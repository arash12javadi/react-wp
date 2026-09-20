/**
 * Server-side plugin routes, served at /api/plugins/<plugin-id>/<route>.
 *
 * Plugins are imported by literal path rather than discovered with readdir: Vercel bundles a
 * function by tracing its imports, so a module found at runtime (and its npm dependencies)
 * would be missing from the deployment. There is one import per plugin that ships a server.mjs.
 * The imports are dynamic so a plugin folder deleted from the Plugins screen does not stop
 * the server from starting; any other load error is still logged.
 *
 * The lines between the rwp:server-plugin-imports markers are rewritten by the plugin
 * uploader and Delete (server/serverPluginImports.mjs). Keep exactly one
 * import('../plugins/<folder>/server.mjs'), per line there, or those actions refuse to edit.
 *
 * A plugin server module default-exports { id, routes }, where routes maps
 * "METHOD path" (e.g. "POST stripe/session") to async (context) => response.
 * A response is { status, body } (body is sent as JSON), { status, redirect },
 * or { status, text, headers }.
 */
const loaded = await Promise.allSettled([
  // rwp:server-plugin-imports:start
  import('../plugins/rwp-shop/server.mjs'),
  import('../plugins/rwp-page-builder/server.mjs'),
  import('../plugins/rwp-code-snippets/server.mjs'),
  // rwp:server-plugin-imports:end
]);

const serverPlugins = loaded.flatMap((result) => {
  if (result.status === 'fulfilled') return [result.value.default];
  // A deleted plugin folder is expected; anything else is a real error in the plugin.
  const folderDeleted = result.reason?.code === 'ERR_MODULE_NOT_FOUND' && /Cannot find module .*server\.mjs'/.test(String(result.reason?.message));
  if (!folderDeleted) console.error('A plugin server module failed to load:', result.reason);
  return [];
});

const activeCache = { at: 0, ids: null };

/** Mirrors App.tsx: a missing rwp_active_plugins option means every bundled plugin is active. */
async function readActivePluginIds(supabaseUrl, supabaseKey) {
  if (Date.now() - activeCache.at < 30_000) return activeCache.ids;
  const base = supabaseUrl.replace(/\/$/, '');
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  const read = async (name) => {
    const response = await fetch(`${base}/rest/v1/options?option_name=eq.${name}&select=option_value`, { headers });
    if (!response.ok) throw new Error(`Could not read the ${name} option (HTTP ${response.status}).`);
    const [row] = await response.json();
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.option_value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const active = await read('rwp_active_plugins');
  const ids = active ?? serverPlugins.map((plugin) => plugin.id);
  activeCache.at = Date.now();
  activeCache.ids = ids;
  return ids;
}

const matchRoute = (routes, method, path) => {
  for (const [key, handler] of Object.entries(routes)) {
    const [routeMethod, routePath] = key.split(' ');
    if (routeMethod !== method) continue;
    const patternParts = routePath.split('/').filter(Boolean);
    const pathParts = path.split('/').filter(Boolean);
    if (patternParts.length !== pathParts.length) continue;
    const params = {};
    const matches = patternParts.every((part, index) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(pathParts[index]);
        return true;
      }
      return part === pathParts[index];
    });
    if (matches) return { handler, params };
  }
  return null;
};

/**
 * @param {object} request
 * @param {string} request.method
 * @param {string} request.path        Everything after /api/plugins/
 * @param {Record<string,string>} request.query
 * @param {Record<string,string|string[]|undefined>} request.headers  Lower-case names.
 * @param {Buffer} request.rawBody
 * @param {{ url: string, publishableKey: string }} request.supabase
 * @param {string} request.origin      Public origin of the site, e.g. https://shop.example.com
 * @returns {Promise<{status:number, body?:unknown, redirect?:string, text?:string, headers?:Record<string,string>}>}
 */
export async function handlePluginRequest(request) {
  const [pluginId, ...rest] = request.path.split('/').filter(Boolean);
  const plugin = serverPlugins.find((item) => item.id === pluginId);
  if (!plugin) return { status: 404, body: { error: `No server plugin is registered with the id "${pluginId}".` } };
  if (!request.supabase?.url || !request.supabase?.publishableKey) {
    return { status: 501, body: { error: 'This site is not installed, so plugin endpoints are unavailable.' } };
  }

  const activeIds = await readActivePluginIds(request.supabase.url, request.supabase.publishableKey);
  if (!activeIds.includes(plugin.id)) {
    return { status: 404, body: { error: `The plugin "${plugin.id}" is not active. Activate it under Plugins.` } };
  }

  const route = matchRoute(plugin.routes, request.method, rest.join('/'));
  if (!route) return { status: 404, body: { error: `${plugin.id} has no route ${request.method} ${rest.join('/')}.` } };

  let parsed;
  const json = () => {
    if (parsed !== undefined) return parsed;
    const text = request.rawBody?.length ? request.rawBody.toString('utf8') : '';
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw Object.assign(new Error('The request body is not valid JSON.'), { status: 400 });
    }
    return parsed;
  };

  try {
    return await route.handler({
      ...request,
      params: route.params,
      json,
      supabase: { ...request.supabase, secretKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '' },
      bearerToken: String(request.headers.authorization || '').replace(/^Bearer\s+/i, ''),
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return { status, body: { error: error instanceof Error ? error.message : 'Unknown plugin error.' } };
  }
}

/** Public origin for building absolute return URLs (payment redirects, email links). */
export function resolveOrigin(headers) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const proto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  const host = String(headers['x-forwarded-host'] || headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}
