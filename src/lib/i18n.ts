import { applyFilters, doAction } from '../core/hooks';
import { describeDbError, getSupabaseClient, updateOption } from './db';
import { coreTranslations } from './locales';

/**
 * Site-wide language, text direction and fonts.
 *
 * This module is deliberately not React: the direction, the `lang` attribute and the font have
 * to be on <html> before the first paint, or every RTL site flashes an LTR layout. App.tsx awaits
 * initI18n() during boot, next to preloadSiteTemplates(), for exactly that reason, and
 * applyStoredLocale() runs at import time so even a failed boot has the right direction.
 *
 * Settings live in four rows of the public `options` table (see the 20260929 migration), not in
 * rwp_app_settings, because the public site needs them before anything else loads and because
 * `options` is the table SetupWizard and the backup/restore already understand.
 */

export type TextDirection = 'ltr' | 'rtl';

export interface LocaleDefinition {
  /** BCP-47-ish code used in `lang`, in URLs and as the dictionary key. */
  code: string;
  /** English name, for the admin. */
  name: string;
  /** The name in its own language, for the public switcher. */
  nativeName: string;
  dir: TextDirection;
  /** CSS font stack applied while this locale is active. */
  fontFamily: string;
  /** Google Fonts stylesheet loaded on demand for the font above. Optional. */
  fontUrl?: string;
  /** For the switcher. A flag is a country, not a language, so these are only a visual hint. */
  flag?: string;
}

/**
 * Vazirmatn is the usual choice for Persian; Noto Naskh Arabic covers Arabic script better than
 * Vazirmatn's Arabic glyphs. Both end in a system fallback so a blocked Google Fonts request
 * still leaves readable text.
 */
export const builtinLocales: Record<string, LocaleDefinition> = {
  en: {
    code: 'en', name: 'English', nativeName: 'English', dir: 'ltr', flag: '🇬🇧',
    fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
  fa: {
    code: 'fa', name: 'Persian', nativeName: 'فارسی', dir: 'rtl', flag: '🇮🇷',
    fontFamily: "'Vazirmatn', 'Segoe UI', Tahoma, sans-serif",
    fontUrl: 'https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap',
  },
  ar: {
    code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl', flag: '🇸🇦',
    fontFamily: "'Noto Naskh Arabic', 'Segoe UI', Tahoma, sans-serif",
    fontUrl: 'https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap',
  },
  fr: {
    code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr', flag: '🇫🇷',
    fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
  de: {
    code: 'de', name: 'German', nativeName: 'Deutsch', dir: 'ltr', flag: '🇩🇪',
    fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
  he: {
    code: 'he', name: 'Hebrew', nativeName: 'עברית', dir: 'rtl', flag: '🇮🇱',
    fontFamily: "'Noto Sans Hebrew', 'Segoe UI', Tahoma, sans-serif",
    fontUrl: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@400;500;600;700&display=swap',
  },
  ur: {
    code: 'ur', name: 'Urdu', nativeName: 'اردو', dir: 'rtl', flag: '🇵🇰',
    fontFamily: "'Noto Nastaliq Urdu', 'Segoe UI', Tahoma, sans-serif",
    fontUrl: 'https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=swap',
  },
  es: {
    code: 'es', name: 'Spanish', nativeName: 'Español', dir: 'ltr', flag: '🇪🇸',
    fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
};

/** Direction for a locale we have no definition for. Keeps unknown codes from breaking a page. */
const rtlPrefixes = ['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb'];

export const directionOf = (code: string): TextDirection => {
  const known = builtinLocales[code];
  if (known) return known.dir;
  const base = code.toLowerCase().split(/[-_]/)[0];
  return rtlPrefixes.includes(base) ? 'rtl' : 'ltr';
};

export const isRtlLocale = (code: string): boolean => directionOf(code) === 'rtl';

export const localeDefinition = (code: string): LocaleDefinition => builtinLocales[code] || {
  code, name: code, nativeName: code, dir: directionOf(code),
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

// Settings ---------------------------------------------------------------------------------------

export interface I18nSettings {
  /** Locale a first-time visitor gets when nothing else matches. */
  default_site_language: string;
  /** Locale the admin dashboard opens in. */
  default_admin_language: string;
  show_header_language_switcher: boolean;
  /** Codes offered in the switcher. The site default is always included. */
  supported_languages: string[];
}

export const i18nOptionNames = [
  'default_site_language', 'default_admin_language', 'show_header_language_switcher', 'supported_languages',
] as const;

export const i18nMigration = 'supabase/migrations/20260929_i18n_hooks.sql';

export const defaultI18nSettings: I18nSettings = {
  default_site_language: 'en',
  default_admin_language: 'en',
  show_header_language_switcher: true,
  supported_languages: ['en'],
};

const parseLanguageList = (raw: string | undefined, fallback: string[]): string[] => {
  if (!raw) return fallback;
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A hand-edited option may be a plain comma-separated list.
    parsed = raw.split(',');
  }
  const codes = (Array.isArray(parsed) ? parsed : [parsed])
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
  return codes.length ? [...new Set(codes)] : fallback;
};

const normalizeSettings = (values: Record<string, string>): I18nSettings => {
  const defaults = defaultI18nSettings;
  const site = (values.default_site_language || defaults.default_site_language).trim().toLowerCase();
  const admin = (values.default_admin_language || defaults.default_admin_language).trim().toLowerCase();
  const supported = parseLanguageList(values.supported_languages, [site]);
  return {
    default_site_language: site,
    default_admin_language: admin,
    // Stored as text, like every other boolean option (see settings.ts).
    show_header_language_switcher: values.show_header_language_switcher === undefined || values.show_header_language_switcher === ''
      ? defaults.show_header_language_switcher
      : values.show_header_language_switcher === 'true' || values.show_header_language_switcher === '1',
    // The defaults must always be offerable, or a visitor could get stuck on a hidden locale.
    supported_languages: [...new Set([...supported, site, admin])],
  };
};

let settings: I18nSettings = defaultI18nSettings;
let settingsPromise: Promise<I18nSettings> | null = null;

export const currentI18nSettings = (): I18nSettings => settings;

export const loadI18nSettings = (force = false): Promise<I18nSettings> => {
  if (!settingsPromise || force) {
    settingsPromise = Promise.resolve(
      getSupabaseClient().from('options').select('option_name,option_value').in('option_name', [...i18nOptionNames]),
    ).then(({ data, error }) => {
      // Missing rows are not an error: a site that never ran the migration is a one-language site.
      if (error) throw new Error(`Could not load the language settings: ${describeDbError(error)}`);
      const values = (data || []).reduce<Record<string, string>>((result, row) => {
        result[row.option_name] = row.option_value;
        return result;
      }, {});
      settings = normalizeSettings(values);
      return settings;
    });
    settingsPromise.catch(() => { settingsPromise = null; });
  }
  return settingsPromise;
};

export const saveI18nSettings = async (next: I18nSettings): Promise<I18nSettings> => {
  const clean = normalizeSettings({
    default_site_language: next.default_site_language,
    default_admin_language: next.default_admin_language,
    show_header_language_switcher: String(next.show_header_language_switcher),
    supported_languages: JSON.stringify(next.supported_languages),
  });
  const results = await Promise.all([
    updateOption('default_site_language', clean.default_site_language),
    updateOption('default_admin_language', clean.default_admin_language),
    updateOption('show_header_language_switcher', clean.show_header_language_switcher),
    updateOption('supported_languages', clean.supported_languages),
  ]);
  if (results.some((saved) => !saved)) {
    throw new Error('The language settings were not saved. Writing options needs the manage_options capability (Administrator).');
  }
  settings = clean;
  settingsPromise = Promise.resolve(clean);
  notifyListeners();
  return clean;
};

/** The locales the switcher offers, as full definitions, after the i18n_supported_locales filter. */
export const supportedLocales = (): LocaleDefinition[] => {
  const codes = applyFilters<string[]>('i18n_supported_locales', settings.supported_languages);
  return [...new Set(codes)].map(localeDefinition);
};

// Dictionaries -------------------------------------------------------------------------------------

export type TranslationDictionary = Record<string, string>;

/** locale code -> flat { 'header.login': 'ورود' } dictionary. */
const dictionaries = new Map<string, TranslationDictionary>();

const mergeInto = (code: string, entries: TranslationDictionary) => {
  const existing = dictionaries.get(code) || {};
  dictionaries.set(code, { ...existing, ...entries });
};

Object.entries(coreTranslations).forEach(([code, entries]) => mergeInto(code, entries));

/**
 * Lets a plugin ship its own strings:
 *
 *   registerPluginTranslations('rwp-shop', { fa: { 'shop.cart': 'سبد خرید' } });
 *
 * Keys should be namespaced with the plugin id to avoid collisions. Returns a function that
 * removes them again, for plugin deactivation.
 */
export function registerPluginTranslations(
  pluginId: string,
  localeData: Record<string, TranslationDictionary>,
): () => void {
  const added: Array<[string, string[]]> = [];
  Object.entries(localeData).forEach(([code, entries]) => {
    const normalized = code.trim().toLowerCase();
    mergeInto(normalized, entries);
    added.push([normalized, Object.keys(entries)]);
  });
  doAction('i18n_translations_registered', pluginId, Object.keys(localeData));
  notifyListeners();
  return () => {
    added.forEach(([code, keys]) => {
      const dictionary = dictionaries.get(code);
      if (!dictionary) return;
      keys.forEach((key) => { delete dictionary[key]; });
    });
    notifyListeners();
  };
}

/** Every key currently known for a locale. Used by the admin to report translation coverage. */
export const translationKeys = (code: string): string[] => Object.keys(dictionaries.get(code) || {});

/** Every key any bundled or plugin dictionary knows, in any language. */
export const allTranslationKeys = (): string[] => [...new Set([...dictionaries.values()].flatMap(Object.keys))];

/** The bundled or plugin string for one key, ignoring database strings. The admin shows it as the default. */
export const bundledTranslation = (code: string, key: string): string | undefined => dictionaries.get(code)?.[key];

/**
 * Strings from the rwp_translations table (Settings → Translations), per locale. Kept apart from
 * `dictionaries` so they always win over core and plugin strings, whatever order things load in,
 * and so replacing them never deletes a bundled string. src/lib/translations.ts fills this.
 */
const databaseStrings = new Map<string, TranslationDictionary>();

export const setDatabaseTranslations = (code: string, entries: TranslationDictionary) => {
  databaseStrings.set(code, entries);
  notifyListeners();
};

type MissingKeyHandler = (key: string, shown: string, locale: string, surface: I18nSurface) => void;
let missingKeyHandler: MissingKeyHandler | null = null;

/** Called by translate() for a key the active locale has no string for. One handler; null removes it. */
export const setMissingKeyHandler = (handler: MissingKeyHandler | null) => { missingKeyHandler = handler; };

// Active locale ---------------------------------------------------------------------------------

export type I18nSurface = 'public' | 'admin';

const storageKey = (surface: I18nSurface) => (surface === 'admin' ? 'rwp_admin_locale' : 'rwp_locale');

let activeLocale = defaultI18nSettings.default_site_language;
let activeSurface: I18nSurface = 'public';
const listeners = new Set<() => void>();
let stateVersion = 0;

const notifyListeners = () => {
  stateVersion += 1;
  listeners.forEach((listener) => listener());
};

export const getLocale = (): string => activeLocale;
export const getSurface = (): I18nSurface => activeSurface;
export const getDirection = (): TextDirection => directionOf(activeLocale);
export const getLocaleVersion = (): number => stateVersion;

export const subscribeLocale = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const readStored = (surface: I18nSurface): string => {
  try {
    return localStorage.getItem(storageKey(surface)) || '';
  } catch {
    // Private mode, or storage blocked. The site default then decides on every load.
    return '';
  }
};

const writeStored = (surface: I18nSurface, code: string) => {
  try {
    localStorage.setItem(storageKey(surface), code);
  } catch {
    // Not fatal: the choice just does not survive a reload.
  }
};

/** The first browser language that matches something we can show, e.g. "fa-IR" -> "fa". */
const fromBrowser = (available: string[]): string => {
  if (typeof navigator === 'undefined') return '';
  const preferences = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const preference of preferences || []) {
    if (!preference) continue;
    const lower = preference.toLowerCase();
    const exact = available.find((code) => code === lower);
    if (exact) return exact;
    const base = lower.split(/[-_]/)[0];
    const loose = available.find((code) => code.split(/[-_]/)[0] === base);
    if (loose) return loose;
  }
  return '';
};

// Fonts and document attributes ------------------------------------------------------------------

const loadedFonts = new Set<string>();

const loadFont = (definition: LocaleDefinition) => {
  if (!definition.fontUrl || loadedFonts.has(definition.fontUrl) || typeof document === 'undefined') return;
  if (document.querySelector(`link[data-rwp-font][href="${definition.fontUrl}"]`)) {
    loadedFonts.add(definition.fontUrl);
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = definition.fontUrl;
  link.dataset.rwpFont = definition.code;
  // A blocked or offline font must not hold up anything; the stack falls back to system fonts.
  link.addEventListener('error', () => console.warn(`The ${definition.name} web font could not be loaded; the system font is used instead.`));
  document.head.appendChild(link);
  loadedFonts.add(definition.fontUrl);
};

/**
 * Writes the locale onto the document: `lang`, `dir`, the direction classes Custom CSS can target
 * and `--rwp-font-family`, which src/index.css feeds into body and the admin.
 */
export const applyDocumentLocale = (code: string) => {
  if (typeof document === 'undefined') return;
  const definition = localeDefinition(code);
  const root = document.documentElement;
  root.lang = definition.code;
  root.dir = definition.dir;
  root.dataset.rwpLocale = definition.code;
  root.classList.toggle('rwp-rtl', definition.dir === 'rtl');
  root.classList.toggle('rwp-ltr', definition.dir === 'ltr');
  root.style.setProperty('--rwp-font-family', definition.fontFamily);
  loadFont(definition);
};

// Switching ----------------------------------------------------------------------------------------

/**
 * Changes the active language. Everything built on useTranslation() re-renders; nothing reloads,
 * so an unsaved form is not lost. `persist: false` is for previews (the theme and builder editors).
 */
export const setLocale = (code: string, options: { persist?: boolean } = {}) => {
  const requested = String(code || '').trim().toLowerCase();
  if (!requested) return;
  const next = applyFilters<string>('i18n_locale', requested, activeSurface);
  if (options.persist !== false) writeStored(activeSurface, next);
  if (next === activeLocale) return;
  const previous = activeLocale;
  activeLocale = next;
  applyDocumentLocale(next);
  notifyListeners();
  doAction('i18n_locale_changed', next, previous);
};

/**
 * Best guess from what is available synchronously (URL, localStorage, browser), so the document
 * has a direction before the settings request comes back. Runs at import time.
 */
export const applyStoredLocale = (surface: I18nSurface = 'public') => {
  activeSurface = surface;
  let stored = readStored(surface);
  if (typeof window !== 'undefined') {
    const requested = new URLSearchParams(window.location.search).get('lang');
    if (requested) {
      stored = requested.trim().toLowerCase();
      writeStored(surface, stored);
    }
  }
  if (stored) {
    activeLocale = stored;
    applyDocumentLocale(stored);
  }
};

/**
 * Loads the settings and settles on the final locale. Awaited in App.tsx before the first render.
 * A site without the migration resolves to the defaults and behaves as a single-language site.
 */
export const initI18n = async (surface: I18nSurface = 'public'): Promise<string> => {
  activeSurface = surface;
  const loaded = await loadI18nSettings().catch(() => defaultI18nSettings);
  const available = loaded.supported_languages;
  const fallback = surface === 'admin' ? loaded.default_admin_language : loaded.default_site_language;
  const stored = readStored(surface);
  // A stored choice that is no longer offered must not strand the visitor on a dead language.
  const chosen = (stored && available.includes(stored) && stored)
    || fromBrowser(available)
    || fallback;
  const resolved = applyFilters<string>('i18n_locale', chosen, surface);
  activeLocale = resolved;
  applyDocumentLocale(resolved);
  notifyListeners();
  doAction('i18n_ready', resolved, loaded);
  return resolved;
};

// Translation --------------------------------------------------------------------------------------

const interpolate = (template: string, vars?: Record<string, string | number>): string => {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
};

/** A database string for the locale, then the bundled or plugin one. */
const lookup = (code: string, key: string): string | undefined =>
  databaseStrings.get(code)?.[key] ?? dictionaries.get(code)?.[key];

/**
 * The string for a key in one locale only: a database string, else a bundled or plugin one, else
 * undefined. No fallback, no filter and no missing-key report, so a caller can ask "is there a
 * translation?" for thousands of keys without side effects (Persian Origins' page translation).
 */
export const lookupTranslation = (code: string, key: string): string | undefined => lookup(code, key);

/**
 * Translates one key for the active locale.
 *
 *   t('header.login', 'Log in')
 *   t('comments.count', '{count} comments', { count: 3 })
 *
 * Resolution order: active locale -> site default -> English -> the fallback you passed -> the key
 * itself. Within each locale, a string edited under Settings → Translations beats the bundled one.
 * The key is the last resort on purpose: a visible `header.login` on the page is a much clearer
 * bug report than an empty element.
 *
 * The result goes through the `i18n_translate_key` filter, which is how a plugin overrides core
 * wording without shipping a whole dictionary.
 */
export function translate(key: string, fallback?: string, vars?: Record<string, string | number>): string {
  const own = lookup(activeLocale, key);
  const found = own
    ?? lookup(settings.default_site_language, key)
    ?? lookup('en', key)
    ?? fallback
    ?? key;
  // Reported before the filter: a plugin filling the gap does not make the key translated.
  if (own === undefined && missingKeyHandler) missingKeyHandler(key, found, activeLocale, activeSurface);
  const filtered = applyFilters<string>('i18n_translate_key', found, key, activeLocale, vars);
  return interpolate(filtered, vars);
}

/** The non-React entry point, for modules that run outside a component (server-ish helpers, stores). */
export const t = translate;

/** Formats a date in the active locale, falling back to the browser default for unknown codes. */
export const formatDate = (value: string | number | Date, options?: Intl.DateTimeFormatOptions): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(activeLocale, options || { dateStyle: 'medium' }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
};

/** Formats a number in the active locale (Persian and Arabic digits, grouping separators). */
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions): string => {
  try {
    return new Intl.NumberFormat(activeLocale, options).format(value);
  } catch {
    return String(value);
  }
};

// Applied as early as the module is imported, so a slow settings request cannot cause an
// RTL site to paint left-to-right first.
if (typeof window !== 'undefined') {
  applyStoredLocale(window.location.pathname.replace(/\/+$/, '') === '/admin' ? 'admin' : 'public');
}
