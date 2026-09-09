import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../lib/db';
import type { Post, PostStatus } from '../lib/types';
import styles from './PostsManager.module.css';

interface PostsManagerProps {
  onCreate: () => void;
  onEdit: (post: Post) => void;
}

const PAGE_SIZE = 10;

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to load posts. Please try again.';

export default function PostsManager({ onCreate, onEdit }: PostsManagerProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const supabase = getSupabaseClient();
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from('posts')
        .select('id,title,slug,content,excerpt,status,author_id,created_at,updated_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (search.trim()) {
        query = query.ilike('title', `%${search.trim()}%`);
      }

      const { data, count, error: queryError } = await query;
      if (queryError) throw queryError;
      setPosts((data || []) as Post[]);
      setTotal(count || 0);
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const toggleStatus = async (post: Post) => {
    const nextStatus: PostStatus = post.status === 'published' ? 'draft' : 'published';
    setUpdatingId(post.id);
    setError('');
    try {
      const supabase = getSupabaseClient();
      const { error: updateError } = await supabase
        .from('posts')
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', post.id);
      if (updateError) throw updateError;
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, status: nextStatus } : item));
    } catch (updateError: unknown) {
      setError(getErrorMessage(updateError));
    } finally {
      setUpdatingId(null);
    }
  };

  const deletePost = async (post: Post) => {
    if (!window.confirm(`Delete "${post.title}"? This cannot be undone.`)) return;
    setDeletingId(post.id);
    setError('');
    try {
      const supabase = getSupabaseClient();
      const { error: deleteError } = await supabase.from('posts').delete().eq('id', post.id);
      if (deleteError) throw deleteError;
      if (posts.length === 1 && page > 1) {
        setPage((current) => current - 1);
      } else {
        await loadPosts();
      }
    } catch (deleteError: unknown) {
      setError(getErrorMessage(deleteError));
    } finally {
      setDeletingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className={styles.container} aria-labelledby="posts-heading">
      <div className={styles.pageIntro}>
        <div>
          <h2 id="posts-heading">Posts</h2>
          <p>Write, edit, and publish content for your site.</p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={onCreate}>
          <span aria-hidden="true">＋</span> New post
        </button>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
          <button type="button" onClick={() => void loadPosts()}>Retry</button>
        </div>
      )}

      <div className={styles.toolbar}>
        <label className={styles.searchLabel} htmlFor="post-search">Search posts</label>
        <div className={styles.searchWrap}>
          <span aria-hidden="true">⌕</span>
          <input
            id="post-search"
            type="search"
            value={search}
            onChange={(event) => handleSearch(event.target.value)}
            placeholder="Search by title"
          />
        </div>
      </div>

      <div className={styles.tableCard}>
        {loading ? (
          <div className={styles.emptyState} role="status">Loading posts…</div>
        ) : posts.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>{search ? 'No posts found' : 'No posts yet'}</strong>
            <span>{search ? 'Try a different search term.' : 'Create your first post to get started.'}</span>
          </div>
        ) : (
          <>
            <div className={styles.tableScroller}>
              <table>
                <caption className={styles.srOnly}>All posts</caption>
                <thead>
                  <tr>
                    <th scope="col">Title</th>
                    <th scope="col">Status</th>
                    <th scope="col">Updated</th>
                    <th scope="col"><span className={styles.srOnly}>Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((post) => (
                    <tr key={post.id}>
                      <td>
                        <strong>{post.title}</strong>
                        <span className={styles.slug}>/{post.slug}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`${styles.status} ${post.status === 'published' ? styles.published : styles.draft}`}
                          onClick={() => void toggleStatus(post)}
                          disabled={updatingId === post.id}
                          aria-label={`Change ${post.title} status, currently ${post.status}`}
                        >
                          <span aria-hidden="true">●</span>
                          {updatingId === post.id ? 'Saving…' : post.status}
                        </button>
                      </td>
                      <td className={styles.date}>{new Date(post.updated_at).toLocaleDateString()}</td>
                      <td className={styles.actions}>
                        <button type="button" className={styles.editButton} onClick={() => onEdit(post)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className={styles.deleteButton}
                          onClick={() => void deletePost(post)}
                          disabled={deletingId === post.id}
                        >
                          {deletingId === post.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.pagination} aria-label="Posts pagination">
              <span>Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
              <div>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1}
                  aria-label="Previous page"
                >
                  ←
                </button>
                <span>Page {page} of {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page >= totalPages}
                  aria-label="Next page"
                >
                  →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
