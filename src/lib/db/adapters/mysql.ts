/**
 * MySQL / MariaDB driver over `mysql2` (connection pool). The dependency is imported lazily so it
 * is only loaded when a MySQL backend is actually selected, keeping the other bundles small.
 */
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { SqlAdapterBase } from './sqlBase';
import { mysqlDialect } from './sql';
import type { DbRow, DbValue } from '../types';
import type { RuntimeConfig } from '../../runtime';

type MysqlRow = RowDataPacket;

export class MysqlAdapter extends SqlAdapterBase {
  readonly type = 'mysql' as const;
  readonly dialect = mysqlDialect;
  private readonly config: RuntimeConfig;
  private pool: Pool | null = null;

  constructor(config: RuntimeConfig) {
    super();
    this.config = config;
  }

  private async getPool(): Promise<Pool> {
    if (!this.pool) {
      const { createPool } = await import('mysql2/promise');
      const base = this.config.databaseUrl
        ? { uri: this.config.databaseUrl }
        : {
            host: this.config.dbHost || 'localhost',
            port: this.config.dbPort ?? 3306,
            database: this.config.dbName,
            user: this.config.dbUser,
            password: this.config.dbPassword,
          };
      this.pool = createPool({
        ...base,
        multipleStatements: true,
        waitForConnections: true,
        connectionLimit: 10,
      });
    }
    return this.pool;
  }

  protected async run(sql: string, params: DbValue[] = []): Promise<DbRow[]> {
    const pool = await this.getPool();
    const [rows] = await pool.query<MysqlRow[]>(sql, params as unknown[]);
    return (Array.isArray(rows) ? rows : []) as DbRow[];
  }

  protected async closeConnection(): Promise<void> {
    if (this.pool) await this.pool.end();
    this.pool = null;
  }

  async migrate(schema: string): Promise<void> {
    const pool = await this.getPool();
    await pool.query(schema);
  }
}

export const createMysqlAdapter = (config: RuntimeConfig): MysqlAdapter => new MysqlAdapter(config);
