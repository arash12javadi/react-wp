import { useEffect, useState } from 'react';
import ContentRenderer from '../../../../src/components/ContentRenderer';
import { alignControl, colorControl, headingTags, opts, typographyControl } from '../../lib/controls';
import type { DynamicPost } from '../../lib/dynamic';
import { Icon } from '../../lib/icons';
import type { WidgetDefinition } from '../../lib/registry';
import { safeMediaUrl } from '../../lib/sanitize';
import { border, color, isSet, length, radius, shadow, typography, type Border, type Box, type Shadow, type Typography } from '../../lib/style';
import { useRenderContext } from '../context';
import { fetchPosts } from '../data';
import { EditorPlaceholder, useText } from './shared';
import { filterGroupControl, useTaxonomyFilter } from './kit';

const formatDate = (value: string) => new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

// Posts grid ---------------------------------------------------------------------------------

export const posts: WidgetDefinition = {
  type: 'posts',
  label: 'Posts',
  icon: 'newspaper',
  category: 'pro',
  keywords: ['blog', 'grid', 'loop', 'query', 'masonry'],
  defaults: () => ({
    settings: { categoryId: '', limit: 6, orderBy: 'created_at', order: 'desc', layout: 'grid', showImage: true, showExcerpt: true, excerptLength: 20, showMeta: true, showReadMore: true, readMoreText: 'Read more', pagination: 'none', titleTag: 'h3' },
    style: { columns: 3, columnGap: 24, rowGap: 24 },
  }),
  controls: [
    { key: '_query', label: 'Query', type: 'heading' },
    { key: 'categoryId', label: 'Category', type: 'category' },
    { key: 'limit', label: 'Posts per page', type: 'number', min: 1, max: 48 },
    { key: 'orderBy', label: 'Order by', type: 'select', options: opts(['created_at', 'Date published'], ['updated_at', 'Date modified'], ['title', 'Title']) },
    { key: 'order', label: 'Order', type: 'select', options: opts(['desc', 'Descending'], ['asc', 'Ascending']) },
    { key: 'excludeCurrent', label: 'Exclude the current post', type: 'toggle' },
    filterGroupControl(),
    { key: '_layout', label: 'Layout', type: 'heading' },
    { key: 'layout', label: 'Layout', type: 'select', options: opts(['grid', 'Grid'], ['list', 'List'], ['masonry', 'Masonry']) },
    { key: 'columns', label: 'Columns', type: 'slider', store: 'style', responsive: true, min: 1, max: 4, condition: (settings) => settings.layout !== 'list' },
    { key: 'showImage', label: 'Featured image', type: 'toggle', help: "Uses each post's social image (SEO panel → og:image)." },
    { key: 'imageRatio', label: 'Image ratio', type: 'select', options: opts(['16/9', '16:9'], ['4/3', '4:3'], ['1/1', '1:1'], ['', 'Original']), condition: (settings) => Boolean(settings.showImage) && settings.layout !== 'masonry' },
    { key: 'titleTag', label: 'Title HTML tag', type: 'select', options: headingTags },
    { key: 'showMeta', label: 'Date and category', type: 'toggle' },
    { key: 'showAuthor', label: 'Author', type: 'toggle', condition: (settings) => Boolean(settings.showMeta) },
    { key: 'showExcerpt', label: 'Excerpt', type: 'toggle' },
    { key: 'excerptLength', label: 'Excerpt length (words)', type: 'number', min: 5, max: 100, condition: (settings) => Boolean(settings.showExcerpt) },
    { key: 'showReadMore', label: 'Read more link', type: 'toggle' },
    { key: 'readMoreText', label: 'Read more text', type: 'text', condition: (settings) => Boolean(settings.showReadMore) },
    { key: 'pagination', label: 'Pagination', type: 'select', options: opts(['none', 'None'], ['numbers', 'Numbers'], ['prev-next', 'Previous / Next'], ['load-more', 'Load more button']) },
    { key: 'emptyText', label: 'Nothing found message', type: 'text', placeholder: 'No posts found.' },
    { key: 'columnGap', label: 'Column gap (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 80 },
    { key: 'rowGap', label: 'Row gap (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 80 },
    colorControl('cardBg', 'Card background'),
    { key: 'cardBorder', label: 'Card border', type: 'border', tab: 'style' },
    { key: 'cardShadow', label: 'Card shadow', type: 'shadow', tab: 'style' },
    { key: 'cardPadding', label: 'Card content padding (px)', type: 'slider', tab: 'style', min: 0, max: 60 },
    alignControl(),
    colorControl('titleColor', 'Title colour'),
    typographyControl('titleTypography', 'Title typography'),
    colorControl('metaColor', 'Meta colour'),
    colorControl('excerptColor', 'Excerpt colour'),
    typographyControl('excerptTypography', 'Excerpt typography'),
    colorControl('linkColor', 'Read more colour'),
  ],
  css: (bag, node) => {
    const columns = Math.max(1, Math.min(4, Number(bag.columns) || 3));
    const layout = node.settings.layout;
    const cardBorder = bag.cardBorder as Border | undefined;
    return {
      ' .rwpb-posts-grid': {
        'grid-template-columns': layout === 'grid' ? `repeat(${columns}, minmax(0, 1fr))` : undefined,
        'column-gap': length(bag.columnGap ?? 24, 'px'),
        'row-gap': length(bag.rowGap ?? 24, 'px'),
      },
      ' .rwpb-posts-masonry': { columns, 'column-gap': length(bag.columnGap ?? 24, 'px') },
      ' .rwpb-posts-masonry .rwpb-post': { 'margin-bottom': length(bag.rowGap ?? 24, 'px') },
      ' .rwpb-posts-list': { gap: length(bag.rowGap ?? 24, 'px') },
      ' .rwpb-post': {
        'background-color': color(bag.cardBg),
        'box-shadow': shadow(bag.cardShadow as Shadow | undefined),
        'text-align': isSet(bag.align) ? String(bag.align) : undefined,
        ...border(cardBorder),
      },
      ' .rwpb-post-media': { ...radius(cardBorder?.radius as Box | undefined) },
      ' .rwpb-post-body': { padding: length(bag.cardPadding, 'px') },
      ' .rwpb-post-title': { color: color(bag.titleColor), ...typography(bag.titleTypography as Typography | undefined) },
      ' .rwpb-post-meta': { color: color(bag.metaColor) },
      ' .rwpb-post-excerpt': { color: color(bag.excerptColor), ...typography(bag.excerptTypography as Typography | undefined) },
      ' .rwpb-post-more': { color: color(bag.linkColor) },
    };
  },
  View: function PostsView({ node }) {
    const { mode, pageId } = useRenderContext();
    const settings = node.settings;
    const limit = Math.max(1, Math.min(48, Number(settings.limit) || 6));
    const [page, setPage] = useState(1);
    const [state, setState] = useState<{ posts: DynamicPost[]; total: number; loading: boolean; error: string }>({ posts: [], total: 0, loading: true, error: '' });
    const pagination = String(settings.pagination || 'none');
    // A Taxonomy Filter widget in the same group overrides the chosen category.
    const filterCategory = useTaxonomyFilter(settings.filterGroup);
    const queryKey = JSON.stringify([filterCategory ?? settings.categoryId, limit, settings.orderBy, settings.order, settings.excerptLength, settings.excludeCurrent, pageId, settings.search || '']);

    // A new query starts again from page one.
    useEffect(() => { setPage(1); }, [queryKey]);

    useEffect(() => {
      let active = true;
      const [categoryId, , orderBy, order, excerptLength, excludeCurrent, , search] = JSON.parse(queryKey) as [string, number, string, string, number, boolean, number, string];
      setState((current) => ({ ...current, loading: true, error: '' }));
      fetchPosts({
        categoryId: categoryId || undefined,
        limit,
        page,
        orderBy: (['created_at', 'updated_at', 'title'].includes(orderBy) ? orderBy : 'created_at') as 'created_at',
        order: order === 'asc' ? 'asc' : 'desc',
        excludeId: excludeCurrent ? pageId : null,
        search: typeof search === 'string' && search ? search : undefined,
      }, Number(excerptLength) || 20)
        .then((result) => {
          if (!active) return;
          setState((current) => ({
            // "Load more" appends; the other modes replace the page.
            posts: pagination === 'load-more' && page > 1 ? [...current.posts, ...result.posts] : result.posts,
            total: result.total, loading: false, error: '',
          }));
        })
        .catch((error: unknown) => active && setState({ posts: [], total: 0, loading: false, error: error instanceof Error ? error.message : 'Could not load posts.' }));
      return () => { active = false; };
    }, [queryKey, page, limit, pageId, pagination]);

    const layout = ['list', 'masonry'].includes(String(settings.layout)) ? String(settings.layout) : 'grid';
    const pages = Math.max(1, Math.ceil(state.total / limit));
    const readMore = useText(settings.readMoreText || 'Read more');
    const emptyText = useText(settings.emptyText || 'No posts found.');
    const TitleTag = (headingTags.some((option) => option.value === settings.titleTag) ? settings.titleTag : 'h3') as 'h3';

    if (state.error) return mode === 'edit' ? <div className="rwpb-placeholder">{state.error}</div> : null;
    if (!state.loading && state.posts.length === 0) return <p className="rwpb-posts-empty">{emptyText}</p>;

    const go = (next: number) => {
      setPage(next);
      if (pagination !== 'load-more' && mode === 'view') {
        document.querySelector(`.rwpb-n-${node.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    return (
      <div className="rwpb-posts" aria-busy={state.loading}>
        <div className={`rwpb-posts-${layout}`}>
          {state.posts.map((post) => {
            const imageUrl = safeMediaUrl(post.featured_image);
            const href = `/${post.slug}`;
            return (
              <article key={post.id} className="rwpb-post">
                {Boolean(settings.showImage) && imageUrl && (
                  <a className="rwpb-post-media" href={href} tabIndex={-1} aria-hidden="true"
                    style={layout !== 'masonry' && settings.imageRatio !== '' ? { aspectRatio: String(settings.imageRatio || '16/9') } : undefined}>
                    <img src={imageUrl} alt="" loading="lazy" />
                  </a>
                )}
                <div className="rwpb-post-body">
                  <TitleTag className="rwpb-post-title"><a href={href}>{post.title}</a></TitleTag>
                  {Boolean(settings.showMeta) && (
                    <p className="rwpb-post-meta">
                      <time dateTime={post.created_at}>{formatDate(post.created_at)}</time>
                      {post.category_name && <> · <span>{post.category_name}</span></>}
                      {Boolean(settings.showAuthor) && post.author_name && <> · <span>{post.author_name}</span></>}
                    </p>
                  )}
                  {Boolean(settings.showExcerpt) && post.excerpt && <p className="rwpb-post-excerpt">{post.excerpt}</p>}
                  {Boolean(settings.showReadMore) && <a className="rwpb-post-more" href={href}>{readMore} <Icon name="arrow-right" size="1em" /></a>}
                </div>
              </article>
            );
          })}
        </div>
        {pages > 1 && pagination === 'numbers' && (
          <nav className="rwpb-pagination" aria-label="Posts pages">
            {Array.from({ length: pages }, (_, index) => index + 1).map((number) => (
              <button key={number} type="button" aria-current={number === page ? 'page' : undefined} onClick={() => go(number)}>{number}</button>
            ))}
          </nav>
        )}
        {pages > 1 && pagination === 'prev-next' && (
          <nav className="rwpb-pagination" aria-label="Posts pages">
            <button type="button" disabled={page <= 1} onClick={() => go(page - 1)}>← Previous</button>
            <span>{page} / {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => go(page + 1)}>Next →</button>
          </nav>
        )}
        {pagination === 'load-more' && page < pages && (
          <div className="rwpb-pagination"><button type="button" disabled={state.loading} onClick={() => go(page + 1)}>{state.loading ? 'Loading…' : 'Load more'}</button></div>
        )}
      </div>
    );
  },
};

// Dynamic theme elements -----------------------------------------------------------------------

function useCurrentPost() {
  const { dynamic } = useRenderContext();
  return dynamic?.page || null;
}

export const postTitle: WidgetDefinition = {
  type: 'post-title',
  label: 'Post Title',
  icon: 'heading',
  category: 'dynamic',
  defaults: () => ({ settings: { tag: 'h1', link: false } }),
  controls: [
    { key: 'tag', label: 'HTML tag', type: 'select', options: headingTags },
    { key: 'link', label: 'Link to the post', type: 'toggle' },
    alignControl('align', 'Alignment', true),
    colorControl('color', 'Colour'),
    typographyControl(),
  ],
  css: (bag) => ({
    '': { 'text-align': isSet(bag.align) ? String(bag.align) : undefined },
    ' .rwpb-post-title': { color: color(bag.color), ...typography(bag.typography as Typography | undefined) },
  }),
  View: function PostTitleView({ node }) {
    const post = useCurrentPost();
    const Tag = (headingTags.some((option) => option.value === node.settings.tag) ? node.settings.tag : 'h1') as 'h1';
    if (!post) return <EditorPlaceholder>Post title</EditorPlaceholder>;
    return <Tag className="rwpb-post-title">{node.settings.link ? <a href={`/${post.slug}`}>{post.title}</a> : post.title}</Tag>;
  },
};

export const postExcerpt: WidgetDefinition = {
  type: 'post-excerpt',
  label: 'Post Excerpt',
  icon: 'file-text',
  category: 'dynamic',
  defaults: () => ({ settings: {} }),
  controls: [alignControl('align', 'Alignment', true), colorControl('color', 'Colour'), typographyControl()],
  css: (bag) => ({ ' .rwpb-post-excerpt': { color: color(bag.color), 'text-align': isSet(bag.align) ? String(bag.align) : undefined, ...typography(bag.typography as Typography | undefined) } }),
  View: function PostExcerptView() {
    const post = useCurrentPost();
    if (!post?.excerpt) return <EditorPlaceholder>This page has no excerpt yet.</EditorPlaceholder>;
    return <p className="rwpb-post-excerpt">{post.excerpt}</p>;
  },
};

export const postContent: WidgetDefinition = {
  type: 'post-content',
  label: 'Post Content',
  icon: 'file-text',
  category: 'dynamic',
  keywords: ['body', 'classic'],
  defaults: () => ({ settings: {} }),
  controls: [colorControl('color', 'Colour'), typographyControl()],
  css: (bag) => ({ ' .rwpb-post-content': { color: color(bag.color), ...typography(bag.typography as Typography | undefined) } }),
  View: function PostContentView() {
    const post = useCurrentPost();
    if (!post?.content) return <EditorPlaceholder>Shows this page&apos;s content from the classic editor. It is empty.</EditorPlaceholder>;
    return <ContentRenderer className="rwpb-post-content rwpb-text" html={post.content} />;
  },
};

export const featuredImage: WidgetDefinition = {
  type: 'featured-image',
  label: 'Featured Image',
  icon: 'image',
  category: 'dynamic',
  defaults: () => ({ settings: {} }),
  controls: [
    { key: 'aspectRatio', label: 'Aspect ratio', type: 'select', tab: 'style', responsive: true, options: opts(['', 'Original'], ['16/9', '16:9'], ['4/3', '4:3'], ['1/1', '1:1'], ['21/9', '21:9']) },
    { key: 'imageRadius', label: 'Corner radius', type: 'dimensions', tab: 'style', units: ['px', '%'] },
    alignControl(),
  ],
  css: (bag) => ({
    '': { 'text-align': isSet(bag.align) ? String(bag.align) : undefined },
    ' img': {
      'aspect-ratio': isSet(bag.aspectRatio) ? String(bag.aspectRatio) : undefined,
      'object-fit': isSet(bag.aspectRatio) ? 'cover' : undefined,
      width: isSet(bag.aspectRatio) ? '100%' : undefined,
      ...radius(bag.imageRadius as Box | undefined),
    },
  }),
  View: function FeaturedImageView() {
    const post = useCurrentPost();
    const src = safeMediaUrl(post?.featured_image);
    if (!src) return <EditorPlaceholder>No featured image. Set the social image (og:image) in this page&apos;s SEO panel.</EditorPlaceholder>;
    return <img className="rwpb-featured-image" src={src} alt={post?.title || ''} />;
  },
};

export const postMeta: WidgetDefinition = {
  type: 'post-meta',
  label: 'Post Meta',
  icon: 'calendar',
  category: 'dynamic',
  keywords: ['author', 'date', 'category'],
  defaults: () => ({ settings: { showAuthor: true, showDate: true, showCategory: true, separator: '·' } }),
  controls: [
    { key: 'showAuthor', label: 'Author', type: 'toggle' },
    { key: 'showDate', label: 'Date', type: 'toggle' },
    { key: 'showModified', label: 'Last modified', type: 'toggle' },
    { key: 'showCategory', label: 'Category', type: 'toggle' },
    { key: 'separator', label: 'Separator', type: 'text' },
    alignControl(),
    colorControl('color', 'Colour'),
    typographyControl(),
  ],
  css: (bag) => ({
    ' .rwpb-post-meta': { color: color(bag.color), 'justify-content': bag.align === 'center' ? 'center' : bag.align === 'right' ? 'flex-end' : undefined, ...typography(bag.typography as Typography | undefined) },
  }),
  View: function PostMetaView({ node }) {
    const post = useCurrentPost();
    if (!post) return <EditorPlaceholder>Post meta</EditorPlaceholder>;
    const parts = [
      node.settings.showAuthor && post.author_name ? <span key="a"><Icon name="user" size="1em" /> {post.author_name}</span> : null,
      node.settings.showDate ? <span key="d"><Icon name="calendar" size="1em" /> <time dateTime={post.created_at}>{formatDate(post.created_at)}</time></span> : null,
      node.settings.showModified ? <span key="m"><Icon name="clock" size="1em" /> Updated {formatDate(post.updated_at)}</span> : null,
      node.settings.showCategory && post.category_name ? <span key="c"><Icon name="tag" size="1em" /> {post.category_name}</span> : null,
    ].filter(Boolean);
    const separator = String(node.settings.separator ?? '·');
    return (
      <p className="rwpb-post-meta">
        {parts.flatMap((part, index) => (index ? [<span key={`s${index}`} className="rwpb-post-meta-sep" aria-hidden="true">{separator}</span>, part] : [part]))}
      </p>
    );
  },
};
