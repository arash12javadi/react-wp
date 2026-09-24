/**
 * Settings → Security: sessions, anti-bot, rate limiting, caching and the SEO routes.
 *
 * Stored as one option row each rather than inside the rwp_app_settings document, for the same
 * reason the four language rows are: server.mjs reads them with the publishable key before any of
 * the app exists (server/middleware/securitySettings.mjs), and parsing a JSON blob to find a rate
 * limit on every request would be work per request rather than work per refresh.
 *
 * The CAPTCHA secret is NOT one of them. public.options is world-readable, so a secret in it is a
 * file every visitor can download; it lives in rwp_security_secrets and is written through
 * rwp_security_save_secrets, which reports set / not set and never a value — the same rule the
 * chat plugin's credentials follow.
 *
 * Every server call here needs server.mjs. On a static host they fail as EndpointUnavailableError
 * so the screen can say "this host cannot do it" rather than reporting a database fault.
 */
import { getSupabaseClient, describeDbError, updateOption } from './db';
import { EndpointUnavailableError } from './pluginSchema';
import type { AntiBotForm, AntiBotProvider } from './antiBot';

export const securityMigration = 'supabase/migrations/20261010_security_engine.sql';

export type SameSitePolicy = 'Lax' | 'Strict' | 'None';

export const sameSiteLabels: Record<SameSitePolicy, string> = {
  Lax: 'Lax — sent on top-level navigations. The right answer for almost every site.',
  Strict: 'Strict — never sent from another site, so a link from an email lands signed out until the page is reloaded.',
  None: 'None — sent everywhere. Needs HTTPS, and only makes sense if another site embeds this one.',
};

export const antiBotProviderLabels: Record<AntiBotProvider, string> = {
  none: 'None — honeypot only',
  turnstile: 'Cloudflare Turnstile',
  recaptcha: 'Google reCAPTCHA v3',
};

export interface SecuritySettings {
  /** How long a session lasts when "remember me" was not asked for. */
  session_max_age_hours: number;
  session_remember_me_days: number;
  session_cookie_samesite: SameSitePolicy;
  /** One window, shared by both limiter tiers. */
  rate_limit_window_minutes: number;
  /** Sign-in, verification and admin endpoints. */
  rate_limit_auth_max: number;
  /** Everything else under /api. */
  rate_limit_api_max: number;
  anti_bot_provider: AntiBotProvider;
  /** Public by design: it is rendered into the CAPTCHA widget. */
  anti_bot_site_key: string;
  anti_bot_honeypot: boolean;
  anti_bot_forms: AntiBotForm[];
  anti_bot_flag_minutes: number;
  cache_enabled: boolean;
  cache_ttl_seconds: number;
  cache_stale_while_revalidate_seconds: number;
  cache_static_max_age_seconds: number;
  /** Whether saving content or settings purges the page cache automatically. */
  cache_auto_purge_on_save: boolean;
  /** Brotli/gzip on HTML, JSON and text assets. Independent of cache_enabled — a pure transport
   *  optimisation with none of the staleness/privacy trade-offs that keep the page cache opt-in. */
  cache_enable_compression: boolean;
  /** Empty means "serve the generated default", which is not the same as an empty file. */
  robots_txt_content: string;
  sitemap_enabled: boolean;
}

export const defaultSecuritySettings: SecuritySettings = {
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
  cache_auto_purge_on_save: true,
  cache_enable_compression: true,
  robots_txt_content: '',
  sitemap_enabled: true,
};

export const securitySettingKeys = Object.keys(defaultSecuritySettings) as Array<keyof SecuritySettings>;

const toNumber = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const toBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
};

const knownForms: AntiBotForm[] = ['login', 'register', 'lost_password', 'comment', 'contact'];

/**
 * Reads the option rows. A site that has not run the migration has none of them and gets the
 * defaults — the same defaults the server is running on, so the screen never shows a value the
 * server is not actually using.
 */
export const loadSecuritySettings = async (): Promise<SecuritySettings> => {
  const { data, error } = await getSupabaseClient()
    .from('options')
    .select('option_name,option_value')
    .in('option_name', securitySettingKeys);
  if (error) throw new Error(describeDbError(error));

  const values = (data || []).reduce<Record<string, string>>((result, row) => {
    result[row.option_name] = row.option_value;
    return result;
  }, {});

  const sameSite = values.session_cookie_samesite as SameSitePolicy | undefined;
  const provider = values.anti_bot_provider as AntiBotProvider | undefined;

  return {
    session_max_age_hours: toNumber(values.session_max_age_hours, defaultSecuritySettings.session_max_age_hours, 1, 24 * 365),
    session_remember_me_days: toNumber(values.session_remember_me_days, defaultSecuritySettings.session_remember_me_days, 1, 365),
    session_cookie_samesite: sameSite && sameSite in sameSiteLabels ? sameSite : defaultSecuritySettings.session_cookie_samesite,
    rate_limit_window_minutes: toNumber(values.rate_limit_window_minutes, defaultSecuritySettings.rate_limit_window_minutes, 1, 1440),
    rate_limit_auth_max: toNumber(values.rate_limit_auth_max, defaultSecuritySettings.rate_limit_auth_max, 0, 100_000),
    rate_limit_api_max: toNumber(values.rate_limit_api_max, defaultSecuritySettings.rate_limit_api_max, 0, 1_000_000),
    anti_bot_provider: provider && provider in antiBotProviderLabels ? provider : 'none',
    anti_bot_site_key: values.anti_bot_site_key || '',
    anti_bot_honeypot: toBoolean(values.anti_bot_honeypot, defaultSecuritySettings.anti_bot_honeypot),
    anti_bot_forms: String(values.anti_bot_forms ?? defaultSecuritySettings.anti_bot_forms.join(','))
      .split(',')
      .map((name) => name.trim() as AntiBotForm)
      .filter((name) => knownForms.includes(name)),
    anti_bot_flag_minutes: toNumber(values.anti_bot_flag_minutes, defaultSecuritySettings.anti_bot_flag_minutes, 1, 60 * 24 * 7),
    cache_enabled: toBoolean(values.cache_enabled, defaultSecuritySettings.cache_enabled),
    cache_ttl_seconds: toNumber(values.cache_ttl_seconds, defaultSecuritySettings.cache_ttl_seconds, 1, 60 * 60 * 24 * 30),
    cache_stale_while_revalidate_seconds: toNumber(values.cache_stale_while_revalidate_seconds, defaultSecuritySettings.cache_stale_while_revalidate_seconds, 0, 60 * 60 * 24 * 365),
    cache_static_max_age_seconds: toNumber(values.cache_static_max_age_seconds, defaultSecuritySettings.cache_static_max_age_seconds, 0, 60 * 60 * 24 * 400),
    cache_auto_purge_on_save: toBoolean(values.cache_auto_purge_on_save, defaultSecuritySettings.cache_auto_purge_on_save),
    cache_enable_compression: toBoolean(values.cache_enable_compression, defaultSecuritySettings.cache_enable_compression),
    robots_txt_content: values.robots_txt_content || '',
    sitemap_enabled: toBoolean(values.sitemap_enabled, defaultSecuritySettings.sitemap_enabled),
  };
};

/**
 * Writes the changed rows. An RLS-blocked update returns no error and affects zero rows, which is
 * why updateOption reports a boolean and this throws on any false — otherwise saving as a role
 * without manage_options would look like it worked.
 */
export const saveSecuritySettings = async (settings: Partial<SecuritySettings>): Promise<void> => {
  const entries = Object.entries(settings) as Array<[keyof SecuritySettings, unknown]>;
  const results = await Promise.all(entries.map(([key, value]) => updateOption(
    key,
    Array.isArray(value) ? value.join(',') : value,
  )));
  if (results.some((saved) => !saved)) {
    throw new Error('Some security settings could not be saved. Check that your role can manage settings.');
  }
};

// --- The CAPTCHA secret -------------------------------------------------------------------------

export interface SecretStatus {
  anti_bot_secret_key: boolean;
  updated_at: string | null;
}

export const loadSecretStatus = async (): Promise<SecretStatus> => {
  const { data, error } = await getSupabaseClient().rpc('rwp_security_secrets_status');
  if (error) throw new Error(describeDbError(error));
  return data as SecretStatus;
};

/** An empty string clears the stored secret; undefined would leave it untouched, so callers send ''. */
export const saveAntiBotSecret = async (key: string): Promise<SecretStatus> => {
  const { data, error } = await getSupabaseClient()
    .rpc('rwp_security_save_secrets', { p_payload: { anti_bot_secret_key: key } });
  if (error) throw new Error(describeDbError(error));
  return data as SecretStatus;
};

// --- The server -----------------------------------------------------------------------------------

export interface ServerSecurityStatus {
  settings: SecuritySettings & { site_title: string; home_page_id: string };
  anti_bot_secret_configured: boolean;
  anti_bot_secret_source: 'environment' | 'database' | 'none';
  refreshed_at: string | null;
  refresh_interval_seconds: number;
  stale: boolean;
  error: string;
  cache: {
    hits: number; misses: number; stale: number; stores: number; purges: number; entries: number;
    bytes: number; max_entries: number;
    /** Compressed copies kept alongside the raw body, and what all of that together holds in memory. */
    stored_bytes: number; compressed_entries: number;
    /** Built assets (JS/CSS/SVG bundles) compressed once and reused — separate from the page cache. */
    cached_assets: number;
  };
  rate_limits: { keys: number; swept_at: string };
  anti_bot: { flagged_addresses: number };
  /** False when the server has no database credentials, so "sign out everywhere" would fail. */
  database_connection: boolean;
}

const accessToken = async (): Promise<string> => {
  const { data } = await getSupabaseClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session has expired. Sign in again.');
  return token;
};

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const token = await accessToken();
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...init.headers, Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new EndpointUnavailableError(`The server could not be reached for ${path}. In development, is server.mjs running on :3000?`);
  }
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    if (response.status === 404 && !body.error) {
      throw new EndpointUnavailableError(
        `This host has no ${path} endpoint. The security engine's rate limiting, page cache and session revocation need the Node server (npm start); they are not available on a static deployment.`);
    }
    throw new Error(body.error || `${path} returned HTTP ${response.status}.`);
  }
  return body;
};

export const fetchServerSecurityStatus = () => request<ServerSecurityStatus>('/api/security/status');

/** Makes the server re-read the options now rather than on its next 30-second tick. */
export const refreshServerSecurity = () => request<ServerSecurityStatus>('/api/security/refresh', { method: 'POST' });

/**
 * Empties the page cache. With no paths the whole cache goes and the server re-reads its settings,
 * which is what a settings or theme change needs; with paths only those pages go, so publishing
 * one post does not discard the rest of the site.
 *
 * `reason: 'manual'` is the admin's explicit "Purge the whole page cache" button and always runs.
 * The default, `'auto'`, is what every automatic call after a save sends, and the server skips it
 * when `cache_auto_purge_on_save` has been switched off — that setting exists to silence exactly
 * these calls, not the deliberate one.
 */
export const purgePageCache = (paths?: string[], reason: 'auto' | 'manual' = 'auto') =>
  request<{ success: boolean; removed: number; scope: 'all' | 'paths' | 'skipped'; paths?: string[]; reason?: string }>(
    '/api/security/cache/purge',
    { method: 'POST', body: JSON.stringify({ paths: paths || [], reason }) },
  );

/**
 * Best-effort purge after a content or settings save. Never throws: a page that is one TTL out of
 * date is not a reason to tell someone their save failed, and on a static host there is no cache
 * to purge in the first place.
 */
export const purgePageCacheQuietly = async (paths?: string[]): Promise<void> => {
  try {
    await purgePageCache(paths, 'auto');
  } catch {
    // Deliberate: the TTL is the backstop.
  }
};

export interface RevokeResult {
  success: boolean;
  user_id: string;
  sessions: number;
  refresh_tokens: number;
  note: string;
}

/**
 * Signs an account out everywhere. `dbPassword` is the Setup Wizard's long-standing fallback for
 * a server without SUPABASE_DB_URL; leave it out when the status reports database_connection.
 */
export const revokeUserSessions = (userId: string, credentials: { dbPassword?: string; connectionString?: string } = {}) =>
  request<RevokeResult>('/api/security/sessions/revoke', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, ...credentials }),
  });
