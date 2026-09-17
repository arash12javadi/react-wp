/**
 * Plugin folders on disk, for the Plugins screen: like WordPress, a plugin is installed when its
 * folder exists, and Delete removes the folder. Browser bundles are built from these folders
 * (import.meta.glob in src/main.jsx), so a change on disk reaches the site after a rebuild
 * (npm start) or immediately under npm run dev.
 */
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { readServerPluginImports, removeServerPluginImport } from './serverPluginImports.mjs';

const pluginsRoot = path.resolve('plugins');
const pluginIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css']);

/** Confirms the caller may manage plugins, using their own access token (no service key). */
export async function authorizePluginManager(supabaseUrl, supabaseKey, accessToken) {
  if (!accessToken) return { ok: false, status: 401, error: 'Sign in required.' };
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${accessToken}` };
  const userResponse = await fetch(`${baseUrl}/auth/v1/user`, { headers });
  if (!userResponse.ok) return { ok: false, status: 401, error: 'Your session is not valid. Sign in again.' };
  const capResponse = await fetch(`${baseUrl}/rest/v1/rpc/user_has_cap`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ capability: 'activate_plugins' }),
  });
  if (!capResponse.ok) {
    return { ok: false, status: 502, error: `Could not check your plugin permission: user_has_cap returned HTTP ${capResponse.status}.` };
  }
  if (await capResponse.json() !== true) {
    return { ok: false, status: 403, error: 'Your role cannot manage plugins: it does not have the activate_plugins capability.' };
  }
  return { ok: true, baseUrl, headers };
}

/** Every plugins/<folder> with a readable manifest.json. Broken folders are reported, not skipped silently. */
export async function listPluginFolders() {
  let entries;
  try {
    entries = await readdir(pluginsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return { plugins: [], problems: [] };
    throw error;
  }
  const plugins = [];
  const problems = [];
  for (const entry of entries) {
    // Hidden folders are not plugins (Vite's import.meta.glob skips them too).
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const folder = entry.name;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(pluginsRoot, folder, 'manifest.json'), 'utf8'));
    } catch (error) {
      problems.push(error?.code === 'ENOENT'
        ? `plugins/${folder} has no manifest.json, so it is not a plugin.`
        : `plugins/${folder}/manifest.json could not be read: ${error instanceof Error ? error.message : 'unknown error'}.`);
      continue;
    }
    if (typeof manifest?.id !== 'string' || !pluginIdPattern.test(manifest.id)) {
      problems.push(`plugins/${folder}/manifest.json has an invalid id ${JSON.stringify(manifest?.id)}.`);
      continue;
    }
    const duplicate = plugins.find((plugin) => plugin.id === manifest.id);
    if (duplicate) {
      problems.push(`plugins/${folder} and plugins/${duplicate.folder} both use the plugin id "${manifest.id}".`);
      continue;
    }
    try {
      await stat(path.join(pluginsRoot, folder, 'index.tsx'));
    } catch {
      problems.push(`plugins/${folder} has no index.tsx, so the build cannot load it.`);
      continue;
    }
    plugins.push({ id: manifest.id, folder, name: String(manifest.name || manifest.id), version: String(manifest.version || '') });
  }
  return { plugins, problems };
}

async function* sourceFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (sourceExtensions.has(path.extname(entry.name))) yield full;
  }
}

/** Other plugin folders whose source imports from plugins/<folder>; deleting it would break the build. */
async function findImporters(folder) {
  const importers = [];
  const pattern = new RegExp(`(?:from|import)\\s*\\(?\\s*['"][^'"]*\\.\\./${folder}/`);
  for (const entry of await readdir(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === folder || entry.name.startsWith('.')) continue;
    for await (const file of sourceFiles(path.join(pluginsRoot, entry.name))) {
      if (pattern.test(await readFile(file, 'utf8'))) {
        importers.push(`plugins/${entry.name}/${path.relative(path.join(pluginsRoot, entry.name), file).replace(/\\/g, '/')}`);
        break;
      }
    }
  }
  return importers;
}

async function readActiveIds(auth) {
  const response = await fetch(`${auth.baseUrl}/rest/v1/options?option_name=eq.rwp_active_plugins&select=option_value`, { headers: auth.headers });
  if (!response.ok) throw Object.assign(new Error(`Could not read rwp_active_plugins (HTTP ${response.status}).`), { status: 502 });
  const [row] = await response.json();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.option_value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Deletes plugins/<id> from disk. The plugin must be inactive, as in WordPress. */
export async function deletePluginFolder(auth, id) {
  if (typeof id !== 'string' || !pluginIdPattern.test(id)) {
    return { status: 400, body: { error: `Invalid plugin id ${JSON.stringify(id)}.` } };
  }
  const { plugins } = await listPluginFolders();
  const plugin = plugins.find((item) => item.id === id);
  if (!plugin) {
    return { status: 404, body: { error: `No folder in plugins/ has a manifest.json with the id "${id}", so there is nothing to delete.` } };
  }
  const folder = path.join(pluginsRoot, plugin.folder);
  if (path.dirname(folder) !== pluginsRoot) return { status: 400, body: { error: `Invalid plugin folder ${JSON.stringify(plugin.folder)}.` } };

  // A missing option means every bundled plugin is active (see App.tsx).
  const activeIds = await readActiveIds(auth);
  if (activeIds === null || activeIds.includes(id)) {
    return { status: 409, body: { error: `"${id}" is active. Deactivate it before deleting it.` } };
  }

  const importers = await findImporters(plugin.folder);
  if (importers.length) {
    return {
      status: 409,
      body: { error: `"${id}" cannot be deleted: ${importers.join(', ')} import${importers.length === 1 ? 's' : ''} its code, so the next build would fail. Delete that plugin first.` },
    };
  }

  // Import removed first: if that edit is refused, the plugin is left fully installed.
  let serverImportRemoved = false;
  if (/^[a-z0-9][a-z0-9-]{0,63}$/.test(plugin.folder) && (await readServerPluginImports()).includes(plugin.folder)) {
    try {
      serverImportRemoved = (await removeServerPluginImport(plugin.folder)).changed;
    } catch (error) {
      return { status: 500, body: { error: `"${id}" was not deleted: its import could not be removed from server/plugins.mjs. ${error instanceof Error ? error.message : ''}`.trim() } };
    }
  }
  await rm(folder, { recursive: true, force: false, maxRetries: 3, retryDelay: 200 });
  return { status: 200, body: { success: true, serverImportRemoved } };
}
