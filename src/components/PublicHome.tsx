import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getSupabaseClient } from '../lib/db';
import { fetchProfile } from '../lib/profiles';
import { getUserRole, type UserRole } from '../lib/roles';
import { resolveExcerpt } from '../lib/excerpt';
import { defaultSettings, loadSettings, type SiteSettings } from '../lib/settings';
import type { Post } from '../lib/types';
import PublicLayout from './PublicLayout';
import PublicSidebar from './PublicSidebar';
import ContentRenderer from './ContentRenderer';
import { BlockFrame } from './theme/ThemeLayoutRenderer';
import { applyMeta, buildMeta } from '../lib/seo';
import { useAppSettings } from '../lib/appSettings';
import { cleanUrl, fillPlaceholders, useTheme, type IndexOptions, type ThemeBlock } from '../lib/theme';
import styles from './PublicHome.module.css';
import { rwp } from '../lib/rwp';
import { signOutAndRedirect } from '../lib/account';

const defaultTitle = defaultSettings.site_title;
const defaultMenuLinks = [
  { label: 'Home', url: '/' },
  { label: 'Sample Page', url: '/sample-page' },
];
const seedPost: Post = {
  id: 0,
  title: 'Hello World!',
  slug: 'hello-world',
  content: 'Welcome to React-WP. This is your first post. Edit or delete it, then start writing!',
  excerpt: 'Welcome to React-WP. This is your first post. Edit or delete it, then start writing!',
  status: 'published',
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

const formatDate = (date: string) =>
  new Date(date).getTime() === 0
    ? 'Welcome'
    : new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

const postColumns = 'id,title,slug,content,excerpt,status,author_id,created_at,updated_at,is_post';

const requestedPage = () => Math.max(1, Math.floor(Number(new URLSearchParams(window.location.search).get('paged')) || 1));

const pageHref = (page: number) => {
  const params = new URLSearchParams(window.location.search);
  if (page <= 1) params.delete('paged'); else params.set('paged', String(page));
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}`;
};

/** First, last, and two either side of the current page, with gaps marked as null. */
const pageNumbers = (current: number, total: number): Array<number | null> => {
  const wanted = new Set([1, total, current - 2, current - 1, current, current + 1, current + 2]);
  const sorted = [...wanted].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  return sorted.flatMap((page, index) => (index > 0 && page - sorted[index - 1] > 1 ? [null, page] : [page]));
};

function Pagination({ style, page, pageCount, loadingMore, onLoadMore }: {
  style: IndexOptions['pagination_style'];
  page: number;
  pageCount: number;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (pageCount <= 1) return null;
  if (style === 'load-more') {
    return page < pageCount ? (
      <div className="rwpt-pagination">
        <button type="button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more posts'}</button>
      </div>
    ) : null;
  }
  if (style === 'prev-next') {
    return (
      <nav className="rwpt-pagination" aria-label="Post pages">
        {page > 1 && <a href={pageHref(page - 1)} rel="prev">← Newer posts</a>}
        {page < pageCount && <a href={pageHref(page + 1)} rel="next">Older posts →</a>}
      </nav>
    );
  }
  return (
    <nav className="rwpt-pagination" aria-label="Post pages">
      {pageNumbers(page, pageCount).map((number, index) => (number === null
        ? <span key={`gap-${index}`} aria-hidden="true">…</span>
        : <a key={number} href={pageHref(number)} aria-current={number === page ? 'page' : undefined}>{number}</a>))}
    </nav>
  );
}

export default function PublicHome({ onReconfigure }: { onReconfigure?: () => void }) {
  const [siteTitle, setSiteTitle] = useState('');
  const [posts, setPosts] = useState<Post[]>([]);
  const [totalPosts, setTotalPosts] = useState(0);
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('s') || '');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [adminEmail, setAdminEmail] = useState<string>();
  const [userRole, setUserRole] = useState<UserRole>('subscriber');
  const [menuLinks, setMenuLinks] = useState(defaultMenuLinks);
  const [settings, setSettings] = useState<SiteSettings>(defaultSettings);
  const [excerptLength, setExcerptLength] = useState(55);
  const { settings: appSettings } = useAppSettings();
  const { theme } = useTheme();
  const { containers, options } = theme.layout.index;
  const blocks = (containers[0]?.blocks || []).filter((block) => block.style.visible);
  const paginated = blocks.some((block) => block.type === 'posts-pagination');
  // Load more always starts at page one and appends; the other styles are real ?paged= URLs.
  const startPage = paginated && options.pagination_style !== 'load-more' ? requestedPage() : 1;
  const [page, setPage] = useState(startPage);

  useEffect(() => {
    let mounted = true;
    const loadHome = async () => {
      try {
        const supabase = getSupabaseClient();
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const user = sessionData.session?.user;
        if (mounted && user) {
          setAdminEmail(user.email || undefined);
          const profile = await fetchProfile(user.id).catch(() => null);
          if (mounted) setUserRole(profile ? profile.role : getUserRole(user));
        }

        const settings = await loadSettings();
        const from = (startPage - 1) * settings.posts_per_page;
        const [{ data: menuOption }, { data, error: postsError, count }] = await Promise.all([
          supabase.from('options').select('option_value').eq('option_name', 'menu_links').maybeSingle(),
          supabase
            .from('pages')
            .select(postColumns, { count: 'exact' })
            .eq('status', 'published')
            .eq('is_post', true)
            .order('created_at', { ascending: false })
            .range(from, from + settings.posts_per_page - 1),
        ]);
        // Asking for a page past the end is a 416 from PostgREST; treat it as an empty page.
        if (postsError && postsError.code !== '42P01' && postsError.code !== 'PGRST205' && postsError.code !== 'PGRST103') throw postsError;
        if (mounted) {
          setSettings(settings);
          setSiteTitle(rwp.filters.apply('rwp_site_title', settings.site_title || defaultTitle));
          setExcerptLength(settings.excerpt_length);
          applyMeta(buildMeta(null, {
            siteTitle: settings.site_title || defaultTitle,
            siteTagline: settings.site_tagline,
            siteIcon: settings.site_icon,
            origin: window.location.origin,
          }));
          if (menuOption?.option_value) {
            try {
              const parsed = JSON.parse(menuOption.option_value);
              if (Array.isArray(parsed) && parsed.every((link) => link && typeof link.label === 'string' && typeof link.url === 'string')) {
                setMenuLinks(rwp.filters.apply('rwp_public_menu', parsed));
              }
            } catch {
              // Keep the default menu when an option contains invalid JSON.
            }
          }
          setPosts(rwp.filters.apply('rwp_posts', (data || []) as Post[]));
          setTotalPosts(count || 0);
        }
      } catch (loadError: unknown) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'Unable to load posts.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void loadHome();
    rwp.actions.do('rwp_public_loaded');
    return () => { mounted = false; };
    // startPage is read once: changing pages is a navigation, which remounts the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const from = page * settings.posts_per_page;
      const { data, error: moreError } = await getSupabaseClient()
        .from('pages')
        .select(postColumns)
        .eq('status', 'published')
        .eq('is_post', true)
        .order('created_at', { ascending: false })
        .range(from, from + settings.posts_per_page - 1);
      if (moreError) throw moreError;
      setPosts((current) => [...current, ...rwp.filters.apply('rwp_posts', (data || []) as Post[])]);
      setPage((current) => current + 1);
    } catch (moreError: unknown) {
      setError(moreError instanceof Error ? moreError.message : 'More posts could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  };

  const visiblePosts = useMemo(() => {
    const source = posts.length || startPage > 1 ? posts : [seedPost];
    const term = search.trim().toLowerCase();
    return term ? source.filter((post) => `${post.title} ${post.excerpt} ${post.content}`.toLowerCase().includes(term)) : source;
  }, [posts, search, startPage]);
  const recentPosts = (posts.length ? posts : [seedPost]).slice(0, 5);
  const pageCount = Math.max(1, Math.ceil(totalPosts / settings.posts_per_page));
  const fill = (value: unknown) => fillPlaceholders(String(value ?? ''), { site_title: siteTitle, site_tagline: settings.site_tagline });

  const renderBlock = (block: ThemeBlock) => {
    const s = block.settings;
    switch (block.type) {
      case 'hero':
        return (
          <section className={`${styles.hero} rwp-hero`} aria-labelledby={`hero-${block.id}`}>
            {s.kicker && <p className={styles.kicker}>{fill(s.kicker)}</p>}
            <h1 id={`hero-${block.id}`}>{fill(s.heading)}</h1>
            {s.text && <p>{fill(s.text)}</p>}
            {s.button_label && (
              <a className={styles.heroLink} href={cleanUrl(s.button_url) || '/'}>{fill(s.button_label)} <span aria-hidden="true">→</span></a>
            )}
          </section>
        );
      case 'posts-feed':
        return (
          <section className={[styles.feed, 'rwp-posts-feed'].filter(Boolean).join(' ')} aria-label={String(s.heading || 'Posts')}>
            <div className={styles.sectionHeading}>
              <div>
                {s.kicker && <p className={styles.kicker}>{String(s.kicker)}</p>}
                {s.heading && <h2>{String(s.heading)}</h2>}
              </div>
              {loading && <span className={styles.muted}>Loading…</span>}
            </div>
            {error && (
              <div className={styles.error} role="alert">
                <p>Supabase could not be reached, so database posts are unavailable. ({error})</p>
                {onReconfigure && <button type="button" onClick={onReconfigure}>Reconfigure Supabase</button>}
              </div>
            )}
            <div className="rwpt-feed-grid" style={{ '--rwpt-columns': Number(s.columns) || 1 } as CSSProperties}>
              {visiblePosts.length ? visiblePosts.map((post) => (
                <article className={`${styles.postCard} rwp-post-card`} key={post.id}>
                  {s.show_meta && appSettings.general.show_post_dates && <p className={styles.postMeta}>{formatDate(post.created_at)} · {post.status}</p>}
                  <h3 className={appSettings.general.show_post_titles ? undefined : styles.srOnly}>{rwp.filters.apply('rwp_post_title', post.title, post)}</h3>
                  {s.show_excerpt && <p>{rwp.filters.apply('rwp_post_excerpt', resolveExcerpt(post, excerptLength, settings.excerpt_unit), post)}</p>}
                  <a href={`/${post.slug}`}>{String(s.read_more || 'Read More')} <span aria-hidden="true">→</span></a>
                </article>
              )) : <p className={styles.muted}>{search.trim() ? 'No posts match your search.' : 'No posts on this page.'}</p>}
            </div>
          </section>
        );
      case 'posts-pagination':
        return <Pagination style={options.pagination_style} page={page} pageCount={pageCount} loadingMore={loadingMore} onLoadMore={() => void loadMore()} />;
      case 'custom-html':
        return <>{s.title && <h2>{String(s.title)}</h2>}<ContentRenderer className={styles.content} html={String(s.html || '')} /></>;
      case 'text':
        return <p className="rwpt-text">{fill(s.text)}</p>;
      default:
        return null;
    }
  };

  // Consecutive full-width blocks render outside the content grid; the sidebar sits beside the
  // first run of contained blocks, as the hero and post feed did before the Theme Editor.
  const segments: Array<{ full: boolean; blocks: ThemeBlock[] }> = [];
  blocks.forEach((block) => {
    const full = Boolean(block.settings.full_width);
    const last = segments[segments.length - 1];
    if (last && last.full === full) last.blocks.push(block);
    else segments.push({ full, blocks: [block] });
  });
  const sidebarSegment = options.sidebar_position === 'hidden' ? -1 : segments.findIndex((segment) => !segment.full);
  const frames = (items: ThemeBlock[]) => items.map((block) => <BlockFrame key={block.id} block={block}>{renderBlock(block)}</BlockFrame>);

  return (
    <PublicLayout
      siteTitle={siteTitle}
      branding={settings}
      adminEmail={adminEmail}
      role={userRole}
      menuLinks={menuLinks}
      layout={settings.home_layout}
      showAuthLinks={settings.show_auth_links}
      canRegister={settings.users_can_register}
      toolbar={settings.admin_toolbar}
      onViewAdmin={() => { window.location.href = `${window.location.origin}/admin`; }}
      onLogout={() => void signOutAndRedirect(settings)}
    >
      <main className={`${settings.home_layout === 'full' ? styles.containerFull : settings.home_layout === 'wide' ? styles.containerWide : styles.container} rwp-index`}>
        {segments.map((segment, index) => {
          if (segment.full) return <div key={index} className="rwpt-index-full">{frames(segment.blocks)}</div>;
          if (index !== sidebarSegment) return <div key={index} className="rwpt-index-main">{frames(segment.blocks)}</div>;
          return (
            <div key={index} className={`${styles.grid} rwpt-grid rwpt-sidebar-${options.sidebar_position}`}>
              <div className="rwpt-index-main">{frames(segment.blocks)}</div>
              <PublicSidebar recentPosts={recentPosts} search={search} onSearch={setSearch} />
            </div>
          );
        })}
      </main>
    </PublicLayout>
  );
}
