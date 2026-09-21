import { describeDbError, getSupabaseClient, tryGetSupabaseClient } from './db';
import {
  currentI18nSettings, getLocale, setDatabaseTranslations, setMissingKeyHandler, subscribeLocale,
  translate, type I18nSurface, type TranslationDictionary,
} from './i18n';

/**
 * Settings → Translations: interface strings stored in public.rwp_translations.
 *
 * This is a data source for the one translate() in src/lib/i18n.ts, not a second i18n system.
 * Database strings sit above core's bundled dictionaries and plugin dictionaries, so an
 * administrator can reword any key (core, plugin, shortcode, builder widget) without a code
 * change. The i18n_translate_key filter still runs last, after all of them.
 *
 * Rows with a null translation_value are keys the site discovered but nobody has translated
 * yet. They are never applied: discovering a key must not change what visitors see.
 */

export const translationsMigration = 'supabase/migrations/20261003_translations.sql';

export interface TranslationRow {
  id: string;
  translation_key: string;
  locale: string;
  /** Null while the key is only discovered and still waits for a translation. */
  translation_value: string | null;
  /** What the code fell back to when the key was discovered. Only shown to translators. */
  source_text: string | null;
  group_name: string;
  updated_at: string;
}

/** Offered in the admin; any other lowercase name is allowed too. */
export const defaultTranslationGroups = ['general', 'frontend', 'admin', 'site_settings', 'widgets', 'shortcodes', 'plugins'];

// The same rules as the check constraints in the migration, so the admin can explain before saving.
export const translationKeyPattern = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,190}$/;
export const localePattern = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;
export const groupPattern = /^[a-z0-9_-]{1,50}$/;
const maxValueLength = 10000;

const isMissingSchema = (message: string) =>
  /rwp_translations|rwp_report_missing_translations/.test(message)
  && /schema cache|does not exist|PGRST20[25]|42P01|42883/i.test(message);

/** Names the real cause, including which migration to run. */
export const describeTranslationError = (error: unknown): string => {
  const message = describeDbError(error);
  if (isMissingSchema(message)) {
    return `The translations table does not exist yet. Run ${translationsMigration} in Supabase → SQL Editor, then reload this page.`;
  }
  if (/row-level security|42501/i.test(message)) {
    return 'The database refused the change: editing translations needs the manage_options capability (Administrator).';
  }
  if (message.includes('rwp_translations_key_format')) {
    return 'A key may only contain letters, digits and . : - _ (up to 191 characters), and must start with a letter, digit or underscore.';
  }
  if (message.includes('rwp_translations_locale_format')) return 'The language code must look like "fa", "en" or "pt-br".';
  if (message.includes('rwp_translations_group_format')) return 'A group name may only contain lowercase letters, digits, - and _ (up to 50 characters).';
  if (message.includes('rwp_translations_lengths')) return `A translation is limited to ${maxValueLength.toLocaleString()} characters.`;
  return message;
};

/** Every row a query matches. PostgREST returns at most 1000 rows per request by default. */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

// Runtime: applying database strings ---------------------------------------------------------------

/** locale -> the request that loaded (or is loading) its strings. */
const requested = new Map<string, Promise<void>>();
/** Locales whose strings are in place, so a gap there is really a missing key. */
const applied = new Set<string>();
/** False once the table turned out not to exist: the site runs on bundled strings alone. */
let tableAvailable = true;

const cacheKey = (code: string) => `rwp_translations:${code}`;

const readCache = (code: string): TranslationDictionary | null => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(cacheKey(code)) || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as TranslationDictionary : null;
  } catch {
    return null;
  }
};

const writeCache = (code: string, entries: TranslationDictionary) => {
  try {
    localStorage.setItem(cacheKey(code), JSON.stringify(entries));
  } catch {
    // Full or blocked storage only costs the offline fallback.
  }
};

/**
 * Loads the applied strings for these locales, once each, in one request. `force` reloads them
 * (after an edit in the admin). A failed request falls back to the copy this browser saved last
 * time, so an outage shows the last known wording rather than reverting to the bundled one.
 */
export function loadDatabaseTranslations(codes: string[], force = false): Promise<void> {
  const wanted = [...new Set(codes.map((code) => String(code || '').trim().toLowerCase()).filter(Boolean))];
  const missing = wanted.filter((code) => force || !requested.has(code));
  const supabase = tryGetSupabaseClient();
  if (missing.length && tableAvailable && supabase) {
    const job = fetchAll<Pick<TranslationRow, 'translation_key' | 'locale' | 'translation_value'>>((from, to) => supabase
      .from('rwp_translations').select('translation_key,locale,translation_value')
      .in('locale', missing).not('translation_value', 'is', null)
      .order('id').range(from, to))
      .then((rows) => {
        const byLocale = new Map<string, TranslationDictionary>(missing.map((code) => [code, {}]));
        rows.forEach((row) => { byLocale.get(row.locale)![row.translation_key] = row.translation_value ?? ''; });
        byLocale.forEach((entries, code) => {
          setDatabaseTranslations(code, entries);
          writeCache(code, entries);
          applied.add(code);
        });
      })
      .catch((error: unknown) => {
        const message = describeDbError(error);
        if (isMissingSchema(message)) {
          // Before the migration: nothing to load, and no reason to ask again on every switch.
          tableAvailable = false;
          return;
        }
        console.warn(`Translations could not be loaded from the database (${message}); using the copy saved in this browser, if any.`);
        // Stays in `requested`, so it is asked again on the next reload, not on every change:
        // applying the cache notifies subscribers, and retrying from there would loop during an outage.
        missing.forEach((code) => {
          const cached = readCache(code);
          if (cached) setDatabaseTranslations(code, cached);
        });
      });
    missing.forEach((code) => requested.set(code, job));
  }
  return Promise.all(wanted.map((code) => requested.get(code))).then(() => undefined);
}

/** The locales translate() can reach right now: the active one, the site default and English. */
const reachableLocales = () => [getLocale(), currentI18nSettings().default_site_language, 'en'];

/**
 * Awaited in App.tsx before the first render, next to initI18n(), so database wording is on
 * screen from the first paint instead of replacing bundled text a moment later.
 */
export const initDatabaseTranslations = async (): Promise<void> => {
  await Promise.all([loadDatabaseTranslations(reachableLocales()), loadDiscoverySetting()]);
};

/** Re-reads every locale loaded so far. Called after the admin saves, so this tab shows the change. */
export const reloadDatabaseTranslations = () => loadDatabaseTranslations([...requested.keys(), ...reachableLocales()], true);

// A language switch (switcher, ?lang=, a plugin) needs the new locale's strings. subscribeLocale
// also fires for our own setDatabaseTranslations, which is harmless: those locales are requested.
if (typeof window !== 'undefined') {
  subscribeLocale(() => {
    if (requested.has(getLocale()) || !tableAvailable) return;
    void loadDatabaseTranslations(reachableLocales());
  });
}

// Missing-key discovery ------------------------------------------------------------------------------

export const discoveryOption = 'translation_auto_discovery';

interface MissingReport { key: string; source: string; group: 'frontend' | 'admin' }

const reported = new Set<string>();
const queue = new Map<string, MissingReport[]>();
let flushTimer: number | undefined;
/** Bounds the requests one visit can make, however many keys a page renders. */
const maxReportsPerVisit = 500;

const flushReports = async () => {
  flushTimer = undefined;
  const supabase = tryGetSupabaseClient();
  const batches = [...queue.entries()];
  queue.clear();
  if (!supabase) return;
  for (const [locale, items] of batches) {
    // The database accepts at most 50 per call.
    for (let start = 0; start < items.length; start += 50) {
      const { error } = await supabase.rpc('rwp_report_missing_translations', { p_locale: locale, p_items: items.slice(start, start + 50) });
      if (error) {
        // Reporting is a convenience for the admin; a visitor never sees this fail.
        console.warn(`Untranslated keys could not be reported: ${describeTranslationError(error)}`);
        if (isMissingSchema(describeDbError(error))) setMissingKeyHandler(null);
        return;
      }
    }
  }
};

const reportMissing = (key: string, shown: string, locale: string, surface: I18nSurface) => {
  // While a locale's strings are still loading every key looks missing; wait for them.
  if (!applied.has(locale)) return;
  const id = `${locale}\u0000${key}`;
  if (reported.has(id) || reported.size >= maxReportsPerVisit) return;
  reported.add(id);
  const items = queue.get(locale) || [];
  items.push({ key, source: shown === key ? '' : shown, group: surface === 'admin' ? 'admin' : 'frontend' });
  queue.set(locale, items);
  // Called while React renders, so nothing here may touch state: the request waits for a quiet moment.
  if (flushTimer === undefined) flushTimer = window.setTimeout(() => void flushReports(), 4000);
};

/** Reads the option and turns reporting on or off for this visit. */
export async function loadDiscoverySetting(): Promise<boolean> {
  const supabase = tryGetSupabaseClient();
  if (!supabase) return false;
  const { data } = await supabase.from('options').select('option_value').eq('option_name', discoveryOption).maybeSingle();
  const enabled = data?.option_value === 'true';
  setMissingKeyHandler(enabled && tableAvailable ? reportMissing : null);
  return enabled;
}

export async function setAutoDiscovery(enabled: boolean): Promise<void> {
  const { data, error } = await getSupabaseClient()
    .from('options').upsert({ option_name: discoveryOption, option_value: String(enabled) }).select('option_name');
  if (error) throw new Error(describeTranslationError(error));
  // An upsert RLS refused can come back empty instead of failing.
  if (!data?.length) throw new Error('The setting was not saved: changing options needs the manage_options capability (Administrator).');
  await loadDiscoverySetting();
}

// Admin: reading and writing ------------------------------------------------------------------------

/** Every row, including untranslated ones (their policy lets manage_options read them). */
export async function getTranslations(filter: { locale?: string; group?: string } = {}): Promise<TranslationRow[]> {
  try {
    return await fetchAll<TranslationRow>((from, to) => {
      let query = getSupabaseClient().from('rwp_translations')
        .select('id,translation_key,locale,translation_value,source_text,group_name,updated_at');
      if (filter.locale) query = query.eq('locale', filter.locale);
      if (filter.group) query = query.eq('group_name', filter.group);
      return query.order('translation_key').order('locale').order('id').range(from, to);
    });
  } catch (error) {
    throw new Error(describeTranslationError(error));
  }
}

export interface TranslationInput {
  key: string;
  locale: string;
  /** Empty or null keeps the row but marks it untranslated, so the bundled string shows again. */
  value: string | null;
  group?: string;
}

const validate = (input: TranslationInput): string => {
  if (!translationKeyPattern.test(input.key)) {
    return `"${input.key}" is not a valid key: use letters, digits and . : - _ (up to 191 characters), starting with a letter, digit or underscore.`;
  }
  if (!localePattern.test(input.locale)) return `"${input.locale}" is not a language code like "fa", "en" or "pt-br".`;
  if (input.group !== undefined && !groupPattern.test(input.group)) {
    return `"${input.group}" is not a valid group: lowercase letters, digits, - and _ only.`;
  }
  if ((input.value || '').length > maxValueLength) return `The translation of "${input.key}" is longer than ${maxValueLength.toLocaleString()} characters.`;
  return '';
};

const normalizeInput = (input: TranslationInput): TranslationInput => ({
  key: input.key.trim(),
  locale: input.locale.trim().toLowerCase(),
  value: input.value === null || input.value.trim() === '' ? null : input.value,
  group: input.group === undefined ? undefined : (input.group.trim().toLowerCase() || 'general'),
});

export async function upsertTranslation(raw: TranslationInput): Promise<TranslationRow> {
  const input = normalizeInput(raw);
  const problem = validate(input);
  if (problem) throw new Error(problem);
  const { data, error } = await getSupabaseClient().from('rwp_translations')
    .upsert({
      translation_key: input.key,
      locale: input.locale,
      translation_value: input.value,
      group_name: input.group || 'general',
    }, { onConflict: 'translation_key,locale' })
    .select('id,translation_key,locale,translation_value,source_text,group_name,updated_at');
  if (error) throw new Error(describeTranslationError(error));
  if (!data?.length) throw new Error('The translation was not saved: the database returned no row, so your role may not be allowed to edit translations (manage_options).');
  return data[0] as TranslationRow;
}

/** Deletes rows by id. Returns how many went; the database may refuse some without an error. */
export async function deleteTranslations(ids: string[]): Promise<number> {
  let deleted = 0;
  for (let start = 0; start < ids.length; start += 200) {
    const { data, error } = await getSupabaseClient().from('rwp_translations')
      .delete().in('id', ids.slice(start, start + 200)).select('id');
    if (error) throw new Error(describeTranslationError(error));
    deleted += data?.length || 0;
  }
  if (ids.length && deleted === 0) {
    throw new Error('Nothing was deleted: the database returned no rows, so your role may not be allowed to edit translations (manage_options).');
  }
  return deleted;
}

export const deleteTranslation = async (id: string): Promise<void> => { await deleteTranslations([id]); };

export interface ImportReport { created: number; updated: number; unchanged: number; skipped: number }

/**
 * Upserts many strings at once. With `overwrite` false, keys that already have a translation for
 * that language are left alone, so importing a partial file never replaces finished work.
 * Entries without a value are skipped rather than blanking a translation.
 */
export async function importTranslations(entries: TranslationInput[], overwrite: boolean): Promise<ImportReport> {
  const clean = entries.map(normalizeInput);
  const invalid = clean.map(validate).filter(Boolean);
  if (invalid.length) {
    throw new Error(`Nothing was imported. ${invalid.length} entr${invalid.length === 1 ? 'y is' : 'ies are'} invalid, for example: ${invalid.slice(0, 3).join(' ')}`);
  }
  const existing = new Map((await getTranslations()).map((row) => [`${row.translation_key}\u0000${row.locale}`, row]));
  const report: ImportReport = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
  const rows = new Map<string, Record<string, string | null>>();
  clean.forEach((entry) => {
    const id = `${entry.key}\u0000${entry.locale}`;
    const current = existing.get(id);
    if (entry.value === null) { report.skipped += 1; return; }
    if (current && current.translation_value !== null && !overwrite) { report.skipped += 1; return; }
    if (current?.translation_value === entry.value && (!entry.group || entry.group === current.group_name)) { report.unchanged += 1; return; }
    if (current) report.updated += 1; else report.created += 1;
    // Every row carries every column: a bulk upsert fills columns a row lacks with null.
    rows.set(id, {
      translation_key: entry.key,
      locale: entry.locale,
      translation_value: entry.value,
      group_name: entry.group || current?.group_name || 'general',
      source_text: current?.source_text ?? null,
    });
  });
  const payload = [...rows.values()];
  for (let start = 0; start < payload.length; start += 500) {
    const chunk = payload.slice(start, start + 500);
    const { data, error } = await getSupabaseClient().from('rwp_translations')
      .upsert(chunk, { onConflict: 'translation_key,locale' }).select('id');
    if (error) throw new Error(`Import stopped after ${start} of ${payload.length} strings: ${describeTranslationError(error)}`);
    if ((data?.length || 0) < chunk.length) {
      throw new Error(`Import stopped after ${start} of ${payload.length} strings: the database saved only ${data?.length || 0} of ${chunk.length}, so your role may not be allowed to edit translations (manage_options).`);
    }
  }
  return report;
}

// Import and export files ----------------------------------------------------------------------------

export const exportFormat = 'react-wp-translations';

/**
 * One exported string. `source` (the original text) and `default` (the bundled string for that
 * language) are context for a translator and are ignored on import; only `value` is imported.
 */
export interface TranslationExportItem {
  key: string;
  locale: string;
  value: string | null;
  group: string;
  source?: string | null;
  default?: string | null;
}

export const rowToExportItem = (row: TranslationRow): TranslationExportItem => ({
  key: row.translation_key, locale: row.locale, value: row.translation_value, group: row.group_name, source: row.source_text,
});

export const translationsToJson = (items: TranslationExportItem[]): string => JSON.stringify({
  format: exportFormat,
  version: 1,
  exported_at: new Date().toISOString(),
  translations: items.map((item) => ({
    key: item.key, locale: item.locale, value: item.value, group: item.group,
    ...(item.source ? { source: item.source } : {}),
    ...(item.default ? { default: item.default } : {}),
  })),
}, null, 2);

const csvCell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/**
 * CSV with a BOM, so Excel opens Persian and Arabic as UTF-8. The source column can be written
 * by visitors' browsers (discovery), so context cells starting with = + - @ are prefixed with '
 * to stop a spreadsheet from running them as formulas. Those columns are never imported.
 */
export const translationsToCsv = (items: TranslationExportItem[]): string => {
  const neutralize = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
  const lines = [['key', 'locale', 'value', 'group', 'source', 'default'].join(',')];
  items.forEach((item) => lines.push([
    item.key, item.locale, item.value ?? '', item.group, neutralize(item.source ?? ''), neutralize(item.default ?? ''),
  ].map(csvCell).join(',')));
  return `﻿${lines.join('\r\n')}\r\n`;
};

/** RFC 4180: quoted fields, doubled quotes, newlines inside quotes, CRLF or LF. */
const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
};

/** { header: { login: 'x' } } -> { 'header.login': 'x' }, for i18next-style nested files. */
const flatten = (value: unknown, prefix: string, into: Record<string, string>) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    Object.entries(value as Record<string, unknown>).forEach(([key, inner]) => flatten(inner, prefix ? `${prefix}.${key}` : key, into));
  } else if (typeof value === 'string' || typeof value === 'number') {
    into[prefix] = String(value);
  }
};

/**
 * Reads an exported file back. Accepted shapes:
 *   - this screen's JSON export, or just its `translations` array;
 *   - { "fa": { "header.login": "ورود" } }, the shape registerPluginTranslations() takes (nested
 *     objects are flattened into dot keys);
 *   - CSV with a header row naming key, locale and value (group optional; source is ignored).
 */
export function parseTranslationFile(text: string, fileName: string): TranslationInput[] {
  const body = text.replace(/^﻿/, '');
  const looksJson = /\.json$/i.test(fileName) || /^\s*[[{]/.test(body);
  if (looksJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      throw new Error(`"${fileName}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const list = Array.isArray(parsed) ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { translations?: unknown }).translations)
        ? (parsed as { translations: unknown[] }).translations : null;
    if (list) {
      return list.map((item, index) => {
        const entry = (item || {}) as Record<string, unknown>;
        const key = entry.key ?? entry.translation_key;
        const locale = entry.locale;
        if (typeof key !== 'string' || typeof locale !== 'string') {
          throw new Error(`Entry ${index + 1} in "${fileName}" needs a "key" and a "locale".`);
        }
        const value = entry.value ?? entry.translation_value;
        const group = entry.group ?? entry.group_name;
        return { key, locale, value: typeof value === 'string' ? value : null, group: typeof group === 'string' ? group : undefined };
      });
    }
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed as Record<string, unknown>).flatMap(([locale, dictionary]) => {
        if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) {
          throw new Error(`"${fileName}" maps "${locale}" to something other than an object of strings.`);
        }
        const flat: Record<string, string> = {};
        flatten(dictionary, '', flat);
        return Object.entries(flat).map(([key, value]) => ({ key, locale, value }));
      });
    }
    throw new Error(`"${fileName}" has no translations in a shape this screen understands.`);
  }

  const [header, ...rows] = parseCsv(body);
  if (!header) throw new Error(`"${fileName}" is empty.`);
  const columns = header.map((name) => name.trim().toLowerCase());
  const find = (...names: string[]) => columns.findIndex((name) => names.includes(name));
  const keyAt = find('key', 'translation_key');
  const localeAt = find('locale', 'language', 'lang');
  const valueAt = find('value', 'translation_value', 'translation');
  const groupAt = find('group', 'group_name');
  if (keyAt < 0 || localeAt < 0 || valueAt < 0) {
    throw new Error(`"${fileName}" needs a header row with key, locale and value columns. It has: ${header.join(', ') || 'nothing'}.`);
  }
  return rows.map((cells) => ({
    key: cells[keyAt] ?? '',
    locale: cells[localeAt] ?? '',
    value: cells[valueAt] ?? null,
    group: groupAt >= 0 && cells[groupAt] ? cells[groupAt] : undefined,
  }));
}

// Content strings ----------------------------------------------------------------------------------------

/**
 * The translation key for a field of a term (a category today): `category.news.name`. Slugs that
 * a key cannot hold (a Persian slug, say) use the id instead, so every term is translatable.
 */
export const termKey = (taxonomy: string, term: { id: string | number; slug?: string | null }, field: string) => {
  const slug = term.slug && /^[A-Za-z0-9_-]{1,120}$/.test(term.slug) ? term.slug : String(term.id);
  return `${taxonomy}.${slug}.${field}`;
};

/**
 * A term's name or description in the active language, falling back to what is stored on the
 * row. Not a hook: call it where the component already re-renders on a language change
 * (anything using useTranslation()).
 */
export const translateTerm = (
  taxonomy: string,
  term: { id: string | number; slug?: string | null; name?: string | null; description?: string | null },
  field: 'name' | 'description' = 'name',
): string => {
  const stored = term[field] || '';
  // An empty description has nothing to translate, and must not be reported as missing.
  if (!stored) return '';
  return translate(termKey(taxonomy, term, field), stored);
};
