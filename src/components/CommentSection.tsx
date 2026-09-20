import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getSupabaseClient } from '../lib/db';
import {
  buildCommentTree, countComments, explainCommentError, fetchPageComments,
  type CommentNode, type CommentWithAuthor,
} from '../lib/comments';
import { useTheme, type ThemeBlock } from '../lib/theme';
import { useTranslation } from '../context/I18nContext';
import { HookSlot } from '../core/HookSlot';
import ContentRenderer from './ContentRenderer';
import { BlockFrame } from './theme/ThemeLayoutRenderer';
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
  parentId, onSubmit, onCancel, busy, placeholder,
}: {
  parentId: number | null;
  onSubmit: (content: string, parentId: number | null) => Promise<void>;
  onCancel?: () => void;
  busy: boolean;
  placeholder?: string;
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
        placeholder={parentId ? 'Write a reply…' : placeholder || 'Join the discussion…'}
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

interface ItemOptions {
  showAvatars: boolean;
  allowReplies: boolean;
}

function CommentItem({
  node, onReply, replyingTo, setReplyingTo, busy, canModerate, onDelete, currentUserId, options,
}: {
  node: CommentNode;
  onReply: (content: string, parentId: number | null) => Promise<void>;
  replyingTo: number | null;
  setReplyingTo: (id: number | null) => void;
  busy: boolean;
  canModerate: boolean;
  onDelete: (id: number) => void;
  currentUserId: string;
  options: ItemOptions;
}) {
  const name = node.author?.display_name || node.author_name || node.author?.email?.split('@')[0] || 'Someone';
  const pending = node.status !== 'approved';

  return (
    // Logical, so replies indent from the right in an RTL language rather than off to the left.
    <li className={`${styles.item} rwp-comment`} style={{ marginInlineStart: `${node.depth * 28}px` }}>
      <article className={pending ? styles.bodyPending : styles.body}>
        <header className={styles.meta}>
          {options.showAvatars && (node.author?.avatar_url
            ? <img className={styles.avatar} src={node.author.avatar_url} alt="" />
            : <span className={styles.avatarFallback} aria-hidden="true">{name.charAt(0).toUpperCase()}</span>)}
          <span className={styles.author}>{name}</span>
          <span className={styles.date}>{formatDate(node.created_at)}</span>
          {pending && <span className={styles.pendingTag}>Awaiting approval</span>}
        </header>
        <p className={styles.content}>{node.content}</p>
        <div className={styles.actions}>
          {options.allowReplies && currentUserId && (
            <button type="button" onClick={() => setReplyingTo(replyingTo === node.id ? null : node.id)}>
              {replyingTo === node.id ? 'Cancel reply' : 'Reply'}
            </button>
          )}
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
              currentUserId={currentUserId} options={options} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The order of the list, form, pagination and rules, and the avatar, reply and paging options,
 * come from Appearance → Theme Editor → Comments.
 */
export default function CommentSection({ pageId, commentsOpen, moderated, maxDepth }: CommentSectionProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { containers, options } = theme.layout.comments;
  const blocks = containers[0]?.blocks || [];
  const paginated = options.per_page > 0 && blocks.some((block) => block.type === 'comments-pagination' && block.style.visible);
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [page, setPage] = useState(1);
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
      setComments(await fetchPageComments(pageId));
    } catch (loadError: unknown) {
      setError(explainCommentError(loadError));
    } finally {
      setLoading(false);
    }
  }, [pageId]);

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

  // With nested replies off, every comment is shown flat in date order, and no new replies are offered.
  const allRoots = options.nested_replies
    ? buildCommentTree(comments, maxDepth)
    : buildCommentTree(comments.map((comment) => ({ ...comment, parent_id: null })), 0);
  const roots = options.order === 'newest' ? [...allRoots].reverse() : allRoots;
  const total = countComments(allRoots);
  const pageCount = paginated ? Math.max(1, Math.ceil(roots.length / options.per_page)) : 1;
  const currentPage = Math.min(page, pageCount);
  const visibleRoots = paginated ? roots.slice((currentPage - 1) * options.per_page, currentPage * options.per_page) : roots;
  const itemOptions: ItemOptions = { showAvatars: options.show_avatars, allowReplies: options.nested_replies && commentsOpen };

  const renderBlock = (block: ThemeBlock) => {
    const title = typeof block.settings.title === 'string' ? block.settings.title : '';
    switch (block.type) {
      case 'comments-list':
        return !loading && visibleRoots.length > 0 ? (
          <ul className={`${styles.list} rwp-comments-list`}>
            {visibleRoots.map((node) => (
              <CommentItem key={node.id} node={node} onReply={addComment} replyingTo={replyingTo}
                setReplyingTo={setReplyingTo} busy={busy} canModerate={canModerate} onDelete={removeComment}
                currentUserId={userId} options={itemOptions} />
            ))}
          </ul>
        ) : null;
      case 'comment-form':
        return (
          <>
            {/* Anti-spam notices, guidelines and consent checkboxes hook in here. */}
            <HookSlot name="comment_form_before" args={{ pageId, commentsOpen, signedIn: Boolean(userId) }} />
            {!commentsOpen ? (
              <p className={styles.closed}>{t('comments.closed', 'Comments are closed.')}</p>
            ) : userId ? (
              <CommentForm parentId={null} onSubmit={addComment} busy={busy} placeholder={String(block.settings.placeholder || '')} />
            ) : (
              <p className={styles.signIn}>
                <a href={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}>Sign in</a> to join the discussion.
              </p>
            )}
            <HookSlot name="comment_form_after" args={{ pageId, commentsOpen, signedIn: Boolean(userId) }} />
          </>
        );
      case 'comments-pagination':
        return paginated && pageCount > 1 ? (
          <nav className="rwpt-pagination" aria-label="Comment pages">
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
              <button key={number} type="button" aria-current={number === currentPage ? 'page' : undefined}
                onClick={() => setPage(number)}>{number}</button>
            ))}
          </nav>
        ) : null;
      case 'discussion-rules':
        return (
          <div className="rwpt-rules">
            {title && <h3>{title}</h3>}
            <p>{String(block.settings.text || '')}</p>
          </div>
        );
      case 'custom-html':
        return <>{title && <h3>{title}</h3>}<ContentRenderer html={String(block.settings.html || '')} /></>;
      case 'text':
        return <p className="rwpt-text">{String(block.settings.text || '')}</p>;
      default:
        return null;
    }
  };

  return (
    <section className={`${styles.section} rwp-comments`} aria-labelledby="comments-heading">
      <h2 id="comments-heading">
        {loading
          ? t('comments.title', 'Comments')
          : total === 0
            ? t('comments.none', 'No comments yet.')
            : t('comments.count', '{count} comments', { count: total })}
      </h2>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {notice && <div className={styles.notice} role="status">{notice}</div>}

      {blocks.map((block) => <BlockFrame key={block.id} block={block}>{renderBlock(block)}</BlockFrame>)}
    </section>
  );
}
