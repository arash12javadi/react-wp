import { createReadStream } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { Client } from 'pg';
import { publicConfig, readConfig, writeConfig } from './server/config.mjs';

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
        `update auth.users
         set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'administrator')
         where lower(email) = lower($1)`,
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

const serveFile = async (request, response, pathname) => {
  const relative = pathname === '/' || pathname === '/admin' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(`${root}${path.sep}`)) return false;
  try {
    await access(filePath);
    if (relative === 'index.html') {
      const html = await readFile(filePath, 'utf8');
      const config = publicConfig(await readConfig());
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(html.replace('window.__REACT_WP_CONFIG__=null;', `window.__REACT_WP_CONFIG__=${JSON.stringify(config)};`));
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
    if (url.pathname === '/api/install-schema' && request.method === 'POST') {
      const body = await readBody(request);
      await install(body);
      json(response, 200, { success: true });
      return;
    }
    if (request.method === 'GET' && await serveFile(request, response, url.pathname)) return;
    if (request.method === 'GET') {
      await serveFile(request, response, '/');
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
