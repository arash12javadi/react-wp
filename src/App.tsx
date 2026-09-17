import { lazy, Suspense, useEffect, useState } from 'react';
import { type Session, type SupabaseClient } from '@supabase/supabase-js';
import SetupWizard from './components/SetupWizard';
import AdminLayout from './components/AdminLayout';
import SiteSettings from './components/SiteSettings';
import MenusScreen from './components/MenusScreen';
import CommentsManager from './components/CommentsManager';
import ProfileManager from './components/ProfileManager';
import PluginsManager from './components/PluginsManager';
import PagesList from './components/PagesList';
import PageEditor from './components/PageEditor';
import CategoriesManager from './components/CategoriesManager';
import MediaLibrary from './components/MediaLibrary';
import UsersManager from './components/UsersManager';
import PublicHome from './components/PublicHome';
import PublicContent from './components/PublicContent';
import AuthPage from './components/AuthPage';
import PublicChrome from './components/PublicChrome';
import PublicArchive, { archiveFromPath } from './components/PublicArchive';
import { preloadSiteTemplates } from './components/SiteTemplate';
import { canAccessAdmin } from './lib/roles';
import { useCurrentProfile } from './lib/profiles';
import { describeDbError, resolveSupabaseConfig, tryGetSupabaseClient } from './lib/db';
import {
  applyDocumentTitle, applySiteIcon, brandingFrom, defaultSettings, loadSettings, placeholderTitle, type SiteBranding,
} from './lib/settings';
import { defaultAppSettings, injectTrackingScripts, loadAppSettings } from './lib/appSettings';
import { buildAdminNavigation, resolveAdminLocation } from './lib/adminNavigation';
import { initThemePreview, loadTheme } from './lib/theme';
import { applyThemeDocument } from './components/theme/ThemeLayoutRenderer';
import { useAdminStatus } from './lib/adminStatus';
import { rwp } from './lib/rwp';
import styles from './Dashboard.module.css';

// Its own chunk: the Overview, Updates and Guide are only ever needed inside the admin.
const Dashboard = lazy(() => import('./components/dashboard/Dashboard'));
// Its own chunk too: dnd-kit and the code editor never reach the public bundle.
const ThemeEditor = lazy(() => import('./components/theme/ThemeEditor'));

const readPluginIds = (value: string | null | undefined): string[] => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const initializePlugins = async (supabase: SupabaseClient) => {
  const { data: activeRow } = await supabase
    .from('options').select('option_value').eq('option_name', 'rwp_active_plugins').maybeSingle();
  const registered = rwp.getPlugins();
  const activeIds = activeRow ? readPluginIds(activeRow.option_value) : registered.map((plugin) => plugin.id);
  registered.forEach((plugin) => {
    if (activeIds.includes(plugin.id)) rwp.activatePlugin(plugin.id);
  });
};

const checkDatabase = async (): Promise<boolean> => {
  const config = resolveSupabaseConfig();
  if (!config) return false;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 5000);
  try {
    const headers = { apikey: config.key, Authorization: `Bearer ${config.key}` };
    const baseUrl = config.url.replace(/\/$/, '');
    const responses = await Promise.all([
      fetch(`${baseUrl}/rest/v1/options?select=option_name&limit=1`, { headers, signal: controller.signal }),
      fetch(`${baseUrl}/rest/v1/posts?select=id&limit=1`, { headers, signal: controller.signal }),
      fetch(`${baseUrl}/rest/v1/menus?select=id&limit=1`, { headers, signal: controller.signal }),
    ]);
    return responses.every((response) => response.ok);
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const checkDatabaseWithRetry = async (): Promise<SupabaseClient | null> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = tryGetSupabaseClient();
    if (client && await checkDatabase()) return client;
    if (attempt < 2) await wait(400);
  }
  return null;
};

interface PublicRouting {
  homePageId: string;
  postsPageSlug: string;
  /** A posts page designed with the Page Builder shows its own layout instead of the theme's post index. */
  postsPageHasLayout: boolean;
}

const loadPublicRouting = async (supabase: SupabaseClient): Promise<PublicRouting> => {
  const settings = await loadSettings();
  applySiteIcon(settings.site_icon);
  // Screens that are not page rows (login, register, plugin routes) never set a title, so
  // without this the tab kept index.html's placeholder. Pages and the admin replace it later;
  // a title the server already wrote is left alone.
  if (document.title === placeholderTitle) applyDocumentTitle(settings.site_title);
  let postsPageSlug = '';
  let postsPageHasLayout = false;
  if (settings.home_page_id && settings.posts_page_id) {
    const { data } = await supabase.from('pages').select('*').eq('id', settings.posts_page_id).maybeSingle();
    postsPageSlug = data?.slug || '';
    postsPageHasLayout = Boolean(data && rwp.getContentRenderer(data as import('./lib/types').Page));
  }
  return { homePageId: settings.home_page_id, postsPageSlug, postsPageHasLayout };
};

function SimpleSection({ title, description }: { title: string; description: string }) {
  return (
    <section className={styles.overview} aria-labelledby="section-heading">
      <div className={styles.welcome}>
        <div>
          <h2 id="section-heading">{title}</h2>
          <p>{description}</p>
        </div>
      </div>
    </section>
  );
}

/**
 * The admin location lives in the URL (/admin?section=settings&tab=seo), so a reload or a
 * bookmark returns to the same screen. The public site's "Edit page" link adds &edit=12.
 * Plugin pages are addressable by id too, e.g. /admin?section=rwp-page-builder.
 */
const requestedLocation = () => {
  const params = new URLSearchParams(window.location.search);
  // ?shop= is the old Shop tab parameter.
  return { section: params.get('section') || 'dashboard', subsection: params.get('tab') || params.get('shop') || '' };
};

/** Only shown when Supabase itself failed; the real error is printed, so it is not mistaken for a paused project. */
function ConnectionError({ detail, onReconfigure }: { detail: string; onReconfigure: () => void }) {
  return (
    <div className={styles.loadingScreen} role="alert">
      <div className={styles.loginCard}>
        <h1>Supabase connection failed</h1>
        <p>The admin could not load your session from Supabase. The error was:</p>
        <p><code>{detail}</code></p>
        <p>If the project was deleted, paused or moved, reconfigure it. Otherwise reload the page, or sign in again.</p>
        <button type="button" onClick={() => { window.location.href = '/login?redirect=%2Fadmin'; }}>Sign in again</button>
        <button type="button" onClick={onReconfigure}>Reconfigure Supabase</button>
      </div>
    </div>
  );
}

function InstalledDashboard({ supabase, onReconfigure }: { supabase: SupabaseClient; onReconfigure: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [requested, setRequested] = useState(requestedLocation);
  const [editingPage, setEditingPage] = useState<import('./lib/types').Page | null>(null);
  const [branding, setBranding] = useState<SiteBranding>(() => brandingFrom(defaultSettings));
  const [authLoading, setAuthLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const [, refreshRegistry] = useState(0);
  const { role, loading: roleLoading } = useCurrentProfile(session?.user);
  const ready = Boolean(session) && !authLoading && !roleLoading;
  const status = useAdminStatus(role, ready ? session?.user.id : undefined);

  // Plugins can register or remove admin pages at any time (activation, HMR).
  useEffect(() => rwp.subscribe(() => refreshRegistry((value) => value + 1)), []);

  useEffect(() => {
    rwp.actions.do('rwp_admin_loaded');
    let mounted = true;
    supabase.auth.getSession()
      .then(async ({ data, error }) => {
        if (!mounted) return;
        if (error) {
          // A stored session Supabase no longer accepts (expired or revoked refresh token) is not
          // a connection problem: clear it locally and send the person to sign in again.
          if (/refresh token|jwt|session/i.test(error.message)) {
            await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
            if (mounted) {
              setSession(null);
              setAuthLoading(false);
            }
            return;
          }
          setConnectionError(`${error.name}: ${error.message}`);
        }
        setSession(data.session);
        setAuthLoading(false);
      })
      .catch((error: unknown) => {
        if (mounted) {
          setConnectionError(describeDbError(error));
          setAuthLoading(false);
        }
      });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) setSession(nextSession);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    const editId = new URLSearchParams(window.location.search).get('edit');
    if (!editId || !session) return;
    let mounted = true;
    void supabase.from('pages').select('*').eq('id', editId).maybeSingle().then(({ data }) => {
      if (mounted && data) setEditingPage(data as import('./lib/types').Page);
      // Clear the query string so a later reload does not reopen the editor.
      window.history.replaceState({}, '', '/admin');
    });
    return () => { mounted = false; };
  }, [session, supabase]);

  useEffect(() => {
    // The database was already reached before the admin rendered, so a failure here only costs
    // the site title and logo in the sidebar; it must not lock the whole admin behind an error.
    loadSettings()
      .then((settings) => setBranding(brandingFrom(settings)))
      .catch((error: unknown) => console.warn(`Site settings could not be loaded for the admin sidebar: ${describeDbError(error)}`));
  }, [supabase]);

  const navigation = ready ? buildAdminNavigation(role) : [];
  const { section, subsection } = resolveAdminLocation(navigation, requested.section, requested.subsection);
  const activeItem = navigation.find((item) => item.id === section);
  const activeSubLabel = activeItem?.submenu?.find((sub) => sub.id === subsection)?.label;
  const screenTitle = editingPage ? `Edit “${editingPage.title}”` : activeSubLabel && activeItem ? `${activeSubLabel} ‹ ${activeItem.label}` : activeItem?.label;

  useEffect(() => {
    if (!ready) return;
    applyDocumentTitle(branding.site_title, screenTitle);
  }, [branding.site_title, ready, screenTitle]);

  // Once the signed-in role is known; plugins use it for one-time setup such as default pages.
  useEffect(() => {
    if (ready && canAccessAdmin(role)) rwp.actions.do('rwp_admin_ready', role);
  }, [ready, role]);

  if (connectionError) {
    return <ConnectionError detail={connectionError} onReconfigure={onReconfigure} />;
  }

  if (authLoading || roleLoading) {
    return <div className={styles.loadingScreen} role="status">Loading dashboard…</div>;
  }

  if (!session) {
    window.location.href = '/login?redirect=%2Fadmin';
    return <div className={styles.loadingScreen} role="status">Redirecting to sign in…</div>;
  }

  if (!canAccessAdmin(role)) {
    return <PublicHome onReconfigure={onReconfigure} />;
  }

  const navigate = (nextSection: string, nextSubsection?: string) => {
    setRequested({ section: nextSection, subsection: nextSubsection || '' });
    setEditingPage(null);
    const resolved = resolveAdminLocation(navigation, nextSection, nextSubsection);
    const query = new URLSearchParams({ section: resolved.section });
    if (resolved.subsection) query.set('tab', resolved.subsection);
    window.history.replaceState({}, '', `/admin?${query.toString()}`);
    window.scrollTo(0, 0);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    rwp.actions.do('rwp_user_logged_out');
    setSession(null);
  };

  let content;
  const pluginPage = rwp.getAdminPages().find((page) => page.id === section);
  if (pluginPage) {
    // Visible in the navigation means the capability check has already passed.
    const PluginPage = pluginPage.component;
    content = <PluginPage subsection={subsection} navigate={navigate} />;
  } else if (section === 'dashboard') {
    content = (
      <Suspense fallback={<div className={styles.loadingScreenInline} role="status">Loading…</div>}>
        <Dashboard subsection={subsection} navigate={navigate} role={role} status={status} siteTitle={branding.site_title} />
      </Suspense>
    );
  } else if (section === 'content') {
    const backToList = () => navigate('content', 'all');
    content = editingPage ? (
      <PageEditor role={role} page={editingPage} onSaved={() => setEditingPage(null)} onCancel={() => setEditingPage(null)} />
    ) : subsection === 'new-post' || subsection === 'new-page' ? (
      // Keyed so switching between Add post and Add page starts a fresh editor.
      <PageEditor key={subsection} role={role} initialIsPost={subsection === 'new-post'} onSaved={backToList} onCancel={backToList} />
    ) : subsection === 'categories' ? (
      <CategoriesManager />
    ) : (
      <PagesList role={role} onCreate={(isPost) => navigate('content', isPost ? 'new-post' : 'new-page')} onEdit={setEditingPage} />
    );
  } else if (section === 'media') {
    content = <MediaLibrary role={role} view={subsection} />;
  } else if (section === 'users') {
    content = <UsersManager role={role} />;
  } else if (section === 'menus') {
    content = <MenusScreen tab={subsection} />;
  } else if (section === 'settings') {
    content = <SiteSettings tab={subsection} onBrandingChange={setBranding} />;
  } else if (section === 'appearance') {
    content = (
      <Suspense fallback={<div className={styles.loadingScreenInline} role="status">Loading…</div>}>
        <ThemeEditor />
      </Suspense>
    );
  } else if (section === 'plugins') {
    content = <PluginsManager />;
  } else if (section === 'comments') {
    content = <CommentsManager />;
  } else if (section === 'profile') {
    content = <ProfileManager role={role} />;
  } else {
    content = <SimpleSection title="Not available" description="Your role does not have access to this section." />;
  }

  return (
    <AdminLayout
      navigation={navigation}
      activeSection={section}
      activeSubsection={editingPage ? '' : subsection}
      onNavigate={navigate}
      onLogout={() => void logout()}
      userEmail={session.user.email}
      branding={branding}
      role={role}
      dashboardBadge={status.badge}
      onViewSite={() => { window.location.href = '/'; }}
    >
      {content}
    </AdminLayout>
  );
}

export default function App() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [routing, setRouting] = useState<PublicRouting>({ homePageId: '', postsPageSlug: '', postsPageHasLayout: false });
  const [checkingDatabase, setCheckingDatabase] = useState(true);
  const isAdminRoute = window.location.pathname.replace(/\/+$/, '') === '/admin';
  const reconfigure = () => {
    localStorage.removeItem('supabase_url');
    localStorage.removeItem('supabase_key');
    window.location.reload();
  };

  useEffect(() => {
    rwp.actions.do('rwp_init');
    let mounted = true;
    void checkDatabaseWithRetry().then(async (client) => {
      if (!mounted) return;
      if (!client) {
        setCheckingDatabase(false);
        return;
      }
      try {
        await initializePlugins(client);
        // Before anything renders: capability checks depend on the role grants in here.
        const appSettings = await loadAppSettings().catch(() => defaultAppSettings);
        const path = window.location.pathname;
        if (!isAdminRoute && !path.startsWith('/builder/')) {
          injectTrackingScripts(appSettings.seo);
          // Loaded before the first render so the saved layout does not flash in after the default one.
          initThemePreview();
          applyThemeDocument(await loadTheme());
          // Before the first render too, so a designed header or 404 never flashes in after the default.
          await preloadSiteTemplates();
        }
        const publicRouting = await loadPublicRouting(client).catch(() => ({ homePageId: '', postsPageSlug: '', postsPageHasLayout: false }));
        if (mounted) {
          setRouting(publicRouting);
          setSupabase(client);
        }
      } finally {
        if (mounted) setCheckingDatabase(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (checkingDatabase) {
    return <div className={styles.loadingScreen} role="status">Checking database connection…</div>;
  }

  if (!supabase) {
    return <SetupWizard onComplete={() => {
      window.location.reload();
    }} />;
  }

  if (isAdminRoute) {
    return <InstalledDashboard supabase={supabase} onReconfigure={reconfigure} />;
  }

  const pathname = window.location.pathname.replace(/^\/+|\/+$/g, '');

  if (pathname === 'login') return <AuthPage mode="login" />;
  if (pathname === 'register') return <AuthPage mode="register" />;

  // Plugin routes are checked before page slugs, so a plugin owns its paths outright.
  const pluginRoute = pathname ? rwp.matchRoute(`/${pathname}`) : null;
  if (pluginRoute) {
    const RouteComponent = pluginRoute.route.component;
    const rendered = <RouteComponent params={pluginRoute.params} />;
    return pluginRoute.route.chrome === false ? rendered : <PublicChrome>{rendered}</PublicChrome>;
  }

  // Search forms send ?s= to the home page. When the home page is a page (not the post feed, which
  // filters itself), show the search results screen instead.
  const homeSearch = new URLSearchParams(window.location.search).get('s');
  if (!pathname && routing.homePageId && homeSearch !== null) {
    return <PublicArchive archive={{ kind: 'search', term: homeSearch }} />;
  }

  if (!pathname) {
    return routing.homePageId
      ? <PublicContent pageId={routing.homePageId} onReconfigure={reconfigure} />
      : <PublicHome onReconfigure={reconfigure} />;
  }

  // Search results and post archives (Page Builder → Templates designs them).
  const archive = archiveFromPath(`/${pathname}`, window.location.search);
  if (archive) return <PublicArchive archive={archive} />;

  const slug = pathname.replace(/^posts\//, '').replace(/^pages\//, '');
  if (routing.postsPageSlug && slug === routing.postsPageSlug && !routing.postsPageHasLayout) {
    return <PublicHome onReconfigure={reconfigure} />;
  }
  return <PublicContent slug={slug} onReconfigure={reconfigure} />;
}
