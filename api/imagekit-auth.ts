import { createHmac, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
// @ts-expect-error -- shared .mjs helpers, also used by server.mjs and the Hono app
import { authorizeImageKitUpload } from '../server/media.mjs';
// @ts-expect-error -- shared .mjs helper
import { readMediaStorageSettings } from '../server/integrationSettings.mjs';

/**
 * ImageKit uploads cannot be signed in the browser: the signature needs the private key.
 *
 * The key comes from `system_settings.media_storage_config` — the row Settings → Integrations writes —
 * rather than from the environment, so it is read through whichever connection this deployment has. On
 * Vercel that means `DATABASE_URL` (the project's PostgreSQL connection string) or a service key; a
 * deployment with neither says so instead of failing with a signature the browser cannot use.
 */
async function imagekitPrivateKey(): Promise<{ key: string; reason: string }> {
  const media = await readMediaStorageSettings({
    databaseUrl: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL,
    dbType: process.env.DB_TYPE || process.env.VITE_DB_TYPE,
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    supabaseKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
    env: process.env,
  });
  if (media.credentials.imagekit.privateKey) return { key: media.credentials.imagekit.privateKey, reason: '' };
  return {
    key: '',
    reason: media.readable
      ? 'ImageKit is not configured: save the URL endpoint, public key and private key under Settings → Integrations, on the Media & storage card.'
      : `ImageKit cannot be used on this deployment: ${media.error}`,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(501).json({ error: 'Supabase environment variables are not configured on this deployment.' });
  }

  const { key: privateKey, reason } = await imagekitPrivateKey();
  if (!privateKey) {
    return res.status(501).json({ error: reason });
  }

  // Only signed-in uploaders within their disk quota get upload credentials.
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const auth = await authorizeImageKitUpload(supabaseUrl, supabaseKey, token, req.query.bytes);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const uploadToken = randomUUID();
  const expire = Math.floor(Date.now() / 1000) + 600;
  const signature = createHmac('sha1', privateKey).update(uploadToken + expire).digest('hex');

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ token: uploadToken, expire, signature });
}
