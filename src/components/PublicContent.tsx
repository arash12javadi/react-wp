import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../lib/db';
import type { Page } from '../lib/types';
import { getUserRole, type UserRole } from '../lib/roles';
import PublicLayout from './PublicLayout';
import styles from './PublicHome.module.css';
import { rwp } from '../lib/rwp';

const sanitizeHtml = (html: string) => {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script, style, iframe, object, embed').forEach((element) => element.remove());
  template.content.querySelectorAll<HTMLElement>('*').forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'src') && value.startsWith('javascript:'))) {
        element.removeAttribute(attribute.name);
      }
    });
  });
  return template.innerHTML;
};

const defaultMenuLinks = [
  { label: 'Home', url: '/' },
  { label: 'Sample Page', url: '/sample-page' },
];

export default function PublicContent({ slug, onReconfigure }: { slug: string; onReconfigure?: () => void }) {
  const [page, setPage] = useState<Page | null>(null);
  const [siteTitle, setSiteTitle] = useState('Just another React-WP site');
  const [menuLinks, setMenuLinks] = useState(defaultMenuLinks);
  const [adminEmail, setAdminEmail] = useState<string>();
  const [role, setRole] = useState<UserRole>('subscriber');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const supabase = getSupabaseClient();
        const [{ data, error: pageError }, { data: option }, { data: menuOption }, { data: sessionData }] = await Promise.all([
          supabase.from('pages').select('*').eq('slug', slug).eq('status', 'published').maybeSingle(),
          supabase.from('options').select('option_value').eq('option_name', 'site_title').maybeSingle(),
          supabase.from('options').select('option_value').eq('option_name', 'menu_links').maybeSingle(),
          supabase.auth.getSession(),
        ]);
        if (pageError) throw pageError;
        if (mounted) {
          setPage(data as Page | null);
          setSiteTitle(rwp.filters.apply('rwp_site_title', option?.option_value || 'Just another React-WP site'));
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
            setRole(getUserRole(user));
          }
        }
      } catch (loadError: unknown) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'Unable to load this page.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => { mounted = false; };
  }, [slug]);

  return (
    <PublicLayout
      siteTitle={siteTitle}
      menuLinks={menuLinks}
      adminEmail={adminEmail}
      role={role}
      onViewAdmin={() => { window.location.href = '/admin'; }}
      onLogout={async () => { await getSupabaseClient().auth.signOut(); setAdminEmail(undefined); setRole('subscriber'); }}
    >
      <main className={styles.container}>
        {loading && <p className={styles.muted}>Loading…</p>}
        {error && <div className={styles.error} role="alert"><p>{error}</p>{onReconfigure && <button type="button" onClick={onReconfigure}>Reconfigure Supabase</button>}</div>}
        {!loading && !error && !page && <section className={styles.hero}><h1>Page not found</h1><p>This page does not exist or is not published.</p><a className={styles.heroLink} href="/">Return home</a></section>}
        {page && (
          <article className={styles.feed} aria-labelledby="content-heading">
            <p className={styles.kicker}>{page.is_post ? 'From the blog' : 'Page'}</p>
            <h1 id="content-heading">{rwp.filters.apply('rwp_post_title', page.title, page)}</h1>
            {page.excerpt && <p>{rwp.filters.apply('rwp_post_excerpt', page.excerpt, page)}</p>}
            <div
              className={styles.content}
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(rwp.filters.apply('rwp_post_content', page.content, page)),
              }}
            />
          </article>
        )}
      </main>
    </PublicLayout>
  );
}
