import { useEffect, useState, type ReactNode } from 'react';
import { getSupabaseClient } from '../lib/db';
import type { Page } from '../lib/types';
import { fetchProfile } from '../lib/profiles';
import { canManageAllPosts, getUserRole, type UserRole } from '../lib/roles';
import { resolveExcerpt } from '../lib/excerpt';
import { defaultSettings, loadSettings, type SiteSettings } from '../lib/settings';
import { applyMeta, buildMeta } from '../lib/seo';
import { defaultAppSettings, loadAppSettings, useAppSettings } from '../lib/appSettings';
import { useTheme } from '../lib/theme';
import PublicLayout from './PublicLayout';
import PublicSidebar from './PublicSidebar';
import ContentRenderer from './ContentRenderer';
import CommentSection from './CommentSection';
import SiteTemplate from './SiteTemplate';
import styles from './PublicHome.module.css';
import { rwp } from '../lib/rwp';
import { accountIdKey, accountPages, signOutAndRedirect } from '../lib/account';

const defaultMenuLinks = [
  { label: 'Home', url: '/' },
  { label: 'Sample Page', url: '/sample-page' },
];

interface PublicContentProps {
  slug?: string;
  pageId?: string;
  onReconfigure?: () => void;
  /**
   * Shown instead of "Page not found" when the page is missing or unpublished. The account paths
   * (/login …) use it, so trashing the chosen Log In page never locks anyone out.
   */
  fallback?: ReactNode;
}

export default function PublicContent({ slug, pageId, onReconfigure, fallback }: PublicContentProps) {
  const [page, setPage] = useState<Page | null>(null);
  const [siteTitle, setSiteTitle] = useState('');
  const [settings, setSettings] = useState<SiteSettings>(defaultSettings);
  const [excerptLength, setExcerptLength] = useState(55);
  const [menuLinks, setMenuLinks] = useState(defaultMenuLinks);
  const [adminEmail, setAdminEmail] = useState<string>();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<UserRole>('subscriber');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const { settings: appSettings } = useAppSettings();
  const { theme } = useTheme();
  const previewing = new URLSearchParams(window.location.search).has('preview');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const supabase = getSupabaseClient();
        const byKey = pageId ? supabase.from('pages').select('*').eq('id', pageId) : supabase.from('pages').select('*').eq('slug', slug);
        // ?preview=1 (the editor's "Preview page") also loads drafts. Row level security still
        // decides: only the author and roles with edit_others_posts can read one, so visitors get
        // "not found" exactly as without it. Trash never shows.
        const query = previewing ? byKey.neq('status', 'trash') : byKey.eq('status', 'published');
        const [{ data, error: pageError }, { data: menuOption }, { data: sessionData }, settings, app] = await Promise.all([
          query.maybeSingle(),
          supabase.from('options').select('option_value').eq('option_name', 'menu_links').maybeSingle(),
          supabase.auth.getSession(),
          loadSettings(),
          loadAppSettings().catch(() => defaultAppSettings),
        ]);
        if (pageError) throw pageError;
        if (!mounted) return;

        // Site templates are shown in place of other screens, never at their own address.
        const loaded = data as Page | null;
        setPage(loaded && !loaded.is_site_template ? loaded : null);
        setSettings(settings);
        setSiteTitle(rwp.filters.apply('rwp_site_title', settings.site_title));
        setExcerptLength(settings.excerpt_length);
        applyMeta(buildMeta(loaded && !loaded.is_site_template ? loaded : null, {
          siteTitle: settings.site_title,
          siteTagline: settings.site_tagline,
          siteIcon: settings.site_icon,
          origin: window.location.origin,
          keywordsEnabled: app.seo.meta_keywords_enabled,
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
  }, [pageId, previewing, slug]);

  const canEdit = canManageAllPosts(role) || Boolean(page?.author_id && page.author_id === userId);
  const containerClass = page?.layout === 'full'
    ? styles.containerFull
    : page?.layout === 'wide' ? styles.containerWide : styles.container;
  const withSidebar = Boolean(page?.show_sidebar);
  // A plugin (e.g. the page builder) can take over how a page's body is rendered.
  const renderer = page ? rwp.getContentRenderer(page) : null;

  // Log In, Profile, Dashboard…: a comment section under a sign-in form is only noise.
  const isAccountPage = Boolean(page && accountPages.some((item) => settings[accountIdKey(item.key)] === String(page.id)));
  const comments = page && settings.comments_enabled && !isAccountPage ? (
    <CommentSection
      pageId={page.id}
      commentsOpen={page.comments_open !== false}
      moderated={settings.comment_moderation}
      maxDepth={settings.comment_max_depth}
    />
  ) : null;

  const showTitle = page?.is_post ? appSettings.general.show_post_titles : appSettings.general.show_page_titles;
  // A page's own layout (renderer) wins; otherwise a published Single Post or Page template, if any.
  const article = page && (renderer ? (
    <renderer.component page={page} comments={comments} />
  ) : (
    <SiteTemplate types={[page.is_post ? 'single_post' : 'page']} post={page} fallback={
    <article className={styles.feed} aria-labelledby="content-heading">
      <p className={styles.kicker}>
        {page.is_post ? 'From the blog' : 'Page'}
        {page.is_post && appSettings.general.show_post_dates && (
          <> · <time dateTime={page.created_at}>{new Date(page.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</time></>
        )}
      </p>
      {/* A hidden title stays in the document for screen readers and the page outline. */}
      <h1 id="content-heading" className={showTitle ? undefined : styles.srOnly}>{rwp.filters.apply('rwp_post_title', page.title, page)}</h1>
      {page.excerpt && <p>{rwp.filters.apply('rwp_post_excerpt', resolveExcerpt(page, excerptLength, settings.excerpt_unit), page)}</p>}
      <ContentRenderer
        className={styles.content}
        html={rwp.filters.apply('rwp_page_content', page.content, page)}
      />
      {comments}
    </article>
    } />
  ));

  if (fallback && !loading && !page) return <>{fallback}</>;

  return (
    <PublicLayout
      siteTitle={siteTitle}
      branding={settings}
      menuLinks={menuLinks}
      adminEmail={adminEmail}
      role={role}
      layout={page?.layout}
      showAuthLinks={settings.show_auth_links}
      canRegister={settings.users_can_register}
      toolbar={settings.admin_toolbar}
      showHeader={page?.show_header !== false}
      showFooter={page?.show_footer !== false}
      editLink={page && canEdit ? (renderer?.editHref?.(page) || `/admin?section=content&edit=${page.id}`) : undefined}
      onViewAdmin={() => { window.location.href = '/admin'; }}
      onLogout={() => void signOutAndRedirect(settings)}
    >
      <main className={containerClass}>
        {page && page.status !== 'published' && (
          <p className={styles.muted} role="status">Preview of a {page.status} {page.is_post ? 'post' : 'page'}: visitors cannot see it until it is published.</p>
        )}
        {loading && <p className={styles.muted}>Loading…</p>}
        {error && <div className={styles.error} role="alert"><p>{error}</p>{onReconfigure && <button type="button" onClick={onReconfigure}>Reconfigure Supabase</button>}</div>}
        {!loading && !error && !page && (
          <SiteTemplate types={['404']} fallback={<section className={styles.hero}><h1>Page not found</h1><p>This page does not exist or is not published.</p><a className={styles.heroLink} href="/">Return home</a></section>} />
        )}
        {page && (withSidebar ? (
          // The page decides whether it has a sidebar; the theme decides which side. "Hidden" is for the index only.
          <div className={`${styles.grid} rwpt-grid rwpt-sidebar-${theme.layout.index.options.sidebar_position === 'left' ? 'left' : 'right'}`}>
            {article}
            <PublicSidebar />
          </div>
        ) : article)}
      </main>
    </PublicLayout>
  );
}
