/**
 * Universal backend API engine — Hono.
 *
 * Hono speaks the standard Web Fetch API (`Request`/`Response`), so this single app runs unchanged
 * on a persistent Node server (`@hono/node-server`), serverless (Vercel/Netlify) and edge runtimes
 * (Cloudflare Workers/Pages, Bun, Deno). It replaces the Express-era `/api/install-schema` and
 * `server.mjs` dependency on Node-only routing with a runtime-agnostic router.
 *
 * The classic `server.mjs` remains available for the full-featured Supabase self-hosting path
 * (SEO prerendering, plugin installer, security middleware); this app is the universal core that
 * every deployment target can run.
 */
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  createServerDbAdapter,
  describeDbError,
  runCoreMigrations,
  scrubConnection,
  scrubSecrets,
  type DBAdapter,
  type DbFilter,
  type DbRow,
  type DbValue,
} from '../lib/db/index';
import { createServerAuthAdapter, type AuthUser } from '../lib/auth/index';
import { hasCapability, roles, type Capability, type UserRole } from '../lib/roles';
import { createStorageAdapter } from '../lib/storage/index';
import { dbTypeFrom, type RuntimeConfig } from '../lib/runtime';
import { readConfigFile, writeConfigFile, getRuntimeConfig, reloadRuntimeConfig } from './config';
import { pluginsRouter } from './routes/plugins';
import { registerIntegrationRoutes } from './integrations';

export const app = new Hono();

/**
 * The last line of defence: no route may ever answer with an opaque body.
 *
 * Hono's default error response is the plain text `Internal Server Error`. A browser — and the Setup
 * Wizard's `response.json()` — can only turn that into "Connection test failed (HTTP 500)"; on Vercel
 * an uncaught rejection can even surface as `FUNCTION_INVOCATION_FAILED`. Answering with a structured
 * JSON body (and preserving an `HTTPException`'s own status) guarantees the caller always sees a
 * reason, whatever escaped the handler that produced it.
 */
app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  const message = error instanceof Error && error.message ? error.message : describeDbError(error);
  return c.json({ success: false, ok: false, error: message, message }, 500);
});

/**
 * The second half of that promise: a route that does not exist must not fall through to Hono's
 * plain-text `404 Not Found` either, because the client parses every reply as JSON — and on Vercel
 * an unrouted `/api/*` is how a rewrite that lost the path announces itself. Scoped to `/api/*`, so
 * a missing asset still gets a conventional 404.
 *
 * The one exception is the paths only the classic Node server can answer: the security engine's
 * counters, cached pages and clearance tickets, the plugin folder on disk, per-plugin schema work and
 * the site reset are per-process memory or a writable `plugins/`, which is why README's Deployment
 * Options table marks every one of them unavailable on a serverless host. What matters here is *how*
 * this host says so: `src/lib/security.ts` and `src/lib/pluginSchema.ts` both read a 404 **with no
 * `error` in the body** as `EndpointUnavailableError` — "this host cannot do it, and the settings are
 * still saved" — and a 404 **with** one as a failure to show an administrator. Answering these paths
 * with the JSON below is what made Settings → Security report `No API endpoint at
 * /api/security/status.` as though the server were broken. So they get the body a static host would
 * have answered with: none. The empty body is the contract, not an oversight.
 */
const classicHostOnly = /^\/api\/(?:security\/|plugin-files|admin\/reset-site|admin\/plugins\/(?:schema-status|install-schema|uninstall))/;

app.notFound((c) => {
  const { pathname } = new URL(c.req.url);
  if (!pathname.startsWith('/api/')) return c.text('Not Found', 404);
  if (classicHostOnly.test(pathname)) return c.body(null, 404);
  return c.json({ success: false, ok: false, error: `No API endpoint at ${pathname}.` }, 404);
});

const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const num = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

/** Maps a Setup Wizard request body into a full RuntimeConfig. */
function bodyToConfig(body: Record<string, unknown>): RuntimeConfig {
  const dbType = dbTypeFrom(str(body.dbType));
  const config: RuntimeConfig = {
    installed: false,
    dbType,
    supabaseUrl: str(body.supabaseUrl),
    supabasePublishableKey: str(body.supabasePublishableKey) || str(body.supabaseKey),
    supabaseServiceRoleKey: str(body.supabaseServiceRoleKey),
    databaseUrl: str(body.databaseUrl) || str(body.connectionString),
    dbHost: str(body.host) || str(body.dbHost),
    dbPort: num(body.port) ?? num(body.dbPort),
    dbName: str(body.database) || str(body.name) || str(body.dbName),
    dbUser: str(body.user) || str(body.dbUser),
    dbPassword: str(body.password) || str(body.dbPassword),
    connectionTimeoutMs: num(body.connectionTimeoutMs) ?? num(body.timeoutMs),
    sqliteFile: str(body.sqliteFile),
    libsqlAuthToken: str(body.libsqlAuthToken),
    jwtSecret: str(body.jwtSecret),
    storage: body.storage === 's3' ? 's3' : 'local',
    s3: (body.s3 as RuntimeConfig['s3']) ?? undefined,
  };
  return config;
}

/** Builds the `.env` block for serverless/read-only hosts (Step 5 of the wizard). */
function buildEnvString(config: RuntimeConfig): string {
  const lines: string[] = [];
  lines.push(`DB_TYPE=${config.dbType}`);
  lines.push(`VITE_DB_TYPE=${config.dbType}`);
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
  lines.push(`JWT_SECRET=${config.jwtSecret || ''}`);
  // Only what a host needs to *boot* is emitted here. Everything else the wizard collected — the
  // storage driver and its S3 credentials above all — is persisted to the `system_settings` table by
  // the install handler and read back from the database, so the platform stays agnostic.
  return lines.join('\n');
}

/**
 * The absolute ceiling for a database probe, in milliseconds.
 *
 * A serverless function (Vercel) must answer well before its own execution limit, so the whole probe
 * — building the adapter, opening a connection and running `select 1` — is raced against this timer.
 * On a persistent host it is just as correct: a wrong host or a firewall that silently drops packets
 * should surface as a clear error, not an endless spinner (an endless request becomes an opaque
 * platform 500 on Vercel).
 */
const DB_TEST_TIMEOUT_MS = 5000;

/** A short bound on releasing a probe's connection, so a stuck pool cannot hold the response open. */
const DB_TEST_CLOSE_TIMEOUT_MS = 1000;

/** Rejects with `message` unless `promise` settles within `ms` milliseconds. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Releases a probe's connection without ever letting teardown escape.
 *
 * `close()` is wrapped in `Promise.resolve().then(...)` so a driver that throws synchronously (rather
 * than returning a rejected promise) becomes a rejection that is swallowed here, and the whole release
 * is bounded — a pool that ignores its own timeout can never hold the HTTP response open.
 */
async function closeAdapter(db: DBAdapter | null): Promise<void> {
  if (!db) return;
  await withTimeout(Promise.resolve().then(() => db.close()), DB_TEST_CLOSE_TIMEOUT_MS, 'close').catch(() => undefined);
}

/** GET /api/health — probes the configured backend. Bounded, and always JSON. */
app.get('/api/health', async (c) => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const fileConfig = await readConfigFile();
  const config = { ...bodyToConfig(env as Record<string, unknown>), ...(fileConfig ?? {}) };
  let db: DBAdapter | null = null;
  try {
    const opened = await createServerDbAdapter(config);
    db = opened;
    const health = await withTimeout(
      opened.healthCheck(),
      DB_TEST_TIMEOUT_MS,
      `The database did not respond within ${DB_TEST_TIMEOUT_MS / 1000} seconds.`,
    );
    return c.json({ success: health.ok, ok: health.ok, dbType: config.dbType, message: health.message });
  } catch (error) {
    const message = scrubConnection(describeDbError(error), config.dbPassword);
    return c.json({ success: false, ok: false, dbType: config.dbType, error: message, message }, 503);
  } finally {
    await closeAdapter(db);
  }
});

/**
 * GET /api/install/check — reports whether a site has been provisioned. Environment-aware: a
 * serverless/edge run is "installed" when `DATABASE_URL` + `DB_TYPE` are present; a persistent host
 * is "installed" when `data/react-wp-config.json` says so. Re-reads the file so it stays current even
 * in the very same process that just ran Step 5 (`POST /api/install-schema`).
 */
app.get('/api/install/check', async (c) => {
  const config = await getRuntimeConfig();
  const fileConfig = await readConfigFile();
  const installed = config.installed === true || (fileConfig !== null && fileConfig.installed !== false);
  return c.json({ installed, dbType: config.dbType ?? fileConfig?.dbType ?? null });
});

/**
 * Shared Step 3 health check: builds an adapter from the wizard's credentials and probes it.
 *
 * Every failure mode — a malformed body, an unsupported backend, a missing Supabase project, a
 * rejected password, an SSL handshake mismatch, an unreachable host, or a driver that simply never
 * answers — is funnelled through one `try/catch` and answered with an HTTP 400 and a readable JSON
 * `{ success: false, error }`. The endpoint therefore never raises an unhandled rejection, which is
 * what made Vercel answer `HTTP 500` / `FUNCTION_INVOCATION_FAILED` for a cloud database it could
 * not reach. `ok`/`message` are kept alongside the new fields for older Setup Wizard bundles.
 */
const testDbHandler = async (c: Context) => {
  let db: DBAdapter | null = null;
  let password: string | undefined;
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // Pin the connection timeout for every driver: `pg`'s pool, `mysql2`'s pool and the Supabase fetch.
    const config = bodyToConfig({ ...body, connectionTimeoutMs: DB_TEST_TIMEOUT_MS });
    password = config.dbPassword;
    db = await createServerDbAdapter(config);
    const health = await withTimeout(
      db.healthCheck(),
      DB_TEST_TIMEOUT_MS,
      `The database did not respond within ${DB_TEST_TIMEOUT_MS / 1000} seconds. Check that the host and port are reachable from your deployment.`,
    );
    if (!health.ok) {
      // `health.message` is already normalised by the driver, so only strip any leaked secret here.
      const message = scrubSecrets(health.message, password);
      return c.json({ success: false, ok: false, error: message, message }, 400);
    }
    return c.json({ success: true, ok: true, message: health.message });
  } catch (error) {
    const message = scrubConnection(describeDbError(error), password);
    return c.json({ success: false, ok: false, error: message, message }, 400);
  } finally {
    // Bound the teardown too: a pool that ignores its own timeout must not hold the response open, and
    // a driver whose `close()` throws must not turn a clean 400 into an opaque 500.
    await closeAdapter(db);
  }
};

/** POST /api/install/check — retained for backward compatibility with older bundles. */
app.post('/api/install/check', testDbHandler);

/** POST /api/install/test-db — Step 3 "Test Connection" button. */
app.post('/api/install/test-db', testDbHandler);

/** POST /api/install-schema — Step 5 schema migration + configuration provisioning. */
app.post('/api/install-schema', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const config = bodyToConfig(body);
  const deployment = str(body.deployment) || (body.saveSettings === true ? 'node' : 'serverless');
  const saveSettings = body.saveSettings === true || deployment === 'node';
  const siteTitle = str(body.siteTitle) || 'My React-WP Site';
  const siteTagline = str(body.siteTagline) || '';
  const adminUsername = str(body.adminUsername) || '';
  const adminEmail = str(body.adminEmail) || '';
  const adminPassword = str(body.adminPassword) || '';

  try {
    if (config.dbType === 'supabase') {
      return await installSupabase(c, body, config, saveSettings, siteTitle, adminEmail);
    }

    if (!adminEmail || !adminPassword) {
      return c.json({ error: 'Site title, admin email and admin password are required.' }, 400);
    }

    const db = await createServerDbAdapter(config);
    const health = await db.healthCheck();
    if (!health.ok) {
      await db.close().catch(() => undefined);
      return c.json({ error: health.message }, 400);
    }

    await runCoreMigrations(db);
    const fullConfig: RuntimeConfig = { ...config, jwtSecret: config.jwtSecret || randomSecret(), installed: true };
    const auth = await createServerAuthAdapter(fullConfig, db);
    const signUp = await auth.signUp(adminEmail, adminPassword, 'administrator').catch(async (error: unknown) => {
      // Re-running the wizard is normal — it is how a site whose administrator ended up with the
      // wrong role is put right — and Supabase's own adapter tolerates an account that already
      // exists. The universal engine refuses it, so the account that is already there is looked up
      // and treated as the answer: everything below cares about its profile row, not about which run
      // created it. The stored password is left alone; a genuinely forgotten one is the Sign in
      // screen's job, not the installer's.
      if (!/already exists/i.test(String((error as Error)?.message))) throw error;
      const existing = await db.select('rwp_users', { where: { email: adminEmail.toLowerCase() }, limit: 1 }).catch(() => []);
      const id = existing[0]?.id;
      if (!id) throw error;
      return { session: null, user: { id: String(id), email: adminEmail, role: 'administrator' } };
    });
    const adminUserId = signUp.user?.id || str(body.adminUserId) || '';
    if (adminUsername && adminUserId) {
      await db.update('profiles', { where: { id: adminUserId } }, { display_name: adminUsername }).catch(() => undefined);
    }
    const admin = await confirmAdministrator(db, adminUserId, adminEmail);
    await db.setOption('site_title', siteTitle);
    await db.setOption('site_tagline', siteTagline);
    await db.setOption('admin_email', adminEmail);
    await db.setOption('installed', 'true');
    // Non-boot configuration lives in the database, not the `.env`: persist the storage driver (and
    // its S3 credentials, when chosen) so any deployment reads it back from `system_settings`.
    await db.setSystemSetting('storage', config.storage === 's3' ? 's3' : 'local');
    // Only persist S3 credentials when a usable set was actually provided; an empty object would
    // otherwise clobber a bucket saved by an earlier run.
    if (config.s3 && Object.values(config.s3).some(Boolean)) await db.setSystemSetting('s3', config.s3);
    await db.close().catch(() => undefined);

    if (saveSettings) {
      await writeConfigFile({ ...fullConfig, installed: true });
      // Refresh the running process's in-memory config so /api/install/check and every API handler
      // see the new backend immediately — no restart required.
      await reloadRuntimeConfig();
      // The `.env` comes back here too. On this host the config file is what is read, but the same
      // block is what a Docker/Vercel copy of the site needs, and Step 5 offers it in both modes
      // rather than making anyone copy the values out of `data/react-wp-config.json` by hand.
      return c.json({ success: true, mode: 'persistent', installed: true, env: buildEnvString(fullConfig), admin });
    }
    return c.json({ success: true, mode: 'serverless', env: buildEnvString(fullConfig), admin });
  } catch (error) {
    return c.json({ error: describeDbError(error) }, 500);
  }
});

/**
 * Confirms that the account the installer just created really is an administrator, and reports the
 * role the row ends up with.
 *
 * The universal sign-up (`UniversalAuthAdapter.signUp`) writes both `rwp_users` and `profiles`, but
 * only the second write is best-effort — it is allowed to fail on a site whose core schema predates
 * that table — and a profile row that exists with the schema default is a subscriber. An
 * installation that quietly produces a subscriber where an administrator was asked for is the bug
 * this reports; the repair is one update, and the wizard shows the warning when even that fails
 * instead of leaving someone to find out in the database.
 */
async function confirmAdministrator(
  db: DBAdapter,
  userId: string,
  email: string,
): Promise<{ id?: string; email: string; role: string | null; warning?: string }> {
  const rows = userId ? await db.select('profiles', { where: { id: userId }, limit: 1 }).catch(() => []) : [];
  const row = rows[0];
  if (!row) {
    return {
      id: userId || undefined,
      email,
      role: null,
      warning: `No profile row was found for ${email}, so the administrator role could not be confirmed. Sign in and promote the account under Users.`,
    };
  }
  if (row.role === 'administrator') return { id: String(row.id), email, role: 'administrator' };
  // `columns` is what makes the adapter hand the written rows back. Without it the SQL drivers answer
  // an UPDATE with an empty array, so a repair that worked and one a policy refused would look
  // identical — the "a blocked write reports success" trap, in the other direction.
  const repaired = await db
    .update('profiles', { where: { id: userId }, columns: 'id,role' }, { role: 'administrator' })
    .then((updated) => updated.find((row) => String(row.role) === 'administrator'))
    .catch(() => undefined);
  if (repaired) return { id: String(row.id), email, role: 'administrator' };
  // Report what the row says *now*, not what it said before the attempt.
  const afterRepair = await db
    .select('profiles', { where: { id: userId }, limit: 1 })
    .then((rows) => rows[0]?.role)
    .catch(() => row.role);
  const current = typeof afterRepair === 'string' ? afterRepair : '';
  return {
    id: String(row.id),
    email,
    role: current || null,
    warning: `The profile row for ${email} still reads "${current || 'no role'}", so this site has no administrator. Promote the account under Users.`,
  };
}

/** A cryptographically random JWT secret for a fresh universal install. */
function randomSecret(): string {
  const crypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof crypto?.randomUUID === 'function') return `${crypto.randomUUID()}${crypto.randomUUID()}`;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The Supabase schema as text, inlined into the bundle by `vite.api.config.mjs`
 * (`define: __RWP_SCHEMA_SQL__`). A serverless function's filesystem is read-only and does not
 * contain the repository, so the DDL has to travel inside the function that runs it.
 *
 * `typeof` is load-bearing: on a builder that does not define it — `tsx`, a plain Node host — the
 * identifier is never declared, and reading it directly would be the very `ReferenceError:
 * __dirname is not defined` this replaced. `typeof` never dereferences an undeclared name.
 */
declare const __RWP_SCHEMA_SQL__: string | undefined;

/**
 * `supabase/schema.sql` for a fresh Supabase install.
 *
 * A bundled run carries it in the bundle. A persistent host (`npm run start:hono`, `tsx`) reads the
 * file, resolved from this module's own URL: not `__dirname` (absent in ES modules) and not
 * `process.cwd()` (not the project root inside a function, and not guaranteed anywhere). `src/server/`
 * and the built `src/server-dist/` sit at the same depth, so one relative path suits either.
 */
async function supabaseSchemaSql(): Promise<string> {
  if (typeof __RWP_SCHEMA_SQL__ === 'string') return __RWP_SCHEMA_SQL__;
  const { readFile } = await import('node:fs/promises');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const candidates = [
    resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase/schema.sql'),
    resolve(process.cwd(), 'supabase/schema.sql'),
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf8');
    } catch {
      continue;
    }
  }
  throw new Error('supabase/schema.sql could not be read. Run it in the Supabase SQL Editor instead.');
}

/**
 * Supabase provisioning over a direct PostgreSQL connection.
 *
 * The canonical schema is applied on every path — `supabase/schema.sql` is documented as safe to
 * re-run — so `options` and `profiles` exist before the steps below. The site options are then
 * seeded and the administrator's `profiles` row is linked to the account Supabase Auth created
 * client-side via `signUp` (see the Setup Wizard). That promotion can only happen here: the
 * `handle_new_user` trigger refuses the administrator role on purpose. `saveSettings` decides only
 * whether the answer is a written config file (persistent host) or the `.env` a read-only host
 * pastes — never whether the admin is created — and the promotion's result is read back and returned
 * so Step 5 can confirm the role rather than assume it (see `promoteSupabaseAdmin`).
 */
async function installSupabase(
  c: Context,
  body: Record<string, unknown>,
  config: RuntimeConfig,
  saveSettings: boolean,
  siteTitle: string,
  adminEmail: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connectionString = resolveSupabaseConnection(config, body as any);
  if (!connectionString) {
    return c.json({ error: 'Supabase provisioning needs the database password (and project URL) or a full connection string.' }, 400);
  }
  const { Client } = await import('pg');
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    await client.query(await supabaseSchemaSql());

    // Persist the non-boot configuration to `system_settings` (this direct connection bypasses RLS),
    // so the wizard no longer has to emit RWP_STORAGE/S3_* environment variables.
    await client.query(
      `insert into public.system_settings (setting_key, setting_value)
       values ('storage', $1)
       on conflict (setting_key) do update set setting_value = excluded.setting_value`,
      [JSON.stringify(config.storage === 's3' ? 's3' : 'local')],
    );
    // Only persist S3 credentials when a usable set was actually provided; an empty object would
    // otherwise clobber a bucket saved by an earlier run.
    if (config.s3 && Object.values(config.s3).some(Boolean)) {
      await client.query(
        `insert into public.system_settings (setting_key, setting_value)
         values ('s3', $1)
         on conflict (setting_key) do update set setting_value = excluded.setting_value`,
        [JSON.stringify(config.s3)],
      );
    }

    // Reported back to Step 5 so the wizard can confirm the role instead of assuming it: see
    // `promoteSupabaseAdmin`.
    let admin: { id?: string; email: string; role: string | null; warning?: string } | null = null;
    if (adminEmail) {
      await client.query(
        `insert into public.options (option_name, option_value)
         values ($1, $2), ($3, $4), ($5, $6)
         on conflict (option_name) do update set option_value = excluded.option_value`,
        ['site_title', siteTitle, 'admin_email', adminEmail, 'installed', 'true'],
      );
      admin = await promoteSupabaseAdmin(client, str(body.adminUserId) || '', adminEmail);
    }

    // The connection just used travels in the block in both modes: without `DATABASE_URL` + `DB_TYPE`
    // a deployment cannot report itself provisioned, and `SUPABASE_DB_URL`-style access is what lets
    // plugin SQL and the site reset run there without asking for the password again.
    const env = buildEnvString({ ...config, databaseUrl: config.databaseUrl || connectionString, installed: true });

    if (saveSettings) {
      // This host keeps `data/react-wp-config.json`; the block is returned anyway, because the same
      // site deployed to Docker or Vercel needs it and Step 5 offers it in both modes rather than
      // making anyone copy the values out of the config file by hand.
      return c.json({ success: true, mode: 'persistent', installed: true, env, admin });
    }

    // A read-only host cannot keep a config file, so the environment the deployed app still needs is
    // the rest of the answer: this is the block Step 5 shows and asks to be pasted into the platform.
    return c.json({ success: true, mode: 'serverless', env, admin });
  } catch (error) {
    return c.json({ error: describeDbError(error) }, 500);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Promotes the Setup Wizard's account over the direct connection and reports the role the profile
 * row actually carries afterwards.
 *
 * The account is created client-side (`supabase.auth.signUp`) because `handle_new_user` refuses the
 * administrator role on purpose — a role taken from a sign-up payload is the escalation path
 * `public.profiles` exists to close — so this is the only thing that can promote it. The INSERT
 * covers a project whose trigger did not exist yet when the account was made, the UPDATE covers the
 * `subscriber` row the trigger does create, and `returning` means "no rows" is reported as a warning
 * rather than mistaken for success: the silent version of that is how an installation ends up with
 * an administrator who is a subscriber.
 *
 * Matching is by email first, because that is what identifies an administrator, with the id the
 * browser got back from `signUp` as a second way in.
 */
async function promoteSupabaseAdmin(
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  adminUserId: string,
  adminEmail: string,
): Promise<{ id?: string; email: string; role: string | null; warning?: string }> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(adminUserId) ? adminUserId : null;
  const result = await client.query(
    `insert into public.profiles (id, email, display_name, role)
     select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'display_name', 'Administrator'), 'administrator'
     from auth.users u
     where lower(u.email) = lower($2) or ($1::uuid is not null and u.id = $1::uuid)
     on conflict (id) do update set role = 'administrator'
     returning id, email, role`,
    [uuid, adminEmail],
  );
  const row = result.rows[0];
  if (!row) {
    return {
      email: adminEmail,
      role: null,
      warning: `Supabase Auth has no account for ${adminEmail}, so nothing was promoted. Create that account (or sign up with it), then run this step again.`,
    };
  }
  return {
    id: String(row.id),
    email: String(row.email ?? adminEmail),
    role: row.role === null || row.role === undefined ? null : String(row.role),
  };
}

/** Builds a Supabase direct-connection string from the request, mirroring server/db.mjs. */
function resolveSupabaseConnection(config: RuntimeConfig, body: Record<string, string | undefined>): string | null {
  const supplied = (body.connectionString || body.databaseUrl || '').trim();
  const password = (body.dbPassword || body.password || '').trim();
  if (supplied) {
    return supplied
      .replace(/\[(?:YOUR-)?PASSWORD\]/gi, encodeURIComponent(password))
      .replace(/<PASSWORD>/gi, encodeURIComponent(password));
  }
  const projectRef = /^https?:\/\/([a-z0-9-]+)\.supabase\.(?:co|in)/i.exec(config.supabaseUrl || '')?.[1];
  if (password && projectRef) return `postgres://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres`;
  if (config.databaseUrl) return config.databaseUrl;
  return null;
}

/** Resolves the server's own config (env + config file) for auth/media handlers. */
async function serverConfig(): Promise<RuntimeConfig> {
  return getRuntimeConfig();
}

// -- Universal authentication -------------------------------------------------

app.post('/api/auth/signin', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const config = await serverConfig();
    const db = await createServerDbAdapter(config);
    const auth = await createServerAuthAdapter(config, db);
    const session = await auth.signIn(str(body.email) || '', str(body.password) || '');
    return c.json({ token: session.accessToken, user: session.user });
  } catch (error) {
    return c.json({ error: describeDbError(error) }, 401);
  }
});

app.post('/api/auth/signup', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const config = await serverConfig();
    const db = await createServerDbAdapter(config);
    const auth = await createServerAuthAdapter(config, db);
    const result = await auth.signUp(str(body.email) || '', str(body.password) || '', str(body.role) || 'subscriber');
    return c.json({ user: result.user, session: result.session });
  } catch (error) {
    return c.json({ error: describeDbError(error) }, 400);
  }
});

app.get('/api/auth/me', async (c) => {
  const token = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return c.json({ user: null });
  try {
    const config = await serverConfig();
    const db = await createServerDbAdapter(config);
    const auth = await createServerAuthAdapter(config, db);
    const user = await auth.authenticate(token);
    return c.json({ user });
  } catch (error) {
    return c.json({ error: describeDbError(error) }, 401);
  }
});

app.post('/api/auth/signout', async (c) => {
  return c.json({ success: true });
});

// -- Media storage ------------------------------------------------------------

app.post('/api/media/upload', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const key = str(body.key);
  const dataBase64 = str(body.dataBase64);
  const contentType = str(body.contentType) || 'application/octet-stream';
  if (!key || !dataBase64) return c.json({ error: 'key and dataBase64 are required.' }, 400);
  try {
    const config = await serverConfig();
    const storage = createStorageAdapter(config);
    const bytes = Uint8Array.from(atob(dataBase64), (ch) => ch.charCodeAt(0));
    const result = await storage.putFile(key, bytes, contentType);
    return c.json({ url: result.url });
  } catch (error) {
    return c.json({ error: describeDbError(error) }, 500);
  }
});

app.delete('/api/media/:key', async (c) => {
  const key = c.req.param('key');
  try {
    const config = await serverConfig();
    const storage = createStorageAdapter(config);
    await storage.deleteFile(key);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: describeDbError(error) }, 500);
  }
});

// -- Plugin administration (in-memory ZIP upload → GitHub → Vercel) ------------
app.route('/api/admin/plugins', pluginsRouter);

// -- Settings → Integrations ---------------------------------------------------
// The status read and the two credential tests, at the paths the shared module owns.
registerIntegrationRoutes(app);

// -- Universal data API -------------------------------------------------------
//
// The browser cannot open a SQL connection, so the universal client's HttpDBAdapter forwards every
// read and write here as one structured request. Reads are public (a visitor must be able to load
// the site); writes need a signed-in session, and the tables that hold site-wide or account controls
// additionally need a capability — mirroring what the Supabase RLS policies enforce.

/** Actions a visitor may run without signing in. */
const PUBLIC_READ_ACTIONS = new Set(['select', 'selectOne', 'getOption', 'hasTable', 'healthCheck']);
/** Actions that run free-form SQL or DDL; administrator-only. */
const ADMIN_ACTIONS = new Set(['query', 'migrate']);
/** Tables whose rows must never be readable by an anonymous caller (they hold password hashes). */
const SENSITIVE_READ_TABLES = new Set(['rwp_users']);
/** Tables only a settings manager may read: they can hold secrets, so they are never public. */
const PRIVILEGED_READ_TABLES = new Set(['system_settings']);
/** Tables an unauthenticated visitor may write to (WordPress-style anonymous comments). */
const PUBLIC_WRITE_TABLES = new Set(['comments']);
/**
 * The capability a table needs for its writes. Tables that are absent only require a signed-in
 * session (a subscriber maintaining their own bookmarks or profile row, for example).
 */
const WRITE_CAPABILITIES: Record<string, Capability> = {
  options: 'manage_options',
  system_settings: 'manage_options',
  theme_settings: 'manage_options',
  menus: 'manage_options',
  rwp_translations: 'manage_options',
  rwp_role_capabilities: 'manage_options',
  rwp_user_capabilities: 'manage_options',
  rwp_quota_overrides: 'manage_options',
  plugins: 'activate_plugins',
  rwp_users: 'edit_users',
  pages: 'edit_posts',
  posts: 'edit_posts',
  categories: 'manage_categories',
  media: 'upload_files',
  media_folders: 'upload_files',
  comments: 'moderate_comments',
};

/** Narrows any untrusted role string (profiles.role, a JWT claim) to a known role, or null. */
const roleOf = (value: unknown): UserRole | null =>
  typeof value === 'string' && (roles as readonly string[]).includes(value) ? (value as UserRole) : null;

const roleHas = (role: UserRole | null, capability: Capability): boolean =>
  role !== null && hasCapability(role, capability);

interface Denied {
  status: 401 | 403;
  message: string;
}

/** Returns the rejection to send back, or null when the request is allowed. */
function authorizeRequest(action: string, table: string | undefined, role: UserRole | null): Denied | null {
  if (PUBLIC_READ_ACTIONS.has(action)) {
    // Only table reads can expose anything sensitive; getOption/hasTable/healthCheck are probes.
    if ((action === 'select' || action === 'selectOne') && table && SENSITIVE_READ_TABLES.has(table) && !roleHas(role, 'list_users')) {
      return { status: 403, message: `Reading "${table}" requires the list_users capability.` };
    }
    if ((action === 'select' || action === 'selectOne') && table && PRIVILEGED_READ_TABLES.has(table) && !roleHas(role, 'manage_options')) {
      return { status: 403, message: `Reading "${table}" requires the manage_options capability.` };
    }
    return null;
  }

  // System settings can hold secrets, so even reading one needs manage_options.
  if (action === 'getSystemSetting') {
    if (roleHas(role, 'manage_options')) return null;
    return { status: role ? 403 : 401, message: 'Reading system settings requires the manage_options capability.' };
  }

  // Writing one is a settings-manager action too.
  if (action === 'setSystemSetting') {
    if (roleHas(role, 'manage_options')) return null;
    return { status: role ? 403 : 401, message: 'Changing system settings requires the manage_options capability.' };
  }

  if (ADMIN_ACTIONS.has(action)) {
    if (roleHas(role, 'manage_options')) return null;
    return { status: role ? 403 : 401, message: 'This action requires the manage_options capability.' };
  }

  // Every remaining action is a write.
  if (role === null) {
    if (action === 'insert' && table && PUBLIC_WRITE_TABLES.has(table)) return null;
    return { status: 401, message: 'Sign in to change this site’s data.' };
  }
  const capability = table ? WRITE_CAPABILITIES[table] : undefined;
  if (capability && !roleHas(role, capability)) {
    return { status: 403, message: `Your role cannot change "${table}"; the ${capability} capability is required.` };
  }
  return null;
}

/** Drops columns a signed-in user must not set on their own row (prevents role escalation). */
function stripPrivilegedColumns(table: string, body: Record<string, unknown>, role: UserRole | null): void {
  if (table !== 'profiles' || roleHas(role, 'edit_users')) return;
  for (const key of ['patch', 'rows'] as const) {
    const value = body[key];
    const list = Array.isArray(value) ? value : value ? [value] : [];
    for (const row of list) {
      if (row && typeof row === 'object') delete (row as Record<string, unknown>).role;
    }
  }
}

/**
 * The filter an update/delete arrived with.
 *
 * The current client sends a whole `DbFilter` in `filter` — equality, but also `in`, ranges, `not`
 * and `or` — while an older bundle may still send a plain `where`. The adapter refuses a filter that
 * narrows nothing, so a request carrying neither is rejected instead of run against every row.
 */
function writeFilter(body: Record<string, unknown>): DbFilter {
  const filter = body.filter as DbFilter | undefined;
  if (filter && typeof filter === 'object') return filter;
  const where = body.where as Record<string, DbValue> | undefined;
  return where && typeof where === 'object' ? { where } : {};
}

/** Runs one already-authorized operation against the server's own database adapter. */
async function executeDbAction(db: DBAdapter, action: string, body: Record<string, unknown>): Promise<unknown> {
  const table = str(body.table) ?? '';
  switch (action) {
    case 'select':
      return db.select(table, (body.filter as DbFilter | undefined) ?? {});
    case 'selectOne':
      return db.selectOne(table, (body.filter as DbFilter | undefined) ?? {});
    case 'insert':
      return db.insert(table, (body.rows as DbRow | DbRow[]) ?? {});
    case 'update':
      return db.update(table, writeFilter(body), (body.patch as DbRow) ?? {});
    case 'upsert':
      return db.upsert(table, (body.rows as DbRow[]) ?? [], body.conflictColumns as string[] | undefined);
    case 'delete':
      return db.delete(table, writeFilter(body));
    case 'getOption':
      return db.getOption(str(body.name) ?? '', body.fallback);
    case 'setOption':
      await db.setOption(str(body.name) ?? '', body.value);
      return true;
    case 'getSystemSetting':
      return db.getSystemSetting(str(body.key) ?? '', body.fallback);
    case 'setSystemSetting':
      await db.setSystemSetting(str(body.key) ?? '', body.value);
      return true;
    case 'hasTable':
      return db.hasTable(table);
    case 'healthCheck':
      return db.healthCheck();
    case 'query':
      return db.query(String(body.sql ?? ''), (body.params as DbValue[]) ?? []);
    case 'migrate':
      await db.migrate(String(body.schema ?? ''));
      return true;
    default:
      throw new Error(`Unsupported database action: ${action || '(missing)'}`);
  }
}

/**
 * POST /api/db/query — the endpoint behind the browser's HttpDBAdapter.
 *
 * It receives one structured `DBAdapter` call, authorizes it, runs it against the active
 * SQLite/PostgreSQL/MySQL adapter and answers `{ data }` (or `{ error }` with a 4xx/5xx status).
 */
app.post('/api/db/query', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = str(body.action);
  const table = str(body.table);
  if (!action) return c.json({ error: { message: 'A database action is required.' } }, 400);
  if (!table && !['getOption', 'setOption', 'getSystemSetting', 'setSystemSetting', 'healthCheck', 'query', 'migrate'].includes(action)) {
    return c.json({ error: { message: 'A table is required for this action.' } }, 400);
  }

  const config = await getRuntimeConfig();
  let db: DBAdapter | null = null;
  try {
    const opened = await createServerDbAdapter(config);
    db = opened;
    const token = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
    let user: AuthUser | null = null;
    if (token) {
      try {
        const auth = await createServerAuthAdapter(config, opened);
        user = await auth.authenticate(token);
      } catch {
        // A missing JWT secret or an unreadable user table simply means "not signed in".
        user = null;
      }
    }

    const role = roleOf(user?.role);
    const denial = authorizeRequest(action, table, role);
    if (denial) return c.json({ error: { message: denial.message } }, denial.status);

    stripPrivilegedColumns(table ?? '', body, role);
    const data = await executeDbAction(opened, action, body);
    return c.json({ data });
  } catch (error) {
    return c.json({ error: { message: describeDbError(error) } }, 500);
  } finally {
    await closeAdapter(db);
  }
});

export default app;

