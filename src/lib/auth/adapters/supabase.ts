/**
 * Supabase authentication driver: a thin adapter over `@supabase/supabase-js` auth.
 */
import type { AuthAdapter, AuthSession, AuthUser, SignUpResult } from '../AuthAdapter';
import type { SupabaseAdapter } from '../../db/adapters/supabase';

export class SupabaseAuthAdapter implements AuthAdapter {
  readonly mode = 'supabase' as const;
  readonly stateless = false;

  private readonly db: SupabaseAdapter;

  constructor(db: SupabaseAdapter) {
    this.db = db;
  }

  private get client() {
    return this.db.getClient();
  }

  private toUser(user: unknown): AuthUser | null {
    if (!user) return null;
    const u = user as {
      id: string;
      email?: string | null;
      app_metadata?: Record<string, unknown>;
      user_metadata?: Record<string, unknown>;
    };
    return {
      id: u.id,
      email: u.email ?? null,
      role: (u.app_metadata?.role as string | undefined) || (u.user_metadata?.role as string | undefined),
    };
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new Error(error?.message || 'Unable to sign in.');
    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
      user: this.toUser(data.session.user) as AuthUser,
    };
  }

  async signUp(email: string, password: string, role?: string): Promise<SignUpResult> {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { data: role ? { role } : undefined },
    });
    if (error) throw new Error(error.message);
    return {
      session: data.session
        ? {
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
            expiresAt: data.session.expires_at,
            user: this.toUser(data.session.user) as AuthUser,
          }
        : null,
      user: this.toUser(data.user),
    };
  }

  async authenticate(): Promise<AuthUser | null> {
    const { data } = await this.client.auth.getUser();
    return this.toUser(data.user);
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
}
