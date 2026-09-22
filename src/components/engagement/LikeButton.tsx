import { Heart } from 'lucide-react';
import { useAppSettings } from '../../lib/appSettings';
import { engagementVisible, useEngagement, type EngagementPlacement, type EngagementTargetType } from '../../lib/engagement';
import { formatNumber } from '../../lib/i18n';
import { useTranslation } from '../../context/I18nContext';
import './engagement.css';

export interface LikeButtonProps {
  targetId: string | number;
  targetType?: EngagementTargetType;
  /** 'auto' follows Settings → Engagement's granular toggles; 'manual' (default) only the global one. */
  placement?: EngagementPlacement;
  showCount?: boolean;
  className?: string;
}

/** <LikeButton targetId={post.id} targetType="page" />. Hidden for items that are not published. */
export default function LikeButton({ targetId, targetType = 'page', placement = 'manual', showCount = true, className = '' }: LikeButtonProps) {
  const { settings, loaded } = useAppSettings();
  const { t } = useTranslation();
  const visible = loaded && engagementVisible(settings.engagement, 'like', { targetType, placement });
  const { item, toggleLike, error } = useEngagement(targetType, visible ? targetId : null);
  if (!visible || item === null) return null;

  const liked = Boolean(item?.liked);
  const count = item?.likes ?? 0;
  const label = liked ? t('engagement.liked', 'Liked') : t('engagement.like', 'Like');
  return (
    <>
      <button
        type="button"
        className={`rwp-engagement-button rwp-like-button${liked ? ' is-active' : ''} ${className}`.trim()}
        aria-pressed={liked}
        aria-label={`${label} (${formatNumber(count)})`}
        disabled={item === undefined}
        onClick={() => void toggleLike()}
      >
        <Heart aria-hidden="true" />
        <span>{label}</span>
        {showCount && item !== undefined && <span className="rwp-engagement-count">{formatNumber(count)}</span>}
      </button>
      {error && <p className="rwp-engagement-error" role="alert">{error}</p>}
    </>
  );
}
