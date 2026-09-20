/**
 * Cloudinary Admin API, for bulk deletion during plugin uninstall and site reset.
 *
 * There is no `cloudinary` npm package in this project: server/media.mjs already talks to the
 * Upload API over plain REST with a hand-built SHA-1 signature, and adding an SDK for three
 * endpoints would mean a new dependency in the Vercel bundle for no gain. The Admin API is
 * simpler than the Upload API anyway — it uses HTTP Basic auth with api_key:api_secret and
 * needs no signature at all.
 *
 * Endpoints used:
 *   DELETE /v1_1/<cloud>/resources/<type>/upload?prefix=<p>   delete_resources_by_prefix
 *   DELETE /v1_1/<cloud>/resources/<type>/upload?public_ids[] delete_resources        (100 max)
 *   DELETE /v1_1/<cloud>/folders/<path>                        delete_folder (must be empty)
 *
 * Nothing here ever throws. Media deletion is a cleanup step, and a Cloudinary outage, a revoked
 * key or an asset someone already removed by hand must never be the reason an uninstall or a
 * reset fails half way. Every function returns { deleted, notFound, warnings } and the caller
 * reports the warnings.
 */
import { readOption } from './media.mjs';

/** Cloudinary rejects more than 100 public ids in one delete_resources call. */
const ID_BATCH = 100;
/** delete_by_prefix removes up to 1000 per call and sets partial:true when more remain. */
const MAX_PREFIX_PASSES = 50;
const RESOURCE_TYPES = ['image', 'video', 'raw'];

/**
 * Credentials plus the cloud name, or null with a reason. The cloud name is read the same way
 * server/media.mjs reads it, so a site that configured Cloudinary in the admin rather than in
 * the environment still works.
 */
export async function cloudinaryConfig(supabaseUrl, supabaseKey) {
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!apiKey || !apiSecret) {
    return { ok: false, reason: 'CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are not set in the server environment (.env.local), so no files can be deleted from Cloudinary.' };
  }
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
    || (supabaseUrl ? await readOption(supabaseUrl, supabaseKey, 'cloudinary_cloud_name') : '');
  if (!cloudName) {
    return { ok: false, reason: 'No Cloudinary cloud name is configured (CLOUDINARY_CLOUD_NAME, or Media → Upload settings), so no files can be deleted from Cloudinary.' };
  }
  return {
    ok: true,
    cloudName,
    auth: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
  };
}

const adminFetch = async (config, path, params) => {
  const url = new URL(`https://api.cloudinary.com/v1_1/${config.cloudName}/${path}`);
  for (const [key, value] of params || []) url.searchParams.append(key, value);
  const response = await fetch(url, { method: 'DELETE', headers: { Authorization: config.auth } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || `HTTP ${response.status}`;
    throw Object.assign(new Error(detail), { status: response.status });
  }
  return payload;
};

/** Cloudinary reports each id as 'deleted' or 'not_found'; both mean "it is gone now". */
const tally = (payload, result) => {
  for (const [id, state] of Object.entries(payload?.deleted || {})) {
    if (state === 'deleted') result.deleted.push(id);
    else result.notFound.push(id);
  }
};

const emptyResult = () => ({ deleted: [], notFound: [], warnings: [] });

/**
 * Deletes every asset whose public id starts with `folderPrefix`, across images, videos and raw
 * files, then removes the now-empty folder itself.
 *
 * `folderPrefix` must be non-empty. Cloudinary treats an empty prefix as "everything in the
 * cloud", which would also destroy assets belonging to any other site sharing these credentials,
 * so that is refused here rather than guarded at each call site.
 */
export async function deleteCloudinaryFolder(folderPrefix, config) {
  const result = emptyResult();
  const prefix = String(folderPrefix || '').replace(/^\/+|\/+$/g, '');
  if (!prefix) {
    result.warnings.push('Refused to delete an empty Cloudinary prefix: that would wipe every asset in the cloud, including any belonging to other sites that share these credentials.');
    return result;
  }

  for (const type of RESOURCE_TYPES) {
    let pass = 0;
    try {
      // delete_by_prefix is capped per call and answers partial:true while more remain.
      for (;;) {
        const payload = await adminFetch(config, `resources/${type}/upload`, [
          ['prefix', `${prefix}/`],
          ['invalidate', 'true'],
        ]);
        tally(payload, result);
        pass += 1;
        if (!payload?.partial) break;
        if (pass >= MAX_PREFIX_PASSES) {
          result.warnings.push(`Cloudinary still reported more ${type} assets under "${prefix}/" after ${MAX_PREFIX_PASSES} passes; the rest were left in place.`);
          break;
        }
      }
    } catch (error) {
      // 404 here means "no such resource type in this cloud", which is normal for video/raw.
      if (error.status !== 404) {
        result.warnings.push(`Cloudinary could not delete ${type} assets under "${prefix}/": ${error.message}. The database cleanup continued.`);
      }
    }
  }

  // Only possible once the folder is empty, and only in fixed-folder clouds. A failure is not
  // worth reporting as a problem: an empty folder is harmless.
  try {
    await adminFetch(config, `folders/${prefix.split('/').map(encodeURIComponent).join('/')}`);
  } catch {
    // Folder already gone, not empty, or dynamic-folder mode. Nothing depends on this.
  }
  return result;
}

/**
 * Deletes specific assets by public id. Used for the site reset, where the ids come from the
 * media table and are therefore exactly the files this site created — never "everything in the
 * cloud". Ids are grouped by the resource type recorded for them, defaulting to image.
 */
export async function deleteCloudinaryMediaByIds(items, config) {
  const result = emptyResult();
  const byType = new Map();
  for (const item of items) {
    const id = typeof item === 'string' ? item : item?.publicId;
    if (!id) continue;
    const type = RESOURCE_TYPES.includes(item?.resourceType) ? item.resourceType : 'image';
    if (!byType.has(type)) byType.set(type, new Set());
    byType.get(type).add(id);
  }

  for (const [type, ids] of byType) {
    const list = [...ids];
    for (let start = 0; start < list.length; start += ID_BATCH) {
      const batch = list.slice(start, start + ID_BATCH);
      try {
        const payload = await adminFetch(config, `resources/${type}/upload`, [
          ...batch.map((id) => ['public_ids[]', id]),
          ['invalidate', 'true'],
        ]);
        tally(payload, result);
      } catch (error) {
        result.warnings.push(`Cloudinary could not delete ${batch.length} ${type} asset(s) (${batch[0]}…): ${error.message}. The database cleanup continued.`);
      }
    }
  }
  return result;
}

/** Merges several results into one, for reporting a whole uninstall or reset in one line. */
export const mergeResults = (...results) => results.reduce((all, one) => ({
  deleted: [...all.deleted, ...one.deleted],
  notFound: [...all.notFound, ...one.notFound],
  warnings: [...all.warnings, ...one.warnings],
}), emptyResult());
