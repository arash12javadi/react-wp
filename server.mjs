// Must come first: it populates process.env before other modules read it at import time.
import './server/env.mjs';
import { createHmac, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { Client } from 'pg';
import { publicConfig, readConfig, writeConfig } from './server/config.mjs';
import { authorizeUploader, deleteFromProvider, describeDeleteSupport } from './server/media.mjs';
import { renderSeoTags } from './server/seo.mjs';

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

const json = (response, status, value) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
};

const readBody = async (request) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
};

const databaseUrl = (body) => {
  const supplied = typeof body.connectionString === 'string'
    ? body.connectionString.trim()
    : typeof body.databaseUrl === 'string'
      ? body.databaseUrl.trim()
      : '';
  const password = typeof body.dbPassword === 'string' ? body.dbPassword : '';
  return (supplied || `postgres://postgres:${encodeURIComponent(password)}@db.${body.projectRef}.supabase.co:5432/postgres`)
    .replace(/\[(?:YOUR-)?PASSWORD\]/gi, encodeURIComponent(password))
    .replace(/<PASSWORD>/gi, encodeURIComponent(password));
};

const install = async (body) => {
  const url = databaseUrl(body);
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
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
  } finally {
    await client.end().catch(() => {});
  }
};

const serveFile = async (request, response, pathname, seoPath = pathname) => {
  const relative = pathname === '/' || pathname === '/admin' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(`${root}${path.sep}`)) return false;
  try {
    await access(filePath);
    if (relative === 'index.html') {
      const html = await readFile(filePath, 'utf8');
      const config = publicConfig(await readConfig());
      const isAdmin = seoPath.replace(/\/+$/, '') === '/admin';
      const origin = `http://${request.headers.host || 'localhost'}`;
      const seoTags = isAdmin ? '' : await renderSeoTags(seoPath, origin, config);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      // The injected block carries its own <title>; leaving the placeholder one in place
      // would win, because browsers honour the first title in the document.
      const withSeo = seoTags
        ? html.replace(/\s*<title>.*?<\/title>/i, '').replace('<!--rwp-seo-->', seoTags)
        : html.replace('<!--rwp-seo-->', '');
      response.end(
        withSeo.replace('window.__REACT_WP_CONFIG__=null;', `window.__REACT_WP_CONFIG__=${JSON.stringify(config)};`),
      );
    } else {
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store, max-age=0',
      });
      createReadStream(filePath).pipe(response);
    }
    return true;
  } catch {
    return false;
  }
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/api/site-config.js' && request.method === 'GET') {
      const config = publicConfig(await readConfig());
      response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(`window.__REACT_WP_CONFIG__=${JSON.stringify(config)};`);
      return;
    }
    if (url.pathname === '/api/imagekit-auth' && request.method === 'GET') {
      const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
      if (!privateKey) {
        json(response, 501, { error: 'IMAGEKIT_PRIVATE_KEY is not configured on this server.' });
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
        json(response, 501, { error: 'This site is not installed, so media cannot be deleted.' });
        return;
      }
      const token = (request.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const auth = await authorizeUploader(config.supabaseUrl, config.supabasePublishableKey, token);
      if (!auth.ok) {
        json(response, auth.status, { error: auth.error });
        return;
      }
      const body = await readBody(request);
      const result = await deleteFromProvider(
        body.provider,
        body.providerFileId,
        body.url,
        config.supabaseUrl,
        config.supabasePublishableKey,
      );
      if (!result.ok) {
        json(response, result.status, { error: result.error });
        return;
      }
      json(response, 200, { success: true, skipped: Boolean(result.skipped) });
      return;
    }
    if (url.pathname === '/api/media-config' && request.method === 'GET') {
      // Reports only whether deletion is possible; never echoes a secret.
      json(response, 200, describeDeleteSupport());
      return;
    }
    if (url.pathname === '/api/install-schema' && request.method === 'POST') {
      const body = await readBody(request);
      await install(body);
      json(response, 200, { success: true });
      return;
    }
    if (request.method === 'GET' && await serveFile(request, response, url.pathname)) return;
    if (request.method === 'GET') {
      // SPA fallback: serve index.html but keep the real path so SEO tags match the route.
      await serveFile(request, response, '/', url.pathname);
      return;
    }
    json(response, 405, { error: 'Method not allowed' });
  } catch (error) {
    json(response, 500, { error: `Database setup failed: ${error instanceof Error ? error.message : 'Unknown server error'}` });
  }
});

server.listen(port, () => {
  console.log(`React-WP server listening on port ${port}`);
});
