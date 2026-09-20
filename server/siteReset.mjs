/**
 * Factory reset: drop the public schema, delete every account, and mark the site uninstalled so
 * the browser lands back on the Setup Wizard.
 *
 * Three gates, all checked on the server, because the browser half of a destructive action is
 * only a convenience:
 *   1. a valid session whose profiles.role is administrator or super_admin;
 *   2. that account's own password, re-entered and verified against Supabase Auth;
 *   3. the literal word RESET, typed.
 *
 * Uploaded files go too. wipeSiteMedia below deletes every Cloudinary asset this site recorded,
 * plus its media/ and plugins/ prefixes, and it runs BEFORE the database is dropped because the
 * media table is the only record of what this site uploaded. The operator can opt out per reset.
 *
 * ImageKit files are not deleted. ImageKit's delete API needs the stored fileId and offers no
 * bulk or prefix operation, so wiping a library of any size would mean thousands of serial
 * requests inside one HTTP handler. The response says how many were left behind.
 */
import { describeDbError, withClient } from './db.mjs';
import { readConfig, writeConfig } from './config.mjs';
import { cloudinaryConfig, deleteCloudinaryFolder, deleteCloudinaryMediaByIds, mergeResults } from './cloudinary.mjs';
import { parseCloudinaryUrl } from './media.mjs';
import { siteMediaPrefixes } from '../src/lib/mediaScope.js';

export class ResetError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Confirms the caller is an administrator AND re-authenticates them with their password.
 * Checking the role through user_has_cap would be wrong here: manage_options can be granted to
 * other roles from App Settings, and this is not a settings change.
 */
export async function authorizeSiteReset(config, accessToken, password) {
  if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
    throw new ResetError(501, 'This site is not installed, so there is nothing to reset.');
  }
  if (!accessToken) throw new ResetError(401, 'Sign in required.');
  if (typeof password !== 'string' || !password) {
    throw new ResetError(400, 'Enter your administrator password to authorise the reset.');
  }

  const baseUrl = config.supabaseUrl.replace(/\/$/, '');
  const apikey = config.supabasePublishableKey;

  const userResponse = await fetch(`${baseUrl}/auth/v1/user`, {
    headers: { apikey, Authorization: `Bearer ${accessToken}` },
  });
  if (!userResponse.ok) throw new ResetError(401, 'Your session is not valid. Sign in again.');
  const user = await userResponse.json();
  if (!user?.email) throw new ResetError(400, 'Your account has no email address, so its password cannot be verified.');

  const profileResponse = await fetch(
    `${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`,
    { headers: { apikey, Authorization: `Bearer ${accessToken}` } },
  );
  if (!profileResponse.ok) {
    throw new ResetError(502, `Your role could not be read: profiles returned HTTP ${profileResponse.status}.`);
  }
  const [profile] = await profileResponse.json();
  const role = profile?.role || '';
  if (!['administrator', 'super_admin'].includes(role)) {
    throw new ResetError(403, `Resetting the site is restricted to Administrators and Super Admins. Your role is "${role || 'unknown'}".`);
  }

  // Verified by asking Supabase Auth for a token, which is the only thing that actually knows
  // the password. A wrong password must not read as a server fault, hence the explicit 401.
  const passwordResponse = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password }),
  });
  if (!passwordResponse.ok) {
    if (passwordResponse.status === 400 || passwordResponse.status === 401) {
      throw new ResetError(401, 'That is not the password for the account you are signed in as. The site was not reset.');
    }
    throw new ResetError(502, `Your password could not be verified: Supabase Auth returned HTTP ${passwordResponse.status}.`);
  }

  return { user, role };
}

/**
 * Rule B: delete every Cloudinary file this site created, before the database is dropped.
 *
 * Two passes, because neither is complete on its own:
 *   1. every public id recorded in the media table — this is the authoritative list of what this
 *      site uploaded, and it is the only thing that catches assets from before the media/ and
 *      plugins/ prefixes existed, which sit at bare folders like general/ or blog/2026/;
 *   2. the media/ and plugins/ prefixes — this catches files Cloudinary still has but the media
 *      table has lost track of (a failed insert, a row deleted without /api/media-delete).
 *
 * What it deliberately does NOT do is call the Admin API with an empty prefix or all=true. Those
 * wipe the entire Cloudinary cloud, and a cloud is frequently shared between a staging site, a
 * production site and unrelated projects on the same free account. "All media created by this
 * website" is what the media table knows about plus this site's two prefixes — not everything the
 * credentials happen to be able to reach.
 *
 * Runs before the schema is dropped, because afterwards there is no media table to read.
 * Never throws: the reset proceeds and the warnings are reported.
 */
export async function wipeSiteMedia(connectionString, config) {
  const summary = { attempted: true, deleted: 0, notFound: 0, recorded: 0, warnings: [] };
  const cloud = await cloudinaryConfig(config?.supabaseUrl, config?.supabasePublishableKey);
  if (!cloud.ok) {
    summary.attempted = false;
    summary.warnings.push(cloud.reason);
    return summary;
  }
  try {
    const items = await withClient(connectionString, async (client) => {
      const exists = await client.query(`
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and c.relname = 'media'
      `);
      if (!exists.rowCount) return [];
      const { rows } = await client.query(
        "select provider_file_id, url from public.media where provider = 'cloudinary'",
      );
      return rows.map((row) => {
        const fromUrl = row.url ? parseCloudinaryUrl(row.url) : null;
        return {
          publicId: row.provider_file_id || fromUrl?.publicId || null,
          resourceType: fromUrl?.resourceType || 'image',
        };
      }).filter((item) => item.publicId);
    });
    summary.recorded = items.length;

    const results = [];
    if (items.length) results.push(await deleteCloudinaryMediaByIds(items, cloud));
    for (const prefix of siteMediaPrefixes()) results.push(await deleteCloudinaryFolder(prefix, cloud));

    const merged = mergeResults(...results);
    summary.deleted = new Set(merged.deleted).size;
    summary.notFound = new Set(merged.notFound).size;
    summary.warnings.push(...merged.warnings);
  } catch (error) {
    summary.warnings.push(`Cloudinary cleanup did not finish: ${error instanceof Error ? error.message : 'unknown error'}. The reset continued.`);
  }
  return summary;
}

/**
 * Everything in one transaction. Postgres makes DDL transactional, so an error anywhere leaves a
 * fully working site rather than a half-dropped one.
 */
export async function resetSite(connectionString) {
  try {
    return await withClient(connectionString, async (client) => {
      // Counted before the drop. Cloudinary rows have already been deleted at the provider by
      // wipeSiteMedia; this reports the ImageKit ones, which are the files still out there.
      const media = await client.query(`
        select count(*)::int as total
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and c.relname = 'media'
      `);
      let remoteFiles = 0;
      if (media.rows[0].total > 0) {
        const { rows } = await client.query(
          "select count(*)::int as files from public.media where url is not null and provider = 'imagekit'",
        );
        remoteFiles = rows[0].files;
      }

      // cascade takes every table, view, function, trigger and policy in public with it,
      // including handle_new_user and therefore its trigger on auth.users.
      await client.query('drop schema if exists public cascade');
      await client.query('create schema public');
      // Supabase's stock grants. Without them PostgREST cannot see the schema at all after a
      // reinstall, and the Setup Wizard fails with a confusing permission error.
      await client.query('grant usage on schema public to postgres, anon, authenticated, service_role');
      await client.query('grant all on schema public to postgres, service_role');
      await client.query('alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role');
      await client.query('alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role');
      await client.query('alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role');

      // Accounts last: if this fails, the schema drop rolls back with it.
      const deleted = await client.query('delete from auth.users');

      return { usersDeleted: deleted.rowCount || 0, remoteFiles };
    }, { transaction: true });
  } catch (error) {
    throw new ResetError(500, `The reset failed and nothing was changed: ${describeDbError(error, connectionString)}`);
  }
}

/**
 * Flips data/react-wp-config.json back to installed: false. Kept separate from resetSite so the
 * database is never wiped while the config still claims the site is live — this runs after.
 * The Supabase URL and publishable key are preserved: the wizard pre-fills them, and they are
 * not secrets.
 */
export async function markUninstalled() {
  const config = (await readConfig()) || {};
  await writeConfig({ ...config, installed: false });
}
