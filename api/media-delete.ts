import type { VercelRequest, VercelResponse } from '@vercel/node';
// @ts-expect-error -- shared .mjs helper, also used by server.mjs
import { authorizeUploader, deleteFromProvider } from '../server/media.mjs';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(501).json({ error: 'Supabase environment variables are not configured on this deployment.' });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const auth = await authorizeUploader(supabaseUrl, supabaseKey, token);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const { provider, providerFileId, url } = req.body || {};
  const result = await deleteFromProvider(provider, providerFileId, url, supabaseUrl, supabaseKey);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }
  return res.status(200).json({ success: true, skipped: Boolean(result.skipped) });
}
