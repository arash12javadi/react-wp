/**
 * Authentication adapter factory.
 *
 * The Supabase adapter is browser-safe; the universal (bcrypt + JWT) engine is server-only and is
 * loaded lazily through `createServerAuthAdapter`. In the browser a non-Supabase site uses
 * `HttpAuthAdapter`, which drives the same universal engine over the `/api/auth/*` endpoints.
 */
import { resolveRuntimeConfig, type RuntimeConfig } from '../runtime';
import { getDbAdapter, type DBAdapter } from '../db/index';
import type { AuthAdapter } from './AuthAdapter';
import { SupabaseAuthAdapter } from './adapters/supabase';
import { HttpAuthAdapter } from './adapters/http';
import type { SupabaseAdapter } from '../db/adapters/supabase';

let adapter: AuthAdapter | null = null;

export function createAuthAdapter(config: RuntimeConfig, db?: DBAdapter): AuthAdapter {
  if (config.dbType === 'supabase') {
    return new SupabaseAuthAdapter((db ?? getDbAdapter(config)) as SupabaseAdapter);
  }
  // Universal mode in the browser: the JWT engine + bcrypt live on the server; this drives them.
  return new HttpAuthAdapter();
}

/** Server factory: Supabase or the universal JWT engine. */
export async function createServerAuthAdapter(config: RuntimeConfig, db: DBAdapter): Promise<AuthAdapter> {
  if (config.dbType === 'supabase') return new SupabaseAuthAdapter(db as SupabaseAdapter);
  const { UniversalAuthAdapter } = await import('./adapters/universal');
  const secret = config.jwtSecret;
  if (!secret) throw new Error('JWT_SECRET is required for universal authentication.');
  return new UniversalAuthAdapter(db, secret);
}

/** Returns the shared client auth adapter (Supabase). */
export function getAuthAdapter(config?: RuntimeConfig): AuthAdapter {
  if (!adapter) adapter = createAuthAdapter(config ?? resolveRuntimeConfig());
  return adapter;
}

/** Drops the cached adapter so a config change takes effect. */
export function resetAuthAdapter(): void {
  adapter = null;
}

export type { AuthAdapter, AuthSession, AuthUser, SignUpResult } from './AuthAdapter';
export { SupabaseAuthAdapter } from './adapters/supabase';

