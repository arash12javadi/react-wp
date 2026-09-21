import { describeDbError, getSupabaseClient } from '../../../src/lib/db';
import {
  allTranslationKeys, bundledTranslation, lookupTranslation, registerPluginTranslations,
} from '../../../src/lib/i18n';
import { reloadDatabaseTranslations, translationsMigration } from '../../../src/lib/translations';
import { faPatterns, faPhrases } from './phrases.fa';
import { getPoSettings } from './settings';

/**
 * Site text: translating a whole rendered page by its text, the way TranslatePress does for
 * WordPress. Every phrase is a core translation key, `phrase.<hash of the text>`, so:
 *   - the strings load with core's others before the first render (initDatabaseTranslations);
 *   - they are listed, imported and exported under Settings → Translations like any key;
 *   - a phrase saved there beats the bundled Farsi below, exactly as for core keys.
 * The original text is kept in rwp_translations.source_text, so the admin always sees it.
 *
 * This file is the pure part (keys, matching, dates, digits). lib/pageTranslator.ts applies it
 * to the DOM.
 */

export const phraseGroup = 'phrases';
export const phrasePrefix = 'phrase.';
export const maxPhraseLength = 2000;

/** Whitespace collapsed and trimmed: how a phrase is matched, whatever the markup indentation. */
export const normalizePhrase = (text: string) => text.replace(/\s+/g, ' ').trim();

/** cyrb53: fast, stable across browsers and Node, 53 bits (a collision needs ~10⁸ phrases). */
export function hashPhrase(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const phraseKey = (text: string) => `${phrasePrefix}${hashPhrase(normalizePhrase(text))}`;

/** Letters of some script, so "—", "2026" and "→" are not phrases. */
export const hasLetters = (text: string) => /\p{L}/u.test(text);

// Patterns ----------------------------------------------------------------------------------------------

interface CompiledPattern { regex: RegExp; names: string[]; target: string }

const patterns = new Map<string, CompiledPattern[]>();

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function compilePattern(source: string, target: string): CompiledPattern | null {
  const names: string[] = [];
  const parts = source.split(/\{(\w+)\}/g);
  if (parts.length < 3) return null;
  const regex = parts.map((part, index) => {
    if (index % 2 === 0) return escapeRegex(part);
    names.push(part);
    return '(.+?)';
  }).join('');
  return { regex: new RegExp(`^${regex}$`, 'u'), names, target };
}

const addPattern = (locale: string, source: string, target: string) => {
  const compiled = compilePattern(normalizePhrase(source), normalizePhrase(target));
  if (!compiled) return;
  const list = patterns.get(locale) || [];
  // Longer literal text first, so "Search results for “{term}”" wins over a vaguer one.
  list.push(compiled);
  list.sort((a, b) => b.regex.source.length - a.regex.source.length);
  patterns.set(locale, list);
};

/** An exact phrase translation for one locale, or undefined. */
export const exactPhrase = (locale: string, text: string) => lookupTranslation(locale, phraseKey(text));

function matchPattern(locale: string, text: string): string | undefined {
  for (const { regex, names, target } of patterns.get(locale) || []) {
    const match = text.match(regex);
    if (!match) continue;
    return names.reduce((result, name, index) => {
      const value = match[index + 1];
      // A captured value that is itself a phrase (a category name, the site title) is translated too.
      return result.split(`{${name}}`).join(exactPhrase(locale, value) ?? value);
    }, target);
  }
  return undefined;
}

// Dates and digits ------------------------------------------------------------------------------------------

const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthPattern = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?';
const usDate = new RegExp(`\\b${monthPattern} (\\d{1,2}), (\\d{4})\\b`, 'g');
const gbDate = new RegExp(`\\b(\\d{1,2}) ${monthPattern},? (\\d{4})\\b`, 'g');
const monthYear = new RegExp(`\\b${monthPattern},? (\\d{4})\\b`, 'g');
const numericDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

const monthIndex = (name: string) => months.findIndex((month) => month.startsWith(name.toLowerCase().replace('.', '').slice(0, 3)));

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatter = (locale: string, options: Intl.DateTimeFormatOptions) => {
  const id = `${locale}|${JSON.stringify(options)}`;
  if (!formatters.has(id)) {
    try {
      formatters.set(id, new Intl.DateTimeFormat(locale, options));
    } catch {
      formatters.set(id, new Intl.DateTimeFormat(undefined, options));
    }
  }
  return formatters.get(id)!;
};

const longDate: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };

/** A date in the locale's own calendar and digits: Persian uses the Solar Hijri calendar. */
export const formatLocalDate = (date: Date, locale: string, options: Intl.DateTimeFormatOptions = longDate) =>
  (Number.isNaN(date.getTime()) ? '' : formatter(locale, options).format(date));

/**
 * Rewrites English dates inside a text: "September 21, 2026", "21 September 2026", "Sep 2026" and,
 * when it is the whole text, "9/21/2026" (what toLocaleDateString() gives in an en-US browser).
 * Noon UTC, so no time zone moves a date to the day before.
 */
export function localizeDates(text: string, locale: string): string {
  const numeric = text.trim().match(numericDate);
  if (numeric) {
    const date = new Date(Date.UTC(Number(numeric[3]), Number(numeric[1]) - 1, Number(numeric[2]), 12));
    return formatLocalDate(date, locale, { year: 'numeric', month: 'numeric', day: 'numeric' }) || text;
  }
  const at = (year: string, month: string, day: string) => new Date(Date.UTC(Number(year), monthIndex(month), Number(day), 12));
  let result = text.replace(usDate, (whole, month: string, day: string, year: string) => formatLocalDate(at(year, month, day), locale) || whole);
  result = result.replace(gbDate, (whole, day: string, month: string, year: string) => formatLocalDate(at(year, month, day), locale) || whole);
  result = result.replace(monthYear, (whole, month: string, year: string) =>
    formatLocalDate(at(year, month, '1'), locale, { year: 'numeric', month: 'long' }) || whole);
  return result;
}

const persianDigits = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Persian digits for numbers standing on their own. Digits touching Latin letters, @, _, / or #
 * (an email, a code, a version, a hashtag) are left alone.
 */
export const toPersianDigits = (text: string) =>
  text.replace(/(?<![A-Za-z@_/#\\-])\d+(?:[.,:]\d+)*(?![A-Za-z@_/#\\-])/g, (number) => number
    .replace(/\d/g, (digit) => persianDigits[Number(digit)])
    // 1,250.5 -> ۱٬۲۵۰٫۵: the Persian thousands and decimal separators. A time (12:30) keeps its colon.
    .replace(/,(?=[۰-۹]{3}(?![۰-۹]))/g, '٬')
    .replace(/\.(?=[۰-۹])/g, '٫'));

// The whole pipeline -------------------------------------------------------------------------------------

export interface TranslationResult {
  /** The text to show. Equal to the input when nothing applies. */
  text: string;
  /** Whether a phrase or pattern matched (not just a date or digit change). */
  translated: boolean;
}

/**
 * The text to show for `source` while `locale` is active: an exact phrase, else a pattern, then
 * dates and digits. The source's own leading and trailing whitespace is kept, and a source that
 * nothing applies to comes back untouched (not even re-spaced).
 */
export function translateText(source: string, locale: string): TranslationResult {
  const core = normalizePhrase(source);
  if (!core) return { text: source, translated: false };
  const settings = getPoSettings();
  let result = core;
  let translated = false;
  if (hasLetters(core) && core.length <= maxPhraseLength) {
    const found = exactPhrase(locale, core) ?? matchPattern(locale, core);
    if (found !== undefined) {
      result = found;
      translated = true;
    }
  }
  if (settings.localize_dates && !locale.startsWith('en') && /\d{4}/.test(result)) result = localizeDates(result, locale);
  if (settings.persian_digits && locale === 'fa' && /\d/.test(result)) result = toPersianDigits(result);
  if (result === core) return { text: source, translated: false };
  const lead = source.match(/^\s*/)![0];
  const trail = source.match(/\s*$/)![0];
  return { text: `${lead}${result}${trail}`, translated };
}

// Bundled phrases ----------------------------------------------------------------------------------------------

/** en text -> fa, as shipped. Exported for the Site text screen. */
export const bundledFaPhrases = new Map(faPhrases.map(([en, fa]) => [normalizePhrase(en), fa]));

/**
 * Registers the bundled Farsi, and derives more from core's own dictionaries: any core key with
 * both an English and a Persian string becomes a phrase (or a pattern when it has {placeholders}),
 * so English that a component hard-codes with the same wording is covered too.
 * The English side is registered as well, so the Translations screen can show the original.
 */
export function registerBundledPhrases(): () => void {
  const fa: Record<string, string> = {};
  const en: Record<string, string> = {};
  const add = (english: string, farsi: string) => {
    const source = normalizePhrase(english);
    if (!source || !farsi) return;
    if (/\{\w+\}/.test(source)) {
      addPattern('fa', source, farsi);
      return;
    }
    fa[phraseKey(source)] = farsi;
    en[phraseKey(source)] = source;
  };
  allTranslationKeys()
    .filter((key) => !key.startsWith(phrasePrefix))
    .forEach((key) => {
      const english = bundledTranslation('en', key);
      const farsi = bundledTranslation('fa', key);
      if (english && farsi) add(english, farsi);
    });
  // After core's, so the curated wording below wins where both exist.
  faPhrases.forEach(([english, farsi]) => add(english, farsi));
  faPatterns.forEach(([english, farsi]) => addPattern('fa', english, farsi));
  const unregister = registerPluginTranslations('persian-origins-phrases', { fa, en });
  return () => {
    unregister();
    patterns.clear();
  };
}

// Saving from the page or the admin --------------------------------------------------------------------------------

export const describePhraseError = (error: unknown) => {
  const message = describeDbError(error);
  if (/rwp_translations/.test(message) && /schema cache|does not exist|PGRST205|42P01/i.test(message)) {
    return `Site text is stored in core's translations table, which does not exist yet. Run ${translationsMigration} in Supabase → SQL Editor, then reload.`;
  }
  if (/row-level security|42501/i.test(message)) return 'The database refused the change: translating site text needs the manage_options capability (Administrator).';
  return message;
};

/**
 * Saves (or, with an empty value, marks untranslated) the translation of one phrase, keeping
 * its original text, then reloads the strings so the open page updates at once.
 */
export async function savePhrase(source: string, locale: string, value: string): Promise<void> {
  const text = normalizePhrase(source).slice(0, maxPhraseLength);
  const { data, error } = await getSupabaseClient().from('rwp_translations').upsert({
    translation_key: phraseKey(text),
    locale,
    translation_value: value.trim() ? value.trim() : null,
    source_text: text,
    group_name: phraseGroup,
  }, { onConflict: 'translation_key,locale' }).select('id');
  if (error) throw new Error(describePhraseError(error));
  if (!data?.length) throw new Error('The translation was not saved: translating site text needs the manage_options capability (Administrator).');
  await reloadDatabaseTranslations();
}

/** Removes a saved phrase translation, so the bundled one (or the original) shows again. */
export async function deletePhrase(source: string, locale: string): Promise<void> {
  const { error } = await getSupabaseClient().from('rwp_translations').delete()
    .eq('translation_key', phraseKey(source)).eq('locale', locale).select('id');
  if (error) throw new Error(describePhraseError(error));
  await reloadDatabaseTranslations();
}

/** The pair's target language: where phrases in the first (source) language are translated to. */
export const phraseTarget = () => getPoSettings().languages[1];
export const phraseSource = () => getPoSettings().languages[0];
