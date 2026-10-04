/**
 * PostgreSQL driver over `pg` (connection pool). Used for self-hosted Postgres, Supabase's direct
 * connection (SUPABASE_DB_URL), Neon, Render, Railway and any other Postgres host. `pg` is imported
 * lazily so it never reaches the browser bundle.
 */
import { SqlAdapterBase } from './sqlBase';
import { postgresDialect } from './sql';
import type { DbRow, DbValue } from '../types';
import type { RuntimeConfig } from '../../runtime';

interface PgPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: DbRow[] }>;
  end(): Promise<void>;
}

const isLocal = (host: string | undefined): boolean =>
  Boolean(host && /^(localhost|127\.0\.0\.1|::1)$/i.test(host));

export class PostgresAdapter extends SqlAdapterBase {
  readonly type = 'postgres' as const;
  readonly dialect = postgresDialect;
  private readonly config: RuntimeConfig;
  private pool: PgPool | null = null;

  constructor(config: RuntimeConfig) {
    super();
    this.config = config;
  }

  private poolConfig(): Record<string, unknown> {
    if (this.config.databaseUrl) {
      const ssl = /@(localhost|127\.0\.0\.1|\[::1\])/i.test(this.config.databaseUrl)
        ? undefined
        : { rejectUnauthorized: false };
      return { connectionString: this.config.databaseUrl, ssl, connectionTimeoutMillis: 15000 };
    }
    const host = this.config.dbHost || 'localhost';
    const ssl = isLocal(host) ? undefined : { rejectUnauthorized: false };
    return {
      host,
      port: this.config.dbPort ?? 5432,
      database: this.config.dbName,
      user: this.config.dbUser,
      password: this.config.dbPassword,
      ssl,
      connectionTimeoutMillis: 15000,
    };
  }

  private async getPool(): Promise<PgPool> {
    if (!this.pool) {
      const { Pool } = await import('pg');
      this.pool = new Pool(this.poolConfig()) as unknown as PgPool;
    }
    return this.pool;
  }

  protected async run(sql: string, params: DbValue[] = []): Promise<DbRow[]> {
    const pool = await this.getPool();
    const result = await pool.query(sql, params as unknown[]);
    return (result.rows ?? []) as DbRow[];
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

export const createPostgresAdapter = (config: RuntimeConfig): PostgresAdapter => new PostgresAdapter(config);

