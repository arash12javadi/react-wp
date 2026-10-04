/**
 * Database adapter factory and singleton accessor.
 *
 * `createDbAdapter` builds a browser-safe driver: Supabase talks to its project directly, and every
 * self-hosted backend (PostgreSQL / MySQL / SQLite / LibSQL) is reached through `HttpDBAdapter`,
 * which forwards each call to the server's `/api/db/query`. The native drivers (`pg`, `mysql2`,
 * `better-sqlite3`, `@libsql/client`) are server-only and are loaded lazily through
 * `createServerDbAdapter`, so the client bundle never pulls them in.
 */
import { resolveRuntimeConfig, type RuntimeConfig } from '../runtime';
import type { DBAdapter } from './DBAdapter';
import { createSupabaseAdapter } from './adapters/supabase';
import { HttpDBAdapter } from './adapters/http';

let adapter: DBAdapter | null = null;

/**
 * Browser-safe factory. Supabase is reached directly from the page; every other backend is reached
 * over HTTP through `/api/db/query` (the connection details and credentials stay on the server).
 */
export function createDbAdapter(config: RuntimeConfig): DBAdapter {
  if (config.dbType === 'supabase') return createSupabaseAdapter(config);
  return new HttpDBAdapter(config.dbType);
}

/** Server factory: every backend, with the heavy drivers imported on demand. */
export async function createServerDbAdapter(config: RuntimeConfig): Promise<DBAdapter> {
  switch (config.dbType) {
    case 'supabase':
      return createSupabaseAdapter(config);
    case 'postgres': {
      const { createPostgresAdapter } = await import('./adapters/postgres');
      return createPostgresAdapter(config);
    }
    case 'mysql': {
      const { createMysqlAdapter } = await import('./adapters/mysql');
      return createMysqlAdapter(config);
    }
    case 'sqlite':
    case 'libsql': {
      const { createSqliteAdapter } = await import('./adapters/sqlite');
      return createSqliteAdapter(config);
    }
    default:
      throw new Error(`Unsupported database type: ${String((config as { dbType?: string }).dbType)}`);
  }
}

/** Returns the shared client adapter (Supabase), creating it from the runtime config on first use. */
export function getDbAdapter(config?: RuntimeConfig): DBAdapter {
  if (!adapter) adapter = createDbAdapter(config ?? resolveRuntimeConfig());
  return adapter;
}

/** Drops the cached adapter so a config change (e.g. after the Setup Wizard) takes effect. */
export function resetDbAdapter(): void {
  if (adapter) void adapter.close().catch(() => undefined);
  adapter = null;
}

export type { DBAdapter } from './DBAdapter';
export type { DbFilter, DbRow, DbValue, HealthResult } from './types';
export { describeDbError, isMissingRelation, scrubConnection } from './errors';
export { runCoreMigrations } from './migrations';
export { schemaFor } from './migrations/schemas';

