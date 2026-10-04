/**
 * Where the browser keeps its universal-auth JWT.
 *
 * The Supabase driver stores a session inside `@supabase/supabase-js`; the universal (self-hosted)
 * engine has no such client, so it keeps the bearer token in `localStorage` under one key. Both the
 * auth facade that writes it (`src/lib/client.ts`) and the HTTP database adapter that sends it on
 * every `/api/db/query` call read it through here, so the key is defined exactly once.
 */

/** The `localStorage` key holding the universal (bcrypt + JWT) session token. */
export const AUTH_TOKEN_KEY = 'rwp_universal_token';

/** The stored bearer token, or null on the server / when storage is unavailable. */
export function readAuthToken(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(AUTH_TOKEN_KEY) : null;
  } catch {
    // Private windows and blocked storage can refuse access; behave as signed out.
    return null;
  }
}

/** Stores (or clears) the bearer token. Storage failures are ignored, never thrown. */
export function writeAuthToken(value: string | null): void {
  try {
    if (value) localStorage.setItem(AUTH_TOKEN_KEY, value);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // Private browsing can refuse storage; the session just does not persist.
  }
}
