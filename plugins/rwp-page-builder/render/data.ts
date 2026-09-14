import { describeDbError, getSupabaseClient } from '../../../src/lib/db';
import { resolveExcerpt } from '../../../src/lib/excerpt';
import type { MenuItemRules } from '../../../src/lib/dynamicMenu';
import type { DynamicPost } from '../lib/dynamic';

export interface PostQuery {
  categoryId?: string;
  limit: number;
  page: number;
  orderBy: 'created_at' | 'updated_at' | 'title';
  order: 'asc' | 'desc';
  excludeId?: number | null;
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
    .eq('is_post', true)
    .order(query.orderBy, { ascending: query.order === 'asc' })
    .range(from, from + query.limit - 1);
  if (query.categoryId) request = request.eq('category_id', query.categoryId);
  if (query.excludeId) request = request.neq('id', query.excludeId);
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
