// Must come first: it populates process.env before other modules read it at import time.
import './server/env.mjs';
import { createHmac, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { publicConfig, readConfig, writeConfig } from './server/config.mjs';
import { authorizeImageKitUpload, authorizeMediaDelete, deleteFromProvider, describeDeleteSupport } from './server/media.mjs';
import { renderDocumentInjections, renderEditorInjections } from './server/seo.mjs';
import { handlePluginRequest, resolveOrigin } from './server/plugins.mjs';
import { authorizePluginManager, deletePluginFolder, listPluginFolders } from './server/pluginFiles.mjs';
import { InstallError, installPlugin, MAX_ZIP_BYTES } from './server/pluginInstaller.mjs';
import { handleAdminRequest } from './server/adminRoutes.mjs';
import { handleSecurityRequest } from './server/securityRoutes.mjs';
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
import { resolveConnectionString, withClient } from './server/db.mjs';

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
 * The config, read once per request and handed to the security engine. readConfig() is a file read,
 * so this also stops the four or five separate readConfig() calls a single request used to make.
 */
const currentConfig = async () => {
  const config = publicConfig(await readConfig());
  configureSecuritySettings(config);
  return config;
};

const readBody = async (request) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
};

// Installs the CORE schema only. Plugin tables are installed per plugin from the Plugins screen
// (POST /api/admin/plugins/install-schema), so a site that never enables the shop never gets
// twenty shop_* tables it will not use.
const install = async (body) => {
  const resolved = resolveConnectionString(body, await readConfig());
  if (!resolved.ok) throw new Error(resolved.error);
  await withClient(resolved.url, async (client) => {
    await client.query(schema);
    if (body.saveSettings) {
      if (!body.siteTitle || !body.adminEmail) throw new Error('Site title and admin email are required.');
      await client.query(
        `insert into public.options (option_name, option_value)
         values ($1, $2), ($3, $4), ($5, $6)
         on conflict (option_name) do update set option_value = excluded.option_value`,
        ['site_title', body.siteTitle, 'admin_email', body.adminEmail, 'installed', 'true'],
      );
      await client.query(
        `insert into public.profiles (id, email, display_name, role)
         select id, email, coalesce(raw_user_meta_data ->> 'display_name', 'Administrator'), 'administrator'
         from auth.users where lower(email) = lower($1)
         on conflict (id) do update set role = 'administrator'`,
        [body.adminEmail],
      );
      await writeConfig({
        installed: true,
        supabaseUrl: body.supabaseUrl,
        supabasePublishableKey: body.supabasePublishableKey,
      });
    }
  });
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
  return withSeo.replace('window.__REACT_WP_CONFIG__=null;', () => `window.__REACT_WP_CONFIG__=${JSON.stringify(config)};`);
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
      const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
      if (!privateKey) {
        json(request, response, 501, { error: 'IMAGEKIT_PRIVATE_KEY is not configured on this server.' });
        return;
      }
      const config = publicConfig(await readConfig());
      if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
        json(request, response, 501, { error: 'This site is not installed, so uploads cannot be authorised.' });
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
      const config = publicConfig(await readConfig());
      if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
        json(request, response, 501, { error: 'This site is not installed, so media cannot be deleted.' });
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
        config.supabaseUrl,
        config.supabasePublishableKey,
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
      const config = publicConfig(await readConfig());
      if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
        json(request, response, 501, { error: 'This site is not installed, so plugins cannot be uploaded.' });
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

      // One JSON object per line: progress steps as they happen, then the result or the error.
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      const send = (event) => response.write(`${JSON.stringify(event)}\n`);
      try {
        const result = await installPlugin(source, auth, (step) => send({ type: 'step', step }));
        send({ type: 'result', result });
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
      const config = publicConfig(await readConfig());
      if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
        json(request, response, 501, { error: 'This site is not installed, so plugins cannot be managed.' });
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
      // Reports only whether deletion is possible; never echoes a secret.
      json(request, response, 200, describeDeleteSupport());
      return;
    }
    if (url.pathname === '/api/install-schema' && request.method === 'POST') {
      const body = await readBody(request);
      await install(body);
      // The site the engine was told about no longer exists, and neither does anything rendered
      // from it. Re-point it and start again from the new project's settings.
      pageCachePurge();
      clearAssetCompressionCache();
      purgeSitemap();
      configureSecuritySettings(await currentConfig());
      await refreshSecuritySettings();
      json(request, response, 200, { success: true });
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
