import { describeDbError, getSupabaseClient } from '../../../src/lib/db';
import { resolveExcerpt } from '../../../src/lib/excerpt';
import type { MenuItemRules } from '../../../src/lib/dynamicMenu';
import { loadSettings, type SiteSettings } from '../../../src/lib/settings';
import type { DynamicPost } from '../lib/dynamic';
import type { SectionNode } from '../lib/types';

export interface PostQuery {
  categoryId?: string;
  limit: number;
  page: number;
  orderBy: 'created_at' | 'updated_at' | 'title';
  order: 'asc' | 'desc';
  excludeId?: number | null;
  /** Matches the title (case-insensitive). */
  search?: string;
  /** Pages instead of posts. */
  pages?: boolean;
}

interface PageRow {
  id: number;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string | null;
  created_at: string;
  updated_at: string;
  og_image: string | null;
  author_id: string | null;
  categories: { name: string; slug: string } | null;
}

const authorCache = new Map<string, string>();

async function authorNames(ids: string[]): Promise<Map<string, string>> {
  const missing = [...new Set(ids)].filter((id) => id && !authorCache.has(id));
  if (missing.length) {
    const { data } = await getSupabaseClient().rpc('builder_author_names', { p_ids: missing });
    (data as Array<{ id: string; display_name: string }> | null || []).forEach((row) => authorCache.set(row.id, row.display_name));
    missing.forEach((id) => { if (!authorCache.has(id)) authorCache.set(id, ''); });
  }
  return authorCache;
}

/** Posts don't have a separate featured image column; the social image (og_image) doubles as one. */
export function toDynamicPost(row: PageRow, excerptLength = 30): DynamicPost {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: resolveExcerpt({ excerpt: row.excerpt || '', content: row.content || '' }, excerptLength),
    content: row.content || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    featured_image: row.og_image || '',
    author_name: row.author_id ? authorCache.get(row.author_id) || '' : '',
    category_name: row.categories?.name || '',
    category_slug: row.categories?.slug || '',
  };
}

const columns = 'id,title,slug,excerpt,content,created_at,updated_at,og_image,author_id,categories!pages_category_id_fkey(name,slug)';

export async function fetchPosts(query: PostQuery, excerptLength = 30): Promise<{ posts: DynamicPost[]; total: number }> {
  const from = (Math.max(1, query.page) - 1) * query.limit;
  let request = getSupabaseClient()
    .from('pages')
    .select(columns, { count: 'exact' })
    .eq('status', 'published')
    .eq('is_post', !query.pages)
    .order(query.orderBy, { ascending: query.order === 'asc' })
    .range(from, from + query.limit - 1);
  if (query.categoryId) request = request.eq('category_id', query.categoryId);
  if (query.excludeId) request = request.neq('id', query.excludeId);
  // % and _ are LIKE wildcards; escaped so a search for "50%" means the characters.
  if (query.search?.trim()) request = request.ilike('title', `%${query.search.trim().replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
  const { data, error, count } = await request;
  if (error) throw new Error(`Could not load posts: ${describeDbError(error)}`);
  const rows = (data || []) as unknown as PageRow[];
  await authorNames(rows.map((row) => row.author_id || ''));
  return { posts: rows.map((row) => toDynamicPost(row, excerptLength)), total: count || 0 };
}

export async function fetchDynamicPage(id: number): Promise<DynamicPost | null> {
  const { data, error } = await getSupabaseClient().from('pages').select(columns).eq('id', id).maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as PageRow;
  await authorNames([row.author_id || '']);
  return toDynamicPost(row, 55);
}

export interface MenuRecord {
  id: number;
  name: string;
  items: Array<MenuItemRules & { id: string; label: string; url: string; depth?: number }>;
}

let menusPromise: Promise<MenuRecord[]> | null = null;

export function fetchMenus(force = false): Promise<MenuRecord[]> {
  if (!menusPromise || force) {
    menusPromise = Promise.resolve(getSupabaseClient().from('menus').select('id,name,items').order('name'))
      .then(({ data, error }) => {
        if (error) throw new Error(`Could not load menus: ${describeDbError(error)}`);
        return ((data || []) as MenuRecord[]).map((menu) => ({ ...menu, items: Array.isArray(menu.items) ? menu.items : [] }));
      });
    menusPromise.catch(() => { menusPromise = null; });
  }
  return menusPromise;
}

let categoriesPromise: Promise<Array<{ id: string; name: string; slug: string }>> | null = null;

export function fetchCategories() {
  if (!categoriesPromise) {
    categoriesPromise = Promise.resolve(getSupabaseClient().from('categories').select('id,name,slug').order('name'))
      .then(({ data }) => (data || []) as Array<{ id: string; name: string; slug: string }>);
  }
  return categoriesPromise;
}

// Widget pack ------------------------------------------------------------------------------------

export const WIDGETS_MIGRATION = 'supabase/migrations/20260923_builder_widgets.sql';

const missingFunction = (message: string, name: string) =>
  new RegExp(`${name}|PGRST202|Could not find the function`, 'i').test(message) && /PGRST202|Could not find|does not exist/i.test(message);

/** Published posts per category, for Categories, Tag Cloud and Taxonomy Filter. */
export async function fetchCategoryCounts(): Promise<Array<{ id: string; name: string; slug: string; count: number }>> {
  const supabase = getSupabaseClient();
  const [categories, { data, error }] = await Promise.all([
    fetchCategories(),
    supabase.from('pages').select('category_id').eq('status', 'published').eq('is_post', true).not('category_id', 'is', null),
  ]);
  if (error) throw new Error(`Could not count posts per category: ${describeDbError(error)}`);
  const counts = new Map<string, number>();
  (data as Array<{ category_id: string }> | null || []).forEach((row) => counts.set(row.category_id, (counts.get(row.category_id) || 0) + 1));
  return categories.map((category) => ({ ...category, count: counts.get(category.id) || 0 }));
}

export interface PostLink { id: number; title: string; slug: string; created_at: string; is_post?: boolean; category_id?: string | null }

/** Lightweight title/slug/date rows, for Archives, Calendar, Pages, Sitemap and Recent Posts. */
export async function fetchPostLinks(options: { pages?: boolean; limit?: number; orderBy?: 'created_at' | 'title'; ascending?: boolean; from?: string; to?: string } = {}): Promise<PostLink[]> {
  let request = getSupabaseClient().from('pages')
    .select('id,title,slug,created_at,is_post,category_id')
    .eq('status', 'published')
    .eq('is_post', !options.pages)
    .order(options.orderBy || 'created_at', { ascending: Boolean(options.ascending) })
    .limit(options.limit || 500);
  if (options.from) request = request.gte('created_at', options.from);
  if (options.to) request = request.lt('created_at', options.to);
  const { data, error } = await request;
  if (error) throw new Error(`Could not load ${options.pages ? 'pages' : 'posts'}: ${describeDbError(error)}`);
  return (data || []) as PostLink[];
}

/** The published posts before and after a date, for Post Navigation. */
export async function fetchAdjacentPosts(current: { id: number; created_at: string }, categoryId?: string | null): Promise<{ previous: PostLink | null; next: PostLink | null }> {
  const base = () => {
    let request = getSupabaseClient().from('pages').select('id,title,slug,created_at').eq('status', 'published').eq('is_post', true).neq('id', current.id);
    if (categoryId) request = request.eq('category_id', categoryId);
    return request;
  };
  const [previous, next] = await Promise.all([
    base().lt('created_at', current.created_at).order('created_at', { ascending: false }).limit(1),
    base().gt('created_at', current.created_at).order('created_at', { ascending: true }).limit(1),
  ]);
  const error = previous.error || next.error;
  if (error) throw new Error(`Could not load the previous and next posts: ${describeDbError(error)}`);
  return { previous: (previous.data?.[0] as PostLink | undefined) || null, next: (next.data?.[0] as PostLink | undefined) || null };
}

/** Category of the current page (DynamicPost has only its name and slug). */
export async function fetchPageCategoryId(pageId: number): Promise<string | null> {
  const { data } = await getSupabaseClient().from('pages').select('category_id').eq('id', pageId).maybeSingle();
  return (data as { category_id?: string | null } | null)?.category_id || null;
}

export interface AuthorProfile { display_name: string; avatar_url: string | null; bio: string | null }

export async function fetchAuthorProfile(pageId: number): Promise<AuthorProfile | null> {
  const { data, error } = await getSupabaseClient().rpc('builder_author_profile', { p_page_id: pageId });
  if (error) {
    const message = describeDbError(error);
    if (missingFunction(message, 'builder_author_profile')) throw new Error(`The Author Box needs the builder_author_profile function. Run ${WIDGETS_MIGRATION} in the Supabase SQL Editor.`);
    throw new Error(`Could not load the author: ${message}`);
  }
  return ((data as AuthorProfile[] | null) || [])[0] || null;
}

export interface RecentComment { id: number; content: string; created_at: string; author_name: string | null; page: { title: string; slug: string } | null; author: { display_name: string | null } | null }

export async function fetchRecentComments(limit: number): Promise<RecentComment[]> {
  const { data, error } = await getSupabaseClient().from('comments')
    .select('id,content,created_at,author_name,page:pages(title,slug),author:profiles!comments_author_id_fkey(display_name)')
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load comments: ${describeDbError(error)}`);
  return (data || []) as unknown as RecentComment[];
}

// Templates -----------------------------------------------------------------------------------------

const templateCache = new Map<string, Promise<SectionNode[]>>();

/** A saved template's sections, readable by visitors only when a published page uses it (see the migration). */
export function fetchTemplateContent(id: string): Promise<SectionNode[]> {
  let promise = templateCache.get(id);
  if (!promise) {
    promise = Promise.resolve(getSupabaseClient().rpc('builder_template_public', { p_id: id })).then(({ data, error }) => {
      if (error) {
        const message = describeDbError(error);
        if (missingFunction(message, 'builder_template_public')) throw new Error(`Templates cannot be shown on pages yet. Run ${WIDGETS_MIGRATION} in the Supabase SQL Editor.`);
        throw new Error(`Could not load the template: ${message}`);
      }
      if (!data) throw new Error('This template was deleted, or it is not used on any published page yet (templates become public once a published page uses them).');
      const content = (data as { content?: unknown }).content;
      return (Array.isArray(content) ? content : []) as SectionNode[];
    });
    promise.catch(() => templateCache.delete(id));
    templateCache.set(id, promise);
  }
  return promise;
}

/** Choices for template pickers in the editor (signed-in builders can list templates). */
export async function templateOptions(): Promise<Array<{ value: string; label: string }>> {
  const { data, error } = await getSupabaseClient().from('elementor_templates').select('id,title,type').order('title');
  if (error) throw new Error(`Could not list templates: ${describeDbError(error)}`);
  return ((data || []) as Array<{ id: string; title: string; type: string }>)
    .map((row) => ({ value: row.id, label: `${row.title} (${row.type})` }));
}

let settingsPromise: Promise<SiteSettings> | null = null;

/** Site title, logo and comment settings, loaded once per page view. */
export function fetchSiteSettings(): Promise<SiteSettings> {
  if (!settingsPromise) {
    settingsPromise = loadSettings();
    settingsPromise.catch(() => { settingsPromise = null; });
  }
  return settingsPromise;
}
