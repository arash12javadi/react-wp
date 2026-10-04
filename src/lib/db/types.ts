/**
 * Shared value types for the database abstraction layer.
 *
 * Every driver accepts and returns these shapes, so callers never have to know whether the rows
 * came from PostgREST, a `pg` pool, `mysql2`, or a SQLite file.
 */

import type { DbType } from '../runtime';

/** A scalar value any driver can round-trip into a column. */
export type DbScalar = string | number | boolean | null;

/** A JSON-compatible value — used for `json`/`jsonb` columns (menus.items, options, …). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Anything a database row can hold, including dates and binary. */
export type DbValue = DbScalar | Date | Uint8Array | JsonValue;

/** A row, keyed by column name. Loose on purpose: payloads carry jsonb blobs and driver-shaped ids. */
export type DbRow = Record<string, DbValue>;

/** A binary column comparison any driver can render. */
export type DbComparison = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';

/**
 * Every operator `.not(column, operator, value)` accepts — the PostgREST set, so a `.not()` written
 * against Supabase keeps working on SQLite/PostgreSQL/MySQL.
 */
export type DbNegatableOperator = DbComparison | 'like' | 'ilike' | 'is' | 'in';

/** One negated condition, as produced by `.not(column, operator, value)`. */
export interface DbNegation {
  column: string;
  operator: DbNegatableOperator;
  /** `null` means `is null`; an array means `in`; anything else is bound as one parameter. */
  value?: DbValue | DbValue[] | undefined;
}

/** A sortable column order. */
export interface DbOrder {
  column: string;
  direction?: 'asc' | 'desc';
}

/** How a single-table query is narrowed, sorted and limited. */
export interface DbFilter {
  /** Column equality. `undefined` values are skipped. */
  where?: Record<string, DbValue>;
  /** Column `IN (…)` membership. */
  in?: Record<string, DbValue[]>;
  /** Column `<>` inequality. */
  notEq?: Record<string, DbValue>;
  /** Column `> value`. */
  gt?: Record<string, DbValue>;
  /** Column `>= value`. */
  gte?: Record<string, DbValue>;
  /** Column `< value`. */
  lt?: Record<string, DbValue>;
  /** Column `<= value`. */
  lte?: Record<string, DbValue>;
  /** Case-insensitive `LIKE`; the value is the pattern, so `%`/`_` stay wildcards. */
  ilike?: Record<string, string>;
  /** Negated conditions, ANDed with everything else (Supabase's `.not()`). */
  not?: DbNegation[];
  /** A PostgREST-style disjunction, e.g. `status.is.null,status.neq.trash`. */
  or?: string;
  orderBy?: DbOrder[];
  limit?: number;
  offset?: number;
  /** Column list, e.g. `'*'` (default) or `'id,name,slug'`. */
  columns?: string;
}

/**
 * True when a filter narrows at least one row.
 *
 * A write must never run without this: a builder that carries a condition the adapter would ignore
 * (or no condition at all) would turn into an unqualified `UPDATE`/`DELETE` over the whole table.
 * Both the query builder and the SQL writer test the filter with this one predicate, so they can
 * never disagree about what counts as scoped.
 */
export function hasFilterScope(filter: DbFilter): boolean {
  const filled = (group?: Record<string, unknown>) => Object.values(group ?? {}).some((value) => value !== undefined);
  return Boolean(
    filled(filter.where)
      || filled(filter.in)
      || filled(filter.notEq)
      || filled(filter.gt)
      || filled(filter.gte)
      || filled(filter.lt)
      || filled(filter.lte)
      || filled(filter.ilike)
      || filter.not?.length
      || filter.or?.trim(),
  );
}

/** The result of probing a connection during the Setup Wizard's health check. */
export interface HealthResult {
  ok: boolean;
  /** A human-readable success summary or the failure reason (already password-scrubbed). */
  message: string;
}

/** Identifies the driver from the outside; useful for feature detection in shared code. */
export interface DbAdapterInfo {
  readonly type: DbType;
}
