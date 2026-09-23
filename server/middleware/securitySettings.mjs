/**
 * The one snapshot of the security engine's settings, held in this process's memory and refreshed
 * on a timer.
 *
 * Why not read the options table per request: every middleware below this one (rate limiter,
 * anti-bot, page cache) needs its rules before it can decide anything, and a database round trip
 * in front of every HTTP request would cost more than the whole engine saves. So the rules are
 * fetched once, kept, and re-fetched in the background every REFRESH_MS. The cost is that a
 * setting saved in the admin takes up to that long to take effect — which is why the admin screen
 * calls POST /api/security/refresh after a save and gets the change immediately.
 *
 * Nothing here ever throws. A failed refresh keeps the previous snapshot (or the defaults on a
 * cold start) and is reported through `snapshot().stale`, because a Supabase outage must not turn
 * into a site that refuses every request or, worse, one that silently drops its rate limits.
 *
 * The CAPTCHA secret is deliberately not in the options table (it is world-readable). It comes
 * from ANTI_BOT_SECRET_KEY, or from public.rwp_security_secrets read with SUPABASE_SECRET_KEY.
 */

const REFRESH_MS = 30_000;

/** Every option row this engine reads. Kept in one place so the PostgREST filter cannot drift. */
export const securityOptionNames = [
  'session_max_age_hours', 'session_remember_me_days', 'session_cookie_samesite',
  'rate_limit_window_minutes', 'rate_limit_auth_max', 'rate_limit_api_max',
  'anti_bot_provider', 'anti_bot_site_key', 'anti_bot_honeypot', 'anti_bot_forms', 'anti_bot_flag_minutes',
  'cache_enabled', 'cache_ttl_seconds', 'cache_stale_while_revalidate_seconds', 'cache_static_max_age_seconds',
  'robots_txt_content', 'sitemap_enabled',
  // Not ours, but the sitemap and robots.txt need them and this is already the one fetch.
  'site_title', 'home_page_id',
];

export const defaultSecuritySettings = {
  session_max_age_hours: 24,
  session_remember_me_days: 30,
  session_cookie_samesite: 'Lax',
  rate_limit_window_minutes: 15,
  rate_limit_auth_max: 5,
  rate_limit_api_max: 100,
  anti_bot_provider: 'none',
  anti_bot_site_key: '',
  anti_bot_honeypot: true,
  anti_bot_forms: ['register', 'comment'],
  anti_bot_flag_minutes: 60,
  cache_enabled: false,
  cache_ttl_seconds: 3600,
  cache_stale_while_revalidate_seconds: 86400,
  cache_static_max_age_seconds: 31536000,
  robots_txt_content: '',
  sitemap_enabled: true,
  site_title: '',
  home_page_id: '',
};

const providers = new Set(['none', 'turnstile', 'recaptcha']);
const sameSiteValues = new Set(['Lax', 'Strict', 'None']);
export const antiBotForms = ['login', 'register', 'lost_password', 'comment', 'contact'];

const toNumber = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const toBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  return value === 'true' || value === '1';
};

/** Turns the option rows into the typed snapshot. Every value is clamped: these drive limits. */
export function normalizeSecuritySettings(values = {}) {
  // Capitalised the way Set-Cookie wants it, whatever case was saved: "strict" and "Strict" are
  // the same intent, and a cookie attribute browsers do not recognise is silently ignored.
  const raw = String(values.session_cookie_samesite || '').trim().toLowerCase();
  const sameSite = raw ? `${raw.charAt(0).toUpperCase()}${raw.slice(1)}` : '';
  const provider = String(values.anti_bot_provider || '').trim().toLowerCase();
  const forms = String(values.anti_bot_forms ?? defaultSecuritySettings.anti_bot_forms.join(','))
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => antiBotForms.includes(name));
  return {
    session_max_age_hours: toNumber(values.session_max_age_hours, defaultSecuritySettings.session_max_age_hours, { min: 1, max: 24 * 365 }),
    session_remember_me_days: toNumber(values.session_remember_me_days, defaultSecuritySettings.session_remember_me_days, { min: 1, max: 365 }),
    session_cookie_samesite: sameSiteValues.has(sameSite) ? sameSite : defaultSecuritySettings.session_cookie_samesite,
    rate_limit_window_minutes: toNumber(values.rate_limit_window_minutes, defaultSecuritySettings.rate_limit_window_minutes, { min: 1, max: 1440 }),
    // 0 is a legitimate value here and means "refuse everything", so the floor is 0, not 1.
    rate_limit_auth_max: toNumber(values.rate_limit_auth_max, defaultSecuritySettings.rate_limit_auth_max, { min: 0, max: 100_000 }),
    rate_limit_api_max: toNumber(values.rate_limit_api_max, defaultSecuritySettings.rate_limit_api_max, { min: 0, max: 1_000_000 }),
    anti_bot_provider: providers.has(provider) ? provider : 'none',
    anti_bot_site_key: String(values.anti_bot_site_key || '').trim(),
    anti_bot_honeypot: toBoolean(values.anti_bot_honeypot, defaultSecuritySettings.anti_bot_honeypot),
    anti_bot_forms: forms,
    anti_bot_flag_minutes: toNumber(values.anti_bot_flag_minutes, defaultSecuritySettings.anti_bot_flag_minutes, { min: 1, max: 60 * 24 * 7 }),
    cache_enabled: toBoolean(values.cache_enabled, defaultSecuritySettings.cache_enabled),
    cache_ttl_seconds: toNumber(values.cache_ttl_seconds, defaultSecuritySettings.cache_ttl_seconds, { min: 1, max: 60 * 60 * 24 * 30 }),
    cache_stale_while_revalidate_seconds: toNumber(values.cache_stale_while_revalidate_seconds, defaultSecuritySettings.cache_stale_while_revalidate_seconds, { min: 0, max: 60 * 60 * 24 * 365 }),
    cache_static_max_age_seconds: toNumber(values.cache_static_max_age_seconds, defaultSecuritySettings.cache_static_max_age_seconds, { min: 0, max: 60 * 60 * 24 * 400 }),
    robots_txt_content: String(values.robots_txt_content || ''),
    sitemap_enabled: toBoolean(values.sitemap_enabled, defaultSecuritySettings.sitemap_enabled),
    site_title: String(values.site_title || ''),
    home_page_id: String(values.home_page_id || ''),
  };
}

let state = {
  settings: { ...defaultSecuritySettings },
  secret: '',
  fetchedAt: 0,
  stale: true,
  error: '',
};
let inFlight = null;
let source = null;

/**
 * Tells the module which Supabase project to read from. server.mjs calls this once at startup and
 * again after the Setup Wizard writes the config, because before installation there is nothing to
 * read and the defaults are the right answer.
 */
export function configureSecuritySettings(config) {
  const next = config?.supabaseUrl && config?.supabasePublishableKey
    ? { baseUrl: config.supabaseUrl.replace(/\/$/, ''), key: config.supabasePublishableKey }
    : null;
  const changed = next?.baseUrl !== source?.baseUrl || next?.key !== source?.key;
  source = next;
  if (changed) state = { ...state, fetchedAt: 0, stale: true };
}

const fetchOptions = async () => {
  const filter = `(${securityOptionNames.join(',')})`;
  const response = await fetch(
    `${source.baseUrl}/rest/v1/options?select=option_name,option_value&option_name=in.${encodeURIComponent(filter)}`,
    { headers: { apikey: source.key, Authorization: `Bearer ${source.key}` } },
  );
  if (!response.ok) throw new Error(`options returned HTTP ${response.status}`);
  const rows = await response.json();
  return (Array.isArray(rows) ? rows : []).reduce((result, row) => {
    result[row.option_name] = row.option_value;
    return result;
  }, {});
};

/**
 * The CAPTCHA secret. ANTI_BOT_SECRET_KEY wins, so an operator who keeps every credential in
 * .env.local never has to put one in the database; otherwise it is read from
 * public.rwp_security_secrets with the service key, which is the only key RLS lets through.
 * Returns '' rather than throwing: a missing secret is reported as "CAPTCHA is not configured"
 * at the point of use, which is a far more useful message than a 500 on a settings refresh.
 */
const fetchSecret = async () => {
  const fromEnv = (process.env.ANTI_BOT_SECRET_KEY || '').trim();
  if (fromEnv) return fromEnv;
  const serviceKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!serviceKey || !source) return '';
  try {
    const response = await fetch(`${source.baseUrl}/rest/v1/rwp_security_secrets?select=anti_bot_secret_key&limit=1`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!response.ok) return '';
    const rows = await response.json();
    return String(rows?.[0]?.anti_bot_secret_key || '').trim();
  } catch {
    return '';
  }
};

/** Re-reads now. Concurrent callers share one request, so a burst cannot fan out into a burst. */
export async function refreshSecuritySettings() {
  if (!source) {
    state = { settings: { ...defaultSecuritySettings }, secret: '', fetchedAt: Date.now(), stale: true, error: 'This site is not installed yet.' };
    return state;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const [values, secret] = await Promise.all([fetchOptions(), fetchSecret()]);
      state = { settings: normalizeSecuritySettings(values), secret, fetchedAt: Date.now(), stale: false, error: '' };
    } catch (error) {
      // The previous snapshot stays in force. Only the timestamp moves, so a hard-down database
      // does not turn into one refresh attempt per request.
      state = { ...state, fetchedAt: Date.now(), stale: true, error: error instanceof Error ? error.message : 'unknown error' };
    } finally {
      inFlight = null;
    }
    return state;
  })();
  return inFlight;
}

/**
 * The current rules, synchronously. Middleware must never await for its own configuration, so a
 * stale snapshot is refreshed in the background and this call returns what it already has.
 */
export function securitySnapshot() {
  if (Date.now() - state.fetchedAt > REFRESH_MS) {
    // Fire and forget; the result lands in `state` for the next request.
    void refreshSecuritySettings();
  }
  return state;
}

export const securitySettings = () => securitySnapshot().settings;
export const antiBotSecret = () => securitySnapshot().secret;

/** For the admin's status panel: what the server believes, never a credential. */
export const securityStatus = () => {
  const { settings, secret, fetchedAt, stale, error } = securitySnapshot();
  return {
    settings,
    anti_bot_secret_configured: Boolean(secret),
    anti_bot_secret_source: (process.env.ANTI_BOT_SECRET_KEY || '').trim() ? 'environment' : (secret ? 'database' : 'none'),
    refreshed_at: fetchedAt ? new Date(fetchedAt).toISOString() : null,
    refresh_interval_seconds: REFRESH_MS / 1000,
    stale,
    error,
  };
};
