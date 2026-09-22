/**
 * Core engagement in the builder: the Engagement Bar (Like, Save, views, Follow the author) for the
 * current post, and Popular Content. Both render core's components, so Settings → Engagement and the
 * counts behave exactly as under classic posts. Shop product tools are registered by the shop plugin.
 */
import EngagementBar from '../../../../src/components/engagement/EngagementBar';
import PopularContentFeed from '../../../../src/components/engagement/PopularContentFeed';
import { useEngagementItem } from '../../../../src/lib/engagement';
import { colorControl, opts } from '../../lib/controls';
import type { WidgetDefinition } from '../../lib/registry';
import { alignToFlex, color } from '../../lib/style';
import { useRenderContext } from '../context';
import { clamp, num, pick, str, useCurrentPost } from './kit';
import { EditorPlaceholder } from './shared';

function CurrentPostBar({ settings }: { settings: Record<string, unknown> }) {
  const { mode, pageId } = useRenderContext();
  const post = useCurrentPost();
  const chosen = str(settings.postId).trim();
  const id = chosen || (post ? String(post.id) : pageId ? String(pageId) : '');
  const item = useEngagementItem('page', id || null);
  if (!id) return <EditorPlaceholder>Shows the Like, Save and Follow buttons of the post being viewed. Use it in a post, a Single Post template or a Loop item.</EditorPlaceholder>;
  if (item === null && mode === 'edit') {
    return <EditorPlaceholder>The engagement buttons appear once this post is published (and while they are on under Settings → Engagement).</EditorPlaceholder>;
  }
  return (
    <EngagementBar
      targetType="page"
      targetId={id}
      compact={Boolean(settings.compact)}
      showLike={settings.showLike !== false}
      showSave={settings.showSave !== false}
      showViews={settings.showViews !== false}
      showFollow={settings.showFollow !== false}
    />
  );
}

export const engagementBar: WidgetDefinition = {
  type: 'engagement-bar',
  label: 'Engagement Bar',
  icon: 'heart',
  category: 'dynamic',
  keywords: ['like', 'save', 'bookmark', 'follow', 'views', 'engagement'],
  defaults: () => ({ settings: { postId: '', showLike: true, showSave: true, showViews: true, showFollow: true, compact: false }, style: { align: 'left' } }),
  controls: [
    { key: 'postId', label: 'Post id', type: 'text', placeholder: 'The current post', help: 'Leave empty for the post being viewed (or the Loop item).' },
    { key: 'showLike', label: 'Like button', type: 'toggle' },
    { key: 'showSave', label: 'Save button', type: 'toggle' },
    { key: 'showViews', label: 'View count', type: 'toggle' },
    { key: 'showFollow', label: 'Follow the author', type: 'toggle' },
    { key: 'compact', label: 'Compact', type: 'toggle' },
    { key: 'align', label: 'Alignment', type: 'select', tab: 'style', store: 'style', options: opts(['left', 'Start'], ['center', 'Center'], ['right', 'End'], ['space-between', 'Spread']) },
    colorControl('buttonColor', 'Button colour'),
    colorControl('activeColor', 'Liked / saved colour'),
  ],
  css: (bag) => ({
    ' .rwp-engagement-bar': { 'justify-content': bag.align === 'space-between' ? 'space-between' : alignToFlex(bag.align) },
    ' .rwp-engagement-button': { color: color(bag.buttonColor) },
    ' .rwp-engagement-button.is-active': { color: color(bag.activeColor) },
  }),
  View: function EngagementBarView({ node }) {
    return <CurrentPostBar settings={node.settings} />;
  },
};

export const popularContent: WidgetDefinition = {
  type: 'popular-content',
  label: 'Popular Content',
  icon: 'flame',
  category: 'site',
  keywords: ['trending', 'most viewed', 'most liked', 'popular posts'],
  defaults: () => ({ settings: { title: 'Popular right now', limit: 5, timeframe: 'week', types: 'all', layout: 'list', showStats: true, showImages: true } }),
  controls: [
    { key: 'title', label: 'Heading', type: 'text' },
    { key: 'limit', label: 'Number of items', type: 'number', min: 1, max: 50 },
    { key: 'timeframe', label: 'Timeframe', type: 'select', options: opts(['week', 'Last 7 days'], ['month', 'Last 30 days'], ['all', 'All time']) },
    { key: 'types', label: 'Show', type: 'select', options: opts(['all', 'Posts and products'], ['page', 'Posts and pages only'], ['product', 'Products only']) },
    { key: 'layout', label: 'Layout', type: 'select', options: opts(['list', 'Numbered list'], ['grid', 'Grid']) },
    { key: 'showImages', label: 'Images', type: 'toggle' },
    { key: 'showStats', label: 'Views and likes', type: 'toggle' },
    colorControl('titleColor', 'Title colour'),
  ],
  css: (bag) => ({ ' .rwp-engagement-item-title': { color: color(bag.titleColor) } }),
  View: function PopularContentView({ node }) {
    const settings = node.settings;
    const types = pick(settings.types, ['all', 'page', 'product'] as const, 'all');
    return (
      <PopularContentFeed
        title={str(settings.title)}
        limit={clamp(Math.round(num(settings.limit, 5)), 1, 50)}
        timeframe={pick(settings.timeframe, ['week', 'month', 'all'] as const, 'week')}
        types={types === 'all' ? undefined : [types]}
        layout={settings.layout === 'grid' ? 'grid' : 'list'}
        showImages={settings.showImages !== false}
        showStats={settings.showStats !== false}
      />
    );
  },
};
