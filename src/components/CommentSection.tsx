import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getSupabaseClient } from '../lib/db';
import {
  buildCommentTree, countComments, explainCommentError, fetchPageComments,
  type CommentNode,
} from '../lib/comments';
import styles from './CommentSection.module.css';

interface CommentSectionProps {
  pageId: number;
  commentsOpen: boolean;
  moderated: boolean;
  maxDepth: number;
}

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

function CommentForm({
  parentId, onSubmit, onCancel, busy,
}: {
  parentId: number | null;
  onSubmit: (content: string, parentId: number | null) => Promise<void>;
  onCancel?: () => void;
  busy: boolean;
}) {
  const [content, setContent] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!content.trim()) return;
    await onSubmit(content.trim(), parentId);
    setContent('');
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.srOnly} htmlFor={`comment-${parentId ?? 'root'}`}>
        {parentId ? 'Write a reply' : 'Write a comment'}
      </label>
      <textarea
        id={`comment-${parentId ?? 'root'}`}
        rows={parentId ? 3 : 4}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={parentId ? 'Write a reply…' : 'Join the discussion…'}
        required
      />
      <div className={styles.formActions}>
        {onCancel && <button type="button" className={styles.secondary} onClick={onCancel}>Cancel</button>}
        <button type="submit" className={styles.primary} disabled={busy || !content.trim()}>
          {busy ? 'Posting…' : parentId ? 'Post reply' : 'Post comment'}
        </button>
      </div>
    </form>
  );
}

function CommentItem({
  node, onReply, replyingTo, setReplyingTo, busy, canModerate, onDelete, currentUserId,
}: {
  node: CommentNode;
  onReply: (content: string, parentId: number | null) => Promise<void>;
  replyingTo: number | null;
  setReplyingTo: (id: number | null) => void;
  busy: boolean;
  canModerate: boolean;
  onDelete: (id: number) => void;
  currentUserId: string;
}) {
  const name = node.author?.display_name || node.author_name || node.author?.email?.split('@')[0] || 'Someone';
  const pending = node.status !== 'approved';

  return (
    <li className={styles.item} style={{ marginLeft: `${node.depth * 28}px` }}>
      <article className={pending ? styles.bodyPending : styles.body}>
        <header className={styles.meta}>
          {node.author?.avatar_url
            ? <img className={styles.avatar} src={node.author.avatar_url} alt="" />
            : <span className={styles.avatarFallback} aria-hidden="true">{name.charAt(0).toUpperCase()}</span>}
          <span className={styles.author}>{name}</span>
          <span className={styles.date}>{formatDate(node.created_at)}</span>
          {pending && <span className={styles.pendingTag}>Awaiting approval</span>}
        </header>
        <p className={styles.content}>{node.content}</p>
        <div className={styles.actions}>
          <button type="button" onClick={() => setReplyingTo(replyingTo === node.id ? null : node.id)}>
            {replyingTo === node.id ? 'Cancel reply' : 'Reply'}
          </button>
          {(canModerate || node.author_id === currentUserId) && (
            <button type="button" className={styles.danger} onClick={() => onDelete(node.id)}>Delete</button>
          )}
        </div>
        {replyingTo === node.id && (
          <CommentForm parentId={node.id} onSubmit={onReply} onCancel={() => setReplyingTo(null)} busy={busy} />
        )}
      </article>
      {node.children.length > 0 && (
        <ul className={styles.list}>
          {node.children.map((child) => (
            <CommentItem key={child.id} node={child} onReply={onReply} replyingTo={replyingTo}
              setReplyingTo={setReplyingTo} busy={busy} canModerate={canModerate} onDelete={onDelete}
              currentUserId={currentUserId} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function CommentSection({ pageId, commentsOpen, moderated, maxDepth }: CommentSectionProps) {
  const [tree, setTree] = useState<CommentNode[]>([]);
  const [userId, setUserId] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [canModerate, setCanModerate] = useState(false);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const supabase = getSupabaseClient();
      const { data: userData } = await supabase.auth.getUser();
      setUserId(userData.user?.id || '');
      if (userData.user) {
        const { data: profile } = await supabase
          .from('profiles').select('role,display_name').eq('id', userData.user.id).maybeSingle();
        setCanModerate(['administrator', 'super_admin', 'editor'].includes(profile?.role || ''));
        setAuthorName(profile?.display_name || userData.user.email?.split('@')[0] || 'Member');
      }
      setTree(buildCommentTree(await fetchPageComments(pageId), maxDepth));
    } catch (loadError: unknown) {
      setError(explainCommentError(loadError));
    } finally {
      setLoading(false);
    }
  }, [maxDepth, pageId]);

  useEffect(() => { void load(); }, [load]);

  const addComment = async (content: string, parentId: number | null) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: insertError } = await getSupabaseClient().from('comments').insert({
        page_id: pageId,
        parent_id: parentId,
        author_id: userId,
        // Denormalised so signed-out readers see a name: profiles is readable by
        // authenticated users only, because it holds email addresses.
        author_name: authorName,
        content,
        status: moderated ? 'pending' : 'approved',
      });
      if (insertError) throw insertError;
      setReplyingTo(null);
      setNotice(moderated ? 'Thanks — your comment is awaiting approval.' : 'Comment posted.');
      await load();
    } catch (submitError: unknown) {
      setError(explainCommentError(submitError));
    } finally {
      setBusy(false);
    }
  };

  const removeComment = async (id: number) => {
    if (!window.confirm('Delete this comment and its replies?')) return;
    const { error: deleteError } = await getSupabaseClient().from('comments').delete().eq('id', id);
    if (deleteError) setError(explainCommentError(deleteError));
    else await load();
  };

  const total = countComments(tree);

  return (
    <section className={styles.section} aria-labelledby="comments-heading">
      <h2 id="comments-heading">
        {loading ? 'Comments' : total === 0 ? 'No comments yet' : `${total} comment${total === 1 ? '' : 's'}`}
      </h2>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {notice && <div className={styles.notice} role="status">{notice}</div>}

      {!loading && tree.length > 0 && (
        <ul className={styles.list}>
          {tree.map((node) => (
            <CommentItem key={node.id} node={node} onReply={addComment} replyingTo={replyingTo}
              setReplyingTo={setReplyingTo} busy={busy} canModerate={canModerate} onDelete={removeComment}
              currentUserId={userId} />
          ))}
        </ul>
      )}

      {!commentsOpen ? (
        <p className={styles.closed}>Comments are closed for this page.</p>
      ) : userId ? (
        <CommentForm parentId={null} onSubmit={addComment} busy={busy} />
      ) : (
        <p className={styles.signIn}>
          <a href={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}>Sign in</a> to join the discussion.
        </p>
      )}
    </section>
  );
}
