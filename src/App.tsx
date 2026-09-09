import { useEffect, useState, type FormEvent } from 'react';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import SetupWizard from './components/SetupWizard';
import AdminLayout, { type AdminSection } from './components/AdminLayout';
import PostEditor from './components/PostEditor';
import PostsManager from './components/PostsManager';
import SiteSettings from './components/SiteSettings';
import type { Post } from './lib/types';
import styles from './Dashboard.module.css';

const getSupabaseClient = (): SupabaseClient | null => {
  const url = (import.meta as any).env?.VITE_SUPABASE_URL || localStorage.getItem('supabase_url');
  const key = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || localStorage.getItem('supabase_key');
  return url && key ? createClient(url, key) : null;
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
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError || !data.session) {
      setError(signInError?.message || 'Unable to sign in.');
    } else {
      onLogin(data.session);
    }
    setLoading(false);
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

function InstalledDashboard({ supabase }: { supabase: SupabaseClient }) {
  const [session, setSession] = useState<Session | null>(null);
  const [activeSection, setActiveSection] = useState<AdminSection>('dashboard');
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [creatingPost, setCreatingPost] = useState(false);
  const [siteTitle, setSiteTitle] = useState('React-WP');
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
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
      .then(({ data }) => {
        if (data?.option_value) setSiteTitle(data.option_value);
      });
  }, [supabase]);

  if (authLoading) {
    return <div className={styles.loadingScreen} role="status">Loading dashboard…</div>;
  }

  if (!session) {
    return <LoginScreen supabase={supabase} onLogin={setSession} />;
  }

  const navigate = (section: AdminSection) => {
    setActiveSection(section);
    setEditingPost(null);
    setCreatingPost(false);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  let content;
  if (activeSection === 'posts') {
    content = creatingPost ? (
      <PostEditor onSaved={() => setCreatingPost(false)} onCancel={() => setCreatingPost(false)} />
    ) : editingPost ? (
      <PostEditor post={editingPost} onSaved={() => setEditingPost(null)} onCancel={() => setEditingPost(null)} />
    ) : (
      <PostsManager onCreate={() => setCreatingPost(true)} onEdit={(post) => {
        setEditingPost(post);
        setCreatingPost(false);
      }} />
    );
  } else if (activeSection === 'settings') {
    content = <SiteSettings onSiteTitleChange={setSiteTitle} />;
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
    >
      {content}
    </AdminLayout>
  );
}

export default function App() {
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null);
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) {
      setIsInstalled(false);
      return;
    }
    setSupabase(client);
    void (async () => {
      try {
        const { data, error } = await client
          .from('options')
          .select('option_value')
          .eq('option_name', 'installed')
          .maybeSingle();
        setIsInstalled(!error && data?.option_value === 'true');
      } catch {
        setIsInstalled(false);
      }
    })();
  }, []);

  if (isInstalled === null) {
    return <div className={styles.loadingScreen} role="status">Loading React-WP…</div>;
  }

  if (!isInstalled) {
    return <SetupWizard onComplete={() => {
      const client = getSupabaseClient();
      setSupabase(client);
      setIsInstalled(true);
    }} />;
  }

  return supabase ? <InstalledDashboard supabase={supabase} /> : <SetupWizard onComplete={() => setIsInstalled(true)} />;
}
