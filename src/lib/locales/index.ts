import type { TranslationDictionary } from '../i18n';
import en from './en';
import fa from './fa';
import ar from './ar';

/**
 * Core's own strings. Plugins add theirs at runtime with registerPluginTranslations(), so this
 * file never needs to know about them.
 *
 * English is the reference: every key here exists in en.ts, and a missing key in another locale
 * falls back to it rather than showing the raw key.
 */
export const coreTranslations: Record<string, TranslationDictionary> = { en, fa, ar };

export type CoreTranslationKey = keyof typeof en;
