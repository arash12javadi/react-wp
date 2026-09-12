import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../lib/db';
import { explainCommentError, fetchAllComments, type CommentWithAuthor } from '../lib/comments';
import styles from './CommentsManager.module.css';

const filters: Array<[string, string]> = [
  ['pending', 'Pending'],
  ['approved', 'Approved'],
  ['spam', 'Spam'],
  ['all', 'All'],
];

export default function CommentsManager() {
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [status, setStatus] = useState('pending');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setComments(await fetchAllComments(status));
      setSelected(new Set());
    } catch (loadError: unknown) {
      setError(explainCommentError(loadError));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const ids = () => [...selected];

  const setStatusFor = async (targets: number[], next: string) => {
    if (targets.length === 0) return;
    setBusy(true);
    setError('');
    setFeedback('');
    const { error: updateError } = await getSupabaseClient()
      .from('comments').update({ status: next }).in('id', targets);
    if (updateError) setError(explainCommentError(updateError));
    else {
      setFeedback(`${targets.length} comment${targets.length === 1 ? '' : 's'} marked ${next}.`);
      await load();
    }
    setBusy(false);
  };

  const remove = async (targets: number[]) => {
    if (targets.length === 0) return;
    if (!window.confirm(`Delete ${targets.length} comment${targets.length === 1 ? '' : 's'} and any replies?`)) return;
    setBusy(true);
    const { error: deleteError } = await getSupabaseClient().from('comments').delete().in('id', targets);
    if (deleteError) setError(explainCommentError(deleteError));
    else {
      setFeedback('Deleted.');
      await load();
    }
    setBusy(false);
  };

  const toggle = (id: number) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <section className={styles.container} aria-labelledby="comments-heading">
      <div className={styles.intro}>
        <h2 id="comments-heading">Comments</h2>
        <p>Approve, reject, or delete comments left on your pages and posts.</p>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {feedback && <div className={styles.feedback} role="status">{feedback}</div>}

      <div className={styles.toolbar}>
        <div className={styles.filters} role="tablist" aria-label="Filter comments">
          {filters.map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={status === value}
              className={status === value ? styles.filterActive : styles.filter}
              onClick={() => setStatus(value)}>{label}</button>
          ))}
        </div>
        {selected.size > 0 && (
          <div className={styles.bulk}>
            <span>{selected.size} selected</span>
            <button type="button" disabled={busy} onClick={() => void setStatusFor(ids(), 'approved')}>Approve</button>
            <button type="button" disabled={busy} onClick={() => void setStatusFor(ids(), 'pending')}>Unapprove</button>
            <button type="button" disabled={busy} onClick={() => void setStatusFor(ids(), 'spam')}>Spam</button>
            <button type="button" className={styles.danger} disabled={busy} onClick={() => void remove(ids())}>Delete</button>
          </div>
        )}
      </div>

      {loading ? (
        <div className={styles.empty}>Loading comments…</div>
      ) : comments.length === 0 ? (
        <div className={styles.empty}>No {status === 'all' ? '' : status} comments.</div>
      ) : (
        <ul className={styles.list}>
          {comments.map((comment) => {
            const name = comment.author?.display_name || comment.author_name || comment.author?.email || 'Unknown';
            return (
              <li key={comment.id} className={styles.row}>
                <input type="checkbox" checked={selected.has(comment.id)} onChange={() => toggle(comment.id)}
                  aria-label={`Select comment by ${name}`} />
                <div className={styles.main}>
                  <div className={styles.meta}>
                    <strong>{name}</strong>
                    <span>{comment.author?.email}</span>
                    <span>{new Date(comment.created_at).toLocaleString()}</span>
                    <span className={styles[comment.status] || styles.pending}>{comment.status}</span>
                    {comment.parent_id && <span className={styles.replyTag}>reply</span>}
                  </div>
                  <p className={styles.content}>{comment.content}</p>
                  {comment.page && (
                    <a className={styles.pageLink} href={`/${comment.page.slug}`} target="_blank" rel="noreferrer">
                      on “{comment.page.title}”
                    </a>
                  )}
                  <div className={styles.rowActions}>
                    {comment.status !== 'approved' && (
                      <button type="button" disabled={busy} onClick={() => void setStatusFor([comment.id], 'approved')}>Approve</button>
                    )}
                    {comment.status === 'approved' && (
                      <button type="button" disabled={busy} onClick={() => void setStatusFor([comment.id], 'pending')}>Unapprove</button>
                    )}
                    {comment.status !== 'spam' && (
                      <button type="button" disabled={busy} onClick={() => void setStatusFor([comment.id], 'spam')}>Spam</button>
                    )}
                    <button type="button" className={styles.danger} disabled={busy} onClick={() => void remove([comment.id])}>Delete</button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
