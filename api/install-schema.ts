import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'pg';

// supabase/schema.sql is the single source of truth, shared with server.mjs.
// vercel.json keeps it in the deployed function bundle.
const readSchema = () => {
  const candidates = [
    path.join(process.cwd(), 'supabase/schema.sql'),
    path.join(__dirname, '../supabase/schema.sql'),
  ];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      continue;
    }
  }
  throw new Error('supabase/schema.sql could not be read from the deployment bundle.');
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const projectRef = typeof body.projectRef === 'string' ? body.projectRef.trim() : '';
  const dbPassword = typeof body.dbPassword === 'string' ? body.dbPassword : '';
  const connectionString = typeof body.connectionString === 'string'
    ? body.connectionString.trim()
    : typeof body.databaseUrl === 'string'
      ? body.databaseUrl.trim()
      : '';
  const { saveSettings, siteTitle, adminEmail } = body;
  if ((!projectRef || !dbPassword) && !connectionString) {
    return res.status(400).json({ error: 'Project reference and database password, or a PostgreSQL connection string, are required.' });
  }

  const suppliedConnectionString = connectionString
    .replace(/\[(?:YOUR-)?PASSWORD\]/gi, encodeURIComponent(dbPassword))
    .replace(/<PASSWORD>/gi, encodeURIComponent(dbPassword));
  const client = new Client({
    connectionString: suppliedConnectionString || `postgres://postgres:${encodeURIComponent(dbPassword)}@db.${projectRef}.supabase.co:5432/postgres`,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    await client.connect();
    if (saveSettings) {
      if (!siteTitle || !adminEmail) {
        throw new Error('Site title and admin email are required.');
      }

      await client.query(
        `insert into public.options (option_name, option_value)
         values ($1, $2), ($3, $4), ($5, $6)
         on conflict (option_name) do update
         set option_value = excluded.option_value`,
        ['site_title', siteTitle, 'admin_email', adminEmail, 'installed', 'true'],
      );
      await client.query(
        `insert into public.profiles (id, email, display_name, role)
         select id, email, coalesce(raw_user_meta_data ->> 'display_name', 'Administrator'), 'administrator'
         from auth.users where lower(email) = lower($1)
         on conflict (id) do update set role = 'administrator'`,
        [adminEmail],
      );
      await client.end();
      return res.status(200).json({ success: true });
    }

    await client.query(readSchema());
    await client.end();
    return res.status(200).json({ success: true });
  } catch (error: unknown) {
    await client.end().catch(() => {});
    const message = error instanceof Error ? error.message : 'Unknown database error';
    return res.status(500).json({ error: `Database setup failed: ${message}` });
  }
}
