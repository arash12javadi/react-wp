import { createHmac, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
// @ts-expect-error -- shared .mjs helper, also used by server.mjs
import { authorizeImageKitUpload } from '../server/media.mjs';

// ImageKit uploads cannot be signed in the browser: the signature needs the private key.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  if (!privateKey) {
    return res.status(501).json({ error: 'IMAGEKIT_PRIVATE_KEY is not configured on this server.' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(501).json({ error: 'Supabase environment variables are not configured on this deployment.' });
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
