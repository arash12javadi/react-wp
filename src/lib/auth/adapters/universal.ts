/**
 * Universal authentication driver: a self-contained email/password engine for PostgreSQL, MySQL
 * and SQLite. Passwords are hashed with `bcryptjs`; sessions are stateless `jose`-signed JWTs
 * (HS256). Users live in the `rwp_users` table, with a mirror row in `profiles` so the rest of the
 * CMS — which reads roles from `profiles` — keeps working unchanged. `bcryptjs` and `jose` are
 * imported lazily so they never reach the browser bundle (this driver is server-only).
 */
import type { AuthAdapter, AuthSession, AuthUser, SignUpResult } from '../AuthAdapter';
import type { DBAdapter } from '../../db/DBAdapter';
import type { DbRow } from '../../db/types';

interface BcryptModule {
  hash(password: string, rounds: number): Promise<string>;
  compare(password: string, hashValue: string): Promise<boolean>;
}

interface SignJWTLike {
  setProtectedHeader(header: Record<string, unknown>): this;
  setSubject(subject: string): this;
  setIssuedAt(): this;
  setExpirationTime(time: string): this;
  sign(secret: Uint8Array): Promise<string>;
}

interface JoseModule {
  SignJWT: new (payload: Record<string, unknown>) => SignJWTLike;
  jwtVerify(token: string, secret: Uint8Array): Promise<{ payload: { sub?: string } }>;
}

const newId = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export class UniversalAuthAdapter implements AuthAdapter {
  readonly mode = 'universal' as const;
  readonly stateless = true;

  private readonly db: DBAdapter;
  private readonly secret: Uint8Array;
  private readonly ttlSeconds: number;

  constructor(db: DBAdapter, jwtSecret: string, ttlSeconds = 60 * 60 * 24 * 7) {
    if (!jwtSecret || jwtSecret.length < 16) {
      throw new Error('JWT_SECRET must be set to at least 16 characters for universal authentication.');
    }
    this.db = db;
    this.secret = new TextEncoder().encode(jwtSecret);
    this.ttlSeconds = ttlSeconds;
  }

  private async bcrypt(): Promise<BcryptModule> {
    return import('bcryptjs') as unknown as Promise<BcryptModule>;
  }

  private async jose(): Promise<JoseModule> {
    return import('jose') as unknown as Promise<JoseModule>;
  }

  async hashPassword(password: string): Promise<string> {
    const bcrypt = await this.bcrypt();
    return bcrypt.hash(password, 10);
  }

  async verifyPassword(password: string, hashValue: string): Promise<boolean> {
    const bcrypt = await this.bcrypt();
    return bcrypt.compare(password, hashValue);
  }

  private async issueToken(user: AuthUser): Promise<string> {
    const { SignJWT } = await this.jose();
    return new SignJWT({ role: user.role ?? 'subscriber', email: user.email ?? '' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.secret);
  }

  private toUser(row: DbRow | null): AuthUser | null {
    if (!row) return null;
    return {
      id: String(row.id),
      email: row.email === null || row.email === undefined ? null : String(row.email),
      role: typeof row.role === 'string' ? row.role : 'subscriber',
    };
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const rows = await this.db.select('rwp_users', { where: { email: email.toLowerCase() }, limit: 1 });
    const row = rows[0];
    if (!row || !row.password_hash) throw new Error('Invalid email or password.');
    const valid = await this.verifyPassword(password, String(row.password_hash));
    if (!valid) throw new Error('Invalid email or password.');
    const user = this.toUser(row) as AuthUser;
    const accessToken = await this.issueToken(user);
    return { accessToken, expiresAt: Math.floor(Date.now() / 1000) + this.ttlSeconds, user };
  }

  async signUp(email: string, password: string, role = 'subscriber'): Promise<SignUpResult> {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('A valid email address is required.');
    if (password.length < 6) throw new Error('The password must be at least 6 characters.');
    const existing = await this.db.select('rwp_users', { where: { email: normalized }, limit: 1 });
    if (existing.length) throw new Error('An account with this email already exists.');

    const id = newId();
    const passwordHash = await this.hashPassword(password);
    await this.db.insert('rwp_users', {
      id,
      email: normalized,
      password_hash: passwordHash,
      role,
    });
    await this.db.insert('profiles', {
      id,
      email: normalized,
      display_name: normalized.split('@')[0],
      role,
    }).catch(() => undefined);

    const user: AuthUser = { id, email: normalized, role };
    return { session: null, user };
  }

  async authenticate(token?: string): Promise<AuthUser | null> {
    if (!token) return null;
    try {
      const { jwtVerify } = await this.jose();
      const { payload } = await jwtVerify(token, this.secret);
      const id = payload.sub;
      if (!id) return null;
      const rows = await this.db.select('rwp_users', { where: { id }, limit: 1 });
      return this.toUser(rows[0] ?? null);
    } catch {
      return null;
    }
  }

  async signOut(): Promise<void> {
    // Stateless: there is no server session to invalidate.
  }
}

