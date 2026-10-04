/**
 * Persistent Node.js server entry point.
 *
 * `npm run start:hono` builds the SPA and runs this: the universal API on Hono plus static serving
 * of `dist/` with SPA fallback.
 *
 * Route order is deliberate: every `/api/*` handler is registered **before** any static file
 * middleware or the catch-all SPA fallback, so `/api/install/check` (and friends) can never be
 * swallowed by `serveStatic` and answered with `index.html`.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { app } from '../index';
import { getRuntimeConfig, publicConfig } from '../config';

const port = Number(process.env.PORT || 3000);
const indexHtmlPath = resolve(process.cwd(), 'dist/index.html');

/**
 * Renders `dist/index.html` with the *current* public config injected. The file is a build-time
 * artifact, so without this a site that finishes the Setup Wizard after the build would keep loading
 * the stale `installed: false`. Reading it per request lets Step 5 -> Dashboard work with no rebuild.
 */
async function renderIndexHtml(): Promise<string> {
  const template = await readFile(indexHtmlPath, 'utf8');
  const injected = `window.__REACT_WP_CONFIG__=${JSON.stringify(publicConfig(await getRuntimeConfig()))};`;
  if (template.includes('window.__REACT_WP_CONFIG__=null;')) {
    return template.replace('window.__REACT_WP_CONFIG__=null;', injected);
  }
  return template.replace(/window\.__REACT_WP_CONFIG__=[^;]*;/, injected);
}

const renderIndex = async (c: Context) => {
  try {
    return c.html(await renderIndexHtml());
  } catch {
    return c.text('dist/index.html is missing. Run "npm run build" before starting the server.', 500);
  }
};

const full = new Hono();

// 1. The universal API first — nothing below this may shadow an /api/* request.
full.route('/', app);

// 2. An unmatched /api/* path is an API 404 (JSON), never the SPA fallback.
full.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// 3. The site root gets index.html with the live config (registered before serveStatic, which would
//    otherwise serve the stale build-time index.html for '/').
full.get('/', renderIndex);

// 4. Static build assets (JS, CSS, images). Only ever reached when no API route matched.
full.use('*', serveStatic({ root: './dist' }));

// 5. SPA fallback for client-side routes (/admin, /login, ...).
full.get('*', renderIndex);

serve({ fetch: full.fetch, port }, (info) => {
  console.log(`React-WP (Hono) listening on http://localhost:${info.port}`);
});
