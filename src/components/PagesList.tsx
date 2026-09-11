import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../lib/db';
import type { Page } from '../lib/types';
import { canManageAllPosts, canPublishPosts, type UserRole } from '../lib/roles';
import { rwp } from '../lib/rwp';
import styles from './PostsManager.module.css';

export default function PagesList({ onCreate, onEdit, role }: { onCreate: (isPost: boolean) => void; onEdit: (page: Page) => void; role: UserRole }) {
  const [pages, setPages] = useState<Page[]>([]); const [type, setType] = useState('all'); const [status, setStatus] = useState('all'); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const supabase = getSupabaseClient(); let query = supabase.from('pages').select('*').order('updated_at', { ascending: false });
      if (type !== 'all') query = query.eq('is_post', type === 'posts');
      if (status !== 'all') query = query.eq('status', status);
      if (!canManageAllPosts(role)) { const { data } = await supabase.auth.getUser(); if (data.user) query = query.eq('author_id', data.user.id); }
      const { data, error: queryError } = await query; if (queryError) throw queryError; setPages((data || []) as Page[]);
    } catch (loadError: unknown) {
      const message = loadError instanceof Error ? loadError.message : 'Unable to load content.';
      setError(
        message.includes('public.pages') || message.includes('relation "pages"')
          ? 'The pages table is missing. Run supabase/migrations/20260911_create_pages_categories.sql in the Supabase SQL Editor, then reload this page.'
          : message,
      );
    } finally { setLoading(false); }
  }, [role, status, type]);
  useEffect(() => { void load(); }, [load]);
  const toggle = async (page: Page) => { const next = page.status === 'published' ? 'draft' : 'published'; if (next === 'published' && !canPublishPosts(role)) return; const { error: updateError } = await getSupabaseClient().from('pages').update({ status: next, updated_at: new Date().toISOString() }).eq('id', page.id); if (updateError) setError(updateError.message); else { rwp.actions.do('rwp_post_updated', { ...page, status: next }); void load(); } };
  const remove = async (page: Page) => { if (!window.confirm(`Delete "${page.title}"?`)) return; const { error: deleteError } = await getSupabaseClient().from('pages').delete().eq('id', page.id); if (deleteError) setError(deleteError.message); else { rwp.actions.do(page.is_post ? 'rwp_post_deleted' : 'rwp_page_deleted', page); void load(); } };
  return <section className={styles.container} aria-labelledby="pages-heading"><div className={styles.pageIntro}><div><h2 id="pages-heading">Pages &amp; Posts</h2><p>Manage static pages and blog posts from one content model.</p></div><div><button className={styles.primaryButton} onClick={() => onCreate(false)}>＋ New page</button> <button className={styles.primaryButton} onClick={() => onCreate(true)}>＋ New post</button></div></div>{error && <div className={styles.error} role="alert">{error}</div>}<div className={styles.toolbar}><select value={type} onChange={(e) => setType(e.target.value)}><option value="all">All content</option><option value="pages">Static pages</option><option value="posts">Posts</option></select><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option><option value="draft">Drafts</option><option value="published">Published</option></select></div><div className={styles.tableCard}>{loading ? <div className={styles.emptyState}>Loading content…</div> : <div className={styles.tableScroller}><table><thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{pages.map((page) => <tr key={page.id}><td><strong>{page.title}</strong><span className={styles.slug}>/{page.slug}</span></td><td>{page.is_post ? 'Post' : 'Page'}</td><td><button className={`${styles.status} ${page.status === 'published' ? styles.published : styles.draft}`} onClick={() => void toggle(page)}>{page.status}</button></td><td className={styles.date}>{new Date(page.updated_at).toLocaleDateString()}</td><td><button className={styles.editButton} onClick={() => onEdit(page)}>Edit</button><button className={styles.deleteButton} onClick={() => void remove(page)}>Delete</button></td></tr>)}</tbody></table></div>}</div></section>;
}
