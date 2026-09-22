import { lazy, Suspense, type ReactNode } from 'react';
import { rwp } from '../../lib/rwp';
import type { EngagementTargetType, FollowTargetType, PopularTimeframe } from '../../lib/engagement';
import { useEngagementTarget } from './context';
import LikeButton from './LikeButton';
import SaveButton from './SaveButton';
import FollowButton from './FollowButton';
import ViewCount from './ViewCount';
import EngagementBar from './EngagementBar';
import PopularContentFeed from './PopularContentFeed';

// The feeds that need a signed-in person go through UserAccount's sign-in prompt; their own chunk.
const SignedInFeed = lazy(() => import('./SignedInFeed'));

const flag = (value: string | undefined, fallback = true) => (value === undefined ? fallback : !/^(no|false|0|off)$/i.test(value));

/** The item a shortcode is about: its id/type attributes, or the post it is written in. */
function Target({ attributes, children }: {
  attributes: Record<string, string>;
  children: (target: { type: EngagementTargetType; id: string; authorId: string | null; categoryId: string | null }) => ReactNode;
}) {
  const current = useEngagementTarget();
  const id = attributes.id || (current ? String(current.targetId) : '');
  if (!id) return null;
  const type = attributes.type || (attributes.id ? 'page' : current?.targetType || 'page');
  return <>{children({ type, id, authorId: current?.authorId || null, categoryId: current?.categoryId || null })}</>;
}

const targetAttributes = [
  { name: 'id', description: 'The post, page or product id. Leave it out to use the post the shortcode is written in.' },
  { name: 'type', description: 'page (posts and pages, the default) or product.' },
];

/** Registered once at startup with the other built-in shortcodes. */
export const registerEngagementShortcodes = () => {
  rwp.shortcodes.register({
    name: 'rwp_like',
    description: 'A Like button with its count. Hidden when likes are switched off under Settings → Engagement.',
    example: '[rwp_like]',
    attributes: [...targetAttributes, { name: 'count', description: 'no hides the number.' }],
    render: (attributes) => (
      <Target attributes={attributes}>{({ type, id }) => <LikeButton targetType={type} targetId={id} showCount={flag(attributes.count)} />}</Target>
    ),
  });

  rwp.shortcodes.register({
    name: 'rwp_save',
    description: 'A Save button: signed-in visitors keep the item in their saved collections (Dashboard → My saved collections).',
    example: '[rwp_save]',
    attributes: [...targetAttributes, { name: 'collections', description: 'no removes the menu for choosing a collection.' }],
    render: (attributes) => (
      <Target attributes={attributes}>{({ type, id }) => <SaveButton targetType={type} targetId={id} collections={flag(attributes.collections)} />}</Target>
    ),
  });

  rwp.shortcodes.register({
    name: 'rwp_follow',
    description: "A Follow button for an author or a category. Without an id: the author of the post it is written in (type=\"category\": the post's category).",
    example: '[rwp_follow type="user"]',
    attributes: [
      { name: 'type', description: 'user (an author, the default) or category.' },
      { name: 'id', description: 'The user id or category id.' },
      { name: 'count', description: 'no hides the follower count.' },
      { name: 'name', description: 'yes shows "Follow Jane" instead of "Follow".' },
    ],
    render: (attributes) => <FollowShortcode attributes={attributes} />,
  });

  rwp.shortcodes.register({
    name: 'rwp_views',
    description: 'How many times the item was viewed.',
    example: '[rwp_views]',
    attributes: targetAttributes,
    render: (attributes) => <Target attributes={attributes}>{({ type, id }) => <ViewCount targetType={type} targetId={id} />}</Target>,
  });

  rwp.shortcodes.register({
    name: 'rwp_engagement',
    description: 'Like, Save, view count and Follow-the-author in one row, as under posts.',
    example: '[rwp_engagement]',
    attributes: [
      ...targetAttributes,
      { name: 'like / save / views / follow', description: 'no leaves that part out, e.g. [rwp_engagement follow="no"].' },
    ],
    render: (attributes) => (
      <Target attributes={attributes}>
        {({ type, id, authorId }) => (
          <EngagementBar targetType={type} targetId={id} authorId={attributes.id ? undefined : authorId}
            showLike={flag(attributes.like)} showSave={flag(attributes.save)} showViews={flag(attributes.views)} showFollow={flag(attributes.follow)} />
        )}
      </Target>
    ),
  });

  rwp.shortcodes.register({
    name: 'rwp_popular_content',
    description: 'The most popular posts (and products), ranked by views + likes × 3.',
    example: '[rwp_popular_content limit="5" timeframe="week"]',
    attributes: [
      { name: 'limit', description: 'How many items, 1 to 50. Default 5.' },
      { name: 'timeframe', description: 'week (default), month or all.' },
      { name: 'type', description: 'page, product, or both separated by a comma. Default: everything.' },
      { name: 'title', description: 'The heading. title="" hides it.' },
      { name: 'layout', description: 'list (default, numbered) or grid.' },
    ],
    render: (attributes) => {
      const timeframe = (['week', 'month', 'all'].includes(attributes.timeframe) ? attributes.timeframe : 'week') as PopularTimeframe;
      return (
        <PopularContentFeed
          limit={Math.min(50, Math.max(1, Number(attributes.limit) || 5))}
          timeframe={timeframe}
          types={attributes.type ? attributes.type.split(',').map((value) => value.trim()).filter(Boolean) : undefined}
          title={attributes.title}
          layout={attributes.layout === 'grid' ? 'grid' : 'list'}
        />
      );
    },
  });

  rwp.shortcodes.register({
    name: 'rwp_saved_collections',
    description: "The signed-in visitor's saved items, by collection. Visitors who are not signed in are asked to.",
    example: '[rwp_saved_collections]',
    attributes: [],
    render: () => <Suspense fallback={<p>Loading…</p>}><SignedInFeed feed="saved" /></Suspense>,
  });

  rwp.shortcodes.register({
    name: 'rwp_following_feed',
    description: 'New posts and products from the authors and categories the signed-in visitor follows.',
    example: '[rwp_following_feed]',
    attributes: [],
    render: () => <Suspense fallback={<p>Loading…</p>}><SignedInFeed feed="following" /></Suspense>,
  });
};

function FollowShortcode({ attributes }: { attributes: Record<string, string> }) {
  const current = useEngagementTarget();
  const type: FollowTargetType = attributes.type === 'category' ? 'category' : 'user';
  const id = attributes.id || (type === 'category' ? current?.categoryId : current?.authorId) || '';
  if (!id) return null;
  return <FollowButton targetType={type} targetId={id} showCount={flag(attributes.count)} showName={flag(attributes.name, false)} />;
}
