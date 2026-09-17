import { describeDbError, getSupabaseClient } from '../../../../src/lib/db';

/**
 * SEO signals that need the rest of the site rather than this page: how many clicks the page is
 * from the home page, and whether another page already uses its meta description.
 */

export type Loadable<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error'; message: string };

export interface ClickDepth {
  /** Clicks from the home page; null when no published page, menu or header/footer links to it. */
  depth: number | null;
  /** Human-readable route, e.g. ["Home", "Main menu", "Blog"]. */
  path: string[];
}

interface PageRow {
  id: number;
  title: string;
  slug: string;
  content: string | null;
  builder_data: unknown;
  is_site_template?: boolean;
  template_type?: string | null;
}

/** Page slugs a blob of HTML or layout JSON links to: "/slug", "/slug/", or this site's absolute URL. */
export function linkedSlugs(source: string, origin: string): Set<string> {
  const slugs = new Set<string>();
  const text = source.split(origin).join('');
  // A quote, bracket or equals sign, then "/slug" ending at a quote, slash, #, ? or bracket.
  const pattern = /["'(=]\s*\/([a-z0-9][a-z0-9_-]*)\/?(?=["')#?\\\s])/gi;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) slugs.add(match[1].toLowerCase());
  return slugs;
}

const stringify = (value: unknown) => (typeof value === 'string' ? value : value ? JSON.stringify(value) : '');

export async function computeClickDepth(target: { id: number; slug: string }): Promise<ClickDepth> {
  const supabase = getSupabaseClient();
  const origin = window.location.origin;
  let pagesQuery: { data: unknown[] | null; error: unknown } = await supabase.from('pages')
    .select('id,title,slug,content,builder_data,is_site_template,template_type')
    .eq('status', 'published').limit(2000);
  // Before the site templates migration those columns do not exist.
  if (pagesQuery.error && /is_site_template|template_type/.test(describeDbError(pagesQuery.error))) {
    pagesQuery = await supabase.from('pages').select('id,title,slug,content,builder_data').eq('status', 'published').limit(2000);
  }
  if (pagesQuery.error) throw new Error(`Could not read pages for the click depth check: ${describeDbError(pagesQuery.error)}`);
  const [menusQuery, homeQuery] = await Promise.all([
    supabase.from('menus').select('name,items'),
    supabase.from('options').select('option_value').eq('option_name', 'home_page_id').maybeSingle(),
  ]);

  const pages = (pagesQuery.data || []) as PageRow[];
  const bySlug = new Map(pages.filter((page) => !page.is_site_template).map((page) => [page.slug.toLowerCase(), page]));
  // A draft is not in the published list, but links to its slug still count toward its depth.
  if (!bySlug.has(target.slug.toLowerCase())) {
    bySlug.set(target.slug.toLowerCase(), { id: target.id, title: 'This page', slug: target.slug, content: '', builder_data: null });
  }
  const homeId = Number(homeQuery.data?.option_value) || null;
  const home = homeId ? pages.find((page) => page.id === homeId) : undefined;
  if (home && home.id === target.id) return { depth: 0, path: ['Home'] };

  // Menus, the header and the footer are on every page, so whatever they link to is one click away.
  const everywhere: Array<{ label: string; source: string }> = [
    ...((menusQuery.data || []) as Array<{ name: string; items: unknown }>).map((menu) => ({ label: `${menu.name} menu`, source: stringify(menu.items) })),
    ...pages.filter((page) => page.is_site_template && ['header', 'footer'].includes(page.template_type || ''))
      .map((page) => ({ label: `${page.template_type} template`, source: `${page.content || ''}${stringify(page.builder_data)}` })),
  ];

  const depth = new Map<number, { depth: number; path: string[] }>();
  const queue: PageRow[] = [];
  const visit = (page: PageRow | undefined, entry: { depth: number; path: string[] }) => {
    if (!page || depth.has(page.id)) return;
    depth.set(page.id, entry);
    queue.push(page);
  };

  if (home) visit(home, { depth: 0, path: ['Home'] });
  everywhere.forEach(({ label, source }) => linkedSlugs(source, origin)
    .forEach((slug) => visit(bySlug.get(slug), { depth: 1, path: ['Home', label, bySlug.get(slug)?.title || slug] })));

  while (queue.length) {
    const page = queue.shift()!;
    const from = depth.get(page.id)!;
    if (page.id === target.id) return from;
    linkedSlugs(`${page.content || ''}${stringify(page.builder_data)}`, origin)
      .forEach((slug) => visit(bySlug.get(slug), { depth: from.depth + 1, path: [...from.path, bySlug.get(slug)?.title || slug] }));
  }
  const found = depth.get(target.id);
  return found || { depth: null, path: [] };
}

/** Titles of other pages with the same meta description. */
export async function findDuplicateDescriptions(pageId: number, description: string): Promise<string[]> {
  const value = description.trim();
  if (!value) return [];
  const { data, error } = await getSupabaseClient().from('pages').select('title').eq('meta_description', value).neq('id', pageId).limit(5);
  if (error) throw new Error(`Could not check other pages' descriptions: ${describeDbError(error)}`);
  return ((data || []) as Array<{ title: string }>).map((row) => row.title);
}
