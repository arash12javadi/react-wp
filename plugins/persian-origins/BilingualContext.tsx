import { useSyncExternalStore } from 'react';
import { useTranslation } from '../../src/context/I18nContext';
import { fontCatalog, type FontChoice } from './fontLoader';
import { getPoSettings, subscribePoSettings, type PoSettings } from './lib/settings';
import {
  effectiveFont, fontSizeLimits, getPoState, getPoVersion, otherLanguage, resetFontSize, setFont, setFontSize,
  setLanguage, setTheme, stepFontSize, subscribePoState, toggleLanguage, type PoState, type PoTheme,
} from './lib/state';

/**
 * React access to the plugin's state. A hook over a store rather than a Provider: shortcodes are
 * portalled into page HTML, floating controls sit in a layout slot, and the header item lives in
 * core's header, so there is no single tree to wrap. Every caller re-renders when the language
 * (through useTranslation), a display choice or the plugin settings change.
 */

export interface BilingualValue {
  /** Core's active locale. */
  lang: string;
  dir: 'ltr' | 'rtl';
  /** The pair the switch toggles between. */
  languages: [string, string];
  /** Where a click on the switch leads. */
  otherLanguage: string;
  setLanguage: (code: string) => void;
  toggleLanguage: () => void;
  theme: PoTheme;
  setTheme: (theme: PoTheme) => void;
  toggleTheme: () => void;
  fontSize: number;
  fontSizeLimits: typeof fontSizeLimits;
  setFontSize: (percent: number) => void;
  stepFontSize: (direction: 1 | -1) => void;
  resetFontSize: () => void;
  /** The font in effect for a language (the visitor's, else the admin default, else the site's). */
  fontFor: (language: string) => FontChoice;
  fontCatalog: (language: string) => FontChoice[];
  setFont: (language: string, slug: string) => void;
  settings: PoSettings;
  t: ReturnType<typeof useTranslation>['t'];
  locales: ReturnType<typeof useTranslation>['locales'];
}

const useStore = () => {
  useSyncExternalStore(subscribePoState, getPoVersion, getPoVersion);
  return getPoState();
};

const useSettings = () => useSyncExternalStore(subscribePoSettings, getPoSettings, getPoSettings);

export function useBilingual(): BilingualValue {
  const { locale, dir, t, locales } = useTranslation();
  const state: PoState = useStore();
  const settings = useSettings();
  return {
    lang: locale,
    dir,
    languages: settings.languages,
    otherLanguage: otherLanguage(locale),
    setLanguage,
    toggleLanguage,
    theme: state.theme,
    setTheme,
    toggleTheme: () => setTheme(state.theme === 'dark' ? 'light' : 'dark'),
    fontSize: state.fontSize,
    fontSizeLimits,
    setFontSize,
    stepFontSize,
    resetFontSize,
    fontFor: effectiveFont,
    fontCatalog,
    setFont,
    settings,
    t,
    locales,
  };
}
