import { UserCheck, UserPlus } from 'lucide-react';
import { useAppSettings } from '../../lib/appSettings';
import { engagementVisible, useFollow, type EngagementPlacement, type FollowTargetType } from '../../lib/engagement';
import { formatNumber } from '../../lib/i18n';
import { useTranslation } from '../../context/I18nContext';
import './engagement.css';

export interface FollowButtonProps {
  targetId: string | null | undefined;
  targetType: FollowTargetType;
  placement?: EngagementPlacement;
  showCount?: boolean;
  /** "Follow Jane" instead of "Follow". */
  showName?: boolean;
  className?: string;
}

/**
 * <FollowButton targetId={authorId} targetType="user" /> or targetType="category". Hidden on your own
 * account and for accounts or categories that no longer exist.
 */
export default function FollowButton({ targetId, targetType, placement = 'manual', showCount = true, showName = false, className = '' }: FollowButtonProps) {
  const { settings, loaded } = useAppSettings();
  const { t } = useTranslation();
  const visible = loaded && Boolean(targetId) && engagementVisible(settings.engagement, 'follow', { targetType, placement });
  const { state, error, toggleFollow } = useFollow(targetType, visible ? targetId : null);
  if (!visible || state === null || state?.self) return null;

  const following = Boolean(state?.following);
  const name = showName && state?.name ? ` ${state.name}` : '';
  const label = following ? t('engagement.following', 'Following') : `${t('engagement.follow', 'Follow')}${name}`;
  const Icon = following ? UserCheck : UserPlus;
  return (
    <>
      <button
        type="button"
        className={`rwp-engagement-button rwp-follow-button rwp-follow-${targetType}${following ? ' is-active' : ''} ${className}`.trim()}
        aria-pressed={following}
        disabled={state === undefined}
        onClick={() => void toggleFollow()}
      >
        <Icon aria-hidden="true" />
        <span>{label}</span>
        {showCount && state !== undefined && (
          <span className="rwp-engagement-count" title={t('engagement.followers', 'Followers')}>{formatNumber(state.followers)}</span>
        )}
      </button>
      {error && <p className="rwp-engagement-error" role="alert">{error}</p>}
    </>
  );
}
