/**
 * Server-side configuration.
 *
 * Reads `process.env` (and, on a persistent Node host, `data/react-wp-config.json`) into the same
 * `RuntimeConfig` the client and drivers share. Secrets (database password, JWT secret) never leave
 * the server — the public config injected into `index.html` only ever carries `dbType`, `installed`
 * and the publishable Supabase keys.
 */
import { runtimeConfigFromEnv, type RuntimeConfig } from '../lib/runtime';

export function resolveServerConfig(): RuntimeConfig {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return runtimeConfigFromEnv(proc?.env ?? {});
}

interface NodeFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  writeFile(path: string, data: string): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
}

async function nodeModules(): Promise<{ fs: NodeFs; path: { resolve(...parts: string[]): string; join(...parts: string[]): string } }> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  return { fs: fs as unknown as NodeFs, path };
}

const dataDir = (): string =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.REACT_WP_DATA_DIR || 'data';

const configPath = async (): Promise<string> => {
  const { path } = await nodeModules();
  return path.resolve(dataDir(), 'react-wp-config.json');
};

/** Reads `data/react-wp-config.json`, or null when absent. Returns null off Node (serverless). */
export async function readConfigFile(): Promise<Partial<RuntimeConfig> | null> {
  try {
    const { fs } = await nodeModules();
    const raw = await fs.readFile(await configPath(), 'utf8');
    return JSON.parse(raw) as Partial<RuntimeConfig>;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') return null;
    // Non-Node runtimes (edge/serverless) cannot read the filesystem.
    if (code === 'ERR_UNSUPPORTED_ESM_URL_SCHEME' || /Dynamic require|node:fs/.test(String(error))) return null;
    return null;
  }
}

/** Writes the config file atomically (persistent Node hosts only). */
export async function writeConfigFile(config: Partial<RuntimeConfig>): Promise<void> {
  const { fs, path } = await nodeModules();
  const target = path.resolve(dataDir(), 'react-wp-config.json');
  await fs.mkdir(path.resolve(dataDir()), { recursive: true });
  const temp = `${target}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`);
  await fs.rename(temp, target);
}

/** Merges the env-derived config with the on-disk file; the file wins and `installed` is sticky. */
function mergeRuntimeConfig(base: RuntimeConfig, file: Partial<RuntimeConfig> | null): RuntimeConfig {
  const merged: RuntimeConfig = { ...base, ...(file ?? {}) };
  merged.installed = file?.installed === true || base.installed === true;
  return merged;
}

let cachedRuntimeConfig: RuntimeConfig | null = null;

/**
 * The server's resolved runtime config, cached in memory for the life of the process.
 *
 * Resolution order is deliberate and environment-aware:
 *   1. `process.env.DATABASE_URL` + `process.env.DB_TYPE` win outright. A serverless/edge run is
 *      read-only (`EROFS`), so it must never touch `data/react-wp-config.json` — the presence of the
 *      env pair is itself the "installed" signal.
 *   2. Otherwise `data/react-wp-config.json` is read (persistent Node hosts), and the file merges
 *      over any env-derived values, with `installed` kept sticky.
 *   3. If neither exists, the site is not installed.
 */
export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (!cachedRuntimeConfig) {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    let base: RuntimeConfig;
    if (env.DATABASE_URL && env.DB_TYPE) {
      base = { ...runtimeConfigFromEnv(env), installed: true };
    } else {
      base = mergeRuntimeConfig(resolveServerConfig(), await readConfigFile());
    }
    cachedRuntimeConfig = await applyStoredStorageSettings(base);
  }
  return cachedRuntimeConfig;
}

/**
 * Fills `storage`/`s3` from the `system_settings` table when the environment/config file did not
 * supply them. The Setup Wizard persists the storage driver (and its S3 credentials) here instead of
 * emitting more boot-time env vars — this is what lets the same wizard output boot on any platform.
 *
 * Supabase is skipped deliberately: its `system_settings` rows are RLS-protected (they need
 * `manage_options`), so the server's publishable-key client cannot read them — a Supabase deployment
 * keeps storage configuration in the environment. Any failure is swallowed, because resolving the
 * config must never throw before a request can be answered.
 */
async function applyStoredStorageSettings(config: RuntimeConfig): Promise<RuntimeConfig> {
  if (!config.installed || config.dbType === 'supabase') return config;
  const envHasS3 = config.s3 ? Object.values(config.s3).some(Boolean) : false;
  // Nothing to fill: skip the database round-trip entirely. A `local` driver never needs S3, and an
  // `s3` driver with credentials already supplied by the environment needs nothing either.
  if (config.storage && (config.storage !== 's3' || envHasS3)) return config;
  try {
    const { createServerDbAdapter } = await import('../lib/db/index');
    const db = await createServerDbAdapter(config);
    try {
      const storedStorage = config.storage ? undefined : await db.getSystemSetting<'local' | 's3'>('storage');
      const storedS3 = envHasS3 ? undefined : await db.getSystemSetting<RuntimeConfig['s3']>('s3');
      const merged: RuntimeConfig = { ...config };
      if (storedStorage === 's3' || storedStorage === 'local') merged.storage = storedStorage;
      if (storedS3 && typeof storedS3 === 'object') merged.s3 = { ...config.s3, ...storedS3 };
      return merged;
    } finally {
      await db.close().catch(() => undefined);
    }
  } catch {
    return config;
  }
}

let startupMigrationPromise: Promise<void> | null = null;

/**
 * Applies the idempotent core schema on startup whenever the site is installed. Supabase is skipped:
 * it is provisioned through `supabase/schema.sql` (RLS + RPCs + triggers) by the Setup Wizard's direct
 * database connection, not through the platform-agnostic subset.
 *
 * The promise is memoised so a cold start that serves several requests at once still migrates once,
 * and a failure is logged rather than thrown — a temporarily unreachable database must not take the
 * whole server down before any request is answered.
 */
export function runStartupMigrations(): Promise<void> {
  if (startupMigrationPromise) return startupMigrationPromise;
  startupMigrationPromise = (async () => {
    const config = await getRuntimeConfig();
    if (!config.installed || config.dbType === 'supabase') return;
    const { createServerDbAdapter, runCoreMigrations } = await import('../lib/db/index');
    const db = await createServerDbAdapter(config);
    try {
      await runCoreMigrations(db);
    } finally {
      await db.close().catch(() => undefined);
    }
  })().catch((error) => {
    console.error('Startup schema migration failed:', error);
  });
  return startupMigrationPromise;
}

/**
 * Re-reads `data/react-wp-config.json` into memory. Call this right after the Setup Wizard provisions
 * a site so the running process serves the new backend immediately, with no server restart.
 */
export async function reloadRuntimeConfig(): Promise<RuntimeConfig> {
  cachedRuntimeConfig = null;
  return getRuntimeConfig();
}

/** The non-secret subset safe to inject into the client bundle. */
export function publicConfig(config: Partial<RuntimeConfig>): Partial<RuntimeConfig> {
  return {
    installed: config.installed === true,
    dbType: config.dbType ?? 'supabase',
    storage: config.storage ?? 'local',
    supabaseUrl: config.supabaseUrl,
    supabasePublishableKey: config.supabasePublishableKey,
  };
}
