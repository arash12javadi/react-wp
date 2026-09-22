import { useEffect, useState } from 'react';
import { Eye, Heart } from 'lucide-react';
import { engagementUnavailable, fetchPopularContent, type PopularEntry, type PopularTimeframe } from '../../lib/engagement';
import { formatNumber } from '../../lib/i18n';
import { useTranslation } from '../../context/I18nContext';
import './engagement.css';

export interface PopularContentFeedProps {
  limit?: number;
  timeframe?: PopularTimeframe;
  /** Only these target types, e.g. ['page'] or ['product']. All when empty. */
  types?: string[];
  title?: string;
  layout?: 'list' | 'grid';
  showStats?: boolean;
  showImages?: boolean;
}

/**
 * <PopularContentFeed limit={5} timeframe="week" />: what is trending, ranked by
 * views + likes × 3 inside the timeframe (rwp_popular_content; 'all' uses the lifetime counters).
 */
export default function PopularContentFeed({
  limit = 5, timeframe = 'week', types, title, layout = 'list', showStats = true, showImages = true,
}: PopularContentFeedProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ items: PopularEntry[]; loading: boolean; error: string }>({ items: [], loading: true, error: '' });
  const typesKey = (types || []).join(',');

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    fetchPopularContent(limit, timeframe, typesKey ? typesKey.split(',') : undefined)
      .then((items) => { if (active) setState({ items, loading: false, error: '' }); })
      .catch((loadError: unknown) => {
        if (active) setState({ items: [], loading: false, error: loadError instanceof Error ? loadError.message : 'Popular content could not be loaded.' });
      });
    return () => { active = false; };
  }, [limit, timeframe, typesKey]);

  // Before the migration the feed disappears instead of showing an error to every visitor.
  if (engagementUnavailable()) return null;
  const heading = title ?? t('engagement.popular', 'Popular right now');

  return (
    <section className="rwp-popular-content" aria-label={heading || 'Popular content'}>
      {heading && <h3>{heading}</h3>}
      {state.loading && <p className="rwp-engagement-muted">{t('engagement.loading', 'Loading…')}</p>}
      {state.error && <p className="rwp-engagement-error" role="alert">{state.error}</p>}
      {!state.loading && !state.error && !state.items.length && (
        <p className="rwp-engagement-muted">{t('engagement.nothingPopular', 'Nothing is trending yet.')}</p>
      )}
      {state.items.length > 0 && (
        <ol className={`rwp-engagement-list${layout === 'grid' ? ' is-grid' : ''}`}>
          {state.items.map((entry, index) => (
            <li key={`${entry.target_type}:${entry.target_id}`} className="rwp-engagement-item rwp-popular-item">
              {layout === 'list' && <span className="rwp-engagement-item-rank" aria-hidden="true">{formatNumber(index + 1)}</span>}
              {showImages && entry.image && <img className="rwp-engagement-thumb" src={entry.image} alt="" loading="lazy" />}
              <span className="rwp-engagement-item-body">
                <a className="rwp-engagement-item-title" href={entry.url}>{entry.title}</a>
                {showStats && (
                  <span className="rwp-engagement-item-meta">
                    {entry.target_type === 'product' && <span className="rwp-engagement-badge">{t('engagement.product', 'Product')}</span>}
                    <span title={t('engagement.viewsTitle', 'Views')}><Eye aria-hidden="true" size={13} /> {formatNumber(entry.views)}</span>
                    <span title={t('engagement.likesTitle', 'Likes')}><Heart aria-hidden="true" size={13} /> {formatNumber(entry.likes)}</span>
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
