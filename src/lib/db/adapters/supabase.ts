/**
 * Supabase driver: wraps `@supabase/supabase-js` behind the `DBAdapter` interface. PostgREST
 * cannot run DDL, so `migrate`/`query` (raw SQL) are unsupported here — provisioning uses the
 * direct Postgres connection the Setup Wizard / `server.mjs` already provide, keeping full
 * backwards compatibility with `supabase/schema.sql`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DBAdapter } from '../DBAdapter';
import type { DbFilter, DbRow, DbValue, HealthResult } from '../types';
import type { RuntimeConfig } from '../../runtime';
import { describeDbError } from '../errors';

const missingRelation = (message: string): boolean =>
  /schema cache|does not exist|PGRST205|42P01/i.test(message);

/**
 * Renders one value the way PostgREST reads it — `supabase-js` sends `not()`'s operator and value
 * through untouched, so an array has to become the `(a,b,c)` list form and a value holding a comma,
 * quote or parenthesis has to be double-quoted. Without this, `.not(column, 'in', ids)` — which the
 * universal builder documents as supported — would reach PostgREST as `not.in.1,2,3`.
 */
const postgrestValue = (value: DbValue | DbValue[] | undefined): unknown => {
  if (Array.isArray(value)) return `(${value.map((item) => postgrestValue(item)).join(',')})`;
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && /[",()]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
};

export class SupabaseAdapter implements DBAdapter {
  readonly type = 'supabase' as const;
  readonly supportsMigrations = false;

  private readonly client: SupabaseClient;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: RuntimeConfig) {
    if (!config.supabaseUrl || !config.supabasePublishableKey) {
      throw new Error('Supabase is not configured: a project URL and publishable key are required.');
    }
    this.baseUrl = config.supabaseUrl.replace(/\/$/, '');
    this.timeoutMs = config.connectionTimeoutMs ?? 10000;
    this.client = createClient(this.baseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  /** The underlying client, for the auth-heavy screens that still speak Supabase directly. */
  getClient(): SupabaseClient {
    return this.client;
  }

  /**
   * Applies every condition a `DbFilter` carries to an existing PostgREST builder. This is what keeps
   * the Supabase driver at parity with the SQL builders: the same `.gt()`, `.not()` or `.or()` written
   * against either backend narrows the same rows. An `update`/`delete` builder has no `.select()` of
   * its own, so the projection is added by the caller.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private applyConditions(query: any, filter: DbFilter): any {
    if (filter.where) {
      for (const [key, value] of Object.entries(filter.where)) {
        if (value === undefined) continue;
        query = value === null ? query.is(key, null) : query.eq(key, value);
      }
    }
    if (filter.in) {
      for (const [key, values] of Object.entries(filter.in ?? {})) {
        if (!values?.length) {
          // An empty list matches nothing, exactly like the SQL builders' `1 = 0`. PostgREST has no
          // such literal, so pair the impossible `is null` with its own negation.
          query = query.is(key, null).not(key, 'is', null);
          continue;
        }
        query = query.in(key, values);
      }
    }
    if (filter.notEq) {
      for (const [key, value] of Object.entries(filter.notEq)) {
        if (value === undefined) continue;
        query = value === null ? query.not(key, 'is', null) : query.neq(key, value);
      }
    }
    const comparisons = [['gt', 'gt'], ['gte', 'gte'], ['lt', 'lt'], ['lte', 'lte']] as const;
    for (const [key, method] of comparisons) {
      for (const [column, value] of Object.entries(filter[key] ?? {})) {
        if (value === undefined) continue;
        query = query[method](column, value);
      }
    }
    if (filter.ilike) for (const [key, value] of Object.entries(filter.ilike)) query = query.ilike(key, value);
    for (const condition of filter.not ?? []) {
      query = query.not(condition.column, condition.operator, postgrestValue(condition.value));
    }
    if (filter.or?.trim()) query = query.or(filter.or);
    return query;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private applyFilter(builder: any, filter: DbFilter): any {
    let query = this.applyConditions(builder.select(filter.columns || '*'), filter);
    for (const order of filter.orderBy ?? []) query = query.order(order.column, { ascending: order.direction !== 'desc' });
    if (filter.limit) query = query.limit(filter.limit);
    if (filter.offset) query = query.range(filter.offset, filter.offset + (filter.limit ?? 1000) - 1);
    return query;
  }

  async select(table: string, filter: DbFilter = {}): Promise<DbRow[]> {
    const { data, error } = await this.applyFilter(this.client.from(table), filter);
    if (error) throw error;
    return (data ?? []) as DbRow[];
  }

  async selectOne(table: string, filter: DbFilter = {}): Promise<DbRow | null> {
    const rows = await this.select(table, { ...filter, limit: 1 });
    return rows[0] ?? null;
  }

  async insert(table: string, rows: DbRow | DbRow[]): Promise<DbRow[]> {
    const { data, error } = await this.client.from(table).insert(rows as Record<string, unknown>).select();
    if (error) throw error;
    return (data ?? []) as DbRow[];
  }

  async update(table: string, filter: DbFilter, patch: DbRow): Promise<DbRow[]> {
    const query = this.applyConditions(this.client.from(table).update(patch).select(), filter);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as DbRow[];
  }

  async upsert(table: string, rows: DbRow[], conflictColumns?: string[]): Promise<DbRow[]> {
    const options = conflictColumns?.length ? { onConflict: conflictColumns.join(',') } : undefined;
    const { data, error } = await this.client.from(table).upsert(rows as Record<string, unknown>[], options).select();
    if (error) throw error;
    return (data ?? []) as DbRow[];
  }

  async delete(table: string, filter: DbFilter): Promise<DbRow[]> {
    const query = this.applyConditions(this.client.from(table).delete().select(filter.columns || '*'), filter);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as DbRow[];
  }

  async getOption<T = unknown>(name: string, fallback?: T | null): Promise<T | null> {
    const { data, error } = await this.client
      .from('options')
      .select('option_value')
      .eq('option_name', name)
      .maybeSingle();
    if (error || !data) return fallback ?? null;
    try {
      return JSON.parse(data.option_value as string) as T;
    } catch {
      return data.option_value as unknown as T;
    }
  }

  async setOption(name: string, value: unknown): Promise<boolean> {
    const valueString = typeof value === 'object' ? JSON.stringify(value) : String(value);
    const { error } = await this.client
      .from('options')
      .upsert({ option_name: name, option_value: valueString });
    return !error;
  }

  /**
   * Reads an admin-only system setting. The `system_settings` table is protected by RLS, so this
   * resolves `fallback` rather than throwing when the current session lacks `manage_options`.
   */
  async getSystemSetting<T = unknown>(key: string, fallback?: T | null): Promise<T | null> {
    const { data, error } = await this.client
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', key)
      .maybeSingle();
    if (error || !data) return fallback ?? null;
    try {
      return JSON.parse(data.setting_value as string) as T;
    } catch {
      return data.setting_value as unknown as T;
    }
  }

  /** Writes an admin-only system setting. RLS silently refuses (→ `false`) without `manage_options`. */
  async setSystemSetting(key: string, value: unknown): Promise<boolean> {
    const valueString = typeof value === 'object' ? JSON.stringify(value) : String(value);
    const { error } = await this.client
      .from('system_settings')
      .upsert({ setting_key: key, setting_value: valueString });
    return !error;
  }

  async migrate(): Promise<void> {
    throw new Error(
      'The Supabase publishable key cannot run schema migrations. Provision with the Setup Wizard ' +
        '(direct database connection) or run supabase/schema.sql in the SQL Editor.',
    );
  }

  async hasTable(table: string): Promise<boolean> {
    const { error } = await this.client.from(table).select('*', { count: 'exact', head: true });
    if (!error) return true;
    return !missingRelation(describeDbError(error));
  }

  async healthCheck(): Promise<HealthResult> {
    // Abort the probe after `timeoutMs` so a slow/unreachable project never holds the function open.
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
    try {
      const key = (this.client as unknown as { supabaseKey: string }).supabaseKey;
      const response = await fetch(`${this.baseUrl}/auth/v1/settings`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: controller?.signal,
      });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: 'Invalid Supabase project URL or publishable key.' };
      }
      if (!response.ok) {
        return { ok: false, message: `Could not reach the Supabase Auth server (HTTP ${response.status}).` };
      }
      return { ok: true, message: 'Connected to Supabase.' };
    } catch (error) {
      return {
        ok: false,
        message: controller?.signal.aborted
          ? `The Supabase project did not respond within ${Math.round(this.timeoutMs / 1000)} seconds.`
          : describeDbError(error),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    // The Supabase client holds no persistent connection to release.
  }

  async query(): Promise<DbRow[]> {
    throw new Error(
      'Raw SQL is not available through the Supabase publishable key. Use SUPABASE_DB_URL (direct ' +
        'PostgreSQL) or the universal PostgreSQL driver.',
    );
  }
}

export const createSupabaseAdapter = (config: RuntimeConfig): DBAdapter => new SupabaseAdapter(config);
