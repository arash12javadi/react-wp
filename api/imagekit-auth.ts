import { createHmac, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ImageKit uploads cannot be signed in the browser: the signature needs the private key.
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  if (!privateKey) {
    return res.status(501).json({ error: 'IMAGEKIT_PRIVATE_KEY is not configured on this server.' });
  }

  const token = randomUUID();
  const expire = Math.floor(Date.now() / 1000) + 600;
  const signature = createHmac('sha1', privateKey).update(token + expire).digest('hex');

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ token, expire, signature });
}
