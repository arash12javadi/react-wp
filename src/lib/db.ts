/**
 * Unified client database helper.
 *
 * This is the one file the rest of the application imports for data access. It no longer exposes any
 * Supabase-specific entry point — `client` is gone. Everything routes through the
 * universal `client` / `db` / `auth` facade (see `./client.ts`), which resolves the runtime config
 * and dispatches to the selected `DBAdapter` / `AuthAdapter` / `StorageAdapter`.
 */
import { client, tryGetClient, resetClient as resetClientInstance, type AuthFacade, type Client, type Session, type User } from './client';
import { getDbAdapter, resetDbAdapter as resetDbAdapterInstance, type DBAdapter } from './db/index';
import { resetAuthAdapter } from './auth/index';
import { createStorageAdapter } from './storage/index';
import { resolveRuntimeConfig, type DbType, type RuntimeConfig } from './runtime';

export type { Client, Session, User, DbType, RuntimeConfig };
export { client, tryGetClient, resolveRuntimeConfig };

let cachedConfig: RuntimeConfig | null = null;

/** The resolved runtime config, cached for the lifetime of the bundle. */
export const getRuntimeConfig = (): RuntimeConfig => {
  if (!cachedConfig) cachedConfig = resolveRuntimeConfig();
  return cachedConfig;
};

export { describeDbError } from './db/index';

/**
 * The shared auth facade (Supabase auth in Supabase mode; universal JWT auth otherwise). Lazy on
 * purpose: touching it must not build the client at module load, or an unconfigured site would throw
 * before the Setup Wizard can render.
 */
export const auth: AuthFacade = new Proxy({} as AuthFacade, {
  get(_target, prop: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (client.auth as any)[prop];
  },
});

/** The shared DBAdapter, exposed for callers that want the universal interface directly. */
export const getDb = (): DBAdapter => getDbAdapter();

/**
 * Drops the cached runtime config plus the client/database/auth adapters so a configuration change
 * (the Setup Wizard's Step 5, or the admin "reconfigure" flow) takes effect on the next call. The
 * Setup Wizard invokes this before it hard-navigates to the dashboard.
 */
export const resetClient = (): void => {
  cachedConfig = null;
  resetClientInstance();
  resetDbAdapterInstance();
  resetAuthAdapter();
};

/** Backward-compatible alias for {@link resetClient}. */
export const resetDbAdapter = resetClient;

export const getStorageAdapter = () => createStorageAdapter(getRuntimeConfig());

// WordPress-style Options API
export const getOption = async <T = string>(optionName: string, defaultValue: T | null = null): Promise<T | null> =>
  getDbAdapter().getOption<T>(optionName, defaultValue);

export const updateOption = async (optionName: string, optionValue: unknown): Promise<boolean> =>
  getDbAdapter().setOption(optionName, optionValue);

/**
 * The system-settings API: an administrator-only key-value store (`system_settings`) for
 * configuration that must not live in boot-time environment variables — the storage driver, S3
 * credentials and integration keys. It is what keeps `react-wp` platform-agnostic: the Setup Wizard
 * writes these once, and every deployment reads them back from the active database instead of from
 * `.env`. Reads and writes route through the selected adapter, which enforces the same
 * `manage_options` rule the Supabase RLS policies apply.
 */
export const getSystemSetting = async <T = unknown>(key: string, fallback: T | null = null): Promise<T | null> =>
  getDbAdapter().getSystemSetting<T>(key, fallback);

export const setSystemSetting = async (key: string, value: unknown): Promise<boolean> =>
  getDbAdapter().setSystemSetting(key, value);

/**
 * The universal data interface. `from(table)` returns the dialect-independent query builder
 * (`.select().eq().order().single()…`, `.insert/update/upsert/delete`); the `select/insert/update/
 * delete` methods below are the plugin `$wpdb`-style helpers kept for backward compatibility.
 */
export const db = {
  from: (table: string) => client.from(table),
  rpc: (fn: string, args?: Record<string, unknown>) => client.rpc(fn, args),

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  select: async (table: string, query: Record<string, any> = {}) =>
    getDbAdapter().select(table, { where: query }),

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insert: async (table: string, payload: Record<string, any>) =>
    getDbAdapter().insert(table, payload),

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update: async (table: string, id: string | number, payload: Record<string, any>) =>
    getDbAdapter().update(table, { where: { id } }, payload),

  delete: async (table: string, id: string | number) =>
    (await getDbAdapter().delete(table, { where: { id } })).length > 0,
};

