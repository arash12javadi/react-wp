import { useEffect, useState } from 'react';
import { type Session, type SupabaseClient } from '@supabase/supabase-js';
import SetupWizard from './components/SetupWizard';
import AdminLayout, { type AdminSection } from './components/AdminLayout';
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
import { canAccessAdmin, canManageComments, canManageSettings, canManageUsers, canUploadMedia } from './lib/roles';
import { useCurrentProfile } from './lib/profiles';
import { resolveSupabaseConfig, tryGetSupabaseClient } from './lib/db';
import { applySiteIcon, loadSettings } from './lib/settings';
import { rwp } from './lib/rwp';
import styles from './Dashboard.module.css';

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
  const [{ data: activeRow }, { data: deletedRow }] = await Promise.all([
    supabase.from('options').select('option_value').eq('option_name', 'rwp_active_plugins').maybeSingle(),
    supabase.from('options').select('option_value').eq('option_name', 'rwp_deleted_plugins').maybeSingle(),
  ]);
  const deletedIds = readPluginIds(deletedRow?.option_value);
  const registered = rwp.getPlugins();
  const activeIds = activeRow ? readPluginIds(activeRow.option_value) : registered.map((plugin) => plugin.id);
  registered.forEach((plugin) => {
    if (!deletedIds.includes(plugin.id) && activeIds.includes(plugin.id)) rwp.activatePlugin(plugin.id);
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
}

const loadPublicRouting = async (supabase: SupabaseClient): Promise<PublicRouting> => {
  const settings = await loadSettings();
  applySiteIcon(settings.site_icon);
  let postsPageSlug = '';
  if (settings.home_page_id && settings.posts_page_id) {
    const { data } = await supabase.from('pages').select('slug').eq('id', settings.posts_page_id).maybeSingle();
    postsPageSlug = data?.slug || '';
  }
  return { homePageId: settings.home_page_id, postsPageSlug };
};

/** Plugin widgets used to live on the Dashboard. That screen is gone, so they render here. */
function PluginWidgets() {
  const widgets = rwp.getDashboardWidgets();
  if (widgets.length === 0) return null;
  return (
    <>
      {widgets.map(({ id, title, component: Widget }) => (
        <section key={id} className={styles.overview} aria-labelledby={`${id}-heading`}>
          <h2 id={`${id}-heading`}>{title}</h2>
          <Widget />
        </section>
      ))}
    </>
  );
}

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

const adminSections: AdminSection[] = ['content', 'media', 'comments', 'categories', 'menus', 'users', 'plugins', 'settings', 'profile'];

/** Supports the public site's "Edit page" link, e.g. /admin?section=content&edit=12 */
const initialSection = (): AdminSection => {
  const requested = new URLSearchParams(window.location.search).get('section');
  return adminSections.includes(requested as AdminSection) ? requested as AdminSection : 'content';
};

function ConnectionError({ onReconfigure }: { onReconfigure: () => void }) {
  return (
    <div className={styles.loadingScreen} role="alert">
      <div className={styles.loginCard}>
        <h1>Supabase connection failed</h1>
        <p>The saved Supabase project could not be reached. This usually means the project was deleted, paused, or its URL has changed.</p>
        <button type="button" onClick={onReconfigure}>Reconfigure Supabase</button>
      </div>
    </div>
  );
}

function InstalledDashboard({ supabase, onReconfigure }: { supabase: SupabaseClient; onReconfigure: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [activeSection, setActiveSection] = useState<AdminSection>(initialSection());
  const [editingPage, setEditingPage] = useState<import('./lib/types').Page | null>(null);
  const [creatingPost, setCreatingPost] = useState<boolean | null>(null);
  const [siteTitle, setSiteTitle] = useState('React-WP');
  const [authLoading, setAuthLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);
  const { role, loading: roleLoading } = useCurrentProfile(session?.user);

  useEffect(() => {
    rwp.actions.do('rwp_admin_loaded');
    let mounted = true;
    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) setConnectionError(true);
        setSession(data.session);
        setAuthLoading(false);
      })
      .catch(() => {
        if (mounted) {
          setConnectionError(true);
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
    supabase
      .from('options')
      .select('option_value')
      .eq('option_name', 'site_title')
      .maybeSingle()
      .then(({ data, error }) => {
        if (data?.option_value) setSiteTitle(data.option_value);
        if (error && error.code !== 'PGRST116') setConnectionError(true);
      });
  }, [supabase]);

  if (connectionError) {
    return <ConnectionError onReconfigure={onReconfigure} />;
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

  const navigate = (section: AdminSection) => {
    setActiveSection(section);
    setEditingPage(null);
    setCreatingPost(null);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    rwp.actions.do('rwp_user_logged_out');
    setSession(null);
  };

  let content;
  const pluginPage = rwp.getAdminPages().find((page) => page.id === activeSection);
  if (pluginPage) {
    const PluginPage = pluginPage.component;
    content = <PluginPage />;
  } else if (activeSection === 'content') {
    content = creatingPost !== null ? (
      <PageEditor
        role={role}
        initialIsPost={creatingPost}
        onSaved={() => setCreatingPost(null)}
        onCancel={() => setCreatingPost(null)}
      />
    ) : editingPage ? (
      <PageEditor role={role} page={editingPage} onSaved={() => setEditingPage(null)} onCancel={() => setEditingPage(null)} />
    ) : (
      <>
        <PluginWidgets />
        <PagesList role={role} onCreate={(isPost) => setCreatingPost(isPost)} onEdit={(page) => {
          setEditingPage(page);
          setCreatingPost(null);
        }} />
      </>
    );
  } else if (activeSection === 'media' && canUploadMedia(role)) {
    content = <MediaLibrary role={role} />;
  } else if (activeSection === 'users' && canManageUsers(role)) {
    content = <UsersManager role={role} />;
  } else if (activeSection === 'menus' && canManageSettings(role)) {
    content = <MenusScreen />;
  } else if (activeSection === 'settings' && canManageSettings(role)) {
    content = <SiteSettings onSiteTitleChange={setSiteTitle} />;
  } else if (activeSection === 'plugins' && canManageSettings(role)) {
    content = <PluginsManager />;
  } else if (activeSection === 'categories' && canManageSettings(role)) {
    content = <CategoriesManager />;
  } else if (activeSection === 'comments' && canManageComments(role)) {
    content = <CommentsManager />;
  } else if (activeSection === 'profile') {
    content = <ProfileManager role={role} />;
  } else {
    content = <SimpleSection title="Not available" description="Your role does not have access to this section." />;
  }

  return (
    <AdminLayout
      activeSection={activeSection}
      onNavigate={navigate}
      onLogout={() => void logout()}
      userEmail={session.user.email}
      siteTitle={siteTitle}
      role={role}
      onViewSite={() => { window.location.href = '/'; }}
    >
      {content}
    </AdminLayout>
  );
}

export default function App() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [routing, setRouting] = useState<PublicRouting>({ homePageId: '', postsPageSlug: '' });
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
        const publicRouting = await loadPublicRouting(client).catch(() => ({ homePageId: '', postsPageSlug: '' }));
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

  if (!pathname) {
    return routing.homePageId
      ? <PublicContent pageId={routing.homePageId} onReconfigure={reconfigure} />
      : <PublicHome onReconfigure={reconfigure} />;
  }

  const slug = pathname.replace(/^posts\//, '').replace(/^pages\//, '');
  if (routing.postsPageSlug && slug === routing.postsPageSlug) {
    return <PublicHome onReconfigure={reconfigure} />;
  }
  return <PublicContent slug={slug} onReconfigure={reconfigure} />;
}
