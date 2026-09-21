import { useEffect, useState, useSyncExternalStore } from 'react';
import { describeDbError, getSupabaseClient } from '../../../src/lib/db';
import type { Page } from '../../../src/lib/types';
import { useBilingual } from '../BilingualContext';
import { readCookie, writeCookie } from '../lib/state';
import { getContentVersion, requestTranslations, subscribeContent, translationsFor } from '../lib/content';

/**
 * [continue_reading category="slug-or-id" class="" label=""]
 *
 * Links to the first post in the category (oldest first, the reading order of a series) that
 * this browser has not opened yet. With nothing read it says "Start reading"; with everything
 * read it goes back to the first post, as the WordPress plugin does.
 *
 * Read posts are kept per category in localStorage (`po_read_posts`), with a cookie of the same
 * name as the fallback when storage is blocked. The cookie keeps the newest 40 ids per category
 * so it stays well under the 4 KB cookie limit.
 */

const storageKey = 'po_read_posts';
const cookieLimitPerCategory = 40;

type ReadMap = Record<string, number[]>;

const parse = (raw: string): ReadMap => {
  try {
    const value: unknown = JSON.parse(raw || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, ids]) => [key, Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : []]));
  } catch {
    return {};
  }
};

export function readProgress(): ReadMap {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) return parse(stored);
  } catch {
    // Blocked storage: the cookie below.
  }
  return parse(readCookie(storageKey));
}

const writeProgress = (map: ReadMap) => {
  const json = JSON.stringify(map);
  try {
    localStorage.setItem(storageKey, json);
    return;
  } catch {
    // Fall through to the cookie.
  }
  const trimmed = Object.fromEntries(Object.entries(map).map(([key, ids]) => [key, ids.slice(-cookieLimitPerCategory)]));
  writeCookie(storageKey, JSON.stringify(trimmed));
};

/** Records that a post was opened. Called from the plugin's rwp_page_content filter. */
export function markPostRead(page: Pick<Page, 'id' | 'is_post' | 'category_id'>) {
  if (!page.is_post || !page.category_id) return;
  const map = readProgress();
  const ids = map[page.category_id] || [];
  if (ids.includes(page.id)) return;
  map[page.category_id] = [...ids, page.id];
  writeProgress(map);
}

export const resetProgress = (categoryId: string) => {
  const map = readProgress();
  delete map[categoryId];
  writeProgress(map);
};

interface SeriesPost { id: number; title: string; slug: string; locale?: string | null }

/** The post a reader should open next, and how far they are. Exported for tests. */
export function nextToRead(posts: SeriesPost[], readIds: number[]) {
  const read = new Set(readIds);
  const next = posts.find((post) => !read.has(post.id));
  const readCount = posts.filter((post) => read.has(post.id)).length;
  return {
    post: next || posts[0] || null,
    state: !posts.length ? 'empty' as const : !readCount ? 'start' as const : next ? 'next' as const : 'again' as const,
    readCount,
  };
}

async function loadSeries(category: string): Promise<{ categoryId: string; posts: SeriesPost[] } | null> {
  const supabase = getSupabaseClient();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(category);
  const { data: found, error } = await supabase.from('categories').select('id').eq(isUuid ? 'id' : 'slug', category).maybeSingle();
  if (error) throw new Error(describeDbError(error));
  if (!found) return null;
  const { data, error: postsError } = await supabase.from('pages').select('id,title,slug')
    .eq('status', 'published').eq('is_post', true).eq('category_id', found.id)
    .order('created_at', { ascending: true }).limit(500);
  if (postsError) throw new Error(describeDbError(postsError));
  return { categoryId: found.id, posts: (data || []) as SeriesPost[] };
}

export default function ContinueReading({ category, className = '', label = '' }: { category: string; className?: string; label?: string }) {
  const { t, lang } = useBilingual();
  useSyncExternalStore(subscribeContent, getContentVersion, getContentVersion);
  const [series, setSeries] = useState<{ categoryId: string; posts: SeriesPost[] } | null | undefined>(undefined);
  const [progress, setProgress] = useState<ReadMap>(readProgress);

  useEffect(() => {
    if (!category) return;
    let active = true;
    loadSeries(category)
      .then((loaded) => { if (active) setSeries(loaded); })
      .catch((error: unknown) => {
        console.warn(`[continue_reading] ${error instanceof Error ? error.message : String(error)}`);
        if (active) setSeries(null);
      });
    return () => { active = false; };
  }, [category]);

  // Another tab reading a post moves this button on too.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === storageKey) setProgress(readProgress()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const next = series ? nextToRead(series.posts, progress[series.categoryId] || []) : null;
  const nextId = next?.post?.id;
  // The next post's translated title, for the button in the active language.
  useEffect(() => { if (nextId) requestTranslations(nextId); }, [nextId]);

  if (!category) {
    console.warn('[continue_reading] needs category="slug" (or the category id).');
    return null;
  }
  if (series === undefined) return <span className={`po-continue is-loading ${className}`.trim()} aria-busy="true" />;
  if (series === null || !next) return null;

  const { post, state, readCount } = next;
  if (!post || state === 'empty') {
    return <p className={`po-continue po-continue--empty ${className}`.trim()}>{t('po.continue.empty', 'Nothing has been published in this category yet.')}</p>;
  }

  const title = translationsFor(post.id)?.[lang]?.title?.trim() || post.title;
  const text = label || (state === 'start'
    ? t('po.continue.start', 'Start reading')
    : state === 'again' ? t('po.continue.again', 'Read again from the start') : t('po.continue.next', 'Continue reading: {title}', { title }));

  return (
    <span className={`po-continue ${className}`.trim()}>
      <a className="po-continue__button" href={`/${post.slug}`} onClick={() => { if (state === 'again') resetProgress(series.categoryId); }}>
        <span>{text}</span>
        <span className="po-continue__arrow" aria-hidden="true">→</span>
      </a>
      {state !== 'start' && (
        <span className="po-continue__progress">
          {t('po.continue.progress', '{read} of {total} read', { read: readCount, total: series.posts.length })}
        </span>
      )}
    </span>
  );
}
