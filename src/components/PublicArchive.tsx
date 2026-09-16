import { useEffect, useState } from 'react';
import { describeDbError, getSupabaseClient } from '../lib/db';
import { resolveExcerpt } from '../lib/excerpt';
import type { RwpArchive } from '../lib/rwp';
import { applyDocumentTitle, loadSettings } from '../lib/settings';
import PublicChrome from './PublicChrome';
import SiteTemplate from './SiteTemplate';
import styles from './PublicHome.module.css';

interface ArchivePost { id: number; title: string; slug: string; excerpt: string | null; content: string | null; created_at: string }

const monthName = (month: number) => new Date(2000, month - 1, 1).toLocaleString(undefined, { month: 'long' });

/** /search?s=, /category/:slug, /author/:id and /date/:year[/:month] as a route. Returns null for other paths. */
export function archiveFromPath(pathname: string, search: string): RwpArchive | null {
  const parts = pathname.split('/').filter(Boolean).map((part) => { try { return decodeURIComponent(part); } catch { return part; } });
  if (parts[0] === 'search' && parts.length === 1) return { kind: 'search', term: new URLSearchParams(search).get('s') || '' };
  if (parts[0] === 'category' && parts.length === 2) return { kind: 'category', slug: parts[1] };
  if (parts[0] === 'author' && parts.length === 2) return { kind: 'author', id: parts[1] };
  if (parts[0] === 'date' && (parts.length === 2 || parts.length === 3)) {
    const year = Number(parts[1]);
    const month = parts[2] === undefined ? undefined : Number(parts[2]);
    if (!Number.isInteger(year) || year < 1000 || year > 9999) return null;
    if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) return null;
    return { kind: 'date', year, month };
  }
  return null;
}

/** Most specific first: archive_category, then the shared archive. Search has its own template. */
export const archiveTemplateTypes = (archive: RwpArchive) =>
  archive.kind === 'search' ? ['search'] : [`archive_${archive.kind}`, 'archive'];

/** Used when no archive template is published: a plain, paginated list of matching posts. */
function DefaultArchive({ archive }: { archive: RwpArchive }) {
  const pageNumber = Math.max(1, Math.floor(Number(new URLSearchParams(window.location.search).get('paged')) || 1));
  const [state, setState] = useState<{ title: string; posts: ArchivePost[]; pages: number; error: string; loading: boolean }>({ title: '', posts: [], pages: 1, error: '', loading: true });

  const archiveKey = JSON.stringify(archive);
  useEffect(() => {
    let active = true;
    const archive = JSON.parse(archiveKey) as RwpArchive;
    const load = async () => {
      const supabase = getSupabaseClient();
      const settings = await loadSettings();
      const perPage = settings.posts_per_page;
      let title = '';
      let query = supabase.from('pages').select('id,title,slug,excerpt,content,created_at', { count: 'exact' })
        .eq('status', 'published').eq('is_post', true).order('created_at', { ascending: false })
        .range((pageNumber - 1) * perPage, pageNumber * perPage - 1);
      if (archive.kind === 'search') {
        title = archive.term ? `Search results for “${archive.term}”` : 'Search';
        query = query.ilike('title', `%${archive.term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
      } else if (archive.kind === 'category') {
        const { data: category } = await supabase.from('categories').select('id,name').eq('slug', archive.slug).maybeSingle();
        title = `Category: ${category?.name || archive.slug}`;
        query = query.eq('category_id', category?.id || '00000000-0000-0000-0000-000000000000');
      } else if (archive.kind === 'author') {
        const { data: names } = await supabase.rpc('builder_author_names', { p_ids: [archive.id] });
        title = `Posts by ${(names as Array<{ display_name: string }> | null)?.[0]?.display_name || 'this author'}`;
        query = query.eq('author_id', archive.id);
      } else {
        const from = new Date(Date.UTC(archive.year, (archive.month || 1) - 1, 1));
        const to = archive.month ? new Date(Date.UTC(archive.year, archive.month, 1)) : new Date(Date.UTC(archive.year + 1, 0, 1));
        title = archive.month ? `${monthName(archive.month)} ${archive.year}` : String(archive.year);
        query = query.gte('created_at', from.toISOString()).lt('created_at', to.toISOString());
      }
      const { data, error, count } = await query;
      if (!active) return;
      applyDocumentTitle(settings.site_title, title);
      // A page past the end is a 416 from PostgREST (PGRST103): show it as empty.
      if (error && error.code !== 'PGRST103') {
        setState({ title, posts: [], pages: 1, error: `Could not load the posts: ${describeDbError(error)}`, loading: false });
        return;
      }
      setState({ title, posts: (data || []) as ArchivePost[], pages: Math.max(1, Math.ceil((count || 0) / perPage)), error: '', loading: false });
    };
    load().catch((loadError: unknown) => active && setState((current) => ({ ...current, error: describeDbError(loadError), loading: false })));
    return () => { active = false; };
  }, [archiveKey, pageNumber]);

  const href = (page: number) => {
    const params = new URLSearchParams(window.location.search);
    if (page <= 1) params.delete('paged'); else params.set('paged', String(page));
    const query = params.toString();
    return `${window.location.pathname}${query ? `?${query}` : ''}`;
  };

  return (
    <main className={`${styles.container} rwp-archive`}>
      <section className={`${styles.feed} rwp-posts-feed`} aria-labelledby="archive-heading">
        <h1 id="archive-heading">{state.title}</h1>
        {archive.kind === 'search' && (
          <form action="/search" method="get" role="search" className="rwp-archive-search">
            <input type="search" name="s" defaultValue={archive.term} placeholder="Search posts…" aria-label="Search posts" />
            <button type="submit">Search</button>
          </form>
        )}
        {state.loading && <p className={styles.muted}>Loading…</p>}
        {state.error && <div className={styles.error} role="alert"><p>{state.error}</p></div>}
        {!state.loading && !state.error && !state.posts.length && <p className={styles.muted}>No posts found.</p>}
        {state.posts.map((post) => (
          <article className={`${styles.postCard} rwp-post-card`} key={post.id}>
            <p className={styles.postMeta}>{new Date(post.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            <h3><a href={`/${post.slug}`}>{post.title}</a></h3>
            <p>{resolveExcerpt({ excerpt: post.excerpt || '', content: post.content || '' }, 30)}</p>
          </article>
        ))}
        {state.pages > 1 && (
          <nav className="rwpt-pagination" aria-label="Post pages">
            {pageNumber > 1 && <a href={href(pageNumber - 1)} rel="prev">← Newer posts</a>}
            {pageNumber < state.pages && <a href={href(pageNumber + 1)} rel="next">Older posts →</a>}
          </nav>
        )}
      </section>
    </main>
  );
}

export default function PublicArchive({ archive }: { archive: RwpArchive }) {
  return (
    <PublicChrome>
      <SiteTemplate types={archiveTemplateTypes(archive)} archive={archive} fallback={<DefaultArchive archive={archive} />} />
    </PublicChrome>
  );
}
