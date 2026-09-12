import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../lib/db';
import type { Page } from '../lib/types';
import { fetchProfile } from '../lib/profiles';
import { canManageAllPosts, getUserRole, type UserRole } from '../lib/roles';
import { resolveExcerpt } from '../lib/excerpt';
import { defaultSettings, loadSettings, type SiteSettings } from '../lib/settings';
import { applyMeta, buildMeta } from '../lib/seo';
import PublicLayout from './PublicLayout';
import PublicSidebar from './PublicSidebar';
import ContentRenderer from './ContentRenderer';
import CommentSection from './CommentSection';
import styles from './PublicHome.module.css';
import { rwp } from '../lib/rwp';

const defaultMenuLinks = [
  { label: 'Home', url: '/' },
  { label: 'Sample Page', url: '/sample-page' },
];

interface PublicContentProps {
  slug?: string;
  pageId?: string;
  onReconfigure?: () => void;
}

export default function PublicContent({ slug, pageId, onReconfigure }: PublicContentProps) {
  const [page, setPage] = useState<Page | null>(null);
  const [siteTitle, setSiteTitle] = useState('Just another React-WP site');
  const [settings, setSettings] = useState<SiteSettings>(defaultSettings);
  const [excerptLength, setExcerptLength] = useState(55);
  const [menuLinks, setMenuLinks] = useState(defaultMenuLinks);
  const [adminEmail, setAdminEmail] = useState<string>();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<UserRole>('subscriber');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const supabase = getSupabaseClient();
        const query = supabase.from('pages').select('*');
        const [{ data, error: pageError }, { data: menuOption }, { data: sessionData }, settings] = await Promise.all([
          pageId
            ? query.eq('id', pageId).eq('status', 'published').maybeSingle()
            : query.eq('slug', slug).eq('status', 'published').maybeSingle(),
          supabase.from('options').select('option_value').eq('option_name', 'menu_links').maybeSingle(),
          supabase.auth.getSession(),
          loadSettings(),
        ]);
        if (pageError) throw pageError;
        if (!mounted) return;

        setPage(data as Page | null);
        setSettings(settings);
        setSiteTitle(rwp.filters.apply('rwp_site_title', settings.site_title));
        setExcerptLength(settings.excerpt_length);
        applyMeta(buildMeta(data as Page | null, {
          siteTitle: settings.site_title,
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

        const user = sessionData.session?.user;
        if (user) {
          setAdminEmail(user.email || undefined);
          setUserId(user.id);
          const profile = await fetchProfile(user.id).catch(() => null);
          if (mounted) setRole(profile ? profile.role : getUserRole(user));
        }
      } catch (loadError: unknown) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'Unable to load this page.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => { mounted = false; };
  }, [pageId, slug]);

  const canEdit = canManageAllPosts(role) || Boolean(page?.author_id && page.author_id === userId);
  const containerClass = page?.layout === 'full'
    ? styles.containerFull
    : page?.layout === 'wide' ? styles.containerWide : styles.container;
  const withSidebar = Boolean(page?.show_sidebar);

  const article = page && (
    <article className={styles.feed} aria-labelledby="content-heading">
      <p className={styles.kicker}>{page.is_post ? 'From the blog' : 'Page'}</p>
      <h1 id="content-heading">{rwp.filters.apply('rwp_post_title', page.title, page)}</h1>
      {page.excerpt && <p>{rwp.filters.apply('rwp_post_excerpt', resolveExcerpt(page, excerptLength), page)}</p>}
      <ContentRenderer
        className={styles.content}
        html={rwp.filters.apply('rwp_page_content', page.content, page)}
      />
      {settings.comments_enabled && (
        <CommentSection
          pageId={page.id}
          commentsOpen={page.comments_open !== false}
          moderated={settings.comment_moderation}
          maxDepth={settings.comment_max_depth}
        />
      )}
    </article>
  );

  return (
    <PublicLayout
      siteTitle={siteTitle}
      menuLinks={menuLinks}
      adminEmail={adminEmail}
      role={role}
      layout={page?.layout}
      showAuthLinks={settings.show_auth_links}
      canRegister={settings.users_can_register}
      editLink={page && canEdit ? `/admin?section=content&edit=${page.id}` : undefined}
      onViewAdmin={() => { window.location.href = '/admin'; }}
      onLogout={async () => { await getSupabaseClient().auth.signOut(); setAdminEmail(undefined); setRole('subscriber'); }}
    >
      <main className={containerClass}>
        {loading && <p className={styles.muted}>Loading…</p>}
        {error && <div className={styles.error} role="alert"><p>{error}</p>{onReconfigure && <button type="button" onClick={onReconfigure}>Reconfigure Supabase</button>}</div>}
        {!loading && !error && !page && <section className={styles.hero}><h1>Page not found</h1><p>This page does not exist or is not published.</p><a className={styles.heroLink} href="/">Return home</a></section>}
        {page && (withSidebar ? (
          <div className={styles.grid}>
            {article}
            <PublicSidebar />
          </div>
        ) : article)}
      </main>
    </PublicLayout>
  );
}
