import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  currentI18nSettings, formatDate, formatNumber, getDirection, getLocale, getLocaleVersion,
  initI18n, localeDefinition, setLocale as setActiveLocale, subscribeLocale, supportedLocales,
  translate, type I18nSettings, type I18nSurface, type LocaleDefinition, type TextDirection,
} from '../lib/i18n';
import { initDatabaseTranslations } from '../lib/translations';

/**
 * The React face of src/lib/i18n.ts.
 *
 * The provider owns no state of its own: it subscribes to the i18n store, so a language changed
 * from anywhere (the switcher, a plugin, a deep link with ?lang=) re-renders every consumer at
 * once and stays consistent with the `dir` and `lang` already written on <html>.
 */

export interface I18nContextValue {
  locale: string;
  /** The full definition of the active locale (name, direction, font). */
  definition: LocaleDefinition;
  dir: TextDirection;
  isRtl: boolean;
  /** Locales the site offers, after the i18n_supported_locales filter. */
  locales: LocaleDefinition[];
  settings: I18nSettings;
  /** t('header.login', 'Log in') — see translate() for the fallback order. */
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string;
  setLocale: (code: string) => void;
  formatDate: typeof formatDate;
  formatNumber: typeof formatNumber;
  /** False until the settings, the final locale and its Settings → Translations strings have loaded. */
  ready: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** Re-renders the caller whenever the locale, the settings or a dictionary changes. */
const useLocaleVersion = () => useSyncExternalStore(subscribeLocale, getLocaleVersion, getLocaleVersion);

export function I18nProvider({ children, surface = 'public' }: { children: ReactNode; surface?: I18nSurface }) {
  const version = useLocaleVersion();
  // App.tsx already awaits initI18n() during boot; this covers anything mounted on its own
  // (the page builder route, a test harness) and is a no-op the second time.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    // Ready once the Settings → Translations strings are in too (a no-op when boot loaded them).
    void initI18n(surface)
      .then(() => initDatabaseTranslations())
      .catch(() => undefined)
      .finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, [surface]);

  const setLocale = useCallback((code: string) => setActiveLocale(code), []);

  const value = useMemo<I18nContextValue>(() => {
    const locale = getLocale();
    const definition = localeDefinition(locale);
    return {
      locale,
      definition,
      dir: getDirection(),
      isRtl: getDirection() === 'rtl',
      locales: supportedLocales(),
      settings: currentI18nSettings(),
      t: translate,
      setLocale,
      formatDate,
      formatNumber,
      ready,
    };
    // `version` is the subscription: it is what makes this recompute after a change.
  }, [version, ready, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Works with or without a provider above it. Without one it still reads the live store, so a
 * component rendered outside the app tree (a portal, a plugin's own root) translates correctly
 * instead of throwing — it just will not re-render on a language change.
 */
export function useTranslation(): I18nContextValue {
  const fromContext = useContext(I18nContext);
  const version = useLocaleVersion();
  const standalone = useMemo<I18nContextValue>(() => {
    const locale = getLocale();
    return {
      locale,
      definition: localeDefinition(locale),
      dir: getDirection(),
      isRtl: getDirection() === 'rtl',
      locales: supportedLocales(),
      settings: currentI18nSettings(),
      t: translate,
      setLocale: (code: string) => setActiveLocale(code),
      formatDate,
      formatNumber,
      ready: true,
    };
  }, [version]);
  return fromContext || standalone;
}

/** Just the direction, for components that only need to flip an icon or a transform. */
export const useDirection = (): { dir: TextDirection; isRtl: boolean } => {
  const { dir, isRtl } = useTranslation();
  return { dir, isRtl };
};

export default I18nProvider;
