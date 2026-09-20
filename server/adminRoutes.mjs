/**
 * Admin-only endpoints that need a direct database connection: per-plugin schema install,
 * plugin uninstall with an optional backup, and the site reset.
 *
 * These live under /api/admin/ rather than /api/plugins/ on purpose. server.mjs routes the whole
 * /api/plugins/ prefix to plugin-registered server routes, so an endpoint named
 * /api/plugins/install-schema would shadow a name a third-party plugin is entitled to use.
 */
import { hasStoredCredentials, resolveConnectionString, withClient } from './db.mjs';
import {
  deleteMediaRows, dropPluginSchema, exportPluginData, installPluginSchema, readPluginDatabase,
  readPluginMedia, readSchemaState, SchemaError,
} from './pluginSchema.mjs';
import { cloudinaryConfig, deleteCloudinaryFolder, deleteCloudinaryMediaByIds, mergeResults } from './cloudinary.mjs';
import { authorizePluginManager, deletePluginFolder } from './pluginFiles.mjs';
import { authorizeSiteReset, markUninstalled, ResetError, resetSite, wipeSiteMedia } from './siteReset.mjs';

const fail = (error) => ({
  status: error instanceof SchemaError || error instanceof ResetError ? error.status : 500,
  body: { error: error instanceof Error ? error.message : 'Unknown server error.' },
});

/** The caller's plugin permission, or a ready-to-send error. Shared by every route below. */
const requireManager = async (config, headers) => {
  if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
    throw new SchemaError(501, 'This site is not installed, so plugins cannot be managed.');
  }
  const auth = await authorizePluginManager(
    config.supabaseUrl,
    config.supabasePublishableKey,
    (headers.authorization || '').replace(/^Bearer\s+/i, ''),
  );
  if (!auth.ok) throw new SchemaError(auth.status, auth.error);
  return auth;
};

/** Connection string or a 400/501 that names both ways of supplying one. */
const requireConnection = (body, config) => {
  const resolved = resolveConnectionString(body, config);
  if (!resolved.ok) throw new SchemaError(resolved.status, resolved.error);
  return resolved.url;
};

/**
 * GET /api/admin/plugins/schema-status?id=<plugin>
 * What the Plugins screen needs to decide whether to offer Install schema, and what the uninstall
 * dialog needs to tell the truth about how much data is at stake.
 */
async function schemaStatus(config, headers, id) {
  await requireManager(config, headers);
  const { plugin, database, mediaPrefixes } = await readPluginDatabase(id);
  const base = {
    plugin: plugin.id,
    name: plugin.name,
    hasSchema: Boolean(database?.schemaPath),
    canDrop: Boolean(database?.uninstallPath),
    tables: database?.tables || [],
    retains: database?.retains || [],
    mediaPrefixes,
    // So the dialog can say "files will be deleted" rather than promising something the server
    // has no credentials to do.
    cloudinaryConfigured: Boolean(process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET),
    storedCredentials: hasStoredCredentials(),
  };
  if (!database?.tables.length) return { status: 200, body: { ...base, checked: false } };

  const resolved = resolveConnectionString({}, config);
  if (!resolved.ok) {
    // Not an error: without credentials the screen still works, it just cannot show row counts.
    return { status: 200, body: { ...base, checked: false, reason: resolved.error } };
  }
  try {
    const state = await withClient(resolved.url, (client) => readSchemaState(client, database.tables));
    return { status: 200, body: { ...base, checked: true, ...state } };
  } catch (error) {
    return { status: 200, body: { ...base, checked: false, reason: error instanceof Error ? error.message : 'unknown error' } };
  }
}

/** POST /api/admin/plugins/install-schema { id, dbPassword? | connectionString? } */
async function installSchema(config, headers, body) {
  await requireManager(config, headers);
  const id = String(body.id || '');
  const { database } = await readPluginDatabase(id);
  if (!database?.schemaPath) {
    return { status: 200, body: { installed: false, reason: 'no-schema', plugin: id, tables: [] } };
  }
  const result = await installPluginSchema(requireConnection(body, config), id);
  return { status: 200, body: result };
}

/**
 * Rule A: delete only what this plugin uploaded.
 *
 * Scoped by provider prefix (plugins/<id>/), never by the plugin's own table contents. A shop
 * product row points at a URL, but that URL is very often a Media Library file the administrator
 * also used on a page — deleting it because a product referenced it would be exactly the
 * data loss this is supposed to prevent. Only files stored under the plugin's own prefix go.
 *
 * Two passes, because they miss different things: delete-by-prefix catches files Cloudinary has
 * but the media table has forgotten, and delete-by-id catches dynamic-folder clouds, where the
 * folder never appears in the public id.
 *
 * Never throws: a Cloudinary failure is collected as a warning and the database cleanup goes on.
 */
async function wipePluginMedia(connectionString, config, prefixes) {
  const summary = { attempted: true, deleted: 0, notFound: 0, rowsRemoved: 0, prefixes, warnings: [] };
  const cloud = await cloudinaryConfig(config?.supabaseUrl, config?.supabasePublishableKey);
  if (!cloud.ok) {
    summary.attempted = false;
    summary.warnings.push(cloud.reason);
    return summary;
  }
  try {
    const items = await withClient(connectionString, (client) => readPluginMedia(client, prefixes));
    const results = [];
    for (const prefix of prefixes) results.push(await deleteCloudinaryFolder(prefix, cloud));
    if (items.length) results.push(await deleteCloudinaryMediaByIds(items, cloud));
    const merged = mergeResults(...results);

    summary.deleted = new Set(merged.deleted).size;
    summary.notFound = new Set(merged.notFound).size;
    summary.warnings.push(...merged.warnings);

    // The rows go even for ids Cloudinary reported as not_found: the file is gone either way,
    // and leaving the row behind would show a broken image in the library forever.
    if (items.length) {
      summary.rowsRemoved = await withClient(connectionString,
        (client) => deleteMediaRows(client, items.map((item) => item.id)));
    }
  } catch (error) {
    summary.warnings.push(`Media cleanup for ${prefixes.join(', ')} did not finish: ${error instanceof Error ? error.message : 'unknown error'}. The database cleanup continued.`);
  }
  return summary;
}

/**
 * POST /api/admin/plugins/uninstall
 *   { id, mode: 'keep' | 'wipe', backup: boolean, confirm?: 'DELETE',
 *     deleteFolder?: boolean, dbPassword? | connectionString? }
 *
 * Order matters and is not negotiable: export, then drop, then remove the folder. Each step only
 * runs if the one before it succeeded, so nobody ends up with wiped tables and no backup file.
 */
async function uninstall(config, headers, body) {
  const auth = await requireManager(config, headers);
  const id = String(body.id || '');
  const mode = body.mode === 'wipe' ? 'wipe' : 'keep';
  const wantsBackup = body.backup !== false;
  const deleteFolder = body.deleteFolder !== false;

  const { plugin, database, mediaPrefixes } = await readPluginDatabase(id);

  if (mode === 'wipe') {
    if (String(body.confirm || '') !== 'DELETE') {
      throw new SchemaError(400, 'Type DELETE in the confirmation box to wipe this plugin\'s data.');
    }
    if (!database?.uninstallPath) {
      throw new SchemaError(400,
        `"${plugin.id}" ships no uninstall.sql, so its tables cannot be dropped automatically. Choose "keep data", then remove them by hand in the Supabase SQL Editor.`);
    }
  }

  // Resolved up front: finding out the password is wrong only after the folder is gone would be
  // the worst possible ordering. A plugin that owns no tables never opens a connection at all,
  // so uninstalling one must not demand credentials this server may not have.
  // A wipe always connects (it was refused above unless the plugin ships uninstall.sql). A backup
  // only connects when there is something to read, so uninstalling a code-only plugin works on a
  // server that has no database credentials at all.
  const needsDatabase = mode === 'wipe' || (wantsBackup && Boolean(database?.tables.length));
  const connectionString = needsDatabase ? requireConnection(body, config) : '';

  const result = { plugin: plugin.id, mode, backup: null, media: null, dropped: null, folderDeleted: false, warnings: [] };

  if (wantsBackup) {
    if (!database?.tables.length) {
      result.warnings.push(`${plugin.name} declares no tables in its manifest, so the backup file is empty.`);
      result.backup = {
        format: 'react-wp-plugin-backup', version: 1,
        plugin: { id: plugin.id, name: plugin.name, version: plugin.version },
        created_at: new Date().toISOString(), missing_tables: [], tables: {}, options: [],
      };
    } else {
      result.backup = await exportPluginData(connectionString, id);
    }
  }

  if (mode === 'wipe') {
    // Media before tables, as specified: once the rows are gone there is no record of which
    // Cloudinary files this plugin owned, and the delivery URLs are unrecoverable.
    result.media = await wipePluginMedia(connectionString, config, mediaPrefixes);
    result.warnings.push(...result.media.warnings);
    result.dropped = await dropPluginSchema(connectionString, id);
  }

  if (deleteFolder) {
    // Reuses the Delete path, so its rules still apply: the plugin must be inactive, and no other
    // plugin may import its code. A refusal here leaves the database work done and says so.
    const folder = await deletePluginFolder(auth, plugin.id);
    if (folder.status === 200) {
      result.folderDeleted = true;
      result.serverImportRemoved = Boolean(folder.body.serverImportRemoved);
    } else {
      result.warnings.push(`The plugin folder was kept: ${folder.body.error}`);
    }
  }

  return { status: 200, body: result };
}

/** POST /api/admin/reset-site { password, confirm: 'RESET', dbPassword? | connectionString? } */
async function handleReset(config, headers, body) {
  if (String(body.confirm || '') !== 'RESET') {
    throw new ResetError(400, 'Type RESET in the confirmation box to wipe this site.');
  }
  await authorizeSiteReset(
    config,
    (headers.authorization || '').replace(/^Bearer\s+/i, ''),
    body.password,
  );
  const resolved = resolveConnectionString(body, config);
  if (!resolved.ok) throw new ResetError(resolved.status, resolved.error);

  // Media first: the list of what this site uploaded lives in the media table, which the reset
  // is about to drop. Opt-out rather than opt-in, because a factory reset that leaves the files
  // behind is not a factory reset — but a shared Cloudinary cloud is a real enough situation
  // that the operator gets a way to say no.
  const media = body.wipeMedia === false
    ? { attempted: false, deleted: 0, notFound: 0, recorded: 0, warnings: ['Cloudinary files were kept: you cleared "also delete uploaded files".'] }
    : await wipeSiteMedia(resolved.url, config);

  const result = await resetSite(resolved.url);
  // Only after the database is actually empty, or a failed reset would strand the site in the
  // wizard with all its data intact.
  await markUninstalled();
  // The Setup Wizard has no route of its own: App.tsx renders it whenever checkDatabase() fails,
  // which it now will, because public.options no longer exists. So the way back to the wizard is
  // the site root, not "/setup" — that path would fall through to the SPA 404.
  return { status: 200, body: { success: true, ...result, media, next: '/' } };
}

/**
 * Returns null when the path is not one of ours, so server.mjs can fall through to its other
 * routes. `body` is already-parsed JSON for POSTs.
 */
export async function handleAdminRequest({ method, pathname, query, headers, body, config }) {
  try {
    if (pathname === '/api/admin/plugins/schema-status') {
      if (method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } };
      if (!query.id) return { status: 400, body: { error: 'Pass ?id=<plugin id>.' } };
      return await schemaStatus(config, headers, String(query.id));
    }
    if (pathname === '/api/admin/plugins/install-schema') {
      if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
      return await installSchema(config, headers, body);
    }
    if (pathname === '/api/admin/plugins/uninstall') {
      if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
      return await uninstall(config, headers, body);
    }
    if (pathname === '/api/admin/reset-site') {
      if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
      return await handleReset(config, headers, body);
    }
    return null;
  } catch (error) {
    if (!(error instanceof SchemaError) && !(error instanceof ResetError)) {
      console.error(`${pathname} failed:`, error);
    }
    return fail(error);
  }
}
