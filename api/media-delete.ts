import type { VercelRequest, VercelResponse } from '@vercel/node';
// @ts-expect-error -- shared .mjs helpers, also used by server.mjs and the Hono app
import { authorizeMediaDelete, deleteFromProvider } from '../server/media.mjs';
// @ts-expect-error -- shared .mjs helper
import { readMediaStorageSettings } from '../server/integrationSettings.mjs';

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
  // The provider id is read from the stored row, not the request body.
  const auth = await authorizeMediaDelete(supabaseUrl, supabaseKey, token, req.body?.id);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // The provider's keys live in `system_settings.media_storage_config` — the row Settings → Integrations
  // writes — so they are read through whichever connection this deployment has (on Vercel,
  // `DATABASE_URL` or a service key).
  const media = await readMediaStorageSettings({
    databaseUrl: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL,
    dbType: process.env.DB_TYPE || process.env.VITE_DB_TYPE,
    supabaseUrl,
    supabaseKey,
    env: process.env,
  });

  const { provider, provider_file_id: providerFileId, url } = auth.item;
  const result = await deleteFromProvider(provider, providerFileId, url, media.credentials, { supabaseUrl, supabaseKey });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }
  return res.status(200).json({ success: true, skipped: Boolean(result.skipped) });
}
