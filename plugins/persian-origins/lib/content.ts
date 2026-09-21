import { refreshFilters } from '../../../src/core/hooks';
import { describeDbError, getSupabaseClient, tryGetSupabaseClient } from '../../../src/lib/db';
import { currentI18nSettings, directionOf, getLocale, localeDefinition, subscribeLocale } from '../../../src/lib/i18n';
import { applyDocumentTitle, loadSettings } from '../../../src/lib/settings';
import type { Page } from '../../../src/lib/types';
import { getPoSettings } from './settings';

const poLanguages = () => getPoSettings().languages;

/**
 * Per-language titles, excerpts and bodies (public.po_content_translations).
 *
 * The public screens do not re-render on a language change (PublicContent and PublicHome do not
 * subscribe to the locale), so this plugin renders every language of a string at once and lets
 * the body class pick one — the approach the WordPress plugin takes for cached pages, and the
 * reason switching is instant with no request. See styles.css for the visibility rules.
 *
 * Titles in a feed come from a batched request (one per screen, not one per post), because the
 * feed selects a fixed column list. Bodies are fetched only for the page being read.
 */

export interface TranslationFields { title: string; excerpt: string; content: string }
export type PageTranslations = Record<string, Partial<TranslationFields>>;

export const contentTable = 'po_content_translations';

const cache = new Map<number, PageTranslations>();
/** Page ids whose body has been fetched, not just the title and excerpt. */
const withBody = new Set<number>();
const queued = new Map<number, boolean>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let tableAvailable = true;
let version = 0;
const listeners = new Set<() => void>();

export const getContentVersion = () => version;
export const subscribeContent = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const emit = () => {
  version += 1;
  listeners.forEach((listener) => listener());
  // ContentRenderer reads the_content through useApplyFilters: this makes it run our filter again.
  refreshFilters();
};

const isMissingTable = (message: string) =>
  message.includes(contentTable) && /schema cache|does not exist|PGRST205|42P01/i.test(message);

async function flush() {
  flushTimer = undefined;
  const supabase = tryGetSupabaseClient();
  const batch = [...queued.entries()];
  queued.clear();
  if (!supabase || !tableAvailable || !batch.length) return;
  const groups = [batch.filter(([, body]) => body).map(([id]) => id), batch.filter(([, body]) => !body).map(([id]) => id)];
  for (const [index, ids] of groups.entries()) {
    const body = index === 0;
    for (let start = 0; start < ids.length; start += 200) {
      const chunk = ids.slice(start, start + 200);
      const { data, error } = await supabase.from(contentTable)
        .select(body ? 'page_id,locale,title,excerpt,content' : 'page_id,locale,title,excerpt')
        .in('page_id', chunk);
      if (error) {
        const message = describeDbError(error);
        if (isMissingTable(message)) {
          // The plugin's schema has not been installed: every page shows its base language.
          tableAvailable = false;
          return;
        }
        console.warn(`Page translations could not be loaded: ${message}`);
        continue;
      }
      chunk.forEach((id) => {
        if (!cache.has(id)) cache.set(id, {});
        if (body) withBody.add(id);
      });
      ((data || []) as unknown as Array<{ page_id: number; locale: string } & Partial<TranslationFields>>).forEach((row) => {
        const entry = cache.get(row.page_id)!;
        entry[row.locale] = { ...entry[row.locale], title: row.title, excerpt: row.excerpt, ...(body ? { content: row.content } : {}) };
      });
    }
  }
  emit();
}

/** Asks for a page's translations; they arrive with the next batch. `body` also loads the content. */
export function requestTranslations(id: number, body = false) {
  if (!tableAvailable || !Number.isFinite(id)) return;
  if (cache.has(id) && (!body || withBody.has(id))) return;
  if (queued.get(id) === true || (queued.has(id) && !body)) return;
  queued.set(id, body);
  if (flushTimer === undefined) flushTimer = setTimeout(() => void flush(), 0);
}

export const translationsFor = (id: number): PageTranslations | undefined => cache.get(id);

/** Puts rows the caller already has into the cache, bodies included (tests, and anything that fetched them itself). */
export function primeTranslations(id: number, translations: PageTranslations) {
  cache.set(id, translations);
  withBody.add(id);
  emit();
}

/** The language the row itself is written in: its own `locale` column, else the site default. */
export const baseLocaleOf = (page: Pick<Page, 'id'> & { locale?: string | null }) =>
  page.locale || currentI18nSettings().default_site_language;

/** Every language of one field, falling back to the base text where a translation is missing or empty. */
export function variantsOf(page: Page & { locale?: string | null }, field: keyof TranslationFields, baseText: string) {
  const base = baseLocaleOf(page);
  const translations = translationsFor(page.id) || {};
  const languages = [...new Set([base, ...poLanguages()])];
  const hasAny = languages.some((code) => code !== base && translations[code]?.[field]?.trim());
  return {
    base,
    hasAny,
    variants: languages.map((code) => {
      const own = code === base ? baseText : translations[code]?.[field]?.trim() ? translations[code]![field]! : '';
      return { code, text: own || baseText, isBase: code === base, isFallback: !own };
    }),
  };
}

// Bodies: the marker between rwp_page_content and the_content ----------------------------------------

const markerPattern = /^<!--po-page:(\d+)-->/;

let viewed: { page: Page & { locale?: string | null }; path: string } | null = null;

/**
 * rwp_page_content is applied with the page; the_content (which ContentRenderer re-runs when the
 * translations arrive) is not. So the first filter leaves the page id in an HTML comment for the
 * second one. The comment is invisible and dropped by the second filter.
 */
export function markPageContent(html: string, page: Page) {
  if (!page?.id) return html;
  viewed = { page, path: typeof window === 'undefined' ? '' : window.location.pathname };
  requestTranslations(page.id, true);
  return `<!--po-page:${page.id}-->${html}`;
}

const escapeAttribute = (value: string) => value.replace(/[&"<>]/g, (char) => `&#${char.charCodeAt(0)};`);

/** Replaces the marked body with one block per language. Unmarked HTML passes through untouched. */
export function expandPageContent(html: string) {
  const match = html.match(markerPattern);
  if (!match) return html;
  const body = html.slice(match[0].length);
  const page = viewed?.page.id === Number(match[1]) ? viewed.page : null;
  if (!page) return body;
  const { hasAny, variants } = variantsOf({ ...page, content: body }, 'content', body);
  if (!hasAny) return body;
  return variants.map(({ code, text, isBase, isFallback }) => {
    // A fallback block is the base text, so it keeps the base language's lang and dir.
    const language = isFallback ? baseLocaleOf(page) : code;
    return `<div class="po-text po-text--${escapeAttribute(code)}${isBase ? ' po-text--base' : ''}" lang="${escapeAttribute(language)}" dir="${directionOf(language)}">${text}</div>`;
  }).join('');
}

/** The browser tab title follows the language too, for the page being read. */
export function syncDocumentTitle() {
  if (!viewed || typeof window === 'undefined' || window.location.pathname !== viewed.path) return;
  const { page } = viewed;
  const active = getLocale();
  const base = baseLocaleOf(page);
  const translated = active !== base ? translationsFor(page.id)?.[active]?.title?.trim() : '';
  // Only ever replaced with a translation; switching back restores what core wrote.
  if (active !== base && !translated) return;
  void loadSettings().then((settings) => applyDocumentTitle(settings.site_title, translated || page.seo_title || page.title));
}

export function startContentSync(): () => void {
  const unsubscribeLocale = subscribeLocale(() => syncDocumentTitle());
  const unsubscribeContent = subscribeContent(() => syncDocumentTitle());
  return () => {
    unsubscribeLocale();
    unsubscribeContent();
  };
}

// Admin: reading and writing ----------------------------------------------------------------------------

export interface TranslationRow extends TranslationFields { id: string; page_id: number; locale: string; updated_at: string }

export const describeContentError = (error: unknown) => {
  const message = describeDbError(error);
  if (isMissingTable(message)) {
    return `The ${contentTable} table does not exist. Activate the plugin again under Plugins (it installs plugins/persian-origins/schema.sql), or run that file in the Supabase SQL Editor.`;
  }
  if (/row-level security|42501/i.test(message)) {
    return 'The database refused the change: you can translate your own pages with edit_posts, other people\'s with edit_others_posts, and published ones only with publish_posts.';
  }
  if (message.includes('po_content_translations_lengths')) return 'The title is limited to 500 characters and the excerpt to 5,000.';
  return message;
};

export async function fetchPageTranslations(pageId: number): Promise<TranslationRow[]> {
  const { data, error } = await getSupabaseClient().from(contentTable)
    .select('id,page_id,locale,title,excerpt,content,updated_at').eq('page_id', pageId);
  if (error) throw new Error(describeContentError(error));
  return (data || []) as TranslationRow[];
}

/** page id -> languages with a translation, for the list screen. */
export async function fetchTranslationIndex(): Promise<Map<number, string[]>> {
  const { data, error } = await getSupabaseClient().from(contentTable).select('page_id,locale');
  if (error) throw new Error(describeContentError(error));
  const index = new Map<number, string[]>();
  (data || []).forEach((row: { page_id: number; locale: string }) => index.set(row.page_id, [...(index.get(row.page_id) || []), row.locale]));
  return index;
}

export async function savePageTranslation(pageId: number, locale: string, fields: TranslationFields): Promise<TranslationRow> {
  const { data, error } = await getSupabaseClient().from(contentTable)
    .upsert({ page_id: pageId, locale, ...fields }, { onConflict: 'page_id,locale' })
    .select('id,page_id,locale,title,excerpt,content,updated_at');
  if (error) throw new Error(describeContentError(error));
  if (!data?.length) throw new Error('The translation was not saved: the database returned no row, so your role may not be allowed to edit this page.');
  // The next public render fetches it again.
  cache.delete(pageId);
  withBody.delete(pageId);
  return data[0] as TranslationRow;
}

export async function deletePageTranslation(pageId: number, locale: string): Promise<void> {
  const { data, error } = await getSupabaseClient().from(contentTable).delete().eq('page_id', pageId).eq('locale', locale).select('id');
  if (error) throw new Error(describeContentError(error));
  if (!data?.length) throw new Error('Nothing was deleted: the translation is already gone, or your role may not edit this page.');
  cache.delete(pageId);
  withBody.delete(pageId);
}

export const languageName = (code: string) => localeDefinition(code).name;
