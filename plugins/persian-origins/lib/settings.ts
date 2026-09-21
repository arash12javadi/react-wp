import { describeDbError, tryGetSupabaseClient, getSupabaseClient } from '../../../src/lib/db';

/**
 * Persian Origins → Appearance, stored as one JSON document in the public `po_settings` option
 * (it only holds display choices, and visitors need it before anything renders).
 *
 * A copy is kept in localStorage so the next visit applies the default theme before the request
 * returns, instead of painting light and then turning dark.
 */

export type ThemeDefault = 'light' | 'dark' | 'system';

export interface PoSettings {
  /** The two languages the switch toggles between. The first is the one content is written in. */
  languages: [string, string];
  /** A switch fixed to the side of every public page. */
  floating_switch: boolean;
  /** A settings button (theme, fonts, text size) fixed to the corner of every public page. */
  floating_settings: boolean;
  /** Also put the switch in the header, next to the login links. Core has its own switcher too. */
  header_switch: boolean;
  default_theme: ThemeDefault;
  /** language -> font slug used until a visitor chooses one ('default' = the site's font). */
  default_fonts: Record<string, string>;
  /** Translate every text on the public page from Site text (lib/pageTranslator.ts). */
  translate_site: boolean;
  /** Add untranslated text to Site text while an administrator browses the site. */
  collect_text: boolean;
  /** Persian digits (۱۲۳) instead of 123 while Persian is active. */
  persian_digits: boolean;
  /** Dates in the active language's calendar (the Persian calendar for Persian). */
  localize_dates: boolean;
}

export const defaultPoSettings: PoSettings = {
  languages: ['en', 'fa'],
  floating_switch: false,
  floating_settings: false,
  header_switch: false,
  default_theme: 'light',
  default_fonts: {},
  translate_site: true,
  collect_text: true,
  persian_digits: true,
  localize_dates: true,
};

const cacheKey = 'po_settings_cache';
const localePattern = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;

export const normalizePoSettings = (raw: unknown): PoSettings => {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof PoSettings, unknown>>;
  const languages = Array.isArray(value.languages)
    ? value.languages.map((code) => String(code).trim().toLowerCase()).filter((code) => localePattern.test(code))
    : [];
  const pair: [string, string] = languages.length >= 2 && languages[0] !== languages[1]
    ? [languages[0], languages[1]]
    : defaultPoSettings.languages;
  const fonts = value.default_fonts && typeof value.default_fonts === 'object' && !Array.isArray(value.default_fonts)
    ? Object.fromEntries(Object.entries(value.default_fonts as Record<string, unknown>).map(([code, slug]) => [code, String(slug)]))
    : {};
  return {
    languages: pair,
    floating_switch: value.floating_switch === true,
    floating_settings: value.floating_settings === true,
    header_switch: value.header_switch === true,
    default_theme: value.default_theme === 'dark' || value.default_theme === 'system' ? value.default_theme : 'light',
    default_fonts: fonts,
    // On unless switched off: a site saved before these existed gets the whole-page translation.
    translate_site: value.translate_site !== false,
    collect_text: value.collect_text !== false,
    persian_digits: value.persian_digits !== false,
    localize_dates: value.localize_dates !== false,
  };
};

const readCache = (): PoSettings | null => {
  try {
    const raw = localStorage.getItem(cacheKey);
    return raw ? normalizePoSettings(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

const writeCache = (settings: PoSettings) => {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(settings));
  } catch {
    // Only costs the head start on the next visit.
  }
};

let current: PoSettings = readCache() || defaultPoSettings;
const listeners = new Set<() => void>();

export const getPoSettings = () => current;

export const subscribePoSettings = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const setCurrent = (next: PoSettings) => {
  current = next;
  writeCache(next);
  listeners.forEach((listener) => listener());
};

/** Reads the option. A missing row (plugin schema not installed yet) keeps the defaults. */
export async function loadPoSettings(): Promise<PoSettings> {
  const supabase = tryGetSupabaseClient();
  if (!supabase) return current;
  const { data, error } = await supabase.from('options').select('option_value').eq('option_name', 'po_settings').maybeSingle();
  if (error) {
    console.warn(`Persian Origins settings could not be loaded (${describeDbError(error)}); the defaults are used.`);
    return current;
  }
  let parsed: unknown = null;
  try {
    parsed = data?.option_value ? JSON.parse(data.option_value) : null;
  } catch {
    console.warn('The po_settings option is not valid JSON; the Persian Origins defaults are used until it is saved again.');
  }
  setCurrent(normalizePoSettings(parsed));
  return current;
}

export async function savePoSettings(next: PoSettings): Promise<PoSettings> {
  const clean = normalizePoSettings(next);
  const { data, error } = await getSupabaseClient()
    .from('options').upsert({ option_name: 'po_settings', option_value: JSON.stringify(clean) }).select('option_name');
  if (error) throw new Error(`The settings were not saved: ${describeDbError(error)}`);
  if (!data?.length) throw new Error('The settings were not saved: changing options needs the manage_options capability (Administrator).');
  setCurrent(clean);
  return clean;
}
