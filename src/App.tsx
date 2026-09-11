import { useEffect, useState, type FormEvent } from 'react';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import SetupWizard from './components/SetupWizard';
import AdminLayout, { type AdminSection } from './components/AdminLayout';
import PostEditor from './components/PostEditor';
import PostsManager from './components/PostsManager';
import SiteSettings from './components/SiteSettings';
import MenuManager from './components/MenuManager';
import PluginsManager from './components/PluginsManager';
import PublicHome from './components/PublicHome';
import type { Post } from './lib/types';
import { getUserRole, canAccessAdmin, canManageSettings } from './lib/roles';
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

const getSupabaseClient = (): SupabaseClient | null => {
  const configWindow = window as Window & { __REACT_WP_CONFIG__?: { supabaseUrl?: string; supabasePublishableKey?: string } | null };
  const serverConfig = configWindow.__REACT_WP_CONFIG__;
  const serverMode = Object.prototype.hasOwnProperty.call(configWindow, '__REACT_WP_CONFIG__');
  const url = serverConfig?.supabaseUrl || (import.meta as any).env?.VITE_SUPABASE_URL || (serverMode ? null : localStorage.getItem('supabase_url'));
  const key =
    serverConfig?.supabasePublishableKey ||
    (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
    (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ||
    (serverMode ? null : localStorage.getItem('supabase_key'));
  return url && key ? createClient(url, key) : null;
};

const checkDatabase = async (): Promise<boolean> => {
  const configWindow = window as Window & { __REACT_WP_CONFIG__?: { supabaseUrl?: string; supabasePublishableKey?: string } | null };
  const serverConfig = configWindow.__REACT_WP_CONFIG__;
  const serverMode = Object.prototype.hasOwnProperty.call(configWindow, '__REACT_WP_CONFIG__');
  const url = serverConfig?.supabaseUrl || (import.meta as any).env?.VITE_SUPABASE_URL || (serverMode ? null : localStorage.getItem('supabase_url'));
  const key =
    serverConfig?.supabasePublishableKey ||
    (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
    (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ||
    (serverMode ? null : localStorage.getItem('supabase_key'));
  if (!url || !key) return false;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 5000);
  try {
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    const baseUrl = url.replace(/\/$/, '');
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

function LoginScreen({ supabase, onLogin }: { supabase: SupabaseClient; onLogin: (session: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError || !data.session) {
        setError(signInError?.message || 'Unable to sign in.');
      } else {
        rwp.actions.do('rwp_user_logged_in', data.session.user);
        onLogin(data.session);
      }
    } catch (loginError: unknown) {
      setError(
        loginError instanceof TypeError
          ? 'Supabase could not be reached. Your saved project URL may be old or invalid. Reconfigure the site with the current Supabase URL and publishable key.'
          : loginError instanceof Error
            ? loginError.message
            : 'Unable to sign in.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.authShell}>
      <form className={styles.loginCard} onSubmit={handleSubmit}>
        <div className={styles.authMark} aria-hidden="true">R</div>
        <h1>Welcome back</h1>
        <p>Sign in to manage your React-WP site.</p>
        {error && <div className={styles.authError} role="alert">{error}</div>}
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <button type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

function Overview({ onNavigate }: { onNavigate: (section: AdminSection) => void }) {
  return (
    <section className={styles.overview} aria-labelledby="overview-heading">
      <div className={styles.welcome}>
        <div>
          <h2 id="overview-heading">Welcome to your dashboard</h2>
          <p>Manage your content and site settings from one place.</p>
        </div>
        <button type="button" onClick={() => onNavigate('posts')}>Manage posts →</button>
      </div>
      <div className={styles.cards}>
        <button type="button" className={styles.card} onClick={() => onNavigate('posts')}>
          <span className={styles.cardIcon} aria-hidden="true">▤</span>
          <strong>Posts</strong>
          <span>Create and manage your content</span>
        </button>
        <button type="button" className={styles.card} onClick={() => onNavigate('settings')}>
          <span className={styles.cardIcon} aria-hidden="true">⚙</span>
          <strong>Site settings</strong>
          <span>Update your site information</span>
        </button>
      </div>
      {rwp.getDashboardWidgets().map(({ id, title, component: Widget }) => (
        <section key={id} aria-labelledby={`${id}-heading`}>
          <h2 id={`${id}-heading`}>{title}</h2>
          <Widget />
        </section>
      ))}
    </section>
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
  const [activeSection, setActiveSection] = useState<AdminSection>('dashboard');
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [creatingPost, setCreatingPost] = useState(false);
  const [siteTitle, setSiteTitle] = useState('React-WP');
  const [authLoading, setAuthLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);
  const role = session ? getUserRole(session.user) : 'subscriber';

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

  if (authLoading) {
    return <div className={styles.loadingScreen} role="status">Loading dashboard…</div>;
  }

  if (!session) {
    return <LoginScreen supabase={supabase} onLogin={setSession} />;
  }

  if (!canAccessAdmin(role)) {
    return <PublicHome onReconfigure={onReconfigure} />;
  }

  const navigate = (section: AdminSection) => {
    setActiveSection(section);
    setEditingPost(null);
    setCreatingPost(false);
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
  } else if (activeSection === 'posts') {
    content = creatingPost ? (
      <PostEditor role={role} onSaved={() => setCreatingPost(false)} onCancel={() => setCreatingPost(false)} />
    ) : editingPost ? (
      <PostEditor role={role} post={editingPost} onSaved={() => setEditingPost(null)} onCancel={() => setEditingPost(null)} />
    ) : (
      <PostsManager role={role} onCreate={() => setCreatingPost(true)} onEdit={(post) => {
        setEditingPost(post);
        setCreatingPost(false);
      }} />
    );
  } else if (activeSection === 'menus' && canManageSettings(role)) {
    content = <MenuManager />;
  } else if (activeSection === 'settings' && canManageSettings(role)) {
    content = <SiteSettings onSiteTitleChange={setSiteTitle} />;
  } else if (activeSection === 'plugins' && canManageSettings(role)) {
    content = <PluginsManager />;
  } else if (activeSection === 'comments') {
    content = <SimpleSection title="Comments" description="Comment moderation will appear here." />;
  } else if (activeSection === 'profile') {
    content = <SimpleSection title="Profile" description="Manage your account profile and password." />;
  } else {
    content = <Overview onNavigate={navigate} />;
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
  const [checkingDatabase, setCheckingDatabase] = useState(true);
  const isAdminRoute = window.location.pathname.replace(/\/+$/, '') === '/admin';
  const reconfigure = () => {
    localStorage.removeItem('supabase_url');
    localStorage.removeItem('supabase_key');
    window.location.reload();
  };

  useEffect(() => {
    rwp.actions.do('rwp_init');
    const client = getSupabaseClient();
    if (!client) {
      setCheckingDatabase(false);
      return;
    }

    const fallbackTimer = window.setTimeout(() => setCheckingDatabase(false), 6000);
    void checkDatabase().then((connected) => {
      window.clearTimeout(fallbackTimer);
      if (connected) {
        void initializePlugins(client).then(() => setSupabase(client));
      }
      setCheckingDatabase(false);
    });
    return () => window.clearTimeout(fallbackTimer);
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

  return <PublicHome onReconfigure={reconfigure} />;
}
