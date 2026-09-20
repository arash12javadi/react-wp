/**
 * The one place that builds a direct PostgreSQL connection.
 *
 * PostgREST cannot run DDL, so installing a plugin's schema, dropping it again and resetting the
 * site all need a real Postgres session. Two ways to get one, in this order:
 *
 *  1. SUPABASE_DB_URL in .env.local (read by server/env.mjs, like CLOUDINARY_API_SECRET). This is
 *     what makes "Activate" a single click: the server already has credentials.
 *  2. A password or connection string sent with the request. The Setup Wizard has always worked
 *     this way, and it stays the fallback for hosts that will not keep the URL on disk.
 *
 * The password is never written to data/react-wp-config.json and never logged: describeDbError
 * below strips it out of driver messages, which quote the connection string on failure.
 */
import { Client } from 'pg';

/** Substituted into a connection string copied from the Supabase dashboard, which ships placeholders. */
const fillPassword = (value, password) => value
  .replace(/\[(?:YOUR-)?PASSWORD\]/gi, encodeURIComponent(password))
  .replace(/<PASSWORD>/gi, encodeURIComponent(password));

/** The project ref out of https://<ref>.supabase.co, so a password alone is enough to connect. */
export const projectRefFromUrl = (supabaseUrl) => {
  const match = /^https?:\/\/([a-z0-9-]+)\.supabase\.(?:co|in)/i.exec(String(supabaseUrl || ''));
  return match ? match[1] : '';
};

/**
 * Resolves the connection string, or explains exactly what is missing. `body` may carry
 * connectionString / databaseUrl / dbPassword / projectRef, exactly like /api/install-schema.
 */
export function resolveConnectionString(body = {}, config = null) {
  const supplied = typeof body.connectionString === 'string' ? body.connectionString.trim()
    : typeof body.databaseUrl === 'string' ? body.databaseUrl.trim()
      : '';
  const password = typeof body.dbPassword === 'string' ? body.dbPassword : '';
  const projectRef = (typeof body.projectRef === 'string' && body.projectRef.trim())
    || projectRefFromUrl(config?.supabaseUrl);

  if (supplied) return { ok: true, url: fillPassword(supplied, password), source: 'request' };
  if (password) {
    if (!projectRef) {
      return {
        ok: false,
        status: 400,
        error: 'A database password was sent, but this site\'s Supabase project reference could not be worked out from its URL. Send a full connectionString instead.',
      };
    }
    return {
      ok: true,
      source: 'request',
      url: `postgres://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres`,
    };
  }

  const fromEnv = (process.env.SUPABASE_DB_URL || '').trim();
  if (fromEnv) return { ok: true, url: fromEnv, source: 'env' };

  return {
    ok: false,
    status: 501,
    // Names both ways out, because "not configured" on its own sends people to the wrong file.
    error: 'This server has no database credentials. Either set SUPABASE_DB_URL in .env.local and restart, or enter your Supabase database password in this dialog.',
  };
}

/** True when the server can connect without asking anyone for a password. */
export const hasStoredCredentials = () => Boolean((process.env.SUPABASE_DB_URL || '').trim());

/**
 * Driver errors quote the connection string, password included. Anything that reaches a browser
 * or a log goes through here first.
 */
export function describeDbError(error, connectionString) {
  let message = error instanceof Error ? error.message : String(error ?? 'unknown database error');
  if (connectionString) {
    message = message.split(connectionString).join('<connection string>');
    const password = (() => {
      try {
        return decodeURIComponent(new URL(connectionString).password || '');
      } catch {
        return '';
      }
    })();
    if (password.length > 2) message = message.split(password).join('<password>');
  }
  if (/password authentication failed/i.test(message)) {
    return 'The database rejected that password. In Supabase this is the database password from Project Settings -> Database, not your Supabase account password and not the publishable key.';
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return `The database host could not be resolved: ${message}. Check the project reference in the connection string.`;
  }
  if (/ETIMEDOUT|ECONNREFUSED/i.test(message)) {
    return `The database refused the connection: ${message}. Supabase direct connections use port 5432; if this host only allows pooled connections, use the pooler URL (port 6543) as SUPABASE_DB_URL.`;
  }
  return message;
}

/**
 * Opens a connection, runs `work`, and always closes it. When `transaction` is set the work runs
 * inside begin/commit, so a schema that fails half way leaves nothing behind — the reason plugin
 * install and uninstall are all-or-nothing.
 */
export async function withClient(connectionString, work, { transaction = false } = {}) {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    // DDL over a slow link plus shop_calculate's large body: the default of no timeout would
    // hang the request forever instead of reporting a failure.
    statement_timeout: 120000,
  });
  await client.connect();
  try {
    if (transaction) await client.query('begin');
    const result = await work(client);
    if (transaction) await client.query('commit');
    return result;
  } catch (error) {
    if (transaction) await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}
