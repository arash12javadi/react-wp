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

/** True for loopback hosts, which have no TLS endpoint and must not be forced onto SSL. */
const isLocalHost = (host?: string): boolean => Boolean(host && /^(localhost|127\.0\.0\.1|\[?::1\]?)$/i.test(host));

/** The hostname out of a `mysql://` URI, when one was supplied. */
const hostOf = (url?: string): string | undefined => {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
};

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
      // SSL auto-handling: cloud/serverless MySQL (Railway, PlanetScale, Hostinger Remote MySQL)
      // requires TLS; a loopback host does not. The `ssl` flag is attached here for discrete fields
      // and appended to the URI for connection strings.
      const host = this.config.dbHost || hostOf(this.config.databaseUrl) || 'localhost';
      const ssl = isLocalHost(host) ? undefined : { rejectUnauthorized: false };
      let uri = this.config.databaseUrl;
      if (uri && ssl && !/[?&]ssl=/.test(uri)) {
        uri += `${uri.includes('?') ? '&' : '?'}ssl=${encodeURIComponent(JSON.stringify(ssl))}`;
      }
      const base = uri
        ? { uri }
        : {
            host: this.config.dbHost || 'localhost',
            port: this.config.dbPort ?? 3306,
            database: this.config.dbName,
            user: this.config.dbUser,
            password: this.config.dbPassword,
            ssl,
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
