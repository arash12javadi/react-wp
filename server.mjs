// Must come first: it populates process.env before other modules read it at import time.
import './server/env.mjs';
import { createHmac, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { publicConfig, writeConfig } from './server/config.mjs';
import { ensureSiteInstalled, resolveSiteConfig } from './server/autoSetup.mjs';
import { buildEnvString } from './server/installEnv.mjs';
import { authorizeImageKitUpload, authorizeMediaDelete, deleteFromProvider } from './server/media.mjs';
import { describeDeleteSupport } from './server/integrationConfig.mjs';
import { authorizeSettingsManager, readMediaStorageSettings } from './server/integrationSettings.mjs';
import { renderDocumentInjections, renderEditorInjections } from './server/seo.mjs';
import { handlePluginRequest, resolveOrigin } from './server/plugins.mjs';
import { authorizePluginManager, deletePluginFolder, listPluginFolders } from './server/pluginFiles.mjs';
import { InstallError, installPlugin, MAX_ZIP_BYTES } from './server/pluginInstaller.mjs';
import { handleAdminRequest } from './server/adminRoutes.mjs';
import { handleSecurityRequest } from './server/securityRoutes.mjs';
import { handleIntegrationsRequest, ownsIntegrationPath } from './server/integrationsRoutes.mjs';
import { buildRobots, buildSitemap, purgeSitemap } from './server/sitemap.mjs';
import { configureSecuritySettings, refreshSecuritySettings, securitySettings } from './server/middleware/securitySettings.mjs';
import { consumeRateLimit, rateLimitHeaders, rateLimitMessage, rateLimitTier } from './server/middleware/rateLimiter.mjs';
import {
  assetCacheHeaders, htmlCacheHeaders, notModified, pageCacheBody, pageCacheKey, pageCacheLookup,
  pageCachePurge, pageCacheStore,
} from './server/middleware/pageCache.mjs';
import {
  clearAssetCompressionCache, compressedAsset, compressForResponse, compressibleContentType, negotiateEncoding,
} from './server/middleware/compression.mjs';
import { describeDbError, projectRefFromUrl, resolveConnectionString, withClient } from './server/db.mjs';

const port = Number(process.env.PORT || 3000);
const root = path.resolve('dist');
const schema = await readFile(path.resolve('supabase/schema.sql'), 'utf8');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

/**
 * Writes a JSON response, compressed when the settings and the request's Accept-Encoding both
 * allow it. `request` is only used for negotiation — every call site already has it in scope, as
 * the handler closure's own parameter.
 */
const json = (request, response, status, value, headers = {}) => {
  const encoding = negotiateEncoding(request.headers['accept-encoding'], securitySettings());
  const { body, contentEncoding } = compressForResponse(JSON.stringify(value), encoding);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Accept-Encoding',
    'Content-Length': String(Buffer.byteLength(body)),
    ...(contentEncoding ? { 'Content-Encoding': contentEncoding } : {}),
    ...headers,
  });
  response.end(body);
};

/**
 * The site's config for every decision this server makes: `data/react-wp-config.json`, completed by the
 * environment (`server/autoSetup.mjs`).
 *
 * The name is the one the call sites below already used. It used to read the file alone, which is what
 * broke a site configured entirely through `.env.local`: the database was provisioned and the browser,
 * which reads the same `VITE_*` variables, was signed in, while this server resolved no config at all
 * and answered "This site is not installed, so plugins cannot be uploaded". `resolveSiteConfig` is still
 * a single file read per call, so the per-request cost is what it was.
 */
const readConfig = () => resolveSiteConfig();

/**
 * The config, read once per request and handed to the security engine. readConfig() is a file read,
 * so this also stops the four or five separate readConfig() calls a single request used to make.
 */
const currentConfig = async () => {
  const config = publicConfig(await readConfig());
  configureSecuritySettings(config);
  return config;
};

/**
 * The Supabase pair this server authorises with — and the answer when it has none.
 *
 * `server.mjs` authenticates every credentialed route against Supabase, because that is the project the
 * browser is signed in to, so a site with no Supabase project cannot be authorised *here*, whatever its
 * database is. The message says that rather than "not installed": a configured site whose
 * `data/react-wp-config.json` was simply missing — everything set through `.env.local`, which the wizard
 * never writes — was told it was not installed, which sent people to re-run the wizard against a
 * database that had been installed all along, and then to paste SQL by hand. The auto-setup at the bottom
 * of this file is what makes the first half below the normal case.
 */
const siteSupabase = async () => {
  const config = publicConfig(await readConfig());
  if (config?.supabaseUrl && config?.supabasePublishableKey) return { config, error: null };
  return {
    config,
    error: config?.installed
      ? 'This site is installed on a non-Supabase backend, and this server authorises uploads through a Supabase project. Run the universal server instead (npm run start:hono), which speaks every backend.'
      : 'This site is not installed yet: no Supabase project is configured. Run the Setup Wizard, or put DB_TYPE and VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY in .env.local.',
  };
};


const readBody = async (request) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
};

/**
 * The saved media configuration, and the credentials built from it, for the routes that issue upload
 * credentials and delete files.
 *
 * Read per request rather than cached: an administrator who saves a new provider expects the next
 * upload to use it, and this is three routes on an admin screen, not the hot path.
 */
const currentMedia = async () => {
  const file = await readConfig();
  return readMediaStorageSettings({
    databaseUrl: file?.databaseUrl,
    dbType: file?.dbType,
    supabaseUrl: file?.supabaseUrl,
    supabaseKey: file?.supabasePublishableKey,
    env: process.env,
  });
};

// Installs the CORE schema only. Plugin tables are installed per plugin from the Plugins screen
// (POST /api/admin/plugins/install-schema), so a site that never enables the shop never gets
// twenty shop_* tables it will not use.
/**
 * Provisions the Supabase project this server installs into: the schema, the site options, the first
 * administrator and — on a persistent host — the config file that says where the database is.
 *
 * `body.saveSettings` decides exactly one thing: whether `data/react-wp-config.json` is written. It
 * comes from the wizard's deployment target (`node` can keep a file, `serverless`/`edge` cannot) and
 * it used to gate the whole block, so a wizard run in serverless mode applied the schema and then
 * skipped the options seed *and* the admin promotion. The new administrator kept the `subscriber`
 * role `handle_new_user` gives every sign-up, and the answer was a bare `{ success: true }` with no
 * `env`, so Step 5 had no credentials to show. The universal server (`src/server/index.ts`) has
 * always separated the two; this is the same split, and the doc comment there says the same thing.
 *
 * The answer is the block Step 5 renders: the mode, the `.env` a read-only host needs, and the
 * administrator's *actual* role afterwards — reported, never assumed, so a promotion that matched no
 * account becomes a visible warning instead of a silent downgrade discovered in the database later.
 */
const install = async (body) => {
  // The project reference comes from the URL the wizard sent, exactly as `testDatabase` above does it.
  // Without this the password path looked only at `data/react-wp-config.json`, which a fresh install
  // does not have yet — so Step 3's "Test Connection" passed and Step 5 answered "A database password
  // was sent, but this site's Supabase project reference could not be worked out from its URL".
  const resolved = resolveConnectionString(
    { ...body, projectRef: body.projectRef || projectRefFromUrl(body.supabaseUrl) },
    await readConfig(),
  );
  if (!resolved.ok) throw new Error(resolved.error);
  const siteTitle = String(body.siteTitle || '').trim();
  const adminEmail = String(body.adminEmail || '').trim();
  const requestedAdminId = String(body.adminUserId || '').trim();
  const adminUserId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedAdminId)
    ? requestedAdminId
    : null;
  if (!adminEmail) throw new Error('The administrator email address is required.');
  if (body.saveSettings && !siteTitle) throw new Error('The site title is required.');

  return withClient(resolved.url, async (client) => {
    await client.query(schema);
    await client.query(
      `insert into public.options (option_name, option_value)
       values ($1, $2), ($3, $4), ($5, $6)
       on conflict (option_name) do update set option_value = excluded.option_value`,
      ['site_title', siteTitle || 'My React-WP Site', 'admin_email', adminEmail, 'installed', 'true'],
    );
    const admin = await promoteAdmin(client, { adminUserId, adminEmail });
    if (body.saveSettings) {
      await writeConfig({
        installed: true,
        supabaseUrl: body.supabaseUrl,
        supabasePublishableKey: body.supabasePublishableKey,
      });
    }
    return {
      success: true,
      mode: body.saveSettings ? 'persistent' : 'serverless',
      installed: true,
      // This server installs the Supabase schema and nothing else (`auth.users`, RLS, PostgREST are
      // what the browser it serves reads through), so the block says Supabase whichever label the
      // wizard used for the connection: "Supabase" and "self-hosted Postgres" reach the same project.
      env: buildEnvString({
        dbType: 'supabase',
        supabaseUrl: body.supabaseUrl,
        supabasePublishableKey: body.supabasePublishableKey,
      }),
      admin,
    };
  }).catch((error) => {
    // Driver errors quote the connection string, password included, and Step 5 shows this text as it
    // is. `describeDbError` is the one place that strips it (server/db.mjs) and turns the common ones
    // — a rejected password above all — into the sentence that says which password it means.
    throw new Error(describeDbError(error, resolved.url));
  });
};

/**
 * Promotes the wizard's account to administrator and reports what the row actually says afterwards.
 *
 * The account itself is created in Supabase Auth by the browser (`supabase.auth.signUp`), because
 * `handle_new_user` refuses the administrator role on purpose — accepting one from a sign-up payload
 * would restore the escalation path `public.profiles` exists to close — so this direct connection is
 * the only thing that can promote it. The INSERT covers a project whose trigger did not exist yet
 * when the account was made, the UPDATE covers the `subscriber` row the trigger does create, and
 * `returning` means "no rows" can no longer be mistaken for success: Step 5 warns about the account
 * it could not find instead of the subscriber role being discovered in the database later.
 *
 * Matching is by email first, because that is what identifies an administrator, with the id the
 * browser got back from `signUp` as a second way in for a stored address that differs in case.
 */
const promoteAdmin = async (client, { adminUserId, adminEmail }) => {
  const hasAuthUsers = await client.query(`select to_regclass('auth.users') is not null as present`);
  if (hasAuthUsers.rows?.[0]?.present !== true) {
    return { email: adminEmail, role: null, warning: 'This database has no Supabase auth schema, so there is no account to promote.' };
  }
  const result = await client.query(
    `insert into public.profiles (id, email, display_name, role)
     select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'display_name', 'Administrator'), 'administrator'
     from auth.users u
     where lower(u.email) = lower($2) or ($1::uuid is not null and u.id = $1::uuid)
     on conflict (id) do update set role = 'administrator'
     returning id, email, role`,
    [adminUserId, adminEmail],
  );
  const row = result.rows?.[0];
  if (row) return { id: row.id, email: row.email, role: row.role };
  return {
    email: adminEmail,
    role: null,
    warning: `Supabase Auth has no account for ${adminEmail}, so nothing was promoted. Create that account (or sign up with it), then run this step again.`,
  };
};


/**
 * Renders index.html for a path: the SEO block, the Theme Editor's CSS and code, the tracking
 * scripts and the injected site config. Split out of serveFile so the page cache has something to
 * store and to re-run — the cache holds the string this returns.
 */
const renderIndex = async (request, filePath, seoPath, config) => {
  const html = await readFile(filePath, 'utf8');
  // Tracking scripts stay off the admin and the full-screen page builder.
  const isAdmin = seoPath.replace(/\/+$/, '') === '/admin';
  const isEditor = isAdmin || seoPath.startsWith('/builder/');
  const origin = `http://${request.headers.host || 'localhost'}`;
  const { head, bodyStart, headEnd = '', bodyEnd = '' } = isEditor
    ? await renderEditorInjections(config)
    : await renderDocumentInjections(seoPath, origin, config);
  // The injected block carries its own <title>; leaving the placeholder one in place
  // would win, because browsers honour the first title in the document.
  // Function replacements throughout, so "$&" or "$1" in a script or title is not treated
  // as a replacement pattern.
  // Theme Editor output goes in first, while index.html still has exactly one </head> and one
  // </body> (a pasted script can contain those strings): CSS after the app's stylesheet link,
  // so it wins at equal specificity, and footer scripts last in <body>.
  const themed = html
    .replace(/<\/head>/i, () => (headEnd ? `  ${headEnd}\n  </head>` : '</head>'))
    .replace(/<\/body>/i, () => (bodyEnd ? `  ${bodyEnd}\n  </body>` : '</body>'));
  let withSeo = (head.includes('<title>') ? themed.replace(/\s*<title>.*?<\/title>/i, '') : themed)
    .replace('<!--rwp-seo-->', () => head);
  // Anchored to </head> so a "<body" inside a <head> script is not mistaken for the real tag.
  if (bodyStart) withSeo = withSeo.replace(/<\/head>\s*<body[^>]*>/i, (tag) => `${tag}\n    ${bodyStart}`);
  // The live config, over whatever the build baked in. The literal `=null;` marker is the usual case,
  // but a build can also have written a real object (`vite.config.js` resolves the same config the
  // environment describes), and the config this process reads is the one that must win there too — it is
  // how Step 5 → Dashboard works with no rebuild. `src/server/adapters/node.ts` replaces both shapes the
  // same way; if you change one, change the other.
  const injected = `window.__REACT_WP_CONFIG__=${JSON.stringify(config)};`;
  if (withSeo.includes('window.__REACT_WP_CONFIG__=null;')) {
    return withSeo.replace('window.__REACT_WP_CONFIG__=null;', () => injected);
  }
  return withSeo.replace(/window\.__REACT_WP_CONFIG__=[^;]*;/, () => injected);
};

/**
 * Serves a file from dist/, with the page cache in front of index.html.
 *
 * A cache hit skips renderIndex entirely — that is three or four PostgREST round trips per page
 * view. A stale hit is served immediately and re-rendered after the response has been flushed
 * (`stale-while-revalidate`), so a page falling out of its TTL never makes a visitor wait.
 */
const serveFile = async (request, response, pathname, seoPath = pathname, url = null, config = null) => {
  const relative = pathname === '/' || pathname === '/admin' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(`${root}${path.sep}`)) return false;
  try {
    await access(filePath);
    const settings = securitySettings();
    if (relative === 'index.html') {
      const resolvedConfig = config ?? await currentConfig();
      const cacheable = url ? pageCacheKey(request, url, settings) : { cacheable: false, reason: 'no-url' };
      const lookup = cacheable.cacheable ? pageCacheLookup(cacheable.key, settings) : { state: 'off' };

      // Negotiated once per request. A cache entry was compressed (or not) according to the
      // setting at *store* time; this only decides which of what is already there to send.
      const encoding = negotiateEncoding(request.headers['accept-encoding'], settings);

      if (lookup.state === 'fresh' || lookup.state === 'stale') {
        const { entry } = lookup;
        const picked = pageCacheBody(entry, encoding);
        const headers = {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': htmlCacheHeaders(settings, true),
          Vary: 'Accept-Encoding',
          ETag: entry.etag,
          'X-RWP-Cache': lookup.state === 'fresh' ? 'HIT' : 'STALE',
          Age: String(Math.floor(lookup.age / 1000)),
          ...(picked.contentEncoding ? { 'Content-Encoding': picked.contentEncoding } : {}),
        };
        // ETag identifies the content, not the encoding, so a 304 decision never depends on which
        // representation (br/gzip/raw) happens to be picked — the spec's own rule for a weak ETag.
        if (notModified(request, entry.etag)) {
          response.writeHead(304, headers);
          response.end();
        } else {
          response.writeHead(200, { ...headers, 'Content-Length': String(Buffer.byteLength(picked.body)) });
          response.end(picked.body);
        }
        if (lookup.state === 'stale') {
          // After the response, and swallowed: a failed background render must leave the stale
          // entry in place rather than crashing the process on an unhandled rejection.
          renderIndex(request, filePath, seoPath, resolvedConfig)
            .then((fresh) => pageCacheStore(cacheable.key, fresh, { compress: settings.cache_enable_compression }))
            .catch((error) => console.error(`Background re-render of ${cacheable.key} failed:`, error));
        }
        return true;
      }

      const body = await renderIndex(request, filePath, seoPath, resolvedConfig);
      const entry = cacheable.cacheable ? pageCacheStore(cacheable.key, body, { compress: settings.cache_enable_compression }) : null;
      // A cached MISS already has its compressed copies from pageCacheStore; an uncacheable
      // (BYPASS) render compresses this one response on the fly — there is nothing to store it in.
      const picked = entry ? pageCacheBody(entry, encoding) : compressForResponse(body, encoding);
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': htmlCacheHeaders(settings, Boolean(entry)),
        Vary: 'Accept-Encoding',
        'Content-Length': String(Buffer.byteLength(picked.body)),
        ...(entry ? { ETag: entry.etag } : {}),
        ...(picked.contentEncoding ? { 'Content-Encoding': picked.contentEncoding } : {}),
        'X-RWP-Cache': entry ? 'MISS' : `BYPASS:${cacheable.reason || 'uncacheable'}`,
      });
      response.end(picked.body);
    } else {
      const contentType = contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      const compressible = compressibleContentType(contentType);
      const headers = {
        'Content-Type': contentType,
        'Cache-Control': assetCacheHeaders(pathname, settings),
        // Present whenever compression is even a possibility for this content type, so a proxy or
        // browser cache between here and the visitor varies its own cache on the header correctly —
        // not only on the requests where this particular caller happened to accept it.
        ...(compressible && settings.cache_enable_compression ? { Vary: 'Accept-Encoding' } : {}),
      };
      const encoding = compressible ? negotiateEncoding(request.headers['accept-encoding'], settings) : null;
      // Cached by pathname after the first request (compression.mjs): every asset here is
      // Vite-fingerprinted or otherwise static for the life of this process, so compressing it
      // once and reusing the bytes is correct, not just an optimisation.
      const compressed = encoding ? await compressedAsset(pathname, filePath, contentType, encoding) : null;
      if (compressed) {
        response.writeHead(200, { ...headers, 'Content-Encoding': encoding, 'Content-Length': String(compressed.length) });
        response.end(compressed);
      } else {
        response.writeHead(200, headers);
        createReadStream(filePath).pipe(response);
      }
    }
    return true;
  } catch (error) {
    // "There is no such file" is the ordinary case and returns false so the caller can fall back
    // to the SPA. Anything else is a bug in the render, and swallowing it silently is how a
    // request ends up hanging with nothing written to it and nothing in the log.
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

/**
 * The Setup Wizard's Step 3 probe, in this classic server's own vocabulary.
 *
 * This server installs into PostgreSQL — a Supabase project, or any Postgres the wizard's connection
 * string or its discrete host/port/database/user/password fields describe — so that is the only
 * backend it can honestly test. MySQL, SQLite and LibSQL live in the universal server
 * (`npm run start:hono`, Vercel, Cloudflare), so they get a pointer at it instead of a probe that
 * could never succeed here and would hide the real reason.
 *
 * The whole probe is bounded, and every failure becomes a readable JSON message: this is the
 * endpoint whose unhandled rejections used to surface as an opaque platform 500.
 */
const DB_PROBE_TIMEOUT_MS = 5000;

/** Rejects with `message` unless `promise` settles inside the probe's budget. */
const withinProbeBudget = (promise, message) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), DB_PROBE_TIMEOUT_MS);
  promise.then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); },
  );
});

/** `select 1`'s stronger cousin: a real session, so the answer is the one `install()` will need. */
const probePostgres = (connectionString) => withClient(connectionString, async (client) => {
  const result = await client.query('select version() as version, current_database() as database');
  const row = result?.rows?.[0];
  if (!row) throw new Error('The database answered the probe without a result.');
  return `Connected to ${row.database} on ${String(row.version).split(' ').slice(0, 2).join(' ')}.`;
});

/**
 * Confirms a Supabase project answers for its own publishable key. Checked before the Postgres
 * probe because a wrong key is the more common mistake, and the message should say which is wrong.
 */
const probeSupabaseKey = async (supabaseUrl, publishableKey) => {
  const base = String(supabaseUrl).trim().replace(/\/+$/, '');
  const response = await fetch(`${base}/auth/v1/settings`, {
    headers: publishableKey ? { apikey: String(publishableKey).trim() } : {},
    signal: AbortSignal.timeout(DB_PROBE_TIMEOUT_MS),
  }).catch((error) => {
    throw new Error(`The Supabase project could not be reached at ${base}: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (!response.ok) {
    throw new Error(`The Supabase project at ${base} answered ${response.status} for its auth settings, so the Project URL or the publishable key is wrong.`);
  }
};

/** The wizard's credentials as one Postgres connection string, or `{ status, error }` if they cannot. */
const wizardConnectionString = (body, config) => {
  const supplied = [body.connectionString, body.databaseUrl].find((value) => typeof value === 'string' && value.trim());
  if (supplied) return supplied.trim();
  // The wizard's "fields" mode: no connection string, just the pieces.
  if (typeof body.host === 'string' && body.host.trim() && typeof body.user === 'string' && body.user.trim()) {
    const password = typeof body.password === 'string' ? body.password : '';
    const port = String(body.port || '').trim() || '5432';
    const database = String(body.database || '').trim() || 'postgres';
    return `postgres://${encodeURIComponent(body.user.trim())}:${encodeURIComponent(password)}@${body.host.trim()}:${port}/${database}`;
  }
  const resolved = resolveConnectionString(
    { ...body, projectRef: body.projectRef || projectRefFromUrl(body.supabaseUrl) },
    config,
  );
  return resolved.ok ? resolved.url : { status: resolved.status || 400, error: resolved.error };
};

/** Answers `POST /api/install/test-db` and `POST /api/install/check` with `{ status, body }`. */
const testDatabase = async (body) => {
  const dbType = String(body.dbType || 'supabase').toLowerCase();
  const failed = (message, status = 400) => ({ status, body: { success: false, ok: false, error: message, message } });
  if (dbType !== 'supabase' && dbType !== 'postgres') {
    return failed(`This server installs into PostgreSQL or Supabase, so it cannot test "${dbType}". Run the universal server for that backend (npm run start:hono), or deploy to Vercel or Cloudflare.`);
  }
  const connection = wizardConnectionString(body, await readConfig());
  if (typeof connection !== 'string') return failed(connection.error, connection.status);
  try {
    if (dbType === 'supabase' && body.supabaseUrl) await probeSupabaseKey(body.supabaseUrl, body.supabasePublishableKey);
    const message = await withinProbeBudget(
      probePostgres(connection),
      `The database did not respond within ${DB_PROBE_TIMEOUT_MS / 1000} seconds. Check that the host and port are reachable from this machine.`,
    );
    return { status: 200, body: { success: true, ok: true, message } };
  } catch (error) {
    // describeDbError strips the password out of driver messages, which quote the whole URL.
    return failed(describeDbError(error, connection));
  }
};

/** GET /api/health — probes the installed backend. Bounded, and always JSON. */
const reportHealth = async () => {
  const config = await readConfig();
  const dbType = config?.dbType || 'supabase';
  const resolved = resolveConnectionString({}, config);
  if (!resolved.ok) {
    return { status: 503, body: { success: false, ok: false, dbType, error: resolved.error, message: resolved.error } };
  }
  try {
    const message = await withinProbeBudget(
      probePostgres(resolved.url),
      `The database did not respond within ${DB_PROBE_TIMEOUT_MS / 1000} seconds.`,
    );
    return { status: 200, body: { success: true, ok: true, dbType, message } };
  } catch (error) {
    const detail = describeDbError(error, resolved.url);
    return { status: 503, body: { success: false, ok: false, dbType, error: detail, message: detail } };
  }
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    // Rate limiting comes before everything else that costs anything: before the body is read,
    // before Supabase is called, before a file is touched. A limiter that runs after the work it
    // is meant to prevent is decoration. Static files and page views are not counted — they are
    // what the page cache and the CDN headers are for, and counting them would throttle a visitor
    // for loading their own page's assets.
    if (url.pathname.startsWith('/api/')) {
      const tier = rateLimitTier(url.pathname, request.method);
      const decision = consumeRateLimit(request, tier, securitySettings());
      if (!decision.allowed) {
        json(request, response, 429, { error: rateLimitMessage(decision) }, rateLimitHeaders(decision));
        return;
      }
      response.setHeader('X-RateLimit-Limit', String(decision.limit));
      response.setHeader('X-RateLimit-Remaining', String(decision.remaining));
    }

    // The security engine's own endpoints. Returns null for anything it does not own.
    if (url.pathname.startsWith('/api/security/')) {
      const result = await handleSecurityRequest({
        method: request.method,
        pathname: url.pathname,
        headers: request.headers,
        body: request.method === 'POST' ? await readBody(request).catch(() => ({})) : {},
        config: await currentConfig(),
        request,
      });
      // Unlike the plugin routes, an unknown /api/security/ path is a mistake, not something a
      // plugin might own — answering 404 beats falling through to the SPA and returning HTML.
      json(request, response, result ? result.status : 404, result ? result.body : { error: `No security endpoint at ${url.pathname}.` }, result?.headers || {});
      return;
    }

    // Settings → Integrations: the status the screen asks for on mount, and the two credential tests it
    // spends a saved key on. Handled by the shared module, so this server and the Hono app answer with
    // the very same routes.
    if (ownsIntegrationPath(url.pathname)) {
      // Every credential these routes use is in `system_settings`, so the runtime config (for the
      // connection the reader needs) and the environment (for that connection's optional overrides) go
      // with the request. `authorize` is what the two POSTs check the caller with.
      const siteConfig = await currentConfig();
      const file = await readConfig();
      const result = await handleIntegrationsRequest({
        method: request.method,
        pathname: url.pathname,
        headers: request.headers,
        body: request.method === 'POST' ? await readBody(request).catch(() => ({})) : {},
        storage: siteConfig?.storage,
        config: {
          ...siteConfig,
          dbType: file?.dbType || siteConfig?.dbType,
          databaseUrl: file?.databaseUrl,
        },
        env: process.env,
        authorize: (token) => authorizeSettingsManager(
          siteConfig?.supabaseUrl,
          siteConfig?.supabasePublishableKey,
          token,
        ),
      });
      if (!result) {
        // ownsIntegrationPath() already said this exact path is ours, so a null here means the method
        // is wrong, not that the route is missing — 405 with Allow beats a 404 that hides the mistake.
        const allowed = request.method === 'POST' ? 'GET' : 'POST';
        json(request, response, 405, { success: false, ok: false, error: `Only ${allowed} is supported at ${url.pathname}.` }, { Allow: allowed });
        return;
      }
      json(request, response, result.status, result.body);
      return;
    }

    // The native SEO routes. Both are public and both are generated, so they sit in front of the
    // SPA fallback — otherwise /sitemap.xml would serve index.html and a crawler would parse the
    // app shell as a sitemap.
    if (url.pathname === '/sitemap.xml' && request.method === 'GET') {
      const config = await currentConfig();
      if (!securitySettings().sitemap_enabled) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('The sitemap is switched off for this site (Settings → Security → SEO & indexing).\n');
        return;
      }
      const xml = await buildSitemap(`http://${request.headers.host || 'localhost'}`, config);
      const xmlEncoding = negotiateEncoding(request.headers['accept-encoding'], securitySettings());
      const xmlSent = compressForResponse(xml, xmlEncoding);
      response.writeHead(200, {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': `public, max-age=${securitySettings().cache_ttl_seconds}`,
        Vary: 'Accept-Encoding',
        'Content-Length': String(Buffer.byteLength(xmlSent.body)),
        ...(xmlSent.contentEncoding ? { 'Content-Encoding': xmlSent.contentEncoding } : {}),
      });
      response.end(xmlSent.body);
      return;
    }
    if (url.pathname === '/robots.txt' && request.method === 'GET') {
      await currentConfig();
      const robotsEncoding = negotiateEncoding(request.headers['accept-encoding'], securitySettings());
      const robotsSent = compressForResponse(buildRobots(`http://${request.headers.host || 'localhost'}`), robotsEncoding);
      response.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        Vary: 'Accept-Encoding',
        'Content-Length': String(Buffer.byteLength(robotsSent.body)),
        ...(robotsSent.contentEncoding ? { 'Content-Encoding': robotsSent.contentEncoding } : {}),
      });
      response.end(robotsSent.body);
      return;
    }

    if (url.pathname === '/api/site-config.js' && request.method === 'GET') {
      const config = publicConfig(await readConfig());
      response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(`window.__REACT_WP_CONFIG__=${JSON.stringify(config)};`);
      return;
    }
    if (url.pathname === '/api/imagekit-auth' && request.method === 'GET') {
      // The private key is stored under Settings → Integrations, and read here from the database: the
      // server no longer needs it in its environment, so rotating it does not mean a restart.
      const media = await currentMedia();
      if (!media.credentials.imagekit.privateKey) {
        json(request, response, 501, {
          error: media.readable
            ? 'ImageKit is not configured: save the URL endpoint, public key and private key under Settings → Integrations, on the Media & storage card.'
            : `ImageKit cannot be used on this server: ${media.error}`,
        });
        return;
      }
      const privateKey = media.credentials.imagekit.privateKey;
      const { config, error } = await siteSupabase();
      if (error) {
        json(request, response, 501, { error });
        return;
      }
      // Previously anyone could fetch upload credentials; now only uploaders within quota can.
      const auth = await authorizeImageKitUpload(
        config.supabaseUrl,
        config.supabasePublishableKey,
        (request.headers.authorization || '').replace(/^Bearer\s+/i, ''),
        url.searchParams.get('bytes'),
      );
      if (!auth.ok) {
        json(request, response, auth.status, { error: auth.error });
        return;
      }
      const token = randomUUID();
      const expire = Math.floor(Date.now() / 1000) + 600;
      const signature = createHmac('sha1', privateKey).update(token + expire).digest('hex');
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ token, expire, signature }));
      return;
    }
    if (url.pathname === '/api/media-delete' && request.method === 'POST') {
      const { config, error } = await siteSupabase();
      if (error) {
        json(request, response, 501, { error });
        return;
      }
      const token = (request.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const body = await readBody(request);
      const auth = await authorizeMediaDelete(config.supabaseUrl, config.supabasePublishableKey, token, body.id);
      if (!auth.ok) {
        json(request, response, auth.status, { error: auth.error });
        return;
      }
      const result = await deleteFromProvider(
        auth.item.provider,
        auth.item.provider_file_id,
        auth.item.url,
        (await currentMedia()).credentials,
      );
      if (!result.ok) {
        json(request, response, result.status, { error: result.error });
        return;
      }
      json(request, response, 200, { success: true, skipped: Boolean(result.skipped) });
      return;
    }
    // Per-plugin schema install, plugin uninstall and the site reset. Returns null for anything
    // it does not own (including /api/admin/plugins/upload below), so this can sit first.
    if (url.pathname.startsWith('/api/admin/')) {
      const adminResult = await handleAdminRequest({
        method: request.method,
        pathname: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: request.headers,
        body: request.method === 'POST' && url.pathname !== '/api/admin/plugins/upload'
          ? await readBody(request).catch(() => ({}))
          : {},
        config: publicConfig(await readConfig()),
      });
      if (adminResult) {
        json(request, response, adminResult.status, adminResult.body);
        return;
      }
    }
    if (url.pathname === '/api/admin/plugins/upload') {
      if (request.method !== 'POST') {
        json(request, response, 405, { error: 'Method not allowed' });
        return;
      }
      const { config, error } = await siteSupabase();
      if (error) {
        json(request, response, 501, { error });
        return;
      }
      // Checked before the body is read, so nobody without permission can make the server buffer 25 MB.
      const auth = await authorizePluginManager(
        config.supabaseUrl,
        config.supabasePublishableKey,
        (request.headers.authorization || '').replace(/^Bearer\s+/i, ''),
      );
      if (!auth.ok) {
        json(request, response, auth.status, { error: auth.error });
        return;
      }
      const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      let source;
      if (contentType === 'application/json') {
        const body = await readBody(request).catch(() => null);
        if (!body || typeof body.url !== 'string' || !body.url.trim()) {
          json(request, response, 400, { error: 'Send JSON like {"url": "https://…/plugin.zip"}.' });
          return;
        }
        source = { url: body.url.trim() };
      } else if (['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(contentType)) {
        if (Number(request.headers['content-length']) > MAX_ZIP_BYTES) {
          json(request, response, 413, { error: `Plugin ZIPs may be at most ${MAX_ZIP_BYTES / 1024 / 1024} MB.` });
          return;
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > MAX_ZIP_BYTES) {
            // Close the connection once the error is flushed, instead of reading the rest of the upload.
            response.on('finish', () => request.destroy());
            json(request, response, 413, { error: `Plugin ZIPs may be at most ${MAX_ZIP_BYTES / 1024 / 1024} MB.` });
            return;
          }
          chunks.push(chunk);
        }
        source = { zip: Buffer.concat(chunks) };
      } else {
        json(request, response, 415, { error: `Send the ZIP as application/zip, or a download URL as application/json (got "${contentType || 'no content type'}").` });
        return;
      }

      // One JSON object per line: progress steps as they happen — each carrying the mode that says how
      // the dialog labels it, which on this engine is always the disk — then the result or the error.
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      const send = (event) => response.write(`${JSON.stringify(event)}\n`);
      try {
        const result = await installPlugin(source, auth, (step) => send({ type: 'step', step, mode: 'local' }));
        send({ type: 'result', result: { ...result, mode: 'local' } });
      } catch (error) {
        if (!(error instanceof InstallError)) console.error('Plugin installation failed:', error);
        send({
          type: 'error',
          status: error instanceof InstallError ? error.status : 500,
          error: error instanceof InstallError ? error.message : `Plugin installation failed on the server: ${error instanceof Error ? error.message : 'unknown error'}`,
        });
      }
      response.end();
      return;
    }
    if (url.pathname === '/api/plugin-files' || url.pathname === '/api/plugin-files/delete') {
      const { config, error } = await siteSupabase();
      if (error) {
        json(request, response, 501, { error });
        return;
      }
      const auth = await authorizePluginManager(
        config.supabaseUrl,
        config.supabasePublishableKey,
        (request.headers.authorization || '').replace(/^Bearer\s+/i, ''),
      );
      if (!auth.ok) {
        json(request, response, auth.status, { error: auth.error });
        return;
      }
      if (url.pathname === '/api/plugin-files' && request.method === 'GET') {
        json(request, response, 200, await listPluginFolders());
        return;
      }
      if (url.pathname === '/api/plugin-files/delete' && request.method === 'POST') {
        const body = await readBody(request);
        const result = await deletePluginFolder(auth, body.id).catch((error) => ({
          status: Number(error?.status) || 500,
          body: { error: `Deleting plugins/${String(body.id)} failed: ${error instanceof Error ? error.message : 'unknown error'}` },
        }));
        json(request, response, result.status, result.body);
        return;
      }
      json(request, response, 405, { error: 'Method not allowed' });
      return;
    }
    if (url.pathname.startsWith('/api/plugins/')) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const config = publicConfig(await readConfig());
      const result = await handlePluginRequest({
        method: request.method,
        path: url.pathname.slice('/api/plugins/'.length),
        query: Object.fromEntries(url.searchParams),
        headers: request.headers,
        // Kept raw: Stripe webhook signatures are computed over the exact bytes received.
        rawBody: Buffer.concat(chunks),
        supabase: { url: config?.supabaseUrl, publishableKey: config?.supabasePublishableKey },
        origin: resolveOrigin(request.headers),
      });
      if (result.redirect) {
        response.writeHead(result.status || 302, { Location: result.redirect });
        response.end();
      } else if (result.text !== undefined) {
        response.writeHead(result.status, result.headers || { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(result.text);
      } else {
        json(request, response, result.status, result.body ?? {});
      }
      return;
    }
    if (url.pathname === '/api/media-config' && request.method === 'GET') {
      // Reports only whether deletion is possible; never echoes a secret. The answer comes from the
      // provider credentials saved under Settings → Integrations, which is also what a delete uses, so
      // the Media screen cannot be told deletion works while it would silently leave the file behind.
      const media = await currentMedia();
      json(request, response, 200, {
        ...describeDeleteSupport(media.configuration),
        provider: media.configuration.provider,
        readable: media.readable,
        reason: media.readable ? '' : media.error,
      });
      return;
    }
    // The Setup Wizard's own endpoints: Step 0's "is this site installed?" and Step 3's "Test
    // Connection". The universal server answers these from its own handlers; this classic server
    // speaks PostgreSQL and Supabase, which is exactly what the wizard's Supabase and
    // self-hosted-Postgres paths need. Both answer JSON on every path, never the SPA fallback.
    if (url.pathname === '/api/install/check' && request.method === 'GET') {
      const config = await readConfig();
      json(request, response, 200, { installed: config?.installed === true, dbType: config?.dbType || 'supabase' });
      return;
    }
    if ((url.pathname === '/api/install/test-db' || url.pathname === '/api/install/check') && request.method === 'POST') {
      // A body that is not JSON is the wizard's to fix, and it must not become an opaque 500 here.
      const result = await testDatabase(await readBody(request).catch(() => ({})));
      json(request, response, result.status, result.body);
      return;
    }
    if (url.pathname === '/api/health' && request.method === 'GET') {
      const result = await reportHealth();
      json(request, response, result.status, result.body);
      return;
    }
    if (url.pathname === '/api/install-schema' && request.method === 'POST') {
      const body = await readBody(request);
      const result = await install(body);
      // The site the engine was told about no longer exists, and neither does anything rendered
      // from it. Re-point it and start again from the new project's settings.
      pageCachePurge();
      clearAssetCompressionCache();
      purgeSitemap();
      configureSecuritySettings(await currentConfig());
      await refreshSecuritySettings();
      json(request, response, 200, result);
      return;
    }
    // Anything else under /api/ is a mistake, not a page. Without this the SPA fallback below
    // answered `GET /api/health` with index.html and a 200, which is how a missing endpoint ends up
    // looking like a working one.
    if (url.pathname.startsWith('/api/')) {
      json(request, response, 404, { error: `No API endpoint at ${url.pathname}.` });
      return;
    }
    const config = request.method === 'GET' ? await currentConfig() : null;
    if (request.method === 'GET' && await serveFile(request, response, url.pathname, url.pathname, url, config)) return;
    if (request.method === 'GET') {
      // SPA fallback: serve index.html but keep the real path so SEO tags match the route.
      // If even index.html is missing, say so — this used to leave the request hanging.
      if (await serveFile(request, response, '/', url.pathname, url, config)) return;
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('dist/index.html is missing. Run "npm run build" before starting the server.\n');
      return;
    }
    json(request, response, 405, { error: 'Method not allowed' });
  } catch (error) {
    // Named after the route that actually failed. This used to say "Database setup failed" for
    // every request, which sent people to check their Supabase password over a media or plugin bug.
    const pathname = (() => {
      try {
        return new URL(request.url || '/', 'http://localhost').pathname;
      } catch {
        return request.url || '/';
      }
    })();
    const detail = error instanceof Error ? error.message : 'Unknown server error';
    console.error(`${request.method} ${pathname} failed:`, error);
    json(request, response, 500, {
      error: pathname === '/api/install-schema'
        ? `Database setup failed: ${detail}`
        : `${request.method} ${pathname} failed on the server: ${detail}`,
    });
  }
});

/**
 * The direct-SQL half of the auto-setup: `options.installed = 'true'`, the statement the Setup Wizard
 * runs in Step 5, so a hand-configured site never needs that SQL pasted into the Supabase editor by hand.
 *
 * `withClient` is the same helper `install` above uses, and `describeDbError` is the one place that
 * strips the password out of a driver message — a log line is not allowed to be the place a connection
 * string leaks. `skipped` is the honest answer when there is no direct connection string to use:
 * `server.mjs` still treats the site as installed, because it is configured, and says so in the log.
 */
const seedInstalledOption = async (config) => {
  const url = [config.databaseUrl, process.env.SUPABASE_DB_URL]
    .find((value) => /^postgres(ql)?:\/\//i.test(String(value || '').trim()));
  if (!url) {
    return { status: 'skipped', reason: 'no direct PostgreSQL connection string in DATABASE_URL or SUPABASE_DB_URL' };
  }
  try {
    await withClient(url, (client) => client.query(
      `insert into public.options (option_name, option_value)
       values ('installed', 'true')
       on conflict (option_name) do update set option_value = excluded.option_value`,
    ));
    return { status: 'seeded' };
  } catch (error) {
    return { status: 'failed', reason: describeDbError(error, url) };
  }
};

/**
 * Site auto-setup, before anything is served — `server/autoSetup.mjs` does the work and logs
 * `[Auto-Setup] Site installation verified/auto-seeded in system_settings.`
 *
 * It runs *before* `configureSecuritySettings` below reads the config, so a site that had no
 * `data/react-wp-config.json` (the whole `.env.local`-only case) is written and marked installed before
 * the first request is limited, and before any route asks whether the site is installed.
 */
await ensureSiteInstalled({ seed: seedInstalledOption });

// Read once at startup so the very first request is already limited and already knows its rules,
// rather than running on the defaults until the first timer tick. A site that is not installed
// yet has nothing to read and keeps the defaults, which is correct.
configureSecuritySettings(publicConfig(await readConfig()));
await refreshSecuritySettings();

server.listen(port, () => {
  const settings = securitySettings();
  console.log(`React-WP server listening on port ${port}`);
  console.log(
    `Security: rate limit ${settings.rate_limit_auth_max}/${settings.rate_limit_api_max} per ${settings.rate_limit_window_minutes} min`
    + `, anti-bot ${settings.anti_bot_provider}${settings.anti_bot_honeypot ? ' + honeypot' : ''}`
    + `, page cache ${settings.cache_enabled ? `on (${settings.cache_ttl_seconds}s)` : 'off'}`,
  );
});
