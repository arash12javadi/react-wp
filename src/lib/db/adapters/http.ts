/**
 * Browser-side HTTP database driver.
 *
 * A web page cannot open a PostgreSQL/MySQL/SQLite connection, so on every self-hosted backend the
 * client talks to the Hono server instead: this adapter turns each `DBAdapter` call into one
 * `POST /api/db/query` request, which the server runs against its own `SqlAdapterBase` driver and
 * answers with JSON. It is the client half of the universal bridge — the Supabase driver remains the
 * only one that reaches its backend directly.
 *
 * The bearer token (see `../../auth/token`) is attached to every request so the server can authorize
 * writes; reads are public because a visitor must be able to load the site.
 */
import type { DBAdapter } from '../DBAdapter';
import type { DbFilter, DbRow, DbValue, HealthResult } from '../types';
import type { DbType } from '../../runtime';
import { describeDbError } from '../errors';
import { readAuthToken } from '../../auth/token';

/** Where the server exposes the universal query endpoint. */
const QUERY_ENDPOINT = '/api/db/query';

interface QueryResponse {
  data?: unknown;
  error?: { message?: string } | string;
}

/** Extracts a readable message from either error shape the endpoint can return. */
const errorMessage = (error: QueryResponse['error'], status: number): string => {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message.trim()) return error.message;
  return `The database request failed (HTTP ${status}).`;
};

export class HttpDBAdapter implements DBAdapter {
  readonly type: DbType;
  /** The server owns schema changes; a browser can never run DDL against a remote database. */
  readonly supportsMigrations = false;

  constructor(type: DbType) {
    this.type = type;
  }

  /** Sends one structured operation to `/api/db/query` and unwraps `{ data }`, throwing the error. */
  private async request(body: Record<string, unknown>): Promise<unknown> {
    const token = readAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(QUERY_ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (error) {
      throw new Error(`Could not reach the database API at ${QUERY_ENDPOINT}. ${describeDbError(error)}`);
    }

    const text = await response.text();
    let parsed: QueryResponse = {};
    if (text) {
      try {
        parsed = JSON.parse(text) as QueryResponse;
      } catch {
        parsed = {};
      }
    }

    if (!response.ok || parsed.error) throw new Error(errorMessage(parsed.error, response.status));
    return parsed.data ?? null;
  }

  async select(table: string, filter: DbFilter = {}): Promise<DbRow[]> {
    return (await this.request({ action: 'select', table, filter })) as DbRow[];
  }

  async selectOne(table: string, filter: DbFilter = {}): Promise<DbRow | null> {
    return (await this.request({ action: 'selectOne', table, filter })) as DbRow | null;
  }

  async insert(table: string, rows: DbRow | DbRow[]): Promise<DbRow[]> {
    return (await this.request({ action: 'insert', table, rows })) as DbRow[];
  }

  async update(table: string, filter: DbFilter, patch: DbRow): Promise<DbRow[]> {
    return (await this.request({ action: 'update', table, filter, patch })) as DbRow[];
  }

  async upsert(table: string, rows: DbRow[], conflictColumns?: string[]): Promise<DbRow[]> {
    return (await this.request({ action: 'upsert', table, rows, conflictColumns })) as DbRow[];
  }

  async delete(table: string, filter: DbFilter): Promise<DbRow[]> {
    return (await this.request({ action: 'delete', table, filter })) as DbRow[];
  }

  async getOption<T = unknown>(name: string, fallback?: T | null): Promise<T | null> {
    return (await this.request({ action: 'getOption', name, fallback: fallback ?? null })) as T | null;
  }

  async setOption(name: string, value: unknown): Promise<boolean> {
    await this.request({ action: 'setOption', name, value });
    return true;
  }

  async migrate(): Promise<void> {
    throw new Error(
      'Schema migrations run on the server during provisioning. Re-run the Setup Wizard (or the ' +
        'deployment’s migration step) rather than calling migrate() from the browser.',
    );
  }

  async hasTable(table: string): Promise<boolean> {
    return Boolean(await this.request({ action: 'hasTable', table }));
  }

  async healthCheck(): Promise<HealthResult> {
    try {
      return (await this.request({ action: 'healthCheck' })) as HealthResult;
    } catch (error) {
      return { ok: false, message: describeDbError(error) };
    }
  }

  async close(): Promise<void> {
    // HTTP requests hold no connection to release.
  }

  async query(sql: string, params: DbValue[] = []): Promise<DbRow[]> {
    return (await this.request({ action: 'query', sql, params })) as DbRow[];
  }
}

export const createHttpAdapter = (type: DbType): DBAdapter => new HttpDBAdapter(type);
