/**
 * Universal runtime configuration.
 *
 * React-WP reads its backend configuration from one of two places, in this order:
 *
 *   1. A server-injected object (`window.__REACT_WP_CONFIG__` on the client, or the parsed
 *      `data/react-wp-config.json` on a persistent server).
 *   2. Environment variables (`VITE_DB_TYPE`, `DATABASE_URL`, `JWT_SECRET`, …).
 *
 * This module is shared by the browser bundle and the Hono server, so every database/auth/storage
 * driver reads the same shape regardless of where it runs. It never touches `@supabase/supabase-js`
 * directly — that coupling lives inside the Supabase driver in `src/lib/db/adapters/supabase.ts`.
 */

/** The database backends React-WP can talk to. */
export type DbType = 'supabase' | 'postgres' | 'mysql' | 'sqlite' | 'libsql';

/** Where a deployment keeps its writable files (and therefore whether it can host uploads itself). */
export type DeploymentMode = 'node' | 'serverless' | 'edge';

/** Object storage the StorageAdapter can write to when the host is read-only. */
export interface S3Config {
  region?: string;
  endpoint?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Public base URL used to build readable object URLs when the bucket is private. */
  publicBaseUrl?: string;
  /** Always force `path-style` addressing (needed for Cloudflare R2 and MinIO). */
  forcePathStyle?: boolean;
}

export interface RuntimeConfig {
  /** False until the Setup Wizard has provisioned a database and written a config. */
  installed: boolean;
  dbType: DbType;

  // Supabase
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  supabaseServiceRoleKey?: string;

  // PostgreSQL / MySQL (either a full URL or discrete parts)
  databaseUrl?: string;
  dbHost?: string;
  dbPort?: number;
  dbName?: string;
  dbUser?: string;
  dbPassword?: string;

  // SQLite / LibSQL
  sqliteFile?: string;
  libsqlAuthToken?: string;

  // Universal authentication
  jwtSecret?: string;

  // Media storage
  storage?: 'local' | 's3';
  s3?: S3Config;
}

const emptyConfig = (dbType: DbType): RuntimeConfig => ({ installed: false, dbType });

const asBool = (value: string | boolean | undefined): boolean =>
  value === true || value === 'true' || value === '1';

const first = (...values: Array<string | undefined>): string | undefined => {
  for (const value of values) if (value && value.trim()) return value.trim();
  return undefined;
};

/** Which backend was requested, normalised and validated. */
export function dbTypeFrom(value: string | undefined): DbType {
  const raw = String(value || '').trim().toLowerCase();
  switch (raw) {
    case 'supabase':
    case 'postgres':
    case 'postgresql':
    case 'pg':
      return raw === 'supabase' ? 'supabase' : 'postgres';
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

/**
 * Builds a `RuntimeConfig` from an environment map plus an optional server-injected object.
 * Pure and side-effect free, so the server and the browser can both call it.
 */
export function runtimeConfigFromEnv(
  env: Record<string, string | undefined>,
  injected: Partial<RuntimeConfig> | null | undefined = null,
): RuntimeConfig {
  const dbType = dbTypeFrom(
    first(String(injected?.dbType ?? ''), env.VITE_DB_TYPE, env.DB_TYPE) || 'supabase',
  );

  const config: RuntimeConfig = emptyConfig(dbType);

  config.installed = asBool(String(injected?.installed ?? ''));
  if (injected?.installed === true) config.installed = true;

  // Supabase
  config.supabaseUrl = first(
    String(injected?.supabaseUrl ?? ''),
    env.VITE_SUPABASE_URL,
    env.SUPABASE_URL,
  );
  config.supabasePublishableKey = first(
    String(injected?.supabasePublishableKey ?? ''),
    env.VITE_SUPABASE_PUBLISHABLE_KEY,
    env.VITE_SUPABASE_ANON_KEY,
    env.SUPABASE_PUBLISHABLE_KEY,
  );
  config.supabaseServiceRoleKey = first(
    String(injected?.supabaseServiceRoleKey ?? ''),
    env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // SQL databases
  config.databaseUrl = first(
    String(injected?.databaseUrl ?? ''),
    env.DATABASE_URL,
    env.VITE_DATABASE_URL,
  );
  config.dbHost = first(String(injected?.dbHost ?? ''), env.DB_HOST, env.PGHOST, env.MYSQL_HOST);
  config.dbName = first(String(injected?.dbName ?? ''), env.DB_NAME, env.PGDATABASE, env.MYSQL_DATABASE);
  config.dbUser = first(String(injected?.dbUser ?? ''), env.DB_USER, env.PGUSER, env.MYSQL_USER);
  config.dbPassword = first(String(injected?.dbPassword ?? ''), env.DB_PASSWORD, env.PGPASSWORD, env.MYSQL_PASSWORD);
  const rawPort = first(String(injected?.dbPort ?? ''), env.DB_PORT, env.PGPORT, env.MYSQL_PORT);
  config.dbPort = rawPort ? Number(rawPort) || undefined : undefined;

  // SQLite / LibSQL
  config.sqliteFile = first(
    String(injected?.sqliteFile ?? ''),
    env.SQLITE_FILE,
    env.DATABASE_URL,
  );
  config.libsqlAuthToken = first(
    String(injected?.libsqlAuthToken ?? ''),
    env.LIBSQL_AUTH_TOKEN,
    env.TURSO_AUTH_TOKEN,
  );

  // Universal auth
  config.jwtSecret = first(
    String(injected?.jwtSecret ?? ''),
    env.JWT_SECRET,
    env.VITE_JWT_SECRET,
  );

  // Storage
  const storage = first(String(injected?.storage ?? ''), env.RWP_STORAGE, env.STORAGE_DRIVER);
  config.storage = storage === 's3' ? 's3' : storage === 'local' ? 'local' : undefined;
  const s3 = injected?.s3 || {};
  config.s3 = {
    region: first(String(s3.region ?? ''), env.S3_REGION, env.AWS_REGION),
    endpoint: first(String(s3.endpoint ?? ''), env.S3_ENDPOINT, env.AWS_ENDPOINT),
    bucket: first(String(s3.bucket ?? ''), env.S3_BUCKET, env.AWS_BUCKET),
    accessKeyId: first(String(s3.accessKeyId ?? ''), env.S3_ACCESS_KEY_ID, env.AWS_ACCESS_KEY_ID),
    secretAccessKey: first(String(s3.secretAccessKey ?? ''), env.S3_SECRET_ACCESS_KEY, env.AWS_SECRET_ACCESS_KEY),
    publicBaseUrl: first(String(s3.publicBaseUrl ?? ''), env.S3_PUBLIC_BASE_URL),
    forcePathStyle: asBool(String(s3.forcePathStyle ?? env.S3_FORCE_PATH_STYLE ?? '')),
  };

  return config;
}

/**
 * Resolves the config for the environment this module is running in. On the browser this reads the
 * injected `window.__REACT_WP_CONFIG__` (written by `server/config.mjs` into `index.html`) plus the
 * Vite env vars; on the server it reads `process.env`.
 */
export function resolveRuntimeConfig(): RuntimeConfig {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const w = window as Window & {
      __REACT_WP_CONFIG__?: Partial<RuntimeConfig> | null;
    };
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
    return runtimeConfigFromEnv(env, w.__REACT_WP_CONFIG__);
  }
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return runtimeConfigFromEnv(proc?.env ?? {});
}

/**
 * True when enough configuration exists to attempt a database connection.
 *
 * `installed: true` (written by the Setup Wizard in Step 5) is decisive: for the server-only
 * backends the public config injected into the page carries no connection details, so a
 * SQLite/PostgreSQL/MySQL site is "configured" the moment its server reports it provisioned — the
 * browser reaches the data through `/api/db/query`, not a direct connection. Supabase still needs
 * its project URL and publishable key, which the injected config does carry.
 */
export function isConfigured(config: RuntimeConfig): boolean {
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
