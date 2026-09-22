import { Eye } from 'lucide-react';
import { useAppSettings } from '../../lib/appSettings';
import { engagementVisible, useEngagementItem, type EngagementPlacement, type EngagementTargetType } from '../../lib/engagement';
import { formatNumber } from '../../lib/i18n';
import { useTranslation } from '../../context/I18nContext';
import './engagement.css';

/** "👁 1,204 views". `context` picks the single-page or archive toggle under Settings → Engagement. */
export default function ViewCount({ targetId, targetType = 'page', context = 'single', placement = 'manual' }: {
  targetId: string | number;
  targetType?: EngagementTargetType;
  context?: 'single' | 'archive';
  placement?: EngagementPlacement;
}) {
  const { settings, loaded } = useAppSettings();
  const { t } = useTranslation();
  const visible = loaded && engagementVisible(settings.engagement, 'views', { targetType, placement, context });
  const item = useEngagementItem(targetType, visible ? targetId : null);
  if (!visible || !item) return null;
  return (
    <span className="rwp-view-count" title={t('engagement.viewsTitle', 'Views')}>
      <Eye aria-hidden="true" />
      <span className="rwp-engagement-count">{formatNumber(item.views)}</span>
      <span>{item.views === 1 ? t('engagement.view', 'view') : t('engagement.views', 'views')}</span>
    </span>
  );
}
