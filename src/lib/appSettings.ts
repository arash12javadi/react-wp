import { useEffect, useState } from 'react';
import { describeDbError, getSupabaseClient } from './db';
import type { UserRole } from './roles';
import { sanitizeTrackingHtml } from './scriptSanitizer.js';

/**
 * App Settings (Admin → App Settings). Stored as one JSON document in the rwp_app_settings
 * option, which is publicly readable — so nothing private belongs here. Per-user quota
 * overrides are keyed by email and live in the rwp_quota_overrides table instead.
 *
 * Several values are enforced by the database, not only this UI: media scoping
 * (rwp_can_manage_media) and upload limits (media_enforce_upload_rules). Keep the key names in
 * sync with those functions. Role grants used to be a `roles` key here; they are now the
 * rwp_role_capabilities table (src/lib/capabilityGrants.ts), and the 20261001 migration moved them.
 */

export const quotaRoles = ['editor', 'author', 'contributor', 'subscriber'] as const;
export type QuotaRole = (typeof quotaRoles)[number];

export interface AppSettings {
  general: {
    show_page_titles: boolean;
    show_post_titles: boolean;
    show_post_dates: boolean;
    /** Roles without edit_others_posts see and manage only their own media. */
    scope_media_to_owner: boolean;
  };
  uploads: {
    /** null means no limit. */
    max_upload_kb: number | null;
    min_width: number | null;
    min_height: number | null;
    max_width: number | null;
    max_height: number | null;
    /** MB per role; null means unlimited, 0 means no uploads. */
    quota_mb: Record<QuotaRole, number | null>;
  };
  menu: {
    /** Target of the #profile_url# menu placeholder. {id} is replaced with the user id. */
    profile_url: string;
  };
  seo: {
    meta_keywords_enabled: boolean;
    header_script: string;
    body_script: string;
  };
}

export const appSettingsOption = 'rwp_app_settings';
export const appSettingsMigration = 'supabase/migrations/20260920_app_settings.sql';

export const defaultAppSettings: AppSettings = {
  general: { show_page_titles: true, show_post_titles: true, show_post_dates: true, scope_media_to_owner: false },
  uploads: {
    max_upload_kb: null, min_width: null, min_height: null, max_width: null, max_height: null,
    quota_mb: { editor: null, author: null, contributor: null, subscriber: null },
  },
  // /profile shows the page chosen under Settings → Site → User profile page, for every role.
  menu: { profile_url: '/profile' },
  seo: { meta_keywords_enabled: false, header_script: '', body_script: '' },
};

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {});
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const str = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);
// SQL reads these with jsonb_typeof = 'number', so a numeric string would be silently ignored there.
const limit = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

/** Coerces whatever is stored into a complete settings object; unknown keys are dropped. */
export const normalizeAppSettings = (raw: unknown): AppSettings => {
  const root = asObject(raw);
  const general = asObject(root.general);
  const uploads = asObject(root.uploads);
  const quota = asObject(uploads.quota_mb);
  const menu = asObject(root.menu);
  const seo = asObject(root.seo);
  const d = defaultAppSettings;
  return {
    general: {
      show_page_titles: bool(general.show_page_titles, d.general.show_page_titles),
      show_post_titles: bool(general.show_post_titles, d.general.show_post_titles),
      show_post_dates: bool(general.show_post_dates, d.general.show_post_dates),
      scope_media_to_owner: bool(general.scope_media_to_owner, d.general.scope_media_to_owner),
    },
    uploads: {
      max_upload_kb: limit(uploads.max_upload_kb),
      min_width: limit(uploads.min_width),
      min_height: limit(uploads.min_height),
      max_width: limit(uploads.max_width),
      max_height: limit(uploads.max_height),
      quota_mb: {
        editor: limit(quota.editor), author: limit(quota.author),
        contributor: limit(quota.contributor), subscriber: limit(quota.subscriber),
      },
    },
    // The old default only opened for roles that can use the admin; /profile works for every role.
    menu: { profile_url: str(menu.profile_url, d.menu.profile_url).trim().replace(/^\/admin\?section=profile$/, d.menu.profile_url) || d.menu.profile_url },
    seo: {
      meta_keywords_enabled: bool(seo.meta_keywords_enabled, d.seo.meta_keywords_enabled),
      header_script: str(seo.header_script, ''),
      body_script: str(seo.body_script, ''),
    },
  };
};

export const parseAppSettings = (value: string | null | undefined): AppSettings => {
  if (!value) return defaultAppSettings;
  try {
    return normalizeAppSettings(JSON.parse(value));
  } catch {
    return defaultAppSettings;
  }
};

// Many components need these on one page load; they share a single request.
let cached: Promise<AppSettings> | null = null;
let current: AppSettings | null = null;
const listeners = new Set<(settings: AppSettings) => void>();

export const loadAppSettings = (force = false): Promise<AppSettings> => {
  if (!cached || force) {
    cached = Promise.resolve(
      getSupabaseClient().from('options').select('option_value').eq('option_name', appSettingsOption).maybeSingle(),
    ).then(({ data, error }) => {
      if (error) throw new Error(`Could not load settings: ${describeDbError(error)}`);
      const settings = parseAppSettings(data?.option_value);
      current = settings;
      listeners.forEach((listener) => listener(settings));
      return settings;
    });
    cached.catch(() => { cached = null; });
  }
  return cached;
};

/** Current App Settings, re-rendering when they load or are saved. Defaults until then. */
export const useAppSettings = (): { settings: AppSettings; loaded: boolean } => {
  const [settings, setSettings] = useState<AppSettings | null>(current);
  useEffect(() => {
    listeners.add(setSettings);
    void loadAppSettings().catch(() => {});
    return () => { listeners.delete(setSettings); };
  }, []);
  return { settings: settings || defaultAppSettings, loaded: Boolean(settings) };
};

export const saveAppSettings = async (settings: AppSettings): Promise<AppSettings> => {
  const clean = normalizeAppSettings(settings);
  clean.seo.header_script = sanitizeTrackingHtml(clean.seo.header_script).html;
  clean.seo.body_script = sanitizeTrackingHtml(clean.seo.body_script).html;
  // .select() because an update refused by row level security returns no error, only no rows.
  const { data, error } = await getSupabaseClient()
    .from('options')
    .upsert({ option_name: appSettingsOption, option_value: JSON.stringify(clean) })
    .select('option_name');
  if (error) {
    throw new Error(/row-level security/i.test(describeDbError(error))
      ? 'The database refused to save these settings: your role needs the manage_options capability (Administrator).'
      : `Could not save settings: ${describeDbError(error)}`);
  }
  if (!data?.length) {
    throw new Error('Settings were not saved: the database accepted the request but changed no rows, which means row level security blocked it. Your role needs the manage_options capability.');
  }
  current = clean;
  cached = Promise.resolve(clean);
  listeners.forEach((listener) => listener(clean));
  return clean;
};

// Tracking scripts -------------------------------------------------------------------------

/**
 * Injects the header and body snippets when the server has not already written them into the
 * HTML (server/seo.mjs marks that with <meta name="rwp-scripts">). Without that check every
 * pageview would be counted twice on npm start.
 */
export const injectTrackingScripts = (seo: AppSettings['seo']) => {
  if (document.querySelector('meta[name="rwp-scripts"]')) return;
  injectSnippet(seo.header_script, 'head');
  injectSnippet(seo.body_script, 'body');
};

/**
 * Adds a snippet after passing it through the tracking-script allowlist. Also used for the Theme
 * Editor's <head> code ('head') and footer scripts ('body-end').
 */
export const injectSnippet = (source: string, target: 'head' | 'body' | 'body-end') => {
  const { html } = sanitizeTrackingHtml(source);
  if (!html) return;
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  const nodes: Node[] = [];
  Array.from(parsed.body.children).forEach((element) => {
    const tag = element.tagName.toLowerCase();
    // With JavaScript running, a <noscript> fallback has nothing to do.
    if (tag === 'noscript') return;
    if (tag === 'script') {
      // Scripts created by DOMParser never execute; a fresh element does.
      const script = document.createElement('script');
      Array.from(element.attributes).forEach((attribute) => script.setAttribute(attribute.name, attribute.value));
      script.text = element.textContent || '';
      script.dataset.rwpInjected = target;
      nodes.push(script);
    } else {
      const clone = document.importNode(element, true) as HTMLElement;
      clone.dataset.rwpInjected = target;
      nodes.push(clone);
    }
  });
  if (target === 'head') nodes.forEach((node) => document.head.appendChild(node));
  else if (target === 'body-end') nodes.forEach((node) => document.body.appendChild(node));
  else document.body.prepend(...nodes);
};

// Uploads ----------------------------------------------------------------------------------

export interface UploadAllowance {
  can_upload: boolean;
  used_bytes: number;
  /** null means unlimited. */
  quota_bytes: number | null;
  has_override: boolean;
}

const isMissingMigration = (message: string) =>
  /PGRST202|PGRST205|42P01|42883|schema cache|does not exist/i.test(message);

/** Resolves to null before the 20260920 migration has run, so uploads keep working without quotas. */
export const fetchUploadAllowance = async (): Promise<UploadAllowance | null> => {
  const { data, error } = await getSupabaseClient().rpc('rwp_upload_allowance');
  if (error) {
    const message = describeDbError(error);
    if (isMissingMigration(message)) return null;
    throw new Error(`Could not check your disk quota: ${message}`);
  }
  const value = asObject(data);
  return {
    can_upload: value.can_upload === true,
    used_bytes: Number(value.used_bytes) || 0,
    quota_bytes: value.quota_bytes === null || value.quota_bytes === undefined ? null : Number(value.quota_bytes),
    has_override: value.has_override === true,
  };
};

const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(2).replace(/\.?0+$/, '')} MB`;

export const describeAllowance = (allowance: UploadAllowance): string =>
  allowance.quota_bytes === null
    ? `You have used ${megabytes(allowance.used_bytes)}. Your role has no disk quota.`
    : `You have used ${megabytes(allowance.used_bytes)} of your ${megabytes(allowance.quota_bytes)} disk quota${allowance.has_override ? ' (set for your account)' : ''}.`;

/** Natural size of an image file, or null for files the browser cannot decode as an image. */
export const readImageDimensions = async (file: File): Promise<{ width: number; height: number } | null> => {
  if (!file.type.startsWith('image/')) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    // createImageBitmap cannot decode SVG; an <img> can.
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image.naturalWidth ? { width: image.naturalWidth, height: image.naturalHeight } : null);
        image.onerror = () => resolve(null);
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
};

/**
 * Checked before a file is sent to Cloudinary or ImageKit. The database checks the same rules
 * when the library row is inserted, but by then the file is already at the provider, so this is
 * what prevents orphaned uploads. `pendingBytes` is what earlier files in the same batch add.
 */
export const checkUploadRules = async (
  file: File,
  rules: AppSettings['uploads'],
  allowance: UploadAllowance | null,
  pendingBytes = 0,
): Promise<string[]> => {
  const problems: string[] = [];
  if (allowance && !allowance.can_upload) {
    problems.push('your role does not have the upload_files capability');
    return problems;
  }
  if (rules.max_upload_kb !== null && file.size > rules.max_upload_kb * 1024) {
    problems.push(`it is ${Math.ceil(file.size / 1024)} KB, over the ${rules.max_upload_kb} KB upload limit`);
  }
  if (allowance && allowance.quota_bytes !== null) {
    const remaining = allowance.quota_bytes - allowance.used_bytes - pendingBytes;
    if (file.size > remaining) {
      problems.push(`it needs ${megabytes(file.size)}, but only ${megabytes(Math.max(remaining, 0))} of your ${megabytes(allowance.quota_bytes)} disk quota is left`);
    }
  }
  const { min_width, min_height, max_width, max_height } = rules;
  if ([min_width, min_height, max_width, max_height].some((value) => value !== null) && file.type.startsWith('image/')) {
    const size = await readImageDimensions(file);
    if (!size) {
      problems.push('its image dimensions could not be read, and dimension limits are enabled');
    } else {
      if ((min_width !== null && size.width < min_width) || (min_height !== null && size.height < min_height)) {
        problems.push(`it is ${size.width} × ${size.height} px, smaller than the minimum of ${min_width ?? 'any'} × ${min_height ?? 'any'} px`);
      }
      if ((max_width !== null && size.width > max_width) || (max_height !== null && size.height > max_height)) {
        problems.push(`it is ${size.width} × ${size.height} px, larger than the maximum of ${max_width ?? 'any'} × ${max_height ?? 'any'} px`);
      }
    }
  }
  return problems;
};

// Quota overrides (administrators) ---------------------------------------------------------

export interface QuotaOverride {
  email: string;
  quota_mb: number;
}

export interface DiskUsageRow {
  email: string;
  display_name: string | null;
  role: UserRole;
  used_bytes: number;
  quota_bytes: number | null;
}

const explainOverrideError = (error: unknown): Error => {
  const message = describeDbError(error);
  if (isMissingMigration(message)) {
    return new Error(`The quota override table or functions do not exist yet. Run ${appSettingsMigration} in the Supabase SQL Editor, then reload.`);
  }
  if (/row-level security|42501/i.test(message)) {
    return new Error(`The database refused this: managing quota overrides needs the manage_options capability. (${message})`);
  }
  return new Error(message);
};

export const fetchQuotaOverrides = async (): Promise<QuotaOverride[]> => {
  const { data, error } = await getSupabaseClient().from('rwp_quota_overrides').select('email,quota_mb').order('email');
  if (error) throw explainOverrideError(error);
  return (data || []) as QuotaOverride[];
};

export const saveQuotaOverride = async (email: string, quotaMb: number): Promise<QuotaOverride> => {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(clean)) throw new Error(`"${email}" is not an email address.`);
  if (!Number.isInteger(quotaMb) || quotaMb < 0) throw new Error('The quota must be a whole number of megabytes, 0 or more.');
  const { data, error } = await getSupabaseClient()
    .from('rwp_quota_overrides')
    .upsert({ email: clean, quota_mb: quotaMb })
    .select('email,quota_mb');
  if (error) throw explainOverrideError(error);
  if (!data?.length) throw new Error('The override was not saved: row level security blocked it. Your role needs the manage_options capability.');
  return data[0] as QuotaOverride;
};

export const deleteQuotaOverride = async (email: string): Promise<void> => {
  const { data, error } = await getSupabaseClient().from('rwp_quota_overrides').delete().eq('email', email).select('email');
  if (error) throw explainOverrideError(error);
  if (!data?.length) throw new Error(`No override for ${email} was removed: it no longer exists, or row level security blocked the delete.`);
};

export const fetchDiskUsageReport = async (): Promise<DiskUsageRow[]> => {
  const { data, error } = await getSupabaseClient().rpc('rwp_disk_usage_report');
  if (error) throw explainOverrideError(error);
  return (Array.isArray(data) ? data : []).map((row: Json) => ({
    email: String(row.email || ''),
    display_name: typeof row.display_name === 'string' ? row.display_name : null,
    role: row.role as UserRole,
    used_bytes: Number(row.used_bytes) || 0,
    quota_bytes: row.quota_bytes === null || row.quota_bytes === undefined ? null : Number(row.quota_bytes),
  }));
};
