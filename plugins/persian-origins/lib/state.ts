import { addAction } from '../../../src/core/hooks';
import { tryGetSupabaseClient } from '../../../src/lib/db';
import {
  currentI18nSettings, directionOf, getLocale, getSurface, localeDefinition, setLocale, subscribeLocale,
} from '../../../src/lib/i18n';
import { ensureFontLoaded, findFont, injectFontFaces } from '../fontLoader';
import { getPoSettings, loadPoSettings, subscribePoSettings, type PoSettings } from './settings';

/**
 * The plugin's runtime: one store for what a visitor chose.
 *
 * The language is NOT stored here. It is core's locale (src/lib/i18n.ts): the same one the
 * header switcher, `?lang=`, `t()`, the Page Builder's per-language layouts and `dir` on <html>
 * follow. A second language state would let the two disagree. The switch calls core's
 * setLocale(); this module mirrors the result into body classes, the po_preferred_language
 * cookie and the poLangChange event.
 *
 * What is stored here — theme, a font per language, text size — is written to cookies (and
 * localStorage), and for a signed-in visitor also to po_user_preferences, so it follows them.
 *
 * Only the public site is restyled. The admin shares the bundle, and a dark admin or a
 * visitor-chosen font in the dashboard is not what anyone asked for.
 */

export type PoTheme = 'light' | 'dark';

export interface PoState {
  theme: PoTheme;
  /** language -> font slug. Missing means the admin's default for that language. */
  fonts: Record<string, string>;
  /** Text size in percent of the browser default. */
  fontSize: number;
}

export const fontSizeLimits = { min: 80, max: 150, step: 10, base: 100 };

const cookieNames = { language: 'po_preferred_language', theme: 'po_site_theme', fontSize: 'po_font_size_percent' };
const fontCookie = (language: string) => `po_font_${language}`;
const yearInSeconds = 60 * 60 * 24 * 365;

export const readCookie = (name: string): string => {
  if (typeof document === 'undefined') return '';
  const found = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`));
  if (!found) return '';
  try {
    return decodeURIComponent(found.slice(name.length + 1));
  } catch {
    return '';
  }
};

export const writeCookie = (name: string, value: string) => {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${yearInSeconds}; SameSite=Lax${secure}`;
};

const readLocal = (key: string): string => {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

const writeLocal = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The cookie written next to it still carries the choice.
  }
};

/** Cookie first (it survives blocked storage), then localStorage. */
const readStored = (name: string) => readCookie(name) || readLocal(name);
const writeStored = (name: string, value: string) => {
  writeCookie(name, value);
  writeLocal(name, value);
};

const clampSize = (value: number) => Math.min(fontSizeLimits.max, Math.max(fontSizeLimits.min, Math.round(value)));

const systemTheme = (): PoTheme =>
  (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

const themeFromSettings = (settings: PoSettings): PoTheme =>
  (settings.default_theme === 'system' ? systemTheme() : settings.default_theme);

/** Which choices the visitor made themselves, so a later default or server copy does not override them. */
const chosen = { theme: false, fontSize: false, fonts: new Set<string>() };

const initialState = (): PoState => {
  const settings = getPoSettings();
  const storedTheme = readStored(cookieNames.theme);
  chosen.theme = storedTheme === 'light' || storedTheme === 'dark';
  const storedSize = Number(readStored(cookieNames.fontSize));
  chosen.fontSize = Number.isFinite(storedSize) && storedSize > 0;
  const fonts: Record<string, string> = {};
  settings.languages.forEach((language) => {
    const stored = readStored(fontCookie(language));
    if (stored) {
      fonts[language] = stored;
      chosen.fonts.add(language);
    }
  });
  return {
    theme: chosen.theme ? storedTheme as PoTheme : themeFromSettings(settings),
    fonts,
    fontSize: chosen.fontSize ? clampSize(storedSize) : fontSizeLimits.base,
  };
};

let state: PoState = initialState();
let version = 0;
const listeners = new Set<() => void>();

export const getPoState = () => state;
export const getPoVersion = () => version;
export const subscribePoState = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const emit = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};

// Language ---------------------------------------------------------------------------------------------

/** The two languages the switch toggles between. */
export const poLanguages = () => getPoSettings().languages;

/** The other language of the pair; the first one when the active locale is neither. */
export const otherLanguage = (active = getLocale()) => {
  const [first, second] = poLanguages();
  return active === first ? second : first;
};

export const setLanguage = (code: string) => setLocale(code);
export const toggleLanguage = () => setLocale(otherLanguage());

// Appearance ---------------------------------------------------------------------------------------------

export const effectiveFont = (language: string) =>
  findFont(language, state.fonts[language] || getPoSettings().default_fonts[language]);

const isPublic = () => getSurface() === 'public';

const bodyClassPrefix = /^po-(lang|dir|theme|font)-/;

/**
 * Writes body classes and the two CSS properties on <html>. Runs after every language change,
 * after core has written its own `--rwp-font-family` for the new locale, so the chosen font wins.
 */
export function applyDocument() {
  if (typeof document === 'undefined' || !document.body || !isPublic()) return;
  const active = getLocale();
  const direction = directionOf(active);
  const [first, second] = poLanguages();
  const classes = [
    `po-lang-${active}`,
    `po-dir-${direction}`,
    `po-theme-${state.theme}`,
    // The CSS in styles.css shows the base variant when the active language is not one of the pair.
    ...(active === first || active === second ? [] : ['po-lang-fallback']),
    ...[first, second].map((language) => `po-font-${language}-${effectiveFont(language).slug}`),
  ];
  const body = document.body;
  [...body.classList].filter((name) => bodyClassPrefix.test(name) || name === 'po-lang-fallback').forEach((name) => body.classList.remove(name));
  body.classList.add(...classes);

  const root = document.documentElement;
  const font = effectiveFont(active);
  ensureFontLoaded(font);
  // 'Site default' puts back the locale's own font, which core would otherwise have set.
  root.style.setProperty('--rwp-font-family', font.stack || localeDefinition(active).fontFamily);
  root.style.setProperty('--po-font-size', `${state.fontSize}%`);
  root.classList.toggle('po-text-scaled', state.fontSize !== fontSizeLimits.base);
  root.style.colorScheme = state.theme;
}

let saveTimer: number | undefined;

const update = (patch: Partial<PoState>) => {
  state = { ...state, ...patch };
  applyDocument();
  emit();
  queueServerSave();
};

export const setTheme = (theme: PoTheme) => {
  chosen.theme = true;
  writeStored(cookieNames.theme, theme);
  update({ theme });
};

export const setFont = (language: string, slug: string) => {
  chosen.fonts.add(language);
  writeStored(fontCookie(language), slug);
  update({ fonts: { ...state.fonts, [language]: slug } });
};

export const setFontSize = (percent: number) => {
  const fontSize = clampSize(percent);
  chosen.fontSize = true;
  writeStored(cookieNames.fontSize, String(fontSize));
  update({ fontSize });
};

export const stepFontSize = (direction: 1 | -1) => setFontSize(state.fontSize + direction * fontSizeLimits.step);
export const resetFontSize = () => setFontSize(fontSizeLimits.base);

// Signed-in visitors: po_user_preferences ------------------------------------------------------------

interface ServerPreferences { language?: string; theme?: PoTheme; fonts?: Record<string, string>; fontSize?: number }

let signedInUser: string | null = null;
/** Whether a language was chosen in this browser before; decides if the account's copy may apply. */
const hadLanguageCookie = Boolean(readCookie(cookieNames.language));

function queueServerSave() {
  if (!signedInUser || typeof window === 'undefined') return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const supabase = tryGetSupabaseClient();
    if (!supabase || !signedInUser) return;
    const preferences: ServerPreferences = { language: getLocale(), theme: state.theme, fonts: state.fonts, fontSize: state.fontSize };
    void supabase.from('po_user_preferences').upsert({ user_id: signedInUser, preferences }).select('user_id')
      .then(({ error }) => {
        // Not worth interrupting a visitor over: the cookies still hold every choice.
        if (error) console.warn(`Display preferences were not saved to your account: ${error.message}`);
      });
  }, 800);
}

/** Applies the account's saved choices, except those this browser already made itself. */
async function loadServerPreferences(userId: string) {
  signedInUser = userId;
  const supabase = tryGetSupabaseClient();
  if (!supabase) return;
  const { data, error } = await supabase.from('po_user_preferences').select('preferences').eq('user_id', userId).maybeSingle();
  if (error || !data) return;
  const saved = (data.preferences || {}) as ServerPreferences;
  const patch: Partial<PoState> = {};
  if (!chosen.theme && (saved.theme === 'light' || saved.theme === 'dark')) patch.theme = saved.theme;
  if (!chosen.fontSize && typeof saved.fontSize === 'number') patch.fontSize = clampSize(saved.fontSize);
  if (saved.fonts && typeof saved.fonts === 'object') {
    const fonts = { ...state.fonts };
    Object.entries(saved.fonts).forEach(([language, slug]) => { if (!chosen.fonts.has(language)) fonts[language] = String(slug); });
    patch.fonts = fonts;
  }
  state = { ...state, ...patch };
  applyDocument();
  emit();
  const language = saved.language;
  if (!hadLanguageCookie && language && language !== getLocale() && currentI18nSettings().supported_languages.includes(language)) {
    setLocale(language);
  }
}

// Start and stop ---------------------------------------------------------------------------------------

let lastLanguage = '';

/** Mirrors a language change into the cookie, the body classes and the poLangChange event. */
const onLocaleChange = () => {
  applyDocument();
  const active = getLocale();
  if (active === lastLanguage) return;
  const previous = lastLanguage;
  lastLanguage = active;
  if (!isPublic()) return;
  writeCookie(cookieNames.language, active);
  if (previous) queueServerSave();
  document.dispatchEvent(new CustomEvent('poLangChange', {
    bubbles: true,
    detail: { lang: active, previous: previous || null, dir: directionOf(active) },
  }));
  emit();
};

/**
 * Starts the runtime. Returns the cleanup that removes every class, property, listener and
 * style it added, for plugin deactivation and HMR.
 */
export function startRuntime(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const cleanups: Array<() => void> = [];

  cleanups.push(injectFontFaces());
  lastLanguage = getLocale();
  applyDocument();

  cleanups.push(subscribeLocale(onLocaleChange));
  cleanups.push(subscribePoSettings(() => {
    // A new default only applies to what the visitor has not chosen.
    if (!chosen.theme) state = { ...state, theme: themeFromSettings(getPoSettings()) };
    applyDocument();
    emit();
  }));

  // Cookie fallback for browsers where core could not keep the choice in localStorage: once core
  // has settled on a locale (before the first render), restore the one the cookie remembers.
  cleanups.push(addAction('i18n_ready', (resolved: unknown) => {
    const cookie = readCookie(cookieNames.language);
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (isPublic() && !fromUrl && cookie && cookie !== resolved && currentI18nSettings().supported_languages.includes(cookie)) {
      setLocale(cookie);
    }
  }));

  // "system" follows the operating system while the visitor has not picked a theme.
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const onSystemTheme = () => {
    if (chosen.theme || getPoSettings().default_theme !== 'system') return;
    state = { ...state, theme: systemTheme() };
    applyDocument();
    emit();
  };
  media?.addEventListener?.('change', onSystemTheme);
  cleanups.push(() => media?.removeEventListener?.('change', onSystemTheme));

  void loadPoSettings();

  const supabase = tryGetSupabaseClient();
  if (supabase && isPublic()) {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) void loadServerPreferences(data.session.user.id);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Deferred: a Supabase request made inside this callback can deadlock the auth client.
      if (event === 'SIGNED_IN' && session?.user && session.user.id !== signedInUser) {
        const userId = session.user.id;
        window.setTimeout(() => void loadServerPreferences(userId), 0);
      }
      if (event === 'SIGNED_OUT') signedInUser = null;
    });
    cleanups.push(() => listener.subscription.unsubscribe());
  }

  return () => {
    cleanups.forEach((cleanup) => cleanup());
    window.clearTimeout(saveTimer);
    const body = document.body;
    if (body) [...body.classList].filter((name) => bodyClassPrefix.test(name) || name === 'po-lang-fallback').forEach((name) => body.classList.remove(name));
    const root = document.documentElement;
    root.classList.remove('po-text-scaled');
    root.style.removeProperty('--po-font-size');
    root.style.removeProperty('color-scheme');
    // Hand the font back to core.
    root.style.setProperty('--rwp-font-family', localeDefinition(getLocale()).fontFamily);
  };
}
