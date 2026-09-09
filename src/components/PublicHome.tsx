import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../lib/db';
import { getUserRole, type UserRole } from '../lib/roles';
import type { Post } from '../lib/types';
import PublicLayout from './PublicLayout';
import styles from './PublicHome.module.css';

const defaultTitle = 'Just another React-WP site';
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

export default function PublicHome({ onReconfigure }: { onReconfigure?: () => void }) {
  const [siteTitle, setSiteTitle] = useState(defaultTitle);
  const [posts, setPosts] = useState<Post[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adminEmail, setAdminEmail] = useState<string>();
  const [userRole, setUserRole] = useState<UserRole>('subscriber');
  const [menuLinks, setMenuLinks] = useState(defaultMenuLinks);

  useEffect(() => {
    let mounted = true;
    const loadHome = async () => {
      try {
        const supabase = getSupabaseClient();
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const user = sessionData.session?.user;
        if (mounted && user) {
          const role = getUserRole(user);
          setAdminEmail(user.email || undefined);
          setUserRole(role);
        }

        const [{ data: option }, { data: menuOption }, { data, error: postsError }] = await Promise.all([
          supabase.from('options').select('option_value').eq('option_name', 'site_title').maybeSingle(),
          supabase.from('options').select('option_value').eq('option_name', 'menu_links').maybeSingle(),
          supabase
            .from('posts')
            .select('id,title,slug,content,excerpt,status,author_id,created_at,updated_at')
            .eq('status', 'published')
            .order('created_at', { ascending: false }),
        ]);
        if (postsError) throw postsError;
        if (mounted) {
          setSiteTitle(option?.option_value || defaultTitle);
          if (menuOption?.option_value) {
            try {
              const parsed = JSON.parse(menuOption.option_value);
              if (Array.isArray(parsed) && parsed.every((link) => link && typeof link.label === 'string' && typeof link.url === 'string')) {
                setMenuLinks(parsed);
              }
            } catch {
              // Keep the default menu when an option contains invalid JSON.
            }
          }
          setPosts((data || []) as Post[]);
        }
      } catch (loadError: unknown) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'Unable to load posts.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void loadHome();
    return () => { mounted = false; };
  }, []);

  const visiblePosts = useMemo(() => {
    const source = posts.length ? posts : [seedPost];
    const term = search.trim().toLowerCase();
    return term ? source.filter((post) => `${post.title} ${post.excerpt} ${post.content}`.toLowerCase().includes(term)) : source;
  }, [posts, search]);
  const recentPosts = (posts.length ? posts : [seedPost]).slice(0, 5);

  return (
    <PublicLayout
      siteTitle={siteTitle}
      adminEmail={adminEmail}
      role={userRole}
      menuLinks={menuLinks}
      onViewAdmin={() => { window.location.href = `${window.location.origin}/admin`; }}
      onLogout={async () => {
        await getSupabaseClient().auth.signOut();
        setAdminEmail(undefined);
        setUserRole('subscriber');
      }}
    >
      <main className={styles.container}>
        <section className={styles.hero} aria-labelledby="home-heading">
          <p className={styles.kicker}>A fresh start</p>
          <h1 id="home-heading">Welcome to {siteTitle}</h1>
          <p>This is your new React-WP website. Customize this homepage, publish your first post, and make it yours from the Admin Dashboard.</p>
          <a className={styles.heroLink} href="/admin">Go to Admin Dashboard <span aria-hidden="true">→</span></a>
        </section>

        <div className={styles.grid}>
          <section className={styles.feed} aria-labelledby="latest-heading">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.kicker}>From the blog</p>
                <h2 id="latest-heading">Latest posts</h2>
              </div>
              {loading && <span className={styles.muted}>Loading…</span>}
            </div>
            {error && (
              <div className={styles.error} role="alert">
                <p>Supabase could not be reached, so database posts are unavailable.</p>
                {onReconfigure && <button type="button" onClick={onReconfigure}>Reconfigure Supabase</button>}
              </div>
            )}
            {visiblePosts.length ? visiblePosts.map((post) => (
              <article className={styles.postCard} key={post.id}>
                <p className={styles.postMeta}>{formatDate(post.created_at)} · {post.status}</p>
                <h3>{post.title}</h3>
                <p>{post.excerpt || post.content.slice(0, 180)}</p>
                <a href={`/posts/${post.slug}`}>Read More <span aria-hidden="true">→</span></a>
              </article>
            )) : <p className={styles.muted}>No posts match your search.</p>}
          </section>

          <aside className={styles.sidebar} aria-label="Sidebar">
            <div className={styles.widget}>
              <h2>Search</h2>
              <label htmlFor="public-search" className={styles.srOnly}>Search posts</label>
              <input id="public-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search posts…" />
            </div>
            <div className={styles.widget}>
              <h2>Recent Posts</h2>
              <ul>{recentPosts.map((post) => <li key={post.id}><a href={`/posts/${post.slug}`}>{post.title}</a></li>)}</ul>
            </div>
            <div className={styles.widget}>
              <h2>Meta</h2>
              <ul>
                <li><a href="/admin">Log in</a></li>
                <li><a href="/feed.json">JSON Feed</a></li>
                <li><a href="/feed.xml">RSS Feed</a></li>
              </ul>
            </div>
          </aside>
        </div>
      </main>
    </PublicLayout>
  );
}
