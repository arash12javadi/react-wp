import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { describeDbError, getSupabaseClient } from './db';
import { loginHref } from './account';
import type { AppSettings } from './appSettings';

/**
 * Likes, saved items (bookmarks), follows and view counts (supabase/migrations/20261004_engagement.sql).
 *
 * Every button on a page reads from one shared store, filled by one request per item type
 * (rwp_engagement_state / rwp_follow_state) however many buttons ask in the same tick. Changes are
 * optimistic: the store updates at once, the database call follows, and a refusal puts the old state
 * back and reports the database's own reason. The browser sends the state it wants (liked: true),
 * never "toggle", so two quick clicks cannot leave it in the opposite state.
 *
 * Products (or anything a plugin registers with rwp_engagement_target_<type>) use the same calls with
 * their own target type. Before the migration has run, every RPC is missing: the buttons then render
 * nothing, and the console names the migration once.
 */

export type EngagementTargetType = 'page' | 'product' | (string & {});
export type FollowTargetType = 'user' | 'category';
export type PopularTimeframe = 'week' | 'month' | 'all';

export const engagementMigration = 'supabase/migrations/20261004_engagement.sql';

export interface EngagementItemState {
  likes: number;
  views: number;
  liked: boolean;
  /** Collections the signed-in person saved this item in; empty when not saved. */
  collections: string[];
  authorId: string | null;
}

export interface FollowState {
  followers: number;
  following: boolean;
  /** Display name for authors with published content, category name for categories. */
  name: string | null;
  slug?: string;
  /** The signed-in person themselves: they cannot follow their own account. */
  self?: boolean;
}

// Errors ------------------------------------------------------------------------------------------

const isMissingMigration = (message: string) =>
  /PGRST202|PGRST205|42883|42P01|schema cache|Could not find the function|does not exist/i.test(message);

let missingWarned = false;
let missing = false;

/** True once an engagement RPC was found missing; the buttons hide themselves. */
export const engagementUnavailable = () => missing;

const noteMissing = (message: string) => {
  missing = true;
  notify();
  if (!missingWarned) {
    missingWarned = true;
    console.warn(`Likes, saves, follows and view counts are hidden: the database does not have them yet. Run ${engagementMigration} in the Supabase SQL Editor. (${message})`);
  }
};

/** Turns a Supabase error into a sentence that names the real cause. */
export const explainEngagementError = (error: unknown): string => {
  const message = describeDbError(error);
  if (isMissingMigration(message)) {
    return `This site's database does not have likes, saves and follows yet. An administrator needs to run ${engagementMigration} in the Supabase SQL Editor.`;
  }
  // The functions raise readable messages ("Please sign in to like this."); strip the code suffix.
  return message.replace(/\s*\((?:42501|22023|54000|P0001)\)$/, '');
};

const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await getSupabaseClient().rpc(name, args);
  if (error) {
    const message = describeDbError(error);
    if (isMissingMigration(message)) noteMissing(message);
    throw new Error(explainEngagementError(error));
  }
  return data as T;
};

// The store ---------------------------------------------------------------------------------------

/** undefined: not loaded yet; null: not public (or missing), so no buttons. */
const items = new Map<string, EngagementItemState | null>();
const follows = new Map<string, FollowState | null>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version += 1;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const getVersion = () => version;

const itemKey = (type: string, id: string) => `${type}:${id}`;

// Keys already asked for, so re-renders while a request is out do not ask again. `generation` changes
// on reset; answers to requests from before it are dropped (they describe the previous session).
const inflight = new Set<string>();
let generation = 0;

// Batching: ids requested in the same tick go out as one request per type (100 per request).
const pendingItems = new Map<string, Set<string>>();
const pendingFollows: Record<FollowTargetType, Set<string>> = { user: new Set(), category: new Set() };
let flushScheduled = false;

const scheduleFlush = () => {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    void flushItems();
    void flushFollows();
  });
};

const chunk = <T,>(values: T[], size: number) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, index * size + size));

interface StateRow { likes: number | string; views: number | string; liked: boolean; collections: string[]; author_id: string | null }

async function flushItems() {
  const batches = [...pendingItems.entries()];
  pendingItems.clear();
  const started = generation;
  await Promise.all(batches.flatMap(([type, ids]) => chunk([...ids], 100).map(async (group) => {
    try {
      const rows = await rpc<Record<string, StateRow>>('rwp_engagement_state', { p_target_type: type, p_target_ids: group });
      if (started !== generation) return;
      group.forEach((id) => {
        const row = rows?.[id];
        items.set(itemKey(type, id), row ? {
          likes: Number(row.likes) || 0,
          views: Number(row.views) || 0,
          liked: row.liked === true,
          collections: Array.isArray(row.collections) ? row.collections : [],
          authorId: row.author_id || null,
        } : null);
      });
    } catch {
      // Hidden rather than retried in a loop; the missing-migration case is already reported.
      if (started === generation) group.forEach((id) => items.set(itemKey(type, id), null));
    } finally {
      group.forEach((id) => inflight.delete(itemKey(type, id)));
    }
  })));
  notify();
}

interface FollowRows {
  users: Record<string, { followers: number | string; following: boolean; name: string | null; self?: boolean }>;
  categories: Record<string, { followers: number | string; following: boolean; name: string | null; slug?: string }>;
}

async function flushFollows() {
  // rwp_follow_state takes 100 ids per call; the rest wait for the next tick.
  const users = [...pendingFollows.user].slice(0, 50);
  const categories = [...pendingFollows.category].slice(0, 50);
  users.forEach((id) => pendingFollows.user.delete(id));
  categories.forEach((id) => pendingFollows.category.delete(id));
  if (pendingFollows.user.size || pendingFollows.category.size) scheduleFlush();
  if (!users.length && !categories.length) return;
  const started = generation;
  const keys = [...users.map((id) => `user:${id}`), ...categories.map((id) => `category:${id}`)];
  try {
    const rows = await rpc<FollowRows>('rwp_follow_state', { p_user_ids: users, p_category_ids: categories });
    if (started !== generation) return;
    users.forEach((id) => {
      const row = rows?.users?.[id];
      follows.set(`user:${id}`, row ? { followers: Number(row.followers) || 0, following: row.following === true, name: row.name, self: row.self === true } : null);
    });
    categories.forEach((id) => {
      const row = rows?.categories?.[id];
      follows.set(`category:${id}`, row ? { followers: Number(row.followers) || 0, following: row.following === true, name: row.name, slug: row.slug } : null);
    });
  } catch {
    if (started === generation) keys.forEach((key) => follows.set(key, null));
  } finally {
    keys.forEach((key) => inflight.delete(key));
  }
  notify();
}

/** Forgets loaded state, e.g. after signing in or out, so buttons show the new person's state. */
export const resetEngagementState = () => {
  generation += 1;
  items.clear();
  follows.clear();
  inflight.clear();
  notify();
};

let authListening = false;
/** "liked" and "saved" belong to one person: a different session reloads them. */
const ensureAuthListener = () => {
  if (authListening) return;
  authListening = true;
  try {
    getSupabaseClient().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') resetEngagementState();
    });
  } catch {
    // Not configured yet (Setup Wizard): nothing is loaded either.
  }
};

// Session -------------------------------------------------------------------------------------------

const signedIn = async () => {
  const { data } = await getSupabaseClient().auth.getSession();
  return Boolean(data.session?.user);
};

/** Sends a visitor to sign in, coming back to this page. Returns false when they already are. */
const requireSignIn = async (): Promise<boolean> => {
  if (await signedIn()) return false;
  window.location.href = loginHref();
  return true;
};

// Hooks ---------------------------------------------------------------------------------------------

/** Loaded state of one item, or undefined while loading, or null when it has no buttons. */
export function useEngagementItem(type: EngagementTargetType, id: string | number | null | undefined) {
  // The version is a dependency so a reset (sign-in, sign-out) loads the item again.
  const storeVersion = useSyncExternalStore(subscribe, getVersion, getVersion);
  const key = id === null || id === undefined || id === '' ? '' : itemKey(type, String(id));
  useEffect(() => {
    ensureAuthListener();
    if (!key || items.has(key) || inflight.has(key) || missing) return;
    inflight.add(key);
    const set = pendingItems.get(type) || new Set<string>();
    set.add(String(id));
    pendingItems.set(type, set);
    scheduleFlush();
  }, [id, key, type, storeVersion]);
  if (!key || missing) return null;
  return items.get(key);
}

export function useFollowTarget(type: FollowTargetType, id: string | null | undefined) {
  const storeVersion = useSyncExternalStore(subscribe, getVersion, getVersion);
  const key = id ? `${type}:${id}` : '';
  useEffect(() => {
    ensureAuthListener();
    if (!key || follows.has(key) || inflight.has(key) || missing) return;
    inflight.add(key);
    pendingFollows[type].add(String(id));
    scheduleFlush();
  }, [id, key, type, storeVersion]);
  if (!key || missing) return null;
  return follows.get(key);
}

const patchItem = (key: string, patch: Partial<EngagementItemState>) => {
  const current = items.get(key);
  if (current) items.set(key, { ...current, ...patch });
  notify();
};

/**
 * Likes and saves for one item, with optimistic updates:
 *   const { item, toggleLike, toggleSave, saveTo, removeFrom, error } = useEngagement('page', page.id);
 * Signed-out visitors are sent to /login and brought back.
 */
export function useEngagement(type: EngagementTargetType, id: string | number | null | undefined) {
  const item = useEngagementItem(type, id);
  const [error, setError] = useState('');
  const key = id === null || id === undefined ? '' : itemKey(type, String(id));

  const setLiked = useCallback(async (liked: boolean) => {
    if (!key) return;
    setError('');
    if (await requireSignIn()) return;
    const before = items.get(key);
    if (!before) return;
    patchItem(key, { liked, likes: Math.max(0, before.likes + (liked === before.liked ? 0 : liked ? 1 : -1)) });
    try {
      const result = await rpc<{ liked: boolean; likes_count: number }>('rwp_set_like', { p_target_type: type, p_target_id: String(id), p_liked: liked });
      patchItem(key, { liked: result.liked, likes: Number(result.likes_count) || 0 });
    } catch (likeError: unknown) {
      items.set(key, before);
      notify();
      setError(likeError instanceof Error ? likeError.message : 'The like was not saved.');
    }
  }, [id, key, type]);

  const setSaved = useCallback(async (collection: string | null, saved: boolean) => {
    if (!key) return;
    setError('');
    if (await requireSignIn()) return;
    const before = items.get(key);
    if (!before) return;
    const name = collection?.trim() || defaultCollection;
    patchItem(key, {
      collections: saved
        ? [...new Set([...before.collections, name])].sort()
        : collection === null ? [] : before.collections.filter((entry) => entry !== name),
    });
    try {
      const result = await rpc<{ collections: string[] }>('rwp_set_bookmark', {
        p_target_type: type, p_target_id: String(id), p_collection: saved ? name : collection, p_saved: saved,
      });
      patchItem(key, { collections: result.collections || [] });
    } catch (saveError: unknown) {
      items.set(key, before);
      notify();
      setError(saveError instanceof Error ? saveError.message : 'The item was not saved.');
    }
  }, [id, key, type]);

  return {
    item,
    error,
    clearError: () => setError(''),
    toggleLike: () => (item ? setLiked(!item.liked) : Promise.resolve()),
    /** Saves to the default collection, or removes the item from every collection. */
    toggleSave: () => (item ? setSaved(item.collections.length ? null : defaultCollection, !item.collections.length) : Promise.resolve()),
    saveTo: (collection: string) => setSaved(collection, true),
    removeFrom: (collection: string) => setSaved(collection, false),
  };
}

/** Following an author (user) or a category, with an optimistic follower count. */
export function useFollow(type: FollowTargetType, id: string | null | undefined) {
  const state = useFollowTarget(type, id);
  const [error, setError] = useState('');

  const toggleFollow = useCallback(async () => {
    if (!id) return;
    setError('');
    if (await requireSignIn()) return;
    const key = `${type}:${id}`;
    const before = follows.get(key);
    if (!before || before.self) return;
    const following = !before.following;
    follows.set(key, { ...before, following, followers: Math.max(0, before.followers + (following ? 1 : -1)) });
    notify();
    try {
      const result = type === 'user'
        ? await rpc<{ following: boolean; followers: number }>('rwp_set_follow', { p_user: id, p_following: following })
        : await rpc<{ following: boolean; followers: number }>('rwp_set_category_follow', { p_category: id, p_following: following });
      follows.set(key, { ...before, following: result.following, followers: Number(result.followers) || 0 });
    } catch (followError: unknown) {
      follows.set(key, before);
      setError(followError instanceof Error ? followError.message : 'The follow was not saved.');
    }
    notify();
  }, [id, type]);

  return { state, error, toggleFollow };
}

export const defaultCollection = 'Saved Items';

// Visibility (Settings → Engagement) --------------------------------------------------------------

export type EngagementFeature = 'like' | 'save' | 'follow' | 'views';
/** 'auto' is a place the site adds buttons by itself; 'manual' is a shortcode or widget placed by hand. */
export type EngagementPlacement = 'auto' | 'manual';

/**
 * Whether a feature shows for a target. Manual placements follow only the global toggle, so an
 * editor who places [rwp_like] by hand gets it even where automatic buttons are off.
 */
export const engagementVisible = (
  settings: AppSettings['engagement'],
  feature: EngagementFeature,
  options: { targetType?: string; placement?: EngagementPlacement; context?: 'single' | 'archive' } = {},
): boolean => {
  const placement = options.placement || 'manual';
  if (feature === 'like') {
    if (!settings.show_like_global) return false;
    if (placement === 'manual') return true;
    return options.targetType === 'product' ? settings.show_like_on_products : settings.show_like_on_posts;
  }
  if (feature === 'save') return settings.show_save_global;
  if (feature === 'follow') {
    if (!settings.show_follow_global) return false;
    return placement === 'manual' || options.targetType !== 'user' || settings.show_follow_on_authors;
  }
  if (!settings.show_views_global) return false;
  if (placement === 'manual') return true;
  return options.context === 'archive' ? settings.show_views_on_archive : settings.show_views_on_single;
};

// Views ---------------------------------------------------------------------------------------------

const visitorStorageKey = 'rwp_visitor';
let memoryVisitor = '';

/** A random id for this browser, only ever sent to be hashed with a daily salt (see the migration). */
const visitorToken = () => {
  const make = () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  try {
    let token = localStorage.getItem(visitorStorageKey) || '';
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
      token = make();
      localStorage.setItem(visitorStorageKey, token);
    }
    return token;
  } catch {
    // Storage blocked (private mode): a token for this page load only.
    memoryVisitor = memoryVisitor || make();
    return memoryVisitor;
  }
};

const recorded = new Set<string>();

/**
 * Counts one view of a published item. The database decides whether it counts (30-minute window per
 * browser, authors excluded, Settings → Engagement → Count views). Never throws: a failed count must
 * not disturb the page.
 */
export const recordView = async (type: EngagementTargetType, id: string | number) => {
  const key = itemKey(type, String(id));
  if (recorded.has(key) || missing) return;
  recorded.add(key);
  // Not a visit: the editor's preview, and pages rendered for a crawler's prerender.
  if (new URLSearchParams(window.location.search).has('preview') || /bot|crawl|spider|headless/i.test(navigator.userAgent)) return;
  try {
    const counted = await rpc<boolean>('rwp_record_view', { p_target_type: type, p_target_id: String(id), p_session: visitorToken() });
    if (counted) {
      const current = items.get(key);
      if (current) patchItem(key, { views: current.views + 1 });
    }
  } catch {
    // Reported once by rpc() when the migration is missing; other failures only lose one count.
  }
};

/** Records a view once per mount of the calling component. */
export function useRecordView(type: EngagementTargetType, id: string | number | null | undefined, enabled = true) {
  useEffect(() => {
    if (!enabled || id === null || id === undefined || id === '') return;
    void recordView(type, id);
  }, [enabled, id, type]);
}

// Reads for feeds and screens ---------------------------------------------------------------------

export interface EngagementEntry {
  target_type: string;
  target_id: string;
  title: string;
  url: string;
  image: string | null;
  excerpt: string | null;
  published_at: string | null;
}

export interface PopularEntry extends EngagementEntry {
  views: number;
  likes: number;
  score: number;
}

export const fetchPopularContent = async (limit: number, timeframe: PopularTimeframe, types?: string[]): Promise<PopularEntry[]> => {
  const rows = await rpc<PopularEntry[]>('rwp_popular_content', {
    p_limit: limit, p_timeframe: timeframe, p_target_types: types && types.length ? types : null,
  });
  return (rows || []).map((row) => ({ ...row, views: Number(row.views) || 0, likes: Number(row.likes) || 0, score: Number(row.score) || 0 }));
};

export interface SavedEntry extends EngagementEntry {
  id: string;
  collection_name: string;
  saved_at: string;
  /** Unpublished or deleted since it was saved. */
  missing: boolean;
}

export interface SavedCollectionsResult {
  collections: Array<{ name: string; count: number }>;
  items: SavedEntry[];
}

export const fetchMyBookmarks = async (collection?: string | null): Promise<SavedCollectionsResult> => {
  const result = await rpc<SavedCollectionsResult>('rwp_my_bookmarks', { p_collection: collection || null });
  return { collections: result?.collections || [], items: result?.items || [] };
};

/** Removes one saved row. `.select()` because a delete refused by RLS reports no error. */
export const removeBookmark = async (bookmarkId: string) => {
  const { data, error } = await getSupabaseClient().from('bookmarks').delete().eq('id', bookmarkId).select('id,target_type,target_id');
  if (error) throw new Error(explainEngagementError(error));
  if (!data?.length) throw new Error('Nothing was removed: the item is no longer saved, or it belongs to another account.');
  resetEngagementState();
};

/** Moves an item to another collection (kept once if it is already there). */
export const moveBookmark = async (entry: SavedEntry, collection: string) => {
  const name = collection.trim();
  if (!name || name.length > 60) throw new Error('A collection name must be 1 to 60 characters long.');
  await rpc('rwp_set_bookmark', { p_target_type: entry.target_type, p_target_id: entry.target_id, p_collection: name, p_saved: true });
  await removeBookmark(entry.id);
};

export const renameCollection = async (from: string, to: string) => {
  await rpc<number>('rwp_rename_bookmark_collection', { p_from: from, p_to: to });
  resetEngagementState();
};

export interface FeedEntry extends EngagementEntry {
  author_id: string | null;
  author_name: string | null;
  category_name: string | null;
  reason: 'author' | 'category';
}

export const fetchFollowingFeed = async (limit = 20, before?: string | null): Promise<FeedEntry[]> =>
  (await rpc<FeedEntry[]>('rwp_following_feed', { p_limit: limit, p_before: before || null })) || [];

/** Everyone the signed-in person follows, for the Following tab's list. */
export const fetchMyFollows = async (): Promise<{ users: Array<{ id: string; name: string }>; categories: Array<{ id: string; name: string; slug: string }> }> => {
  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return { users: [], categories: [] };
  const [users, categories] = await Promise.all([
    supabase.from('follows').select('following_id, profiles!follows_following_id_fkey(display_name)').eq('follower_id', uid),
    supabase.from('taxonomy_follows').select('category_id, categories(name, slug)').eq('user_id', uid),
  ]);
  if (users.error) throw new Error(explainEngagementError(users.error));
  if (categories.error) throw new Error(explainEngagementError(categories.error));
  type UserRow = { following_id: string; profiles: { display_name: string | null } | null };
  type CategoryRow = { category_id: string; categories: { name: string; slug: string } | null };
  return {
    users: ((users.data || []) as unknown as UserRow[]).map((row) => ({ id: row.following_id, name: row.profiles?.display_name || 'Author' })),
    categories: ((categories.data || []) as unknown as CategoryRow[]).filter((row) => row.categories)
      .map((row) => ({ id: row.category_id, name: row.categories!.name, slug: row.categories!.slug })),
  };
};

export interface EngagementReport {
  days: number;
  since: string;
  totals: { views: number; likes: number; saves: number; follows: number; category_follows: number };
  daily: Array<{ date: string; views: number; likes: number }>;
  top: Array<{ target_type: string; target_id: string; title: string; url: string; views: number; likes: number; saves: number }>;
  top_authors: Array<{ id: string; name: string; followers: number }>;
}

export const fetchEngagementReport = async (days: number): Promise<EngagementReport> => {
  const report = await rpc<EngagementReport>('rwp_engagement_report', { p_days: days });
  const n = (value: unknown) => Number(value) || 0;
  return {
    ...report,
    totals: {
      views: n(report.totals?.views), likes: n(report.totals?.likes), saves: n(report.totals?.saves),
      follows: n(report.totals?.follows), category_follows: n(report.totals?.category_follows),
    },
    daily: (report.daily || []).map((day) => ({ date: day.date, views: n(day.views), likes: n(day.likes) })),
    top: (report.top || []).map((row) => ({ ...row, views: n(row.views), likes: n(row.likes), saves: n(row.saves) })),
    top_authors: (report.top_authors || []).map((row) => ({ ...row, followers: n(row.followers) })),
  };
};

export const recountLikes = () => rpc<number>('rwp_recount_likes', {});
