/**
 * The unified database interface.
 *
 * Every backend driver (Supabase, PostgreSQL, MySQL/MariaDB, SQLite/LibSQL) implements this
 * contract, so the rest of the application — the options API, the content engine, the plugin
 * layer, the Setup Wizard — can talk to any of them without knowing which one is underneath.
 *
 * The method set is deliberately small and WordPess-shaped: CRUD, a key-value options store, a
 * schema migrator, a health probe, and a raw escape hatch for driver-specific work.
 */
import type { DbFilter, DbRow, DbValue, HealthResult } from './types';
import type { DbType } from '../runtime';

export interface DBAdapter {
  readonly type: DbType;
  /** False for the Supabase anon-key client, which cannot run DDL over PostgREST. */
  readonly supportsMigrations: boolean;

  // -- Single-table CRUD -------------------------------------------------------

  /** Returns all rows matching `filter`, or every row when no filter is given. */
  select(table: string, filter?: DbFilter): Promise<DbRow[]>;
  /** Returns one matching row, or null. */
  selectOne(table: string, filter?: DbFilter): Promise<DbRow | null>;
  /** Inserts one or many rows and returns them (as the driver is able to). */
  insert(table: string, rows: DbRow | DbRow[]): Promise<DbRow[]>;
  /** Updates the rows `filter` matches and returns them (on MySQL, once `.select()` asked for them). */
  update(table: string, filter: DbFilter, patch: DbRow): Promise<DbRow[]>;
  /** Insert-or-update keyed on `conflictColumns` (defaults to the primary key). */
  upsert(table: string, rows: DbRow[], conflictColumns?: string[]): Promise<DbRow[]>;
  /**
   * Deletes the rows `filter` matches and returns them — the `.select()` columns, or the whole row
   * when the driver cannot project a delete. A filter that narrows nothing is refused: an
   * unqualified `DELETE` would empty the table.
   */
  delete(table: string, filter: DbFilter): Promise<DbRow[]>;

  // -- WordPress-style options -------------------------------------------------

  /** Reads a JSON-encoded option. Returns `fallback` when absent or unparseable as JSON. */
  getOption<T = unknown>(name: string, fallback?: T | null): Promise<T | null>;
  /** Writes (upserts) an option. Resolves `false` only when the write was blocked or failed. */
  setOption(name: string, value: unknown): Promise<boolean>;

  // -- Migrations / provisioning -----------------------------------------------

  /** Runs a schema script (DDL). Throws on failure. */
  migrate(schema: string): Promise<void>;
  /** True when a table (or, for Supabase, a queryable relation) exists. */
  hasTable(table: string): Promise<boolean>;

  // -- Diagnostics & lifecycle -------------------------------------------------

  /** Probes the connection and returns a success summary or a scrubbed failure reason. */
  healthCheck(): Promise<HealthResult>;
  /** Releases pooled connections / file handles. Safe to call more than once. */
  close(): Promise<void>;

  // -- Raw escape hatch --------------------------------------------------------

  /** Runs arbitrary SQL (or, for Supabase, a named RPC). Returns rows, or an empty array. */
  query(sql: string, params?: DbValue[]): Promise<DbRow[]>;
}

/** A driver constructor: builds an adapter from the resolved runtime config. */
export type DbAdapterFactory = (config: import('../runtime').RuntimeConfig) => DBAdapter;
