/**
 * The anti-bot engine: honeypot fields, Cloudflare Turnstile / Google reCAPTCHA v3 verification,
 * and the short-lived clearance ticket that carries the result to whatever the form does next.
 *
 * How it fits the rest of React-WP, honestly
 * -----------------------------------------
 * Sign-in, registration and comments go from the browser straight to Supabase (supabase-js with
 * the publishable key); there is no server hop this middleware could sit in. So the honest model
 * is two layers, and it is worth saying which is which:
 *
 *   * For anything that reaches this server — plugin form widgets, the chat, media authorisation,
 *     the admin endpoints — the check is enforced. POST /api/security/verify hands back a signed
 *     clearance ticket, and requireClearance() below refuses the request without a valid one.
 *
 *   * For the Supabase-direct forms the check runs in the browser before the call is made, which
 *     stops every bot that drives a real page and none that speaks to the REST API directly. The
 *     things that actually stop the latter are Supabase's own auth rate limits, email confirmation
 *     and the comment RLS policies — this layer is in front of them, not instead of them.
 *
 * Flagged addresses are kept in this process's memory, hashed, for anti_bot_flag_minutes. Not a
 * table: a flag is a few minutes of suspicion, and writing one per tripped honeypot would hand a
 * bot a way to make the site write rows.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { clientAddress } from './rateLimiter.mjs';

/**
 * The name every honeypot input uses. A bot fills inputs it can see in the DOM; a person never
 * sees this one, so any value at all is proof. Named after a field a form-filler wants to complete
 * rather than something like "honeypot", which the better bots skip.
 */
export const honeypotField = 'rwp_website_url';
/** How long the browser must have had the form open. Submitted faster than this, it was not typed. */
export const minimumFormSeconds = 2;
export const timestampField = 'rwp_form_started';

const CLEARANCE_TTL_MS = 10 * 60_000;
const ticketSecret = randomBytes(32);
const flags = new Map();
const salt = randomBytes(16).toString('hex');

const hashAddress = (value) => createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32);

const sweepFlags = (now) => {
  for (const [key, until] of flags) if (until <= now) flags.delete(key);
};

/** Marks an address as suspicious for the configured window. */
export function flagAddress(request, settings) {
  const now = Date.now();
  sweepFlags(now);
  flags.set(hashAddress(clientAddress(request)), now + settings.anti_bot_flag_minutes * 60_000);
}

/** Whether this address is inside a flag window, and for how much longer. */
export function addressFlagged(request) {
  const now = Date.now();
  const until = flags.get(hashAddress(clientAddress(request)));
  if (!until) return null;
  if (until <= now) {
    flags.delete(hashAddress(clientAddress(request)));
    return null;
  }
  return { retryAfter: Math.max(1, Math.ceil((until - now) / 1000)) };
}

export const antiBotStats = () => ({ flagged_addresses: flags.size });
export const clearFlags = () => flags.clear();

/**
 * The honeypot half of the check, done before any upstream call: it costs nothing and it catches
 * the majority. Returns { ok } or { ok: false, reason }.
 *
 * The timestamp test is separate from the field test on purpose. A form posted 200 ms after it
 * rendered was not typed, but it is also what an impatient password manager looks like, so it is
 * reported as its own reason and never flags the address — only a filled honeypot does that.
 */
export function checkHoneypot(payload, settings) {
  if (!settings.anti_bot_honeypot) return { ok: true };
  const trap = payload?.[honeypotField];
  if (typeof trap === 'string' && trap.trim() !== '') {
    return { ok: false, trap: true, reason: 'This form was rejected because a field only a bot fills in was completed.' };
  }
  const started = Number(payload?.[timestampField]);
  if (Number.isFinite(started) && started > 0) {
    const elapsed = (Date.now() - started) / 1000;
    // A negative age means a clock skew or a replayed timestamp; not proof, so it is allowed.
    if (elapsed >= 0 && elapsed < minimumFormSeconds) {
      return { ok: false, trap: false, reason: `This form was submitted ${elapsed.toFixed(1)} seconds after it opened, which is faster than a person types. Try again.` };
    }
  }
  return { ok: true };
}

const verifyTurnstile = async (token, secret, remoteip) => {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteip) body.set('remoteip', remoteip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  if (!response.ok) throw new Error(`Cloudflare Turnstile returned HTTP ${response.status}`);
  const result = await response.json();
  return {
    ok: result?.success === true,
    // Turnstile's codes are the only useful thing in a failure; passing them through saves a
    // support round trip over a generic "verification failed".
    detail: Array.isArray(result?.['error-codes']) ? result['error-codes'].join(', ') : '',
  };
};

const verifyRecaptcha = async (token, secret, remoteip, minimumScore) => {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteip) body.set('remoteip', remoteip);
  const response = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body });
  if (!response.ok) throw new Error(`Google reCAPTCHA returned HTTP ${response.status}`);
  const result = await response.json();
  if (result?.success !== true) {
    return { ok: false, detail: Array.isArray(result?.['error-codes']) ? result['error-codes'].join(', ') : '' };
  }
  // v3 always "succeeds" and reports a score instead, so success alone is not a pass.
  const score = Number(result?.score);
  if (Number.isFinite(score) && score < minimumScore) {
    return { ok: false, score, detail: `score ${score.toFixed(2)} is below the ${minimumScore} threshold` };
  }
  return { ok: true, score };
};

export const RECAPTCHA_MIN_SCORE = 0.5;

/**
 * Runs the configured provider against a token. Returns { ok, status, error } so the caller can
 * answer with the real reason: "not configured" (501), "you failed the check" (403) and "the
 * verification service is down" (502) need three different responses, and collapsing them into one
 * is how a misconfigured site ends up looking like a bot attack.
 */
export async function verifyCaptcha(token, settings, secret, request) {
  if (settings.anti_bot_provider === 'none') return { ok: true, skipped: 'CAPTCHA is switched off for this site.' };
  if (!secret) {
    return {
      ok: false, status: 501,
      error: `${settings.anti_bot_provider === 'turnstile' ? 'Cloudflare Turnstile' : 'Google reCAPTCHA'} is selected under Settings → Security, but no secret key is stored. Add it there, or set ANTI_BOT_SECRET_KEY in .env.local and restart the server.`,
    };
  }
  if (typeof token !== 'string' || !token.trim()) {
    return { ok: false, status: 400, error: 'The CAPTCHA did not produce a token. Reload the page and try again.' };
  }
  const remoteip = (process.env.TRUST_PROXY || '').trim() === 'true' ? clientAddress(request) : '';
  try {
    const result = settings.anti_bot_provider === 'turnstile'
      ? await verifyTurnstile(token.trim(), secret, remoteip)
      : await verifyRecaptcha(token.trim(), secret, remoteip, RECAPTCHA_MIN_SCORE);
    if (result.ok) return { ok: true, score: result.score };
    return { ok: false, status: 403, error: `The CAPTCHA check did not pass${result.detail ? ` (${result.detail})` : ''}.` };
  } catch (error) {
    return { ok: false, status: 502, error: error instanceof Error ? error.message : 'The CAPTCHA service could not be reached.' };
  }
}

/**
 * A clearance ticket: "<form>.<expiry>.<hmac>". Signed with a key generated at startup, so a
 * ticket is only valid on the server that issued it and every restart invalidates the lot — which
 * is correct, a ticket is worth ten minutes.
 *
 * The address is part of the signed material, so a ticket earned on one connection cannot be
 * handed to a farm of others.
 */
export function issueClearance(form, request) {
  const expires = Date.now() + CLEARANCE_TTL_MS;
  const material = `${form}.${expires}.${hashAddress(clientAddress(request))}`;
  const signature = createHmac('sha256', ticketSecret).update(material).digest('base64url');
  return `${form}.${expires}.${signature}`;
}

export function verifyClearance(ticket, form, request) {
  if (typeof ticket !== 'string' || !ticket) return { ok: false, error: 'This form was submitted without a verification ticket.' };
  const parts = ticket.split('.');
  if (parts.length !== 3) return { ok: false, error: 'The verification ticket is malformed.' };
  const [ticketForm, expiresRaw, signature] = parts;
  if (ticketForm !== form) return { ok: false, error: `The verification ticket was issued for "${ticketForm}", not "${form}".` };
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    return { ok: false, error: 'The verification ticket has expired. Reload the page and try again.' };
  }
  const expected = createHmac('sha256', ticketSecret)
    .update(`${ticketForm}.${expiresRaw}.${hashAddress(clientAddress(request))}`)
    .digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // Length-checked first: timingSafeEqual throws on a mismatch rather than returning false.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: 'The verification ticket is not valid for this connection.' };
  }
  return { ok: true };
}

/**
 * The guard a server route calls. Returns null when the request may proceed, or a ready-to-send
 * { status, body } when it may not.
 *
 * A form not listed in anti_bot_forms is not guarded at all — that list is the administrator's
 * decision about which forms are worth the friction.
 */
export function requireClearance(request, form, settings, ticket) {
  const flagged = addressFlagged(request);
  if (flagged) {
    return {
      status: 429,
      headers: { 'Retry-After': String(flagged.retryAfter) },
      body: { error: 'This address tripped a bot trap recently and is paused. Try again shortly.' },
    };
  }
  if (!settings.anti_bot_forms.includes(form)) return null;
  if (settings.anti_bot_provider === 'none' && !settings.anti_bot_honeypot) return null;
  const result = verifyClearance(ticket, form, request);
  return result.ok ? null : { status: 403, body: { error: result.error } };
}
