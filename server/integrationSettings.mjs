/**
 * Reading the Integrations credentials out of `system_settings` — for the server.
 *
 * The rows are written by the signed-in administrator's own browser (only a session with
 * `manage_options` may touch them: Supabase RLS says so, and the universal engine's `/api/db/query`
 * checks the same capability). The server therefore has to read them *somewhere else*, and which
 * somewhere depends on the deployment. Four ways are tried, in this order, and the first that can
 * answer wins:
 *
 *   1. **An injected reader** — the universal engine passes one backed by the database adapter it
 *      already has open. This is the only path that works on MySQL, SQLite and LibSQL.
 *   2. **A direct connection string** — `DATABASE_URL` (or the older `SUPABASE_DB_URL`) pointing at
 *      the site's PostgreSQL database. RLS does not apply to a direct session, so every row is
 *      readable.
 *   3. **The service key**, when the deployment sets `SUPABASE_SECRET_KEY`: PostgREST with a key RLS
 *      lets through.
 *   4. **Nothing.** Under Supabase the publishable key can never read these rows, so that is reported
 *      as `readable: false` together with the sentence that says what to set — far more useful than
 *      telling the administrator every card is unconfigured.
 *
 * Plain ESM for the same reason as `integrationConfig.mjs`: `server.mjs`, the Hono app and the
 * `api/*` functions all use this file. `pg` is imported on demand, so a deployment that never opens a
 * direct connection does not load a database driver for it.
 */
import {
  MEDIA_STORAGE_CONFIG_KEY,
  mediaCredentialsFrom,
  mediaStorageConfigFrom,
} from './integrationConfig.mjs';

/** The table the hub writes to. */
const SETTINGS_TABLE = 'system_settings';

/** What to tell an administrator whose server cannot read the rows. */
const UNREADABLE_REASON = 'This server cannot read the Integrations credentials: Supabase protects '
  + 'system_settings with row level security, which only a signed-in administrator can satisfy. Set '
  + 'DATABASE_URL to this project\'s connection string (Supabase → Project Settings → Database → '
  + 'Connection string → URI) and restart, or set SUPABASE_SECRET_KEY.';

/** Which connection string to use for a direct read, if any. */
const connectionStringFrom = ({ databaseUrl, env = {}, dbType = '' }) => {
  const type = String(dbType || '').toLowerCase();
  // A MySQL or SQLite URL cannot be opened by the Postgres driver, so it is not offered as one.
  if (type && type !== 'postgres' && type !== 'supabase') return '';
  return String(databaseUrl || env.DATABASE_URL || env.SUPABASE_DB_URL || '').trim();
};

const serviceKeyFrom = (env = {}) =>
  String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

/** Reads keys over PostgREST with whatever key is given. Resolves null when the read failed. */
const readViaRest = async (supabaseUrl, key, keys) => {
  const base = String(supabaseUrl || '').replace(/\/+$/, '');
  if (!base || !key) return null;
  const filter = keys.map((name) => `"${name.replace(/"/g, '')}"`).join(',');
  const url = `${base}/rest/v1/${SETTINGS_TABLE}?setting_key=in.(${filter})&select=setting_key,setting_value`;
  try {
    const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!response.ok) return null;
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
};

/** Reads keys from a PostgreSQL database directly. Resolves null when the connection failed. */
const readViaPostgres = async (connectionString, keys) => {
  let Client;
  try {
    ({ Client } = await import('pg'));
  } catch {
    return null;
  }
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      `select setting_key, setting_value from public.${SETTINGS_TABLE} where setting_key = any($1::text[])`,
      [keys],
    );
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  } finally {
    await client.end().catch(() => {});
  }
};

/** `setting_value` is JSON with a string fallback, exactly like every other reader of this table. */
export const parseSettingValue = (raw) => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw;
  const text = String(raw);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** Turns rows into `{ setting_key: value }`, dropping a key the deployment does not have. */
const rowsToSettings = (rows) => {
  const settings = {};
  for (const row of rows || []) settings[row.setting_key] = parseSettingValue(row.setting_value);
  return settings;
};

/**
 * The active media provider and the credentials built from it — the one call every media route makes.
 *
 * `credentials` is what a delete or an upload signature needs; `configuration` is what a screen shows.
 * Both come from the same read, so the Media screen can never be told deletion works while the delete
 * route is looking at a different row.
 */
export async function readMediaStorageSettings(options = {}) {
  const rows = await readIntegrationRows([MEDIA_STORAGE_CONFIG_KEY], options);
  const configuration = mediaStorageConfigFrom(rows.settings[MEDIA_STORAGE_CONFIG_KEY]);
  return {
    configuration,
    credentials: mediaCredentialsFrom(configuration),
    readable: rows.readable,
    error: rows.error,
  };
}

/**
 * Reads the rows the hub owns.
 *
 * @param {string[]} keys                     the `system_settings` keys to read
 * @param {object}   options
 * @param {(key: string) => Promise<unknown>} [options.readSetting] a reader the caller already has
 *   (the universal engine's database adapter). Takes precedence over every connection below.
 * @param {string}   [options.databaseUrl]     a PostgreSQL connection string, from the runtime config
 * @param {string}   [options.dbType]          the resolved database type, so a MySQL URL is not offered to pg
 * @param {string}   [options.supabaseUrl]     the project URL, for the PostgREST fallbacks
 * @param {string}   [options.supabaseKey]     the publishable key (only useful if policies allow reads)
 * @param {object}   [options.env]             the server environment, for the connection and service keys
 * @returns {Promise<{settings: Record<string, unknown>, readable: boolean, source: string, error: string}>}
 *   `settings` holds only the keys that exist. `readable: false` means the server *cannot* know —
 *   never that the site is unconfigured.
 */
export async function readIntegrationRows(keys, options = {}) {
  const { readSetting, supabaseUrl, supabaseKey, env = {} } = options;

  if (typeof readSetting === 'function') {
    const settings = {};
    for (const name of keys) settings[name] = parseSettingValue(await readSetting(name));
    return { settings, readable: true, source: 'adapter', error: '' };
  }

  const connectionString = connectionStringFrom(options);
  if (connectionString) {
    const rows = await readViaPostgres(connectionString, keys);
    if (rows) return { settings: rowsToSettings(rows), readable: true, source: 'database', error: '' };
    // A connection string that does not open is worth saying out loud: provisioning or a network rule
    // changed, and every card would otherwise simply look unconfigured.
    const fallback = await readViaRest(supabaseUrl, serviceKeyFrom(env), keys);
    if (fallback) return { settings: rowsToSettings(fallback), readable: true, source: 'rest', error: '' };
    return {
      settings: {},
      readable: false,
      source: 'unavailable',
      error: 'This server has a database connection string but could not open it, so the Integrations '
        + 'credentials could not be read. Check DATABASE_URL — a Supabase transaction-pooler URL cannot '
        + 'be used here, its session-mode URL can — then reload this screen.',
    };
  }

  const serviceKey = serviceKeyFrom(env);
  if (serviceKey && supabaseUrl) {
    const rows = await readViaRest(supabaseUrl, serviceKey, keys);
    if (rows) return { settings: rowsToSettings(rows), readable: true, source: 'rest', error: '' };
  }

  // Last resort: the publishable key. It answers on a backend whose policies allow it, and returns
  // nothing at all under Supabase — in which case saying so is the honest answer.
  const publishable = await readViaRest(supabaseUrl, supabaseKey, keys);
  if (publishable && publishable.length > 0) {
    return { settings: rowsToSettings(publishable), readable: true, source: 'rest', error: '' };
  }

  return { settings: {}, readable: false, source: 'unavailable', error: UNREADABLE_REASON };
}

/**
 * Confirms the caller may manage this site's settings, using their own access token and the
 * publishable key — no service key and no server-side session. It asks the same `user_has_cap` the
 * rest of the server asks, so a role granted `manage_options` under Settings → Roles is recognised.
 *
 * Only the classic server needs this: the universal engine already has an authenticated adapter.
 */
export async function authorizeSettingsManager(supabaseUrl, supabaseKey, accessToken) {
  if (!accessToken) {
    return { ok: false, status: 401, error: 'Sign in as an administrator to change integrations.' };
  }
  const baseUrl = String(supabaseUrl || '').replace(/\/+$/, '');
  if (!baseUrl || !supabaseKey) {
    return { ok: false, status: 501, error: 'This site is not installed, so its integrations cannot be managed.' };
  }
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${accessToken}` };
  try {
    const userResponse = await fetch(`${baseUrl}/auth/v1/user`, { headers });
    if (!userResponse.ok) return { ok: false, status: 401, error: 'Your session is not valid. Sign in again.' };
    const capResponse = await fetch(`${baseUrl}/rest/v1/rpc/user_has_cap`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability: 'manage_options' }),
    });
    if (!capResponse.ok) {
      return { ok: false, status: 502, error: `Could not check your permission: user_has_cap returned HTTP ${capResponse.status}.` };
    }
    if (await capResponse.json() !== true) {
      return { ok: false, status: 403, error: 'Your role cannot change integrations: it does not have the manage_options capability.' };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: `The site could not be reached to check your permission: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
}
