/**
 * Boot-time site setup: the one place that decides whether this site is *installed*, and heals it when
 * the answer a server would give is wrong.
 *
 * A site is provisioned in two places that used to be able to disagree:
 *
 *   1. **The database**, where the Setup Wizard writes `options.installed = 'true'` (and a
 *      `system_settings` row for everything else it collected).
 *   2. **The server**, whose own config comes from `data/react-wp-config.json` on a persistent host and
 *      from the environment (`DB_TYPE`, `DATABASE_URL`, `VITE_SUPABASE_URL`,
 *      `VITE_SUPABASE_PUBLISHABLE_KEY` — exactly the block Step 5 prints) everywhere.
 *
 * The browser reads the second, and that asymmetry is the bug this module exists to remove: a site
 * configured entirely through `.env.local` was fully provisioned and had an administrator, the admin UI
 * was signed in — while `server.mjs` answered every credentialed route with "This site is not installed,
 * so plugins cannot be uploaded", because it read `data/react-wp-config.json`, which a hand-written
 * `.env.local` never creates.
 *
 * The rule is therefore stated once, here, and both engines apply it:
 *
 *   **configured ⇒ installed.** A database the runtime can actually talk to is an installed site.
 *   `options.installed` is then *verified* (and repaired when it is missing or `false`), and the config
 *   file is written when the host can keep one, so the next reader — this process, another engine, a
 *   restart — sees the same answer.
 *
 * Deliberately free of any driver: `pg` is not imported here, so a serverless bundle can import this
 * module (through `src/server/config.ts`) without carrying a PostgreSQL client it may never use. The one
 * thing it cannot do itself is the direct-SQL repair, which is why `ensureSiteInstalled` takes the
 * `seed` implementation from a caller that already has a connection — `server.mjs`, whose `withClient`
 * is the same helper the wizard installs with.
 */
import { readConfig, writeConfig } from './config.mjs';
import { loadEnvFiles } from './env.mjs';

/** The tag every line this module logs carries, so a boot log says which part of startup spoke. */
export const AUTO_SETUP_LOG = '[Auto-Setup]';

/** The first non-empty value, trimmed — "later sources fill gaps, they do not overwrite" as in runtime.ts. */
const first = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
};

/** Which backend was requested; kept in step with `dbTypeFrom` in `src/lib/runtime.ts`. */
function dbTypeFrom(value) {
  const raw = String(value || '').trim().toLowerCase();
  switch (raw) {
    case 'postgres':
    case 'postgresql':
    case 'pg':
      return 'postgres';
    case 'mysql':
    case 'mariadb':
      return 'mysql';
    case 'sqlite':
    case 'sqlite3':
      return 'sqlite';
    case 'libsql':
    case 'turso':
      return 'libsql';
    default:
      return 'supabase';
  }
}

/** The environment this process can see: real variables, completed by `.env.local`/`.env`. */
export function autoSetupEnv() {
  return { ...loadEnvFiles(), ...process.env };
}

/**
 * The config the environment describes, from the same variable names as `runtimeConfigFromEnv` in
 * `src/lib/runtime.ts` (the browser's copy). `installed` is not an environment variable: whether a site
 * is installed is decided below, by `configIsConfigured`.
 */
export function envDerivedConfig(env = {}) {
  const dbType = dbTypeFrom(first(env.VITE_DB_TYPE, env.DB_TYPE) || 'supabase');
  const storage = first(env.RWP_STORAGE, env.STORAGE_DRIVER);
  const sqliteBackend = dbType === 'sqlite' || dbType === 'libsql';
  return {
    installed: false,
    dbType,
    supabaseUrl: first(env.VITE_SUPABASE_URL, env.SUPABASE_URL),
    supabasePublishableKey: first(
      env.VITE_SUPABASE_PUBLISHABLE_KEY,
      env.VITE_SUPABASE_ANON_KEY,
      env.SUPABASE_PUBLISHABLE_KEY,
    ),
    // `DATABASE_URL` comes last because it is the generic name: on Supabase it is that project's
    // PostgreSQL connection string (and the credential the direct-SQL repair needs), on SQLite a path.
    databaseUrl: first(env.VITE_DATABASE_URL, env.DATABASE_URL),
    sqliteFile: first(env.SQLITE_FILE, sqliteBackend ? env.DATABASE_URL : undefined),
    dbHost: first(env.DB_HOST, env.PGHOST, env.MYSQL_HOST),
    dbName: first(env.DB_NAME, env.PGDATABASE, env.MYSQL_DATABASE),
    dbUser: first(env.DB_USER, env.PGUSER, env.MYSQL_USER),
    jwtSecret: first(env.JWT_SECRET, env.VITE_JWT_SECRET),
    storage: storage === 's3' || storage === 'local' ? storage : undefined,
  };
}

/**
 * True when enough configuration exists to attempt a database connection — the twin of `isConfigured`
 * in `src/lib/runtime.ts`, and this install's definition of "installed". The two are separate on
 * purpose: the browser's copy runs in the SPA bundle and must not import a Node module, while this one
 * is imported by both servers. **If you change one, change the other.**
 */
export function configIsConfigured(config) {
  if (!config) return false;
  if (config.installed === true) return true;
  switch (config.dbType) {
    case 'supabase':
      return Boolean(config.supabaseUrl && config.supabasePublishableKey);
    case 'postgres':
    case 'mysql':
      return Boolean(config.databaseUrl || (config.dbHost && config.dbName && config.dbUser));
    case 'sqlite':
    case 'libsql':
      return Boolean(config.sqliteFile || config.databaseUrl);
    default:
      return false;
  }
}

/** The on-disk config, with the environment filling whatever it does not carry. `installed` stays sticky. */
export function mergeSiteConfig(fileConfig, envConfig) {
  const merged = {
    installed: fileConfig?.installed === true,
    dbType: first(fileConfig?.dbType, envConfig?.dbType) || 'supabase',
    supabaseUrl: first(fileConfig?.supabaseUrl, envConfig?.supabaseUrl),
    supabasePublishableKey: first(fileConfig?.supabasePublishableKey, envConfig?.supabasePublishableKey),
    databaseUrl: first(fileConfig?.databaseUrl, envConfig?.databaseUrl),
    sqliteFile: first(fileConfig?.sqliteFile, envConfig?.sqliteFile),
    dbHost: first(fileConfig?.dbHost, envConfig?.dbHost),
    dbName: first(fileConfig?.dbName, envConfig?.dbName),
    dbUser: first(fileConfig?.dbUser, envConfig?.dbUser),
    jwtSecret: first(fileConfig?.jwtSecret, envConfig?.jwtSecret),
    storage: fileConfig?.storage || envConfig?.storage,
  };
  if (configIsConfigured({ ...merged, installed: false })) merged.installed = true;
  return merged;
}

/** How a log line names the site it is about, without ever naming a password. */
export function describeSiteTarget(config) {
  if (config?.dbType === 'supabase' && config.supabaseUrl) return `Supabase project ${config.supabaseUrl}`;
  if (config?.databaseUrl) {
    try {
      const url = new URL(config.databaseUrl);
      return `${config.dbType} database ${url.host}`;
    } catch {
      return `${config.dbType} database`;
    }
  }
  return `${config?.dbType || 'unknown'} backend`;
}

/**
 * The site's config for a request path: the config file, completed by the environment. Cheap (one file
 * read) and side-effect free, which is what makes it safe to call per request — the writes belong to
 * `ensureSiteInstalled`, which runs once at boot.
 */
export async function resolveSiteConfig(env = null) {
  const file = await readConfig().catch(() => null);
  return mergeSiteConfig(file, envDerivedConfig({ ...autoSetupEnv(), ...(env ?? {}) }));
}

const describeError = (error) => (error instanceof Error ? error.message : String(error || 'unknown error'));

/** Writes the marking Step 5 writes, keeping every other key the file already held. */
async function writeInstalledConfig(fileConfig, config) {
  try {
    await writeConfig({
      ...(fileConfig ?? {}),
      installed: true,
      dbType: config.dbType || 'supabase',
      supabaseUrl: config.supabaseUrl,
      supabasePublishableKey: config.supabasePublishableKey,
    });
    return { ok: true };
  } catch (error) {
    // A serverless/edge host has a read-only filesystem (EROFS), which is not a failure: the environment
    // it just resolved from is that host's config.
    return { ok: false, reason: describeError(error) };
  }
}

let pending = null;

/**
 * Verifies the site on boot and repairs what is missing, once per process.
 *
 *   * `options.installed` is set to `'true'` through the caller's `seed` (a direct PostgreSQL
 *     connection — the statement the wizard runs). A host with no such credentials reports `skipped`:
 *     refusing to treat the site as *installed* because a shared row could not be written would
 *     re-create the very bug this module removes.
 *   * `data/react-wp-config.json` is written whenever the host can keep one and the file did not already
 *     say `installed: true` — on Supabase that is the point of it, because it is what makes every later
 *     `readConfig()` in `server.mjs` agree with the environment.
 *
 * Never throws and never rejects: a temporarily unreachable database must not stop a server from
 * answering requests, which is the rule `runStartupMigrations` follows too. The result is memoised; pass
 * `force: true` to run it again.
 */
export function ensureSiteInstalled({ seed = null, env = null, log = console, force = false } = {}) {
  if (!force && pending) return pending;
  const run = (async () => {
    const report = {
      installed: false,
      configured: false,
      repaired: false,
      target: '',
      seeded: { status: 'not-requested' },
      wrote: null,
    };
    try {
      const file = await readConfig().catch(() => null);
      const config = mergeSiteConfig(file, envDerivedConfig({ ...autoSetupEnv(), ...(env ?? {}) }));
      report.target = describeSiteTarget(config);
      // A site nobody has configured is the Setup Wizard's to install: say nothing, write nothing.
      if (!configIsConfigured(config)) return report;

      report.configured = true;
      report.installed = true;
      const wasMarked = file?.installed === true;
      report.repaired = !wasMarked;
      if (seed) {
        report.seeded = await Promise.resolve(seed(config))
          .then((result) => result ?? { status: 'seeded' })
          .catch((error) => ({ status: 'failed', reason: describeError(error) }));
      }
      if (!wasMarked) report.wrote = await writeInstalledConfig(file, config);

      const say = typeof log?.info === 'function' ? log.info.bind(log) : log?.log?.bind(log);
      const warn = typeof log?.warn === 'function' ? log.warn.bind(log) : say;
      say?.(`${AUTO_SETUP_LOG} Site installation verified/auto-seeded in system_settings.`);
      if (report.seeded.status === 'seeded') {
        say?.(`${AUTO_SETUP_LOG} options.installed = true — ${report.target}.`);
      } else if (report.seeded.status === 'skipped') {
        warn?.(`${AUTO_SETUP_LOG} Could not verify options.installed: ${report.seeded.reason}. The site is still treated as installed, because it is configured.`);
      } else if (report.seeded.status === 'failed') {
        warn?.(`${AUTO_SETUP_LOG} Writing options.installed failed: ${report.seeded.reason}. The site is still treated as installed, because it is configured.`);
      }
      if (report.wrote?.ok) {
        say?.(`${AUTO_SETUP_LOG} Wrote data/react-wp-config.json (${config.dbType}) so this server answers with the same backend the browser reads from the environment.`);
      } else if (report.wrote && !report.wrote.ok) {
        say?.(`${AUTO_SETUP_LOG} data/react-wp-config.json was not written (${report.wrote.reason}); the environment is this host's config.`);
      }
      return report;
    } catch (error) {
      report.error = describeError(error);
      return report;
    }
  })();
  if (!force) pending = run;
  return run;
}

/** The healed config, for callers that want the answer rather than the report. */
export async function ensureSiteInstalledConfig(options = {}) {
  await ensureSiteInstalled(options);
  return resolveSiteConfig(options.env ?? null);
}
