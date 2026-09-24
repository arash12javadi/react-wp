/**
 * /api/security/* — the server half of Settings → Security.
 *
 * Public (anon):
 *   GET  /api/security/config          what the browser must render: provider, site key, honeypot
 *   POST /api/security/verify          honeypot + CAPTCHA, returns a clearance ticket
 *   POST /api/security/session         issues the governed session cookie
 *   GET  /api/security/session         how much of the configured session lifetime is left
 *   POST /api/security/session/end     clears it
 *
 * manage_options:
 *   GET  /api/security/status          settings, cache and limiter statistics, secret set / not set
 *   POST /api/security/refresh         re-read the options now instead of on the next timer tick
 *   POST /api/security/cache/purge     { paths?: string[], reason?: 'auto' | 'manual' }
 *
 * Administrator or Super Admin (profiles.role, not a capability):
 *   POST /api/security/sessions/revoke { user_id }
 *
 * The revoke endpoint is gated on the role rather than on manage_options for the same reason
 * Settings → Advanced → Reset Website is: manage_options can be granted to other roles from the
 * Roles screen, and "sign everyone out" is not a settings change.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolveConnectionString, withClient } from './db.mjs';
import {
  antiBotSecret, refreshSecuritySettings, securitySettings, securityStatus,
} from './middleware/securitySettings.mjs';
import {
  antiBotStats, checkHoneypot, flagAddress, honeypotField, issueClearance,
  minimumFormSeconds, timestampField, verifyCaptcha, addressFlagged,
} from './middleware/antiBot.mjs';
import { pageCachePurge, pageCacheStats } from './middleware/pageCache.mjs';
import { compressionAssetCacheStats } from './middleware/compression.mjs';
import { rateLimitStats } from './middleware/rateLimiter.mjs';
import { purgeSitemap } from './sitemap.mjs';

export class SecurityError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** The cookie name. Read by pageCache (any cookie disables caching) and by the session endpoints. */
const SESSION_COOKIE = 'rwp_session';
const sessionSecret = () => {
  // Derived from whatever long-lived server secret this install has, so the cookie survives a
  // restart and a second Node process behind a load balancer validates the same cookies. Falling
  // back to the publishable key would be pointless (it is public), so without a secret the cookie
  // is refused rather than signed with something guessable.
  const material = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SESSION_COOKIE_SECRET || '').trim();
  return material || '';
};

const readCookie = (headers, name) => {
  const raw = String(headers.cookie || '');
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
};

const signSession = (subject, expiresAt, secret) =>
  createHmac('sha256', secret).update(`${subject}.${expiresAt}`).digest('base64url');

/**
 * Set-Cookie for the governed session.
 *
 * HttpOnly so no script can read it (the Supabase JWT stays where supabase-js keeps it; this
 * cookie only carries the policy). Secure unless the request came in over plain http on localhost,
 * because a Secure cookie on http://localhost is dropped and development would silently break.
 * SameSite comes from the options table; SameSite=None without Secure is rejected by browsers, so
 * it is downgraded to Lax with the reason in the response rather than issuing a cookie that
 * vanishes.
 */
const sessionCookie = (value, maxAgeSeconds, settings, secureRequest) => {
  let sameSite = settings.session_cookie_samesite;
  let note = '';
  if (sameSite === 'None' && !secureRequest) {
    sameSite = 'Lax';
    note = 'SameSite=None needs a secure connection, so this cookie was issued as SameSite=Lax. Serve the site over HTTPS to use None.';
  }
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secureRequest) parts.push('Secure');
  return { cookie: parts.join('; '), note, sameSite };
};

const clearedCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** True when the browser reached us over TLS, directly or through a proxy that says so. */
const isSecureRequest = (request) => {
  if (request.socket?.encrypted) return true;
  if ((process.env.TRUST_PROXY || '').trim() !== 'true') return false;
  return String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';
};

/** The signed-in user behind a bearer token, or an exception. Uses the caller's own token only. */
const requireUser = async (config, headers) => {
  if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
    throw new SecurityError(501, 'This site is not installed, so security settings cannot be managed.');
  }
  const token = String(headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new SecurityError(401, 'Sign in required.');
  const baseUrl = config.supabaseUrl.replace(/\/$/, '');
  const apikey = config.supabasePublishableKey;
  const response = await fetch(`${baseUrl}/auth/v1/user`, { headers: { apikey, Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new SecurityError(401, 'Your session is not valid. Sign in again.');
  return { user: await response.json(), token, baseUrl, apikey };
};

const requireCapability = async (config, headers, capability) => {
  const auth = await requireUser(config, headers);
  const response = await fetch(`${auth.baseUrl}/rest/v1/rpc/user_has_cap`, {
    method: 'POST',
    headers: { apikey: auth.apikey, Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ capability }),
  });
  if (!response.ok) throw new SecurityError(502, `Could not check your permission: user_has_cap returned HTTP ${response.status}.`);
  if (await response.json() !== true) {
    throw new SecurityError(403, `This needs the "${capability}" capability, and your role does not have it.`);
  }
  return auth;
};

const requireAdministrator = async (config, headers) => {
  const auth = await requireUser(config, headers);
  const response = await fetch(
    `${auth.baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(auth.user.id)}&select=role`,
    { headers: { apikey: auth.apikey, Authorization: `Bearer ${auth.token}` } },
  );
  if (!response.ok) throw new SecurityError(502, `Your role could not be read: profiles returned HTTP ${response.status}.`);
  const [profile] = await response.json();
  const role = profile?.role || '';
  if (!['administrator', 'super_admin'].includes(role)) {
    throw new SecurityError(403, `Signing other people out is restricted to Administrators and Super Admins. Your role is "${role || 'unknown'}".`);
  }
  return { ...auth, role };
};

/** GET /api/security/config — everything the public widget needs, and nothing it does not. */
function publicConfigResponse() {
  const settings = securitySettings();
  return {
    status: 200,
    headers: { 'Cache-Control': 'public, max-age=60' },
    body: {
      provider: settings.anti_bot_provider,
      // The site key is public by design: it is rendered into the CAPTCHA widget.
      site_key: settings.anti_bot_site_key,
      honeypot: settings.anti_bot_honeypot,
      honeypot_field: honeypotField,
      timestamp_field: timestampField,
      minimum_seconds: minimumFormSeconds,
      forms: settings.anti_bot_forms,
      session_max_age_hours: settings.session_max_age_hours,
      session_remember_me_days: settings.session_remember_me_days,
    },
  };
}

/**
 * POST /api/security/verify { form, token?, rwp_website_url?, rwp_form_started? }
 *
 * The one place a human check is decided. A filled honeypot flags the address AND is answered with
 * the same 403 a failed CAPTCHA gets, so a bot learns nothing about which trap it stepped in.
 */
async function verify(request, body) {
  const settings = securitySettings();
  const form = String(body?.form || '').trim().toLowerCase();
  if (!form || !/^[a-z][a-z0-9_]{1,30}$/.test(form)) {
    return { status: 400, body: { error: 'Send { "form": "login" | "register" | "comment" | … }.' } };
  }

  const flagged = addressFlagged(request);
  if (flagged) {
    return {
      status: 429,
      headers: { 'Retry-After': String(flagged.retryAfter) },
      body: { error: 'This address tripped a bot trap recently and is paused. Try again shortly.' },
    };
  }

  const honeypot = checkHoneypot(body, settings);
  if (!honeypot.ok) {
    if (honeypot.trap) flagAddress(request, settings);
    return { status: 403, body: { error: honeypot.reason } };
  }

  const captcha = await verifyCaptcha(body?.token, settings, antiBotSecret(), request);
  if (!captcha.ok) return { status: captcha.status, body: { error: captcha.error } };

  return {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
    body: { ticket: issueClearance(form, request), provider: settings.anti_bot_provider, score: captcha.score ?? null },
  };
}

/** POST /api/security/session { remember?: boolean } with the caller's bearer token. */
async function openSession(request, config, headers, body) {
  const settings = securitySettings();
  const secret = sessionSecret();
  if (!secret) {
    throw new SecurityError(501,
      'Session cookies need a server secret to sign with. Set SUPABASE_SECRET_KEY (or SESSION_COOKIE_SECRET) in .env.local and restart the server.');
  }
  const { user } = await requireUser(config, headers);
  const remember = body?.remember === true;
  const maxAgeSeconds = remember
    ? settings.session_remember_me_days * 24 * 60 * 60
    : settings.session_max_age_hours * 60 * 60;
  const expiresAt = Date.now() + maxAgeSeconds * 1000;
  const value = `${user.id}.${expiresAt}.${signSession(user.id, expiresAt, secret)}`;
  const { cookie, note, sameSite } = sessionCookie(value, maxAgeSeconds, settings, isSecureRequest(request));
  return {
    status: 200,
    headers: { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' },
    body: {
      expires_at: new Date(expiresAt).toISOString(),
      max_age_seconds: maxAgeSeconds,
      remember,
      same_site: sameSite,
      ...(note ? { note } : {}),
    },
  };
}

/**
 * GET /api/security/session — what is left of the configured lifetime.
 *
 * The app polls this and signs out when it reaches zero. Note what this is and is not: it enforces
 * the administrator's session policy on this site's own front end. It does not shorten the
 * Supabase JWT, which Supabase itself owns (Dashboard → Authentication → Sessions); the revoke
 * endpoint below is what actually ends a session server-side.
 */
function readSession(request) {
  const secret = sessionSecret();
  const raw = readCookie(request.headers, SESSION_COOKIE);
  if (!raw || !secret) return { status: 200, headers: { 'Cache-Control': 'no-store' }, body: { valid: false, reason: raw ? 'unsigned' : 'none' } };
  const [subject, expiresRaw, signature] = raw.split('.');
  const expiresAt = Number(expiresRaw);
  if (!subject || !Number.isFinite(expiresAt) || !signature) {
    return { status: 200, headers: { 'Cache-Control': 'no-store' }, body: { valid: false, reason: 'malformed' } };
  }
  const expected = signSession(subject, expiresRaw, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { status: 200, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': clearedCookie() }, body: { valid: false, reason: 'signature' } };
  }
  const remaining = Math.floor((expiresAt - Date.now()) / 1000);
  if (remaining <= 0) {
    return { status: 200, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': clearedCookie() }, body: { valid: false, reason: 'expired', user_id: subject } };
  }
  return {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
    body: { valid: true, user_id: subject, expires_at: new Date(expiresAt).toISOString(), seconds_remaining: remaining },
  };
}

/**
 * POST /api/security/sessions/revoke { user_id }
 *
 * Deletes the account's rows in auth.sessions, which cascades to its refresh tokens: the next
 * refresh fails and every device is signed out. This is done over the direct Postgres connection
 * (SUPABASE_DB_URL, or the password the Setup Wizard's fallback sends) because GoTrue's admin API
 * revokes by JWT — it has no "sign out this user id" call — and an administrator signing someone
 * else out does not have that person's token.
 *
 * The access token already issued stays valid until it expires on its own; Supabase JWTs are
 * stateless and nothing can recall one. The response says so rather than claiming an instant cut
 * the mechanism cannot deliver.
 */
async function revokeSessions(config, headers, body) {
  await requireAdministrator(config, headers);
  const userId = String(body?.user_id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new SecurityError(400, 'Send { "user_id": "<the account\'s uuid>" }.');
  }
  const resolved = resolveConnectionString(body, config);
  if (!resolved.ok) throw new SecurityError(resolved.status, resolved.error);

  const result = await withClient(resolved.url, async (client) => {
    const sessions = await client.query('delete from auth.sessions where user_id = $1', [userId]);
    // Older GoTrue schemas keep refresh tokens without a session row; revoking them by hand covers
    // an install that predates auth.sessions.
    const tokens = await client.query('update auth.refresh_tokens set revoked = true where user_id = $1::text and revoked = false', [userId]);
    return { sessions: sessions.rowCount || 0, refresh_tokens: tokens.rowCount || 0 };
  });

  return {
    status: 200,
    body: {
      success: true,
      user_id: userId,
      ...result,
      note: 'Refresh is now refused on every device. An access token already issued keeps working until it expires — shorten that under Authentication → Sessions in the Supabase dashboard.',
    },
  };
}

/**
 * POST /api/security/cache/purge { paths?: string[], reason?: 'auto' | 'manual' }
 *
 * `reason: 'manual'` is the admin's own "Purge the whole page cache" button and always runs —
 * an administrator asking for a purge is not something a setting should be able to refuse.
 * Anything else is `purgePageCacheQuietly`'s automatic call after a content or settings save
 * (src/lib/security.ts), and honours `cache_auto_purge_on_save`: turning that off is meant to stop
 * exactly these calls, on a site that would rather eat the TTL's staleness than pay the purge cost
 * on every edit.
 */
async function purgeCache(config, headers, body) {
  await requireCapability(config, headers, 'manage_options');
  if (body?.reason !== 'manual' && !securitySettings().cache_auto_purge_on_save) {
    return { status: 200, body: { success: true, removed: 0, scope: 'skipped', reason: 'cache_auto_purge_on_save is off' } };
  }
  const result = pageCachePurge(body?.paths);
  purgeSitemap();
  // A settings change is the common reason for a full purge, and it is also the change the
  // in-memory snapshot has not seen yet.
  if (result.scope === 'all') await refreshSecuritySettings();
  return { status: 200, body: { success: true, ...result, sitemap: 'rebuilt on the next request' } };
}

export async function handleSecurityRequest({ method, pathname, headers, body, config, request }) {
  try {
    if (pathname === '/api/security/config') {
      if (method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } };
      return publicConfigResponse();
    }
    if (pathname === '/api/security/verify') {
      if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
      return await verify(request, body);
    }
    if (pathname === '/api/security/session') {
      if (method === 'GET') return readSession(request);
      if (method === 'POST') return await openSession(request, config, headers, body);
      return { status: 405, body: { error: 'Method not allowed' } };
    }
    if (pathname === '/api/security/session/end') {
      if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
      return { status: 200, headers: { 'Set-Cookie': clearedCookie(), 'Cache-Control': 'no-store' }, body: { success: true } };
    }
    if (pathname === '/api/security/status') {
      if (method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } };
      await requireCapability(config, headers, 'manage_options');
      return {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
        body: {
          ...securityStatus(),
          cache: { ...pageCacheStats(), ...compressionAssetCacheStats() },
          rate_limits: rateLimitStats(),
          anti_bot: antiBotStats(),
          // So the panel can say whether the revoke button will work before someone presses it.
          database_connection: resolveConnectionString({}, config).ok,
        },
      };
    }
    if (pathname === '/api/security/refresh') {
      if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
      await requireCapability(config, headers, 'manage_options');
      await refreshSecuritySettings();
      return { status: 200, headers: { 'Cache-Control': 'no-store' }, body: securityStatus() };
    }
    if (pathname === '/api/security/cache/purge') {
      if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
      return await purgeCache(config, headers, body);
    }
    if (pathname === '/api/security/sessions/revoke') {
      if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
      return await revokeSessions(config, headers, body);
    }
    return null;
  } catch (error) {
    if (!(error instanceof SecurityError)) console.error(`${pathname} failed:`, error);
    return {
      status: error instanceof SecurityError ? error.status : 500,
      body: { error: error instanceof Error ? error.message : 'Unknown server error.' },
    };
  }
}
