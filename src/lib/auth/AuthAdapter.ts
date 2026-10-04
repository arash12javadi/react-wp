/**
 * Pluggable authentication.
 *
 * The app decouples from Supabase Auth RLS through this interface. Two implementations exist:
 *
 *  - `SupabaseAuthAdapter` — native Supabase Auth + JWT, used by the Supabase backend.
 *  - `UniversalAuthAdapter` — a lightweight internal engine: `bcryptjs` password hashing and
 *    `jose`-signed JWTs against the `rwp_users` table, for PostgreSQL / MySQL / SQLite.
 */
export interface AuthUser {
  id: string;
  email: string | null;
  role?: string;
  [key: string]: unknown;
}

export interface AuthSession {
  /** Bearer token (Supabase access token, or the universal JWT). */
  accessToken: string;
  refreshToken?: string;
  /** Unix epoch seconds when the token expires. */
  expiresAt?: number;
  user: AuthUser;
}

export interface SignUpResult {
  session: AuthSession | null;
  user: AuthUser | null;
}

export interface AuthAdapter {
  readonly mode: 'supabase' | 'universal';
  /** True for the stateless universal JWT engine (no server-side session to clear). */
  readonly stateless: boolean;

  /** Signs a user in with email + password; throws when the credentials are invalid. */
  signIn(email: string, password: string): Promise<AuthSession>;
  /** Creates an account. Supabase may return a session; universal returns the user only. */
  signUp(email: string, password: string, role?: string): Promise<SignUpResult>;
  /** Resolves the user for a bearer token (universal) or the current client session (Supabase). */
  authenticate(token?: string): Promise<AuthUser | null>;
  /** Signs the current session out where the backend supports it. */
  signOut(): Promise<void>;
}
