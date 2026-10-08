/**
 * The `.env` block the Setup Wizard's last step hands back, as built by the classic server.
 *
 * This mirrors `buildEnvString` in `src/server/index.ts`, which runs inside the Hono bundle
 * (Vercel, Cloudflare, `npm run start:hono`) instead. The two cannot share a module: a Vercel
 * function is bundled on its own and may not read a repository file at runtime, which is the same
 * reason `supabase/schema.sql` is inlined into that bundle. **If you change one, change the other**,
 * or the same site gets two different `.env` files depending on which server answered Step 5.
 *
 * Only what a host needs to *boot* belongs here. Everything else the wizard collected — the storage
 * driver and its S3 credentials above all — is written to the `system_settings` table and read back
 * from the database, so the platform stays agnostic and the block stays short enough to paste.
 *
 * `JWT_SECRET` is emitted only when there is one: the universal runtime refuses to start without it
 * on a non-Supabase backend (hence the unconditional line in the Hono builder), while this server
 * signs no tokens of its own — an empty `JWT_SECRET=` would only invite someone to paste a blank
 * secret into their host.
 */
export function buildEnvString(config = {}) {
  const dbType = config.dbType || 'supabase';
  const lines = [`DB_TYPE=${dbType}`, `VITE_DB_TYPE=${dbType}`];
  if (config.databaseUrl) lines.push(`DATABASE_URL=${config.databaseUrl}`);
  if (config.supabaseUrl) {
    lines.push(`VITE_SUPABASE_URL=${config.supabaseUrl}`);
    lines.push(`VITE_SUPABASE_PUBLISHABLE_KEY=${config.supabasePublishableKey || ''}`);
  }
  if (config.dbHost) {
    lines.push(`DB_HOST=${config.dbHost}`);
    lines.push(`DB_PORT=${config.dbPort ?? ''}`);
    lines.push(`DB_NAME=${config.dbName || ''}`);
    lines.push(`DB_USER=${config.dbUser || ''}`);
    lines.push(`DB_PASSWORD=${config.dbPassword || ''}`);
  }
  if (config.sqliteFile) lines.push(`SQLITE_FILE=${config.sqliteFile}`);
  if (config.libsqlAuthToken) lines.push(`LIBSQL_AUTH_TOKEN=${config.libsqlAuthToken}`);
  if (config.jwtSecret) lines.push(`JWT_SECRET=${config.jwtSecret}`);
  return lines.join('\n');
}
