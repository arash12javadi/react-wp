/**
 * Request rate limiting for every /api route server.mjs serves.
 *
 * Two tiers, because they protect different things. The `auth` tier covers anything where a wrong
 * guess is worth retrying — sign-in verification, the CAPTCHA endpoint, the admin endpoints that
 * run DDL or delete folders — and is deliberately tight. The `api` tier covers ordinary plugin and
 * media traffic and is loose enough that a busy page full of widgets is never throttled. Both
 * ceilings and the shared window come from the options table (Settings → Security → Rate limiting)
 * through securitySettings.mjs, so changing them needs no restart.
 *
 * Counted per address AND per account, and the stricter of the two decides. Address alone lets one
 * signed-in account burn a shared office NAT's budget; account alone lets a bot that never signs in
 * go uncounted. A request that trips either one is refused.
 *
 * Fixed windows rather than a sliding log: a sliding log stores one timestamp per request, which is
 * the memory a flood is trying to make you spend. A fixed window stores one integer per key, so the
 * worst case is bounded by the number of distinct keys, which the sweeper below also bounds.
 *
 * Keys are hashed with a salt generated at startup. Nothing here is written to disk or to the
 * database, and a heap dump of a running server yields no visitor addresses — the same rule
 * core's rwp_record_view follows for page views.
 */
import { createHash, randomBytes } from 'node:crypto';

const salt = randomBytes(16).toString('hex');
/** Above this many live keys the sweeper runs early. A flood from many addresses must not grow the heap without bound. */
const MAX_KEYS = 50_000;
const SWEEP_MS = 60_000;

const buckets = new Map();
let lastSweep = Date.now();

const hashKey = (value) => createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32);

/**
 * The caller's address. X-Forwarded-For is only trusted when TRUST_PROXY is set, because behind no
 * proxy it is a header the caller chooses — and a rate limiter keyed on a value the attacker
 * controls is not a rate limiter. The left-most entry is the original client.
 */
export function clientAddress(request) {
  if ((process.env.TRUST_PROXY || '').trim() === 'true') {
    const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
    const real = String(request.headers['x-real-ip'] || '').trim();
    if (real) return real;
  }
  return request.socket?.remoteAddress || 'unknown';
}

/**
 * The `sub` claim of a bearer token, used only as a counting key. It is NOT verified here and
 * grants nothing: every endpoint that cares about identity re-checks the token with Supabase.
 * A forged sub can at worst move the forger into someone else's bucket, and the address bucket
 * still applies.
 */
export function bearerSubject(request) {
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = token.split('.')[1];
  if (!payload) return '';
  try {
    const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof decoded?.sub === 'string' ? decoded.sub : '';
  } catch {
    return '';
  }
}

const sweep = (now) => {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  lastSweep = now;
};

const hit = (key, windowMs, now) => {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    buckets.set(key, fresh);
    return fresh;
  }
  bucket.count += 1;
  return bucket;
};

/**
 * Counts this request and says whether to serve it.
 *
 * Returns { allowed, limit, remaining, resetAt, retryAfter, scope }. The caller writes the headers
 * so that an allowed request is still told its budget — a client that can see it is at 95/100 can
 * back off before it is refused, which is the whole point of the X-RateLimit headers.
 */
export function consumeRateLimit(request, tier, settings) {
  const windowMs = settings.rate_limit_window_minutes * 60_000;
  const limit = tier === 'auth' ? settings.rate_limit_auth_max : settings.rate_limit_api_max;
  const now = Date.now();

  if (now - lastSweep > SWEEP_MS || buckets.size > MAX_KEYS) sweep(now);

  const address = hashKey(clientAddress(request));
  const subject = bearerSubject(request);
  const checks = [
    { scope: 'address', bucket: hit(`${tier}:ip:${address}`, windowMs, now) },
  ];
  if (subject) checks.push({ scope: 'account', bucket: hit(`${tier}:user:${hashKey(subject)}`, windowMs, now) });

  // The one closest to its ceiling reports, so the headers describe the limit that will actually
  // bite rather than whichever was checked first.
  const worst = checks.reduce((a, b) => (b.bucket.count > a.bucket.count ? b : a));
  const allowed = worst.bucket.count <= limit;
  return {
    allowed,
    tier,
    scope: worst.scope,
    limit,
    remaining: Math.max(0, limit - worst.bucket.count),
    resetAt: worst.bucket.resetAt,
    retryAfter: Math.max(1, Math.ceil((worst.bucket.resetAt - now) / 1000)),
  };
}

/** The headers for a decision, allowed or not. */
export function rateLimitHeaders(decision) {
  const headers = {
    'X-RateLimit-Limit': String(decision.limit),
    'X-RateLimit-Remaining': String(decision.remaining),
    'X-RateLimit-Reset': String(Math.ceil(decision.resetAt / 1000)),
  };
  if (!decision.allowed) headers['Retry-After'] = String(decision.retryAfter);
  return headers;
}

/**
 * Which tier a path belongs to. Anything that authenticates, authorises, verifies a human or
 * changes the server's own state is `auth`; everything else is `api`.
 */
export function rateLimitTier(pathname, method) {
  if (pathname.startsWith('/api/admin/') || pathname === '/api/install-schema') return 'auth';
  // Reading the anti-bot config or how much of a session is left happens on ordinary page loads,
  // so those belong in the loose tier — putting them in the strict one would throttle a visitor
  // for browsing, which is exactly the false positive that gets a rate limiter switched off.
  if (pathname === '/api/security/config') return 'api';
  if (pathname === '/api/security/session' && method === 'GET') return 'api';
  // status and refresh are read-only diagnostics that already require manage_options before they
  // do anything — the strict tier is for endpoints a stranger can hammer, not for the settings
  // screen an admin is actively using. Putting them in `auth` meant loading this very panel a few
  // times, or saving it, could lock the admin out of the one screen that raises the limit.
  if (pathname === '/api/security/status' || pathname === '/api/security/refresh') return 'api';
  // Purged automatically after every page and settings save (purgePageCacheQuietly), so ordinary
  // editing — several pages saved within one window — must not exhaust the strict tier's budget.
  // It is still manage_options-gated, so the strict tier's job (stopping a stranger) is not needed.
  if (pathname === '/api/security/cache/purge') return 'api';
  // verify (CAPTCHA/honeypot checks) and sessions/revoke stay strict: the former is exactly what
  // brute-force protection means here, and the latter is a deliberately rare, high-impact action.
  if (pathname.startsWith('/api/security/')) return 'auth';
  if (pathname === '/api/imagekit-auth' || pathname === '/api/media-delete') return 'auth';
  if (pathname === '/api/plugin-files/delete') return 'auth';
  // A plugin route that takes a write is worth the strict tier; its reads are ordinary traffic.
  if (pathname.startsWith('/api/plugins/') && method !== 'GET') return 'api';
  return 'api';
}

/** The message a refused caller sees. Names the real reason, never "something went wrong". */
export function rateLimitMessage(decision) {
  const minutes = Math.ceil(decision.retryAfter / 60);
  const wait = decision.retryAfter < 90 ? `${decision.retryAfter} seconds` : `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const who = decision.scope === 'account' ? 'account' : 'address';
  const budget = `The limit is ${decision.limit} per window`;
  return decision.tier === 'auth'
    ? `Too many attempts from this ${who}. ${budget}; try again in ${wait}. An administrator can change it under Settings → Security → Rate limiting.`
    : `Too many requests from this ${who}. ${budget}; try again in ${wait}.`;
}

/** Test and admin support: forget every counter. */
export function resetRateLimits() {
  buckets.clear();
  lastSweep = Date.now();
}

export const rateLimitStats = () => ({ keys: buckets.size, swept_at: new Date(lastSweep).toISOString() });
