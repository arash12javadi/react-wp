/**
 * Session governance: the HttpOnly cookie server.mjs issues on sign-in, and the timer that signs
 * someone out when the administrator's configured lifetime runs out.
 *
 * What this is, precisely
 * -----------------------
 * Supabase owns the JWT's real lifetime (Dashboard → Authentication → Sessions), and nothing in
 * this repository can shorten it — a JWT is stateless and cannot be recalled. What an
 * administrator configures here is this site's own policy: how long a signed-in person stays
 * signed in on this front end, whether "remember me" extends it, and the SameSite policy of the
 * cookie that carries it. The cookie is HttpOnly, so no script on the page — including an injected
 * one — can read it, and it holds only {user id, expiry, signature}: never the access token.
 *
 * Ending a session for real, from the admin, is Settings → Security → "Sign out everywhere",
 * which deletes the account's refresh tokens server-side (src/lib/security.ts).
 *
 * The cookie has a second job: server/middleware/pageCache.mjs refuses to cache any request
 * carrying a cookie, so a signed-in visitor is never served another person's cached page.
 *
 * Every call here is best-effort. A static host has no /api/security/session, and a visitor who
 * cannot reach it must still be able to use the site — so a failure leaves the Supabase session
 * exactly as it was.
 */
import { getSupabaseClient } from './db';

export interface GovernedSession {
  valid: boolean;
  user_id?: string;
  expires_at?: string;
  seconds_remaining?: number;
  reason?: string;
}

/** How often the governor checks. A minute is well inside any sane session length. */
const CHECK_MS = 60_000;

/**
 * Asks the server for a session cookie. Called right after a successful sign-in, with `remember`
 * from the form's "keep me signed in" box.
 */
export const openGovernedSession = async (remember = false): Promise<GovernedSession | null> => {
  try {
    const { data } = await getSupabaseClient().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const response = await fetch('/api/security/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ remember }),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return { valid: true, expires_at: body.expires_at, seconds_remaining: body.max_age_seconds };
  } catch {
    return null;
  }
};

export const readGovernedSession = async (): Promise<GovernedSession | null> => {
  try {
    const response = await fetch('/api/security/session', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json() as GovernedSession;
  } catch {
    return null;
  }
};

export const endGovernedSession = async (): Promise<void> => {
  try {
    await fetch('/api/security/session/end', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // The cookie expires by itself; failing to clear it early is not worth blocking a sign-out.
  }
};

/**
 * Starts the expiry watch. Returns a function that stops it.
 *
 * Only a cookie that exists and has run out triggers `onExpired`. A missing cookie means this host
 * has no server or the person signed in before this feature existed — neither is a reason to throw
 * someone out of a session they legitimately hold.
 */
export const startSessionGovernor = (onExpired: () => void): (() => void) => {
  let stopped = false;
  const check = async () => {
    if (stopped) return;
    const session = await readGovernedSession();
    if (stopped || !session) return;
    if (!session.valid && session.reason === 'expired') onExpired();
  };
  void check();
  const timer = window.setInterval(() => { void check(); }, CHECK_MS);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
};
