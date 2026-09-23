import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../lib/db';
import type { Category, Page } from '../lib/types';
import { canManageAllPosts, canPublishPosts, type UserRole } from '../lib/roles';
import { rwp } from '../lib/rwp';
import { deleteContent, explainContentError, plural, setContentStatus, type ContentStatus } from '../lib/contentBulk';
import { purgePageCacheQuietly } from '../lib/security';
import {
  BulkBar, BulkInline, RowCheckbox, SelectAllCheckbox, describeBulkResult, useBulkSelection, type BulkAction,
} from './BulkActions';
import styles from './PostsManager.module.css';

type PageRow = Page & { is_site_template?: boolean };

/** The Category column's value: a category id, a post without one, or a page (not a post). */
const AS_PAGE = 'page';
const NO_CATEGORY = 'none';
const categoryValue = (row: PageRow) => (row.is_post ? row.category_id || NO_CATEGORY : AS_PAGE);

export default function PagesList({ onCreate, onEdit, role }: { onCreate: (isPost: boolean) => void; onEdit: (page: Page) => void; role: UserRole }) {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState('');
  const [trashCount, setTrashCount] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bulkCategory, setBulkCategory] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const inTrash = status === 'trash';
  const canPublish = canPublishPosts(role);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const supabase = getSupabaseClient();
      let query = supabase.from('pages').select('*').order('updated_at', { ascending: false });
      let trashQuery = supabase.from('pages').select('id', { count: 'exact', head: true }).eq('status', 'trash');
      if (type === 'templates') query = query.eq('is_site_template', true);
      else if (type !== 'all') query = query.eq('is_post', type === 'posts');
      // Trashed content only shows in the Trash view, as in WordPress.
      if (status === 'all') query = query.or('status.is.null,status.neq.trash');
      else query = query.eq('status', status);
      if (!canManageAllPosts(role)) {
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          query = query.eq('author_id', data.user.id);
          trashQuery = trashQuery.eq('author_id', data.user.id);
        }
      }
      const [{ data, error: queryError }, { count }, { data: categoryRows }] = await Promise.all([
        query, trashQuery, supabase.from('categories').select('id,name,slug').order('name'),
      ]);
      if (queryError) throw queryError;
      setPages((data || []) as PageRow[]);
      setTrashCount(count || 0);
      setCategories((categoryRows || []) as Category[]);
    } catch (loadError: unknown) {
      const message = explainContentError(loadError);
      setError(
        message.includes('public.pages') || message.includes('relation "pages"')
          ? 'The pages table is missing. Run supabase/migrations/20260911_create_pages_categories.sql in the Supabase SQL Editor, then reload this page.'
          : message,
      );
    } finally { setLoading(false); }
  }, [role, status, type]);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return pages.filter((page) => (!term || `${page.title} ${page.slug}`.toLowerCase().includes(term))
      && (!categoryFilter || (!page.is_site_template && categoryValue(page) === categoryFilter)));
  }, [categoryFilter, pages, search]);
  const visibleIds = useMemo(() => visible.map((page) => page.id), [visible]);
  const selection = useBulkSelection(visibleIds);

  const toggle = async (page: PageRow) => {
    const next = page.status === 'published' ? 'draft' : 'published';
    if (next === 'published' && !canPublish) return;
    const { error: updateError } = await getSupabaseClient().from('pages').update({ status: next, updated_at: new Date().toISOString() }).eq('id', page.id);
    if (updateError) setError(explainContentError(updateError));
    else {
      // Publishing or unpublishing changes both the page itself and any list that includes it.
      await purgePageCacheQuietly();
      rwp.actions.do('rwp_post_updated', { ...page, status: next });
      void load();
    }
  };

  /** Runs one bulk action over the given rows and reports exactly what the database changed. */
  const runBulk = async (action: string, ids: number[]) => {
    const rows = pages.filter((page) => ids.includes(page.id));
    if (!rows.length) return;
    setError(''); setSuccess('');
    let targets = rows;
    let skippedNote = '';
    if (action === 'trash') {
      // One row per template type is allowed, so a trashed template would block creating a new one.
      targets = rows.filter((row) => !row.is_site_template);
      if (targets.length < rows.length) {
        skippedNote = ` ${plural(rows.length - targets.length, 'site template')} left alone: templates cannot be trashed; set them to draft or delete them permanently.`;
      }
      if (!targets.length) return setError(skippedNote.trim());
    }
    if (action === 'delete' && !window.confirm(`Permanently delete ${plural(targets.length, 'item')}? This cannot be undone.`)) return;

    const labels: Record<string, [ContentStatus | null, string]> = {
      publish: ['published', 'Published'],
      draft: ['draft', 'Moved to draft'],
      trash: ['trash', 'Moved to Trash'],
      restore: ['draft', 'Restored as draft'],
      delete: [null, 'Permanently deleted'],
    };
    const [nextStatus, verb] = labels[action];
    setBusy(action);
    try {
      const result = nextStatus ? await setContentStatus(targets, nextStatus) : await deleteContent(targets);
      const report = describeBulkResult(verb, targets.length, result.changed.length, targets.length === 1 ? 'item' : 'items', result.blockedReason);
      setSuccess(report.success + (report.success ? skippedNote : ''));
      setError(report.error + (report.success ? '' : skippedNote));
      selection.clear();
      await load();
    } catch (bulkError: unknown) {
      setError(bulkError instanceof Error ? bulkError.message : explainContentError(bulkError));
    } finally {
      setBusy('');
    }
  };

  /**
   * The Category column and its bulk action. Giving a page a category turns it into a post (the
   * blog, archives and category pages only list posts); "Page" turns a post back into a page.
   */
  const assignCategory = async (ids: number[], value: string) => {
    const rows = pages.filter((page) => ids.includes(page.id) && !page.is_site_template && categoryValue(page) !== value);
    const skippedTemplates = pages.filter((page) => ids.includes(page.id) && page.is_site_template).length;
    if (!value) return setError('Choose a category first.');
    if (!rows.length) {
      setSuccess('');
      return setError(skippedTemplates ? 'Site templates cannot be put in a category.' : 'The selected items are already there.');
    }
    const category = categories.find((item) => item.id === value);
    const toPosts = rows.filter((row) => !row.is_post).length;
    const toPages = value === AS_PAGE ? rows.filter((row) => row.is_post).length : 0;
    const question = toPosts && value !== AS_PAGE
      ? `${plural(toPosts, 'page')} will become ${toPosts === 1 ? 'a post' : 'posts'} in ${category ? `“${category.name}”` : 'no category'}, so ${toPosts === 1 ? 'it appears' : 'they appear'} in the blog and archives. Continue?`
      : toPages ? `${plural(toPages, 'post')} will become ${toPages === 1 ? 'a page' : 'pages'} and leave the blog. Continue?` : '';
    if (question && !window.confirm(question)) return;

    const changes = value === AS_PAGE
      ? { is_post: false, category_id: null }
      : { is_post: true, category_id: value === NO_CATEGORY ? null : value };
    setBusy('category'); setError(''); setSuccess('');
    try {
      // .select(): rows row level security skips come back missing, not as an error.
      const { data, error: updateError } = await getSupabaseClient().from('pages')
        .update({ ...changes, updated_at: new Date().toISOString() })
        .in('id', rows.map((row) => row.id))
        .select('id');
      if (updateError) throw updateError;
      const changed = (data || []).length;
      const label = value === AS_PAGE ? 'Made into pages' : value === NO_CATEGORY ? 'Moved out of every category' : `Moved to “${category?.name || 'category'}”`;
      if (changed) setSuccess(`${label}: ${plural(changed, 'item')}.${skippedTemplates ? ` ${plural(skippedTemplates, 'site template')} left alone.` : ''}`);
      if (changed < rows.length) {
        setError(`${plural(rows.length - changed, 'item')} not changed: row level security skipped ${rows.length - changed === 1 ? 'it' : 'them'}. Changing someone else's content needs the edit_others_posts capability.`);
      }
      rows.filter((row) => data?.some((item) => item.id === row.id))
        .forEach((row) => rwp.actions.do(changes.is_post ? 'rwp_post_updated' : 'rwp_page_updated', { ...row, ...changes }));
      selection.clear();
      await load();
    } catch (updateError: unknown) {
      setError(explainContentError(updateError));
    } finally {
      setBusy('');
    }
  };

  const categoryOptions = (
    <>
      <option value={AS_PAGE}>Page (not a post)</option>
      <option value={NO_CATEGORY}>Post, no category</option>
      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
    </>
  );

  const emptyTrash = async () => {
    const { data, error: loadError } = await getSupabaseClient().from('pages').select('id,title,is_post').eq('status', 'trash');
    if (loadError) return setError(explainContentError(loadError));
    const rows = (data || []) as PageRow[];
    if (!rows.length || !window.confirm(`Permanently delete all ${plural(rows.length, 'item')} in the Trash? This cannot be undone.`)) return;
    setBusy('empty'); setError(''); setSuccess('');
    try {
      const result = await deleteContent(rows);
      const report = describeBulkResult('Permanently deleted', rows.length, result.changed.length, 'items', result.blockedReason);
      setSuccess(report.success); setError(report.error);
      selection.clear();
      await load();
    } catch (bulkError: unknown) {
      setError(bulkError instanceof Error ? bulkError.message : explainContentError(bulkError));
    } finally { setBusy(''); }
  };

  const bulkActions: BulkAction[] = inTrash
    ? [
      { id: 'restore', label: 'Restore', tone: 'primary' },
      { id: 'delete', label: 'Delete permanently', tone: 'danger' },
    ]
    : [
      { id: 'publish', label: 'Publish', hidden: !canPublish || status === 'published' },
      { id: 'draft', label: 'Move to draft', hidden: status === 'draft' },
      { id: 'trash', label: 'Move to Trash', tone: 'danger' },
    ];

  return (
    <section className={styles.container} aria-labelledby="pages-heading">
      <div className={styles.pageIntro}>
        <div><h2 id="pages-heading">Pages &amp; Posts</h2><p>Manage static pages and blog posts from one content model.</p></div>
        <div>
          <button className={styles.primaryButton} onClick={() => onCreate(false)}>＋ New page</button>{' '}
          <button className={styles.primaryButton} onClick={() => onCreate(true)}>＋ New post</button>
        </div>
      </div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {success && <div className={styles.success} role="status">{success}</div>}
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Content type">
            <option value="all">All content</option>
            <option value="pages">Static pages</option>
            <option value="posts">Posts</option>
            <option value="templates">Templates (Page Builder)</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            <option value="draft">Drafts</option>
            <option value="published">Published</option>
            <option value="trash">Trash ({trashCount})</option>
          </select>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {categoryOptions}
          </select>
          {inTrash && trashCount > 0 && (
            <button type="button" className={styles.deleteButton} disabled={Boolean(busy)} onClick={() => void emptyTrash()}>
              {busy === 'empty' ? 'Emptying…' : 'Empty Trash'}
            </button>
          )}
        </div>
        <div className={styles.searchWrap}>
          <span aria-hidden="true">⌕</span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or slug" aria-label="Search pages and posts" />
        </div>
      </div>
      {!loading && (
        <BulkBar selection={selection} total={visible.length} noun="items" actions={bulkActions} busy={busy} onAction={(id, ids) => void runBulk(id, ids)}>
          {!inTrash && (
            <BulkInline>
              <select value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)} aria-label="Category for the selected items">
                <option value="">Move to category…</option>
                {categoryOptions}
              </select>
              <button type="button" className={styles.editButton} disabled={!bulkCategory || Boolean(busy)}
                onClick={() => void assignCategory(selection.selected, bulkCategory)}>
                {busy === 'category' ? 'Saving…' : 'Apply'}
              </button>
            </BulkInline>
          )}
        </BulkBar>
      )}
      <div className={styles.tableCard}>
        {loading ? <div className={styles.emptyState}>Loading content…</div> : visible.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>{inTrash ? 'The Trash is empty' : search ? 'Nothing matches your search' : 'No content here yet'}</strong>
          </div>
        ) : (
          <div className={styles.tableScroller}>
            <table>
              <thead>
                <tr>
                  <th className={styles.checkCell}><SelectAllCheckbox selection={selection} total={visible.length} /></th>
                  <th>Title</th><th>Type</th><th>Category</th><th>Status</th><th>Updated</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((page) => (
                  <tr key={page.id} className={selection.isSelected(page.id) ? styles.rowSelected : undefined}>
                    <td className={styles.checkCell}><RowCheckbox selection={selection} id={page.id} label={page.title} /></td>
                    <td><strong>{page.title}</strong><span className={styles.slug}>/{page.slug}</span></td>
                    <td>{page.is_site_template ? 'Template' : page.is_post ? 'Post' : 'Page'}</td>
                    <td>
                      {page.is_site_template || page.status === 'trash' ? (
                        <span className={styles.slug}>{page.is_post ? categories.find((item) => item.id === page.category_id)?.name || '—' : '—'}</span>
                      ) : (
                        <select className={styles.categorySelect} value={categoryValue(page)} disabled={Boolean(busy)}
                          aria-label={`Category of ${page.title}`} onChange={(event) => void assignCategory([page.id], event.target.value)}>
                          {categoryOptions}
                        </select>
                      )}
                    </td>
                    <td>
                      {page.status === 'trash'
                        ? <span className={`${styles.status} ${styles.trash}`}>trash</span>
                        : <button className={`${styles.status} ${page.status === 'published' ? styles.published : styles.draft}`} onClick={() => void toggle(page)}>{page.status}</button>}
                    </td>
                    <td className={styles.date}>{new Date(page.updated_at).toLocaleDateString()}</td>
                    <td>
                      {page.status === 'trash' ? (
                        <>
                          <button className={styles.editButton} disabled={Boolean(busy)} onClick={() => void runBulk('restore', [page.id])}>Restore</button>
                          <button className={styles.deleteButton} disabled={Boolean(busy)} onClick={() => void runBulk('delete', [page.id])}>Delete permanently</button>
                        </>
                      ) : (
                        <>
                          <button className={styles.editButton} onClick={() => onEdit(page)}>Edit</button>
                          {rwp.getContentActions(page).map((action) => <a key={action.id} className={styles.editButton} href={action.href(page)}>{action.label}</a>)}
                          {page.is_site_template
                            ? <button className={styles.deleteButton} disabled={Boolean(busy)} onClick={() => void runBulk('delete', [page.id])}>Delete</button>
                            : <button className={styles.deleteButton} disabled={Boolean(busy)} onClick={() => void runBulk('trash', [page.id])}>Trash</button>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
