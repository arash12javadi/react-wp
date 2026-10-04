/**
 * Base class for the PostgreSQL, MySQL and SQLite drivers.
 *
 * It implements every `DBAdapter` method against a single primitive — `run(sql, params)` — so the
 * concrete drivers only have to open a connection, execute a statement, and close it again. Schema
 * migration (`migrate`) stays abstract because each driver's client handles multi-statement DDL
 * differently.
 */
import type { DBAdapter } from '../DBAdapter';
import type { DbFilter, DbRow, DbValue, HealthResult } from '../types';
import type { DbType } from '../../runtime';
import { describeDbError, scrubConnection } from '../errors';
import {
  buildDelete,
  buildInsert,
  buildSelect,
  buildUpdate,
  buildUpsert,
  type SqlDialect,
} from './sql';

export abstract class SqlAdapterBase implements DBAdapter {
  abstract readonly type: DbType;
  abstract readonly dialect: SqlDialect;
  readonly supportsMigrations = true;

  /** Executes SQL and returns the resulting rows (empty for statements without a result set). */
  protected abstract run(sql: string, params?: DbValue[]): Promise<DbRow[]>;
  /** Releases the connection / pool / file handle. */
  protected abstract closeConnection(): Promise<void>;
  /** Runs a multi-statement schema script. */
  abstract migrate(schema: string): Promise<void>;

  async select(table: string, filter: DbFilter = {}): Promise<DbRow[]> {
    const { sql, params } = buildSelect(table, filter, this.dialect);
    return this.run(sql, params);
  }

  async selectOne(table: string, filter: DbFilter = {}): Promise<DbRow | null> {
    const rows = await this.select(table, { ...filter, limit: 1 });
    return rows[0] ?? null;
  }

  async insert(table: string, rows: DbRow | DbRow[]): Promise<DbRow[]> {
    const { sql, params } = buildInsert(table, rows, this.dialect);
    const returning = this.dialect.returning ? ' returning *' : '';
    return this.run(`${sql}${returning}`, params);
  }

  async update(table: string, filter: DbFilter, patch: DbRow): Promise<DbRow[]> {
    const { sql, params } = buildUpdate(table, filter, patch, this.dialect);
    if (this.dialect.returning) {
      return this.run(`${sql}${filter.columns ? ` returning ${filter.columns}` : ''}`, params);
    }
    return this.writeReturningRows(table, filter, () => this.run(sql, params));
  }

  async upsert(table: string, rows: DbRow[], conflictColumns?: string[]): Promise<DbRow[]> {
    const { sql, params } = buildUpsert(table, rows, conflictColumns ?? [], this.dialect);
    const returning = this.dialect.returning ? ' returning *' : '';
    return this.run(`${sql}${returning}`, params);
  }

  async delete(table: string, filter: DbFilter): Promise<DbRow[]> {
    const { sql, params } = buildDelete(table, filter, this.dialect);
    if (this.dialect.returning) {
      return this.run(`${sql}${filter.columns ? ` returning ${filter.columns}` : ''}`, params);
    }
    return this.writeReturningRows(table, filter, () => this.run(sql, params));
  }

  /**
   * Returns the rows a write touched on a driver that cannot hand them back itself (MySQL/MariaDB).
   *
   * The ids the filter matches are read before the write and looked up again afterwards. Nothing is
   * read at all unless the caller chained `.select()`, because then it never asked for the rows.
   */
  private async writeReturningRows(table: string, filter: DbFilter, write: () => Promise<DbRow[]>): Promise<DbRow[]> {
    const columns = filter.columns;
    const before = columns ? await this.readMatchingIds(table, filter) : [];
    await write();
    if (!columns) return [];
    const ids = before.map((row) => row.id).filter((id): id is DbValue => id !== undefined && id !== null);
    if (ids.length && ids.length === before.length) {
      return this.select(table, { in: { id: ids }, columns });
    }
    // A table keyed by something other than `id` (`options`, `rwp_role_capabilities`), or one whose
    // key list could not be read: the filter itself is the best key available, because its columns
    // are not the ones that were just written.
    return this.select(table, { ...this.scopedFilter(filter), columns });
  }

  /** The ids matching `filter`, or none when the table has no `id` column. */
  private async readMatchingIds(table: string, filter: DbFilter): Promise<DbRow[]> {
    try {
      return await this.select(table, { ...this.scopedFilter(filter), columns: 'id' });
    } catch {
      return [];
    }
  }

  /** The narrowing conditions only — ordering and paging would truncate or reorder a key list. */
  private scopedFilter(filter: DbFilter): DbFilter {
    const scoped: DbFilter = { ...filter };
    delete scoped.orderBy;
    delete scoped.limit;
    delete scoped.offset;
    delete scoped.columns;
    return scoped;
  }

  async getOption<T = unknown>(name: string, fallback?: T | null): Promise<T | null> {
    const rows = await this.select('options', { where: { option_name: name }, limit: 1 });
    const row = rows[0];
    if (!row || row.option_value === null || row.option_value === undefined) return fallback ?? null;
    const raw = String(row.option_value);
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async setOption(name: string, value: unknown): Promise<boolean> {
    const valueString = typeof value === 'object' ? JSON.stringify(value) : String(value);
    await this.upsert('options', [{ option_name: name, option_value: valueString }], ['option_name']);
    return true;
  }

  async hasTable(table: string): Promise<boolean> {
    try {
      await this.run(`select 1 from ${this.dialect.quote(table)} limit 1`);
      return true;
    } catch {
      return false;
    }
  }

  async query(sql: string, params: DbValue[] = []): Promise<DbRow[]> {
    return this.run(sql, params);
  }

  async healthCheck(): Promise<HealthResult> {
    try {
      await this.run('select 1 as ok');
      return { ok: true, message: 'Connected.' };
    } catch (error) {
      return { ok: false, message: scrubConnection(describeDbError(error)) };
    }
  }

  async close(): Promise<void> {
    await this.closeConnection();
  }
}
