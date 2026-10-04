/**
 * SQLite / LibSQL driver.
 *
 * - `sqlite` uses `better-sqlite3` for a zero-config embedded file database (local, Docker volumes).
 * - `libsql` uses `@libsql/client` for an embedded file or a remote Turso serverless/edge database.
 *
 * Both dependencies are imported lazily so neither loads unless this backend is selected.
 */
import { SqlAdapterBase } from './sqlBase';
import { sqliteDialect } from './sql';
import type { DbRow, DbValue } from '../types';
import type { RuntimeConfig } from '../../runtime';

/** Minimal structural types so the adapter stays decoupled from the exact driver typings. */
interface LibSqlClient {
  execute(input: { sql: string; args?: unknown[] }): Promise<{ rows: DbRow[] }>;
  executeMultiple(sql: string): Promise<unknown>;
  close(): void;
}

interface BetterSqliteStatement {
  all(...params: unknown[]): DbRow[];
  run(...params: unknown[]): unknown;
}

interface BetterSqliteDatabase {
  prepare(sql: string): BetterSqliteStatement;
  exec(sql: string): void;
  close(): void;
}

type Connection = { kind: 'better-sqlite3'; db: BetterSqliteDatabase } | { kind: 'libsql'; client: LibSqlClient };

const defaultFile = 'data/react-wp.db';

export class SqliteAdapter extends SqlAdapterBase {
  readonly dialect = sqliteDialect;
  private readonly config: RuntimeConfig;
  private readonly useLibsql: boolean;
  private connection: Connection | null = null;

  constructor(config: RuntimeConfig) {
    super();
    this.config = config;
    this.useLibsql = config.dbType === 'libsql';
  }

  get type(): 'sqlite' | 'libsql' {
    return this.useLibsql ? 'libsql' : 'sqlite';
  }

  private async connect(): Promise<Connection> {
    if (this.connection) return this.connection;
    if (this.useLibsql) {
      const { createClient } = await import('@libsql/client');
      const url = this.config.databaseUrl
        || (this.config.sqliteFile ? `file:${this.config.sqliteFile}` : `file:${defaultFile}`);
      const client = createClient({
        url,
        authToken: this.config.libsqlAuthToken || undefined,
      }) as unknown as LibSqlClient;
      this.connection = { kind: 'libsql', client };
      return this.connection;
    }
    const Database = (await import('better-sqlite3')).default;
    const file = this.config.sqliteFile
      || (this.config.databaseUrl ? this.config.databaseUrl.replace(/^file:/, '') : defaultFile);
    if (file !== ':memory:') {
      const { mkdirSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(file), { recursive: true });
    }
    const db = new Database(file) as BetterSqliteDatabase;
    db.exec('pragma journal_mode = WAL;');
    this.connection = { kind: 'better-sqlite3', db };
    return this.connection;
  }

  protected async run(sql: string, params: DbValue[] = []): Promise<DbRow[]> {
    const connection = await this.connect();
    if (connection.kind === 'libsql') {
      const result = await connection.client.execute({ sql, args: params as unknown[] });
      return result.rows ?? [];
    }
    const statement = connection.db.prepare(sql);
    const selectsRows = /^\s*(select|with|pragma)\b/i.test(sql) || /\sreturning\s/i.test(sql);
    if (selectsRows) return statement.all(...(params as unknown[]));
    statement.run(...(params as unknown[]));
    return [];
  }

  protected async closeConnection(): Promise<void> {
    if (!this.connection) return;
    if (this.connection.kind === 'libsql') this.connection.client.close();
    else this.connection.db.close();
    this.connection = null;
  }

  async migrate(schema: string): Promise<void> {
    const connection = await this.connect();
    if (connection.kind === 'libsql') await connection.client.executeMultiple(schema);
    else connection.db.exec(schema);
  }
}

export const createSqliteAdapter = (config: RuntimeConfig): SqliteAdapter => new SqliteAdapter(config);
