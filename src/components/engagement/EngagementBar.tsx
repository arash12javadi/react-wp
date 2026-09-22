import { useEngagementItem, type EngagementPlacement, type EngagementTargetType } from '../../lib/engagement';
import LikeButton from './LikeButton';
import SaveButton from './SaveButton';
import FollowButton from './FollowButton';
import ViewCount from './ViewCount';
import './engagement.css';

export interface EngagementBarProps {
  targetId: string | number;
  targetType?: EngagementTargetType;
  /** The author to offer "Follow" for. Read from the item when left out. */
  authorId?: string | null;
  placement?: EngagementPlacement;
  context?: 'single' | 'archive';
  compact?: boolean;
  showLike?: boolean;
  showSave?: boolean;
  showViews?: boolean;
  showFollow?: boolean;
}

/**
 * Like, Save, views and Follow-the-author in one row, each following Settings → Engagement. Renders
 * nothing when every part is switched off or the item is not published.
 */
export default function EngagementBar({
  targetId, targetType = 'page', authorId, placement = 'manual', context = 'single', compact = false,
  showLike = true, showSave = true, showViews = true, showFollow = true,
}: EngagementBarProps) {
  const item = useEngagementItem(targetType, targetId);
  if (item === null) return null;
  const author = authorId === undefined ? item?.authorId : authorId;
  return (
    <div className={`rwp-engagement-bar${compact ? ' is-compact' : ''}`} data-rwp-engagement={targetType}>
      {showLike && <LikeButton targetId={targetId} targetType={targetType} placement={placement} />}
      {showSave && <SaveButton targetId={targetId} targetType={targetType} placement={placement} collections={!compact} />}
      {(showViews || (showFollow && author)) && (
        <span className="rwp-engagement-bar-end">
          {showViews && <ViewCount targetId={targetId} targetType={targetType} context={context} placement={placement} />}
          {showFollow && author && <FollowButton targetId={author} targetType="user" placement={placement} showName={!compact} />}
        </span>
      )}
    </div>
  );
}
