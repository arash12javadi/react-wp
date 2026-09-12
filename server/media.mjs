import { createHash } from 'node:crypto';

/**
 * Confirms the caller is a signed-in user whose role may upload files, using only the
 * publishable key and the caller's own access token. No service-role key is involved.
 */
export async function authorizeUploader(supabaseUrl, supabaseKey, accessToken) {
  if (!accessToken) return { ok: false, status: 401, error: 'Sign in required.' };
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${accessToken}` };

  const userResponse = await fetch(`${baseUrl}/auth/v1/user`, { headers });
  if (!userResponse.ok) return { ok: false, status: 401, error: 'Your session is not valid.' };
  const user = await userResponse.json();

  const profileResponse = await fetch(
    `${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`,
    { headers },
  );
  if (!profileResponse.ok) return { ok: false, status: 403, error: 'Could not read your profile.' };
  const [profile] = await profileResponse.json();

  const uploaders = ['super_admin', 'administrator', 'editor', 'author'];
  if (!profile || !uploaders.includes(profile.role)) {
    return { ok: false, status: 403, error: 'Your role cannot manage media.' };
  }
  return { ok: true, userId: user.id, role: profile.role };
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
    let rest = segments.slice(uploadIndex + 1);
    // Drop transformation segments and the version marker that precede the public id.
    const versionIndex = rest.findIndex((segment) => /^v\d+$/.test(segment));
    if (versionIndex !== -1) rest = rest.slice(versionIndex + 1);
    if (rest.length === 0) return null;
    const publicId = rest.join('/').replace(/\.[^./]+$/, '');
    return { publicId, resourceType: ['image', 'video', 'raw'].includes(resourceType) ? resourceType : 'image' };
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

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME
      || await readOption(supabaseUrl, supabaseKey, 'cloudinary_cloud_name');
    if (!cloudName) {
      return { ok: false, status: 501, error: 'No Cloudinary cloud name is configured under Media → Upload settings.' };
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHash('sha1')
      .update(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
      .digest('hex');
    const body = new URLSearchParams({ public_id: publicId, api_key: apiKey, timestamp: String(timestamp), signature });
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, { method: 'POST', body });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, status: 502, error: payload.error?.message || `Cloudinary rejected the delete (HTTP ${response.status}).` };
    }
    if (payload.result && payload.result !== 'ok' && payload.result !== 'not found') {
      return { ok: false, status: 502, error: `Cloudinary returned "${payload.result}" for ${publicId}.` };
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
