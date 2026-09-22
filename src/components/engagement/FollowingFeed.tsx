import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '../../lib/db';
import { fetchFollowingFeed, fetchMyFollows, type FeedEntry } from '../../lib/engagement';
import { formatDate } from '../../lib/i18n';
import { useTranslation } from '../../context/I18nContext';
import FollowButton from './FollowButton';
import './engagement.css';

const pageSize = 20;
const entryKey = (entry: FeedEntry) => `${entry.target_type}:${entry.target_id}`;
const newestFirst = (a: FeedEntry, b: FeedEntry) => new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime();

/**
 * Following Feed: newly published posts (and, with the shop, products) from the authors and categories
 * the signed-in person follows. It refreshes itself when a post is published, through Supabase Realtime
 * on `pages` (added to the supabase_realtime publication by the migration), and every minute while the
 * tab is visible as a fallback, which is also what picks up new products.
 */
export default function FollowingFeed() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [follows, setFollows] = useState<Awaited<ReturnType<typeof fetchMyFollows>>>({ users: [], categories: [] });
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [fresh, setFresh] = useState(0);
  const known = useRef(new Set<string>());

  /** Newest page, merged in front of what is already shown. */
  const refresh = useCallback(async (initial = false) => {
    try {
      const latest = await fetchFollowingFeed(pageSize);
      setError('');
      const added = latest.filter((entry) => !known.current.has(entryKey(entry)));
      latest.forEach((entry) => known.current.add(entryKey(entry)));
      if (initial) {
        setEntries(latest);
        setMore(latest.length === pageSize);
      } else if (added.length) {
        setEntries((current) => [...added, ...current].sort(newestFirst));
        setFresh((count) => count + added.length);
      }
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'The feed could not be loaded.');
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    fetchMyFollows().then(setFollows).catch(() => undefined);
  }, [refresh]);

  // Realtime: any published page may be from someone followed; the feed query decides.
  useEffect(() => {
    let timer = 0;
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 1500);
    };
    let channel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null;
    try {
      channel = getSupabaseClient()
        .channel('rwp-following-feed')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pages', filter: 'status=eq.published' }, later)
        .subscribe();
    } catch {
      channel = null;
    }
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      if (channel) void getSupabaseClient().removeChannel(channel);
    };
  }, [refresh]);

  const loadMore = async () => {
    const last = entries[entries.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const older = await fetchFollowingFeed(pageSize, last.published_at);
      older.forEach((entry) => known.current.add(entryKey(entry)));
      setEntries((current) => {
        const seen = new Set(current.map(entryKey));
        return [...current, ...older.filter((entry) => !seen.has(entryKey(entry)))];
      });
      setMore(older.length === pageSize);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Older posts could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  };

  const followsNothing = !follows.users.length && !follows.categories.length;

  return (
    <section className="rwp-following-feed" aria-labelledby="rwp-following-heading">
      <h3 id="rwp-following-heading">{t('engagement.followingFeed', 'Following')}</h3>
      {(follows.users.length > 0 || follows.categories.length > 0) && (
        <div className="rwp-engagement-following-list">
          <span>{t('engagement.youFollow', 'You follow:')}</span>
          {follows.users.map((user) => (
            <span key={user.id} className="rwp-engagement-badge">
              {user.name} <FollowButton targetId={user.id} targetType="user" showCount={false} className="is-compact" />
            </span>
          ))}
          {follows.categories.map((category) => (
            <span key={category.id} className="rwp-engagement-badge">
              <a href={`/category/${category.slug}`}>{category.name}</a>{' '}
              <FollowButton targetId={category.id} targetType="category" showCount={false} className="is-compact" />
            </span>
          ))}
        </div>
      )}
      {fresh > 0 && (
        <p className="rwp-engagement-notice" role="status">
          {t('engagement.newInFeed', '{count} new since you opened this page.', { count: fresh })}
          <button type="button" className="rwp-engagement-link-button" onClick={() => { setFresh(0); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
            {t('engagement.dismiss', 'Dismiss')}
          </button>
        </p>
      )}
      {error && <p className="rwp-engagement-error" role="alert">{error}</p>}
      {loading ? <p className="rwp-engagement-muted">{t('engagement.loading', 'Loading…')}</p> : !entries.length ? (
        <p className="rwp-engagement-muted">
          {followsNothing
            ? t('engagement.followSomeone', 'Follow authors and categories (the Follow buttons on posts and archives) and their new posts will appear here.')
            : t('engagement.feedEmpty', 'Nothing new from the people and categories you follow yet.')}
        </p>
      ) : (
        <ul className="rwp-engagement-list">
          {entries.map((entry) => (
            <li key={entryKey(entry)} className="rwp-engagement-item rwp-following-item">
              {entry.image && <img className="rwp-engagement-thumb" src={entry.image} alt="" loading="lazy" />}
              <span className="rwp-engagement-item-body">
                <a className="rwp-engagement-item-title" href={entry.url}>{entry.title}</a>
                <span className="rwp-engagement-item-meta">
                  {entry.target_type === 'product' && <span className="rwp-engagement-badge">{t('engagement.product', 'Product')}</span>}
                  <span>
                    {entry.reason === 'category' && entry.category_name
                      ? t('engagement.inCategory', 'In {category}', { category: entry.category_name })
                      : t('engagement.byAuthor', 'By {author}', { author: entry.author_name || 'Author' })}
                  </span>
                  {entry.published_at && <time dateTime={entry.published_at}>{formatDate(entry.published_at)}</time>}
                </span>
                {entry.excerpt && <p className="rwp-engagement-item-excerpt">{entry.excerpt}</p>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {more && !loading && (
        <div>
          <button type="button" className="rwp-engagement-button" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? t('engagement.loading', 'Loading…') : t('engagement.older', 'Older posts')}
          </button>
        </div>
      )}
    </section>
  );
}
