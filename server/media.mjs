import { createHash } from 'node:crypto';

const rpc = (baseUrl, headers, name, body) => fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// PostgREST answers 404 (PGRST202) for a function that does not exist yet.
const functionMissing = (response) => response.status === 404;

/**
 * Confirms the caller is a signed-in user who may upload files, using only the publishable key
 * and the caller's own access token. No service-role key is involved. The capability is asked
 * of public.user_has_cap() rather than decided from a role list here, so roles granted uploads
 * under Settings → Roles are recognised.
 */
export async function authorizeUploader(supabaseUrl, supabaseKey, accessToken) {
  if (!accessToken) return { ok: false, status: 401, error: 'Sign in required.' };
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${accessToken}` };

  const userResponse = await fetch(`${baseUrl}/auth/v1/user`, { headers });
  if (!userResponse.ok) return { ok: false, status: 401, error: 'Your session is not valid. Sign in again.' };
  const user = await userResponse.json();

  const capResponse = await rpc(baseUrl, headers, 'user_has_cap', { capability: 'upload_files' });
  if (!capResponse.ok) {
    return { ok: false, status: 502, error: `Could not check your upload permission: user_has_cap returned HTTP ${capResponse.status}.` };
  }
  if (await capResponse.json() !== true) {
    return { ok: false, status: 403, error: 'Your role cannot upload or manage media: it does not have the upload_files capability.' };
  }
  return { ok: true, userId: user.id, baseUrl, headers };
}

/**
 * Authorises deleting one library item at its provider. The provider id comes from the stored
 * row, never from the request, and rwp_can_manage_media() applies the same ownership rule as
 * the media delete policy — otherwise any uploader could delete anyone's file by sending its id.
 */
export async function authorizeMediaDelete(supabaseUrl, supabaseKey, accessToken, mediaId) {
  const auth = await authorizeUploader(supabaseUrl, supabaseKey, accessToken);
  if (!auth.ok) return auth;
  if (typeof mediaId !== 'string' || !mediaId) {
    return { ok: false, status: 400, error: 'The request did not say which media item to delete. Reload the Media screen and try again.' };
  }

  const rowResponse = await fetch(
    `${auth.baseUrl}/rest/v1/media?id=eq.${encodeURIComponent(mediaId)}&select=id,provider,provider_file_id,url,uploaded_by`,
    { headers: auth.headers },
  );
  if (!rowResponse.ok) {
    return { ok: false, status: 502, error: `Could not read the media item: HTTP ${rowResponse.status}.` };
  }
  const [item] = await rowResponse.json();
  if (!item) return { ok: false, status: 404, error: 'That media item is no longer in the library.' };

  const permission = await rpc(auth.baseUrl, auth.headers, 'rwp_can_manage_media', { p_uploaded_by: item.uploaded_by });
  // Before the 20260920 migration there is no ownership rule, and the delete policy lets any
  // uploader delete any row, so this matches what the database allows.
  if (!functionMissing(permission)) {
    if (!permission.ok) {
      return { ok: false, status: 502, error: `Could not check permission to delete this item: rwp_can_manage_media returned HTTP ${permission.status}.` };
    }
    if (await permission.json() !== true) {
      return { ok: false, status: 403, error: 'You can only delete media you uploaded yourself. Media is limited to its uploader under Settings → General.' };
    }
  }
  return { ok: true, item };
}

/** ImageKit signs uploads on the server, so the disk quota can be checked before signing. */
export async function authorizeImageKitUpload(supabaseUrl, supabaseKey, accessToken, bytes) {
  const auth = await authorizeUploader(supabaseUrl, supabaseKey, accessToken);
  if (!auth.ok) return auth;
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return { ok: true };

  const response = await rpc(auth.baseUrl, auth.headers, 'rwp_upload_allowance', {});
  if (functionMissing(response)) return { ok: true };
  if (!response.ok) {
    return { ok: false, status: 502, error: `Could not check your disk quota: rwp_upload_allowance returned HTTP ${response.status}.` };
  }
  const allowance = await response.json();
  if (allowance?.quota_bytes !== null && allowance?.quota_bytes !== undefined) {
    const remaining = Number(allowance.quota_bytes) - Number(allowance.used_bytes || 0);
    if (size > remaining) {
      const mb = (value) => (Math.max(value, 0) / 1048576).toFixed(2);
      return { ok: false, status: 403, error: `This file needs ${mb(size)} MB, but you have ${mb(remaining)} MB left of your ${mb(Number(allowance.quota_bytes))} MB disk quota.` };
    }
  }
  return { ok: true };
}

async function readOption(supabaseUrl, supabaseKey, name) {
  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, '')}/rest/v1/options?option_name=eq.${encodeURIComponent(name)}&select=option_value`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
    );
    if (!response.ok) return '';
    const [row] = await response.json();
    return row?.option_value || '';
  } catch {
    return '';
  }
}

/**
 * Recovers a Cloudinary public id from a delivery URL. Rows uploaded before the
 * provider_file_id column existed have no stored id, and without this they could never be
 * removed from Cloudinary at all.
 *
 * Shape: https://res.cloudinary.com/<cloud>/<type>/upload/[transforms/]v<version>/<public_id>.<ext>
 */
export function parseCloudinaryUrl(url) {
  try {
    const { pathname } = new URL(url);
    const segments = pathname.split('/').filter(Boolean);
    const uploadIndex = segments.indexOf('upload');
    if (uploadIndex === -1) return null;
    const resourceType = segments[uploadIndex - 1] || 'image';
    // The cloud the file actually lives in, which may differ from the one configured today.
    const cloudName = uploadIndex >= 2 ? segments[uploadIndex - 2] : null;
    let rest = segments.slice(uploadIndex + 1);
    // Drop transformation segments and the version marker that precede the public id.
    const versionIndex = rest.findIndex((segment) => /^v\d+$/.test(segment));
    if (versionIndex !== -1) rest = rest.slice(versionIndex + 1);
    if (rest.length === 0) return null;
    const publicId = rest.join('/').replace(/\.[^./]+$/, '');
    return { publicId, cloudName, resourceType: ['image', 'video', 'raw'].includes(resourceType) ? resourceType : 'image' };
  } catch {
    return null;
  }
}

/** ImageKit URLs do not encode the fileId, so this only works for stored ids. */
export function describeDeleteSupport() {
  return {
    cloudinary: Boolean(process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET),
    imagekit: Boolean(process.env.IMAGEKIT_PRIVATE_KEY),
  };
}

/** Cloudinary's destroy API and ImageKit's delete API are both signed-only, so neither
 *  can be called from the browser. */
export async function deleteFromProvider(provider, fileId, url, supabaseUrl, supabaseKey) {
  if (provider === 'external') return { ok: true, skipped: true };

  if (provider === 'cloudinary') {
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!apiKey || !apiSecret) {
      return { ok: false, status: 501, error: 'CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must be set in the server environment (.env.local) to delete Cloudinary files.' };
    }

    const fromUrl = url ? parseCloudinaryUrl(url) : null;
    const publicId = fileId || fromUrl?.publicId;
    const resourceType = fromUrl?.resourceType || 'image';
    if (!publicId) {
      return { ok: false, status: 400, error: 'This item has no Cloudinary id and none could be recovered from its URL, so only the library record can be removed.' };
    }

    const cloudName = fromUrl?.cloudName
      || process.env.CLOUDINARY_CLOUD_NAME
      || await readOption(supabaseUrl, supabaseKey, 'cloudinary_cloud_name');
    if (!cloudName) {
      return { ok: false, status: 501, error: 'No Cloudinary cloud name is configured under Media → Upload settings.' };
    }

    // invalidate=true also purges the CDN copy; without it the old URL keeps serving the file
    // for a while after deletion, which looks exactly like the delete did nothing.
    // Signed parameters must be sorted alphabetically.
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHash('sha1')
      .update(`invalidate=true&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
      .digest('hex');
    const body = new URLSearchParams({
      public_id: publicId, invalidate: 'true', api_key: apiKey, timestamp: String(timestamp), signature,
    });
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, { method: 'POST', body });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload.error?.message || `HTTP ${response.status}`;
      return { ok: false, status: 502, error: `Cloudinary rejected the delete of ${publicId} in cloud "${cloudName}": ${detail}. Check that CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET belong to that cloud.` };
    }
    if (payload.result === 'not found') {
      // Previously treated as success, which hid wrong ids and wrong resource types.
      return { ok: false, status: 404, error: `Cloudinary has no ${resourceType} "${publicId}" in cloud "${cloudName}". It may already have been deleted there.` };
    }
    if (payload.result !== 'ok') {
      return { ok: false, status: 502, error: `Cloudinary returned "${payload.result ?? 'no result'}" for ${publicId}.` };
    }
    return { ok: true, publicId };
  }

  if (provider === 'imagekit') {
    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!privateKey) {
      return { ok: false, status: 501, error: 'IMAGEKIT_PRIVATE_KEY must be set in the server environment (.env.local) to delete ImageKit files.' };
    }
    if (!fileId) {
      return { ok: false, status: 400, error: 'This item has no ImageKit file id, so only the library record can be removed. ImageKit ids cannot be recovered from the URL.' };
    }
    const response = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString('base64')}` },
    });
    if (!response.ok && response.status !== 404) {
      const payload = await response.json().catch(() => ({}));
      return { ok: false, status: 502, error: payload.message || 'ImageKit rejected the delete.' };
    }
    return { ok: true };
  }

  return { ok: false, status: 400, error: `Unknown media provider "${provider}".` };
}
