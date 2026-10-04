/**
 * Browser-side authentication driver.
 *
 * `bcryptjs` and `jose` are server-only, so the browser never hashes or signs anything: it forwards
 * email/password to the Hono `/api/auth/*` endpoints (which run the universal engine server-side) and
 * keeps the returned JWT in `localStorage` through `UniversalAuthFacade`. This is the counterpart to
 * `HttpDBAdapter` — together they let a SQLite/PostgreSQL/MySQL site sign people in and read their
 * data from the browser without exposing a database connection or the JWT secret.
 */
import type { AuthAdapter, AuthSession, AuthUser, SignUpResult } from '../AuthAdapter';
import { describeDbError } from '../../db/errors';

/** Narrows an untrusted JSON value into an `AuthUser`, or null when it is not one. */
const asUser = (value: unknown): AuthUser | null =>
  value && typeof value === 'object' && typeof (value as AuthUser).id === 'string' ? (value as AuthUser) : null;

/** Reads the message out of `{ error }`, which the auth endpoints return as a string. */
const messageFrom = (payload: { error?: unknown }, fallback: string): string => {
  const { error } = payload;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return fallback;
};

export class HttpAuthAdapter implements AuthAdapter {
  readonly mode = 'universal' as const;
  /** Stateless JWTs: there is no server-side session to clear. */
  readonly stateless = true;

  private async send(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(path, init);
    } catch (error) {
      throw new Error(`Could not reach the authentication API at ${path}. ${describeDbError(error)}`);
    }
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || payload.error) {
      throw new Error(messageFrom(payload, `Authentication failed (HTTP ${response.status}).`));
    }
    return payload;
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const payload = await this.send('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const token = typeof payload.token === 'string' ? payload.token : '';
    const user = asUser(payload.user);
    if (!token || !user) throw new Error('The authentication server did not return a session.');
    return { accessToken: token, user };
  }

  async signUp(email: string, password: string, role?: string): Promise<SignUpResult> {
    const payload = await this.send('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role }),
    });
    return { session: null, user: asUser(payload.user) };
  }

  async authenticate(token?: string): Promise<AuthUser | null> {
    if (!token) return null;
    try {
      const payload = await this.send('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      return asUser(payload.user);
    } catch {
      // An expired or tampered token simply means "not signed in".
      return null;
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.send('/api/auth/signout', { method: 'POST' });
    } catch {
      // Stateless JWTs need no server round-trip; a failure here must not block sign-out.
    }
  }
}
