/** Query and template widgets: Template, Loop Grid/Carousel, Posts Slider, Portfolio, Taxonomy Filter, Mega Menu. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { alignControl, colorControl, linkControl, opts, typographyControl } from '../../lib/controls';
import type { DynamicPost } from '../../lib/dynamic';
import { Icon } from '../../lib/icons';
import type { Control, WidgetDefinition } from '../../lib/registry';
import { safeMediaUrl } from '../../lib/sanitize';
import { alignToFlex, color, length, typography, type Typography } from '../../lib/style';
import { useRenderContext } from '../context';
import { fetchCategoryCounts, fetchPosts, templateOptions } from '../data';
import { posts } from './posts';
import { EditorPlaceholder, useText } from './shared';
import {
  Carousel, carouselControls, carouselCss, carouselOptions, clamp, cssVars, emitTaxonomyFilter, errorText, filterGroupControl,
  itemId, linkAttributes, listOf, num, Pagination, pick, PostCard, postCardControls, postQueryControls, postQueryFrom, PostScope,
  prefersReducedMotion, scrollToWidget, str, TemplateContent, useAsync, usePostsPage, useTaxonomyFilter, WidgetError,
} from './kit';

/** Card styling reuses the Posts widget's style controls and CSS, so cards look the same everywhere. */
const cardStyleKeys = ['cardBg', 'cardBorder', 'cardShadow', 'cardPadding', 'align', 'titleColor', 'titleTypography', 'metaColor', 'excerptColor', 'excerptTypography', 'linkColor'];
const cardStyleControls: Control[] = posts.controls.filter((control) => cardStyleKeys.includes(control.key));
const cardCss: NonNullable<typeof posts.css> = (bag, node, device) => {
  const rules = posts.css!(bag, { ...node, settings: { ...node.settings, layout: 'none' } }, device);
  delete rules[' .rwpb-posts-grid'];
  delete rules[' .rwpb-posts-masonry'];
  delete rules[' .rwpb-posts-masonry .rwpb-post'];
  delete rules[' .rwpb-posts-list'];
  return rules;
};

const templateControl = (help?: string): Control => ({
  key: 'templateId', label: 'Template', type: 'asyncSelect', loadOptions: templateOptions, placeholder: '— Choose a saved template —',
  help: help || 'Save a section as a template (section toolbar → Save as template), then pick it here.',
});

const cardDefaults = { showImage: true, imageRatio: '16/9', titleTag: 'h3', showMeta: true, showExcerpt: true, excerptLength: 18, showReadMore: true, readMoreText: 'Read more' };

// Template ------------------------------------------------------------------------------------------------------------

export const template: WidgetDefinition = {
  type: 'template',
  label: 'Template',
  icon: 'template',
  category: 'pro',
  keywords: ['saved section', 'global', 'reusable', 'block'],
  defaults: () => ({ settings: { templateId: '' } }),
  controls: [
    templateControl('Shows a saved template. Edit the template once and every page using it updates.'),
  ],
  View: function TemplateView({ node }) {
    return <TemplateContent templateId={str(node.settings.templateId)} />;
  },
};

// Loop Grid ---------------------------------------------------------------------------------------------------------------

function LoopItem({ post, templateId, css, settings }: { post: DynamicPost; templateId: string; css: boolean; settings: Record<string, unknown> }) {
  return (
    <PostScope post={post}>
      {templateId ? <TemplateContent templateId={templateId} css={css} /> : <PostCard post={post} settings={settings} />}
    </PostScope>
  );
}

export const loopGrid: WidgetDefinition = {
  type: 'loop-grid',
  label: 'Loop Grid',
  icon: 'layout-list',
  category: 'pro',
  keywords: ['posts', 'query', 'template', 'archive', 'cards'],
  defaults: () => ({ settings: { templateId: '', limit: 6, orderBy: 'created_at', order: 'desc', pagination: 'numbers', ...cardDefaults }, style: { columns: 3, columnGap: 24, rowGap: 24 } }),
  controls: [
    templateControl('Each post is rendered with this template; use Post Title, Featured Image, Post Excerpt and {{post.*}} tags in it. Without a template, a standard post card is used.'),
    { key: 'limit', label: 'Posts per page', type: 'number', min: 1, max: 60 },
    { key: 'columns', label: 'Columns', type: 'slider', store: 'style', responsive: true, min: 1, max: 6 },
    { key: 'pagination', label: 'Pagination', type: 'select', options: opts(['none', 'None'], ['numbers', 'Numbers'], ['prev-next', 'Previous / Next'], ['load-more', 'Load more button']) },
    { key: 'emptyText', label: 'Nothing found message', type: 'text', placeholder: 'No posts found.' },
    ...postQueryControls(),
    ...postCardControls().map((control) => ({ ...control, condition: (settings: Record<string, unknown>, style: Record<string, unknown>) => !settings.templateId && (!control.condition || control.condition(settings, style)) })),
    { key: 'columnGap', label: 'Column gap (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 80 },
    { key: 'rowGap', label: 'Row gap (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 80 },
    ...cardStyleControls,
  ],
  css: (bag, node, device) => ({
    ...cardCss(bag, node, device),
    ' .rwpb-loop-grid': {
      'grid-template-columns': `repeat(${clamp(Math.round(num(bag.columns, 3)), 1, 6)}, minmax(0, 1fr))`,
      'column-gap': length(bag.columnGap ?? 24, 'px'), 'row-gap': length(bag.rowGap ?? 24, 'px'),
    },
  }),
  View: function LoopGridView({ node }) {
    const { mode, pageId } = useRenderContext();
    const settings = node.settings;
    const limit = clamp(Math.round(num(settings.limit, 6)), 1, 60);
    const filter = useTaxonomyFilter(settings.filterGroup);
    const pagination = str(settings.pagination, 'numbers');
    const [page, setPage] = useState(1);
    const [items, setItems] = useState<DynamicPost[]>([]);
    const query = postQueryFrom(settings, pageId, filter, limit, page);
    const queryKey = JSON.stringify({ ...query, page: 0 });
    useEffect(() => { setPage(1); }, [queryKey]);
    const state = usePostsPage(query, num(settings.excerptLength, 18));
    // "Load more" keeps earlier pages; the other modes show one page at a time.
    useEffect(() => {
      if (state.loading) return;
      setItems((current) => (pagination === 'load-more' && page > 1 ? [...current.filter((item) => !state.posts.some((post) => post.id === item.id)), ...state.posts] : state.posts));
    }, [state.posts, state.loading, pagination, page]);
    const emptyText = useText(settings.emptyText || 'No posts found.');
    const templateId = str(settings.templateId);
    if (state.error) return <WidgetError message={state.error} />;
    if (!state.loading && !items.length) return <p className="rwpb-posts-empty">{emptyText}</p>;
    const pages = Math.max(1, Math.ceil(state.total / limit));
    return (
      <div className="rwpb-loop" aria-busy={state.loading}>
        {mode === 'edit' && !templateId && <p className="rwpb-loop-hint">Showing standard post cards. Choose a template to design each item yourself.</p>}
        <div className="rwpb-loop-grid">
          {items.map((post, index) => <div key={post.id} className="rwpb-loop-item"><LoopItem post={post} templateId={templateId} css={index === 0} settings={settings} /></div>)}
        </div>
        <Pagination page={page} pages={pages} mode={pagination} loading={state.loading} label="Posts pages"
          onPage={(next) => { setPage(next); if (pagination !== 'load-more' && mode === 'view') scrollToWidget(node.id); }} />
      </div>
    );
  },
};

// Loop Carousel ----------------------------------------------------------------------------------------------------------------

export const loopCarousel: WidgetDefinition = {
  type: 'loop-carousel',
  label: 'Loop Carousel',
  icon: 'gallery-thumbnails',
  category: 'pro',
  keywords: ['posts', 'slider', 'template', 'carousel', 'query'],
  defaults: () => ({ settings: { templateId: '', limit: 9, orderBy: 'created_at', order: 'desc', arrows: true, dots: true, scrollBy: 'one', ...cardDefaults }, style: { perView: 3, gap: 24 } }),
  controls: [
    templateControl('Each post is rendered with this template. Without one, a standard post card is used.'),
    { key: 'limit', label: 'Number of posts', type: 'number', min: 1, max: 30 },
    ...postQueryControls(),
    ...carouselControls(),
    ...postCardControls().map((control) => ({ ...control, condition: (settings: Record<string, unknown>, style: Record<string, unknown>) => !settings.templateId && (!control.condition || control.condition(settings, style)) })),
    ...cardStyleControls,
  ],
  css: (bag, node, device) => ({ ...cardCss(bag, node, device), ...carouselCss(bag, 3) }),
  View: function LoopCarouselView({ node }) {
    const { pageId } = useRenderContext();
    const settings = node.settings;
    const filter = useTaxonomyFilter(settings.filterGroup);
    const state = usePostsPage(postQueryFrom(settings, pageId, filter, clamp(Math.round(num(settings.limit, 9)), 1, 30), 1), num(settings.excerptLength, 18));
    const templateId = str(settings.templateId);
    if (state.error) return <WidgetError message={state.error} />;
    if (!state.posts.length) return state.loading ? <div className="rwpb-loop-loading" aria-busy="true" /> : <EditorPlaceholder>No posts match this query.</EditorPlaceholder>;
    const slides = state.posts.map((post, index) => <LoopItem key={post.id} post={post} templateId={templateId} css={index === 0} settings={settings} />);
    return <Carousel key={`${templateId}-${state.posts.length}`} slides={slides} options={carouselOptions(settings)} label="Posts" />;
  },
};

// Posts Slider ---------------------------------------------------------------------------------------------------------------------

interface SliderData { key: string; total: number | null; pages: Record<number, DynamicPost[]>; error: string }

export const postsSlider: WidgetDefinition = {
  type: 'posts-slider',
  label: 'Posts Slider',
  icon: 'slides',
  category: 'pro',
  keywords: ['posts carousel', 'blog slider', 'grid slider', 'pagination', 'older posts', 'newer posts'],
  defaults: () => ({
    settings: {
      rows: 1, maxPosts: 0, orderBy: 'created_at', order: 'desc', transition: 'slide', arrows: true, arrowsPosition: 'sides', navText: false,
      pagination: 'dots', loop: false, autoplay: false, interval: 6000, ...cardDefaults,
    },
    style: { columns: 3, columnGap: 24, rowGap: 24 },
  }),
  controls: [
    { key: '_layout', label: 'Grid on each slide', type: 'heading' },
    { key: 'columns', label: 'Columns', type: 'slider', store: 'style', responsive: true, min: 1, max: 6, help: 'Set a different number on tablet and mobile with the device switcher.' },
    { key: 'rows', label: 'Rows', type: 'slider', min: 1, max: 6, help: 'Posts per slide = columns × rows, on each device.' },
    { key: 'maxPosts', label: 'Maximum posts in total (0 = all)', type: 'number', min: 0, max: 500 },
    ...postQueryControls(),
    { key: '_navigation', label: 'Navigation', type: 'heading' },
    { key: 'transition', label: 'Transition', type: 'select', options: opts(['slide', 'Slide'], ['fade', 'Fade']) },
    { key: 'arrows', label: 'Arrows', type: 'toggle' },
    { key: 'arrowsPosition', label: 'Arrows position', type: 'select', options: opts(['sides', 'On the sides'], ['below', 'Below the grid'], ['above', 'Above the grid']), condition: (settings) => settings.arrows !== false },
    { key: 'navText', label: 'Show "Newer / Older" text on arrows', type: 'toggle', condition: (settings) => settings.arrows !== false },
    { key: 'pagination', label: 'Pagination', type: 'select', options: opts(['dots', 'Dots'], ['numbers', 'Page numbers'], ['fraction', 'Page 2 of 7'], ['none', 'None']) },
    { key: 'loop', label: 'Loop from the last slide to the first', type: 'toggle' },
    { key: 'autoplay', label: 'Autoplay', type: 'toggle' },
    { key: 'interval', label: 'Autoplay interval (ms)', type: 'slider', min: 2000, max: 20000, step: 500, condition: (settings) => Boolean(settings.autoplay) },
    ...postCardControls(),
    { key: 'columnGap', label: 'Column gap (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 80 },
    { key: 'rowGap', label: 'Row gap (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 80 },
    colorControl('navColor', 'Arrows and pagination colour'),
    colorControl('navBg', 'Arrow background'),
    ...cardStyleControls,
  ],
  css: (bag, node, device) => ({
    ...cardCss(bag, node, device),
    ' .rwpb-pslider': {
      '--rwpb-columns': clamp(Math.round(num(bag.columns, 3)), 1, 6),
      '--rwpb-column-gap': length(bag.columnGap ?? 24, 'px') || '0px',
      '--rwpb-row-gap': length(bag.rowGap ?? 24, 'px') || '0px',
      '--rwpb-nav-color': color(bag.navColor),
      '--rwpb-nav-bg': color(bag.navBg),
    },
  }),
  View: function PostsSliderView({ node }) {
    const { mode, pageId } = useRenderContext();
    const settings = node.settings;
    const rootRef = useRef<HTMLDivElement>(null);
    const [columns, setColumns] = useState(() => clamp(Math.round(num(node.style?.desktop?.columns, 3)), 1, 6));
    const rows = clamp(Math.round(num(settings.rows, 1)), 1, 6);
    const perSlide = columns * rows;
    const filter = useTaxonomyFilter(settings.filterGroup);
    const excerptLength = num(settings.excerptLength, 18);
    const query = postQueryFrom(settings, pageId, filter, perSlide, 1);
    const baseKey = JSON.stringify([query, excerptLength]);
    const [page, setPage] = useState(1);
    const [data, setData] = useState<SliderData>({ key: baseKey, total: null, pages: {}, error: '' });
    const [paused, setPaused] = useState(false);
    const inflight = useRef(new Set<string>());
    const drag = useRef<{ x: number; id: number } | null>(null);

    // Columns are responsive CSS, so the number per slide is read back from the rendered grid.
    useLayoutEffect(() => {
      const element = rootRef.current;
      if (!element) return undefined;
      const measure = () => {
        const value = Math.round(parseFloat(getComputedStyle(element).getPropertyValue('--rwpb-columns')));
        if (Number.isFinite(value) && value >= 1) setColumns(value);
      };
      measure();
      if (!('ResizeObserver' in window)) return undefined;
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    });

    useEffect(() => {
      setPage(1);
      setData({ key: baseKey, total: null, pages: {}, error: '' });
      inflight.current.clear();
    }, [baseKey]);

    const cap = Math.max(0, Math.round(num(settings.maxPosts, 0)));
    const total = data.key === baseKey && data.total !== null ? (cap ? Math.min(cap, data.total) : data.total) : null;
    const pageCount = total === null ? 1 : Math.max(1, Math.ceil(total / perSlide));

    const load = useCallback((target: number) => {
      const requestKey = `${baseKey}:${target}`;
      if (inflight.current.has(requestKey)) return;
      inflight.current.add(requestKey);
      const parsed = JSON.parse(baseKey) as [typeof query, number];
      fetchPosts({ ...parsed[0], page: target }, parsed[1])
        .then((result) => setData((current) => (current.key !== baseKey ? current : { ...current, total: result.total, pages: { ...current.pages, [target]: result.posts } })))
        .catch((error: unknown) => {
          inflight.current.delete(requestKey);
          setData((current) => (current.key !== baseKey ? current : { ...current, error: errorText(error, 'Could not load posts.') }));
        });
    }, [baseKey]);

    // Load the visible slide and its neighbours, so sliding either way shows posts immediately.
    useEffect(() => {
      [page, page + 1, page - 1].forEach((target) => {
        if (target >= 1 && (target === 1 || target <= pageCount) && !data.pages[target]) load(target);
      });
    }, [page, pageCount, data.pages, load]);

    useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

    const go = useCallback((target: number) => {
      if (target < 1) setPage(settings.loop ? pageCount : 1);
      else if (target > pageCount) setPage(settings.loop ? 1 : pageCount);
      else setPage(target);
    }, [pageCount, settings.loop]);

    useEffect(() => {
      if (mode === 'edit' || !settings.autoplay || paused || pageCount < 2 || prefersReducedMotion()) return undefined;
      const timer = window.setInterval(() => setPage((current) => (current >= pageCount ? 1 : current + 1)), Math.max(2000, num(settings.interval, 6000)));
      return () => window.clearInterval(timer);
    }, [mode, settings.autoplay, settings.interval, paused, pageCount]);

    if (data.error) return <WidgetError message={data.error} />;
    if (total === 0) return <EditorPlaceholder>No posts match this query.</EditorPlaceholder>;

    const postsOn = (target: number) => {
      const loaded = data.pages[target];
      if (!loaded) return null;
      return cap ? loaded.slice(0, Math.max(0, cap - (target - 1) * perSlide)) : loaded;
    };
    const newestFirst = settings.order !== 'asc' && str(settings.orderBy, 'created_at') !== 'title';
    const prevLabel = newestFirst ? 'Newer posts' : 'Previous posts';
    const nextLabel = newestFirst ? 'Older posts' : 'Next posts';
    const canPrev = settings.loop ? pageCount > 1 : page > 1;
    const canNext = settings.loop ? pageCount > 1 : page < pageCount;
    const arrowsOn = settings.arrows !== false && pageCount > 1;
    const arrowsPosition = pick(settings.arrowsPosition, ['sides', 'below', 'above'] as const, 'sides');
    const arrow = (direction: 'prev' | 'next') => (
      <button type="button" className={`rwpb-pslider-arrow rwpb-pslider-${direction}`} disabled={direction === 'prev' ? !canPrev : !canNext}
        aria-label={direction === 'prev' ? prevLabel : nextLabel} onClick={() => go(page + (direction === 'prev' ? -1 : 1))}>
        {direction === 'prev' && <Icon name="chevron-left" size={20} />}
        {Boolean(settings.navText) && <span>{direction === 'prev' ? prevLabel : nextLabel}</span>}
        {direction === 'next' && <Icon name="chevron-right" size={20} />}
      </button>
    );
    const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => { drag.current = { x: event.clientX, id: event.pointerId }; };
    const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = drag.current;
      drag.current = null;
      if (start && start.id === event.pointerId && Math.abs(event.clientX - start.x) > 50) go(page + (event.clientX < start.x ? 1 : -1));
    };
    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowRight') { event.preventDefault(); go(page + 1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(page - 1); }
    };
    const pagination = pick(settings.pagination, ['dots', 'numbers', 'fraction', 'none'] as const, 'dots');
    const fade = settings.transition === 'fade';

    return (
      <div ref={rootRef} className={`rwpb-pslider rwpb-pslider-${fade ? 'fade' : 'slide'} rwpb-pslider-arrows-${arrowsPosition}`}
        role="region" aria-roledescription="carousel" aria-label="Posts" onKeyDown={onKeyDown}
        onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
        {arrowsOn && arrowsPosition === 'above' && <div className="rwpb-pslider-nav">{arrow('prev')}{arrow('next')}</div>}
        <div className="rwpb-pslider-stage">
          {arrowsOn && arrowsPosition === 'sides' && arrow('prev')}
          <div className="rwpb-pslider-viewport" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; }}>
            <div className="rwpb-pslider-track" style={fade ? undefined : cssVars({ transform: `translateX(-${(page - 1) * 100}%)` })}>
              {Array.from({ length: pageCount }, (_, index) => {
                const number = index + 1;
                const active = number === page;
                const near = Math.abs(number - page) <= 1;
                const items = near ? postsOn(number) : null;
                return (
                  <div key={number} className={`rwpb-pslider-page${active ? ' is-active' : ''}`} role="group" aria-roledescription="slide"
                    aria-label={`${number} of ${pageCount}`} aria-hidden={!active} inert={!active}>
                    {items
                      ? items.map((post) => <PostCard key={post.id} post={post} settings={settings} />)
                      : near && Array.from({ length: perSlide }, (_, skeleton) => <div key={skeleton} className="rwpb-post rwpb-post-skeleton" aria-hidden="true" />)}
                  </div>
                );
              })}
            </div>
          </div>
          {arrowsOn && arrowsPosition === 'sides' && arrow('next')}
        </div>
        {(pagination !== 'none' || (arrowsOn && arrowsPosition === 'below')) && pageCount > 1 && (
          <div className="rwpb-pslider-footer">
            {arrowsOn && arrowsPosition === 'below' && arrow('prev')}
            {pagination === 'dots' && (
              pageCount <= 15
                ? <div className="rwpb-carousel-dots rwpb-pslider-dots">{Array.from({ length: pageCount }, (_, index) => <button key={index} type="button" aria-label={`Go to slide ${index + 1}`} aria-current={index + 1 === page} onClick={() => go(index + 1)} />)}</div>
                : <span className="rwpb-pslider-fraction">{page} / {pageCount}</span>
            )}
            {pagination === 'numbers' && <Pagination page={page} pages={pageCount} onPage={go} label="Post slides" />}
            {pagination === 'fraction' && <span className="rwpb-pslider-fraction" aria-live="polite">Page {page} of {pageCount}</span>}
            {arrowsOn && arrowsPosition === 'below' && arrow('next')}
          </div>
        )}
      </div>
    );
  },
};

// Portfolio ---------------------------------------------------------------------------------------------------------------------

export const portfolio: WidgetDefinition = {
  type: 'portfolio',
  label: 'Portfolio',
  icon: 'grid',
  category: 'pro',
  keywords: ['projects', 'work', 'filterable', 'posts grid'],
  defaults: () => ({ settings: { limit: 12, orderBy: 'created_at', order: 'desc', filterBar: true, allLabel: 'All', itemRatio: '4/3', showTitle: true, showCategory: true }, style: { columns: 3, gap: 12 } }),
  controls: [
    { key: 'limit', label: 'Number of posts', type: 'number', min: 1, max: 60 },
    { key: 'columns', label: 'Columns', type: 'slider', store: 'style', responsive: true, min: 1, max: 6 },
    { key: 'itemRatio', label: 'Item ratio', type: 'select', options: opts(['1/1', '1:1'], ['4/3', '4:3'], ['3/2', '3:2'], ['16/9', '16:9'], ['3/4', '3:4']) },
    { key: 'filterBar', label: 'Category filter bar', type: 'toggle' },
    { key: 'allLabel', label: '"All" label', type: 'text', condition: (settings) => Boolean(settings.filterBar) },
    { key: 'showTitle', label: 'Title on hover', type: 'toggle' },
    { key: 'showCategory', label: 'Category on hover', type: 'toggle' },
    ...postQueryControls().filter((control) => control.key !== 'filterGroup'),
    { key: 'gap', label: 'Gap (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 60 },
    colorControl('overlayBg', 'Overlay colour'),
    colorControl('overlayText', 'Overlay text colour'),
    typographyControl('titleTypography', 'Title typography'),
    colorControl('filterColor', 'Filter colour'),
    colorControl('filterActive', 'Active filter colour'),
  ],
  css: (bag) => ({
    ' .rwpb-portfolio-grid': { 'grid-template-columns': `repeat(${clamp(Math.round(num(bag.columns, 3)), 1, 6)}, minmax(0, 1fr))`, gap: length(bag.gap ?? 12, 'px') },
    ' .rwpb-portfolio-overlay': { 'background-color': color(bag.overlayBg), color: color(bag.overlayText) },
    ' .rwpb-portfolio-title': typography(bag.titleTypography as Typography | undefined),
    ' .rwpb-filter-bar button': { color: color(bag.filterColor) },
    ' .rwpb-filter-bar button[aria-pressed=true]': { color: color(bag.filterActive), 'border-color': color(bag.filterActive) },
  }),
  View: function PortfolioView({ node }) {
    const { pageId } = useRenderContext();
    const settings = node.settings;
    const state = usePostsPage(postQueryFrom(settings, pageId, null, clamp(Math.round(num(settings.limit, 12)), 1, 60), 1), 10);
    const [filter, setFilter] = useState('');
    const categories = useMemo(() => [...new Set(state.posts.map((post) => post.category_name).filter(Boolean))], [state.posts]);
    if (state.error) return <WidgetError message={state.error} />;
    if (!state.posts.length) return state.loading ? null : <EditorPlaceholder>No posts match this query.</EditorPlaceholder>;
    const shown = state.posts.filter((post) => !filter || post.category_name === filter);
    return (
      <div className="rwpb-portfolio">
        {Boolean(settings.filterBar) && categories.length > 1 && (
          <div className="rwpb-filter-bar" role="group" aria-label="Filter by category">
            <button type="button" aria-pressed={!filter} onClick={() => setFilter('')}>{str(settings.allLabel, 'All')}</button>
            {categories.map((name) => <button key={name} type="button" aria-pressed={filter === name} onClick={() => setFilter(name)}>{name}</button>)}
          </div>
        )}
        <div className="rwpb-portfolio-grid" aria-live="polite">
          {shown.map((post) => {
            const image = safeMediaUrl(post.featured_image);
            return (
              <a key={post.id} className="rwpb-portfolio-item" href={`/${post.slug}`} style={{ aspectRatio: str(settings.itemRatio, '4/3') }}>
                {image ? <img src={image} alt="" loading="lazy" /> : <span className="rwpb-portfolio-noimage" aria-hidden="true"><Icon name="image" size={28} /></span>}
                <span className={`rwpb-portfolio-overlay${settings.showTitle || settings.showCategory ? '' : ' rwpb-sr-only'}`}>
                  {settings.showTitle !== false ? <span className="rwpb-portfolio-title">{post.title}</span> : <span className="rwpb-sr-only">{post.title}</span>}
                  {Boolean(settings.showCategory) && post.category_name && <span className="rwpb-portfolio-category">{post.category_name}</span>}
                </span>
              </a>
            );
          })}
        </div>
      </div>
    );
  },
};

// Taxonomy Filter -----------------------------------------------------------------------------------------------------------------

export const taxonomyFilter: WidgetDefinition = {
  type: 'taxonomy-filter',
  label: 'Taxonomy Filter',
  icon: 'filter',
  category: 'pro',
  keywords: ['category filter', 'filter posts', 'tabs'],
  defaults: () => ({ settings: { filterGroup: 'posts', showAll: true, allLabel: 'All', showCounts: false, hideEmpty: true, layout: 'horizontal', readUrl: true }, style: { align: 'left' } }),
  controls: [
    { ...filterGroupControl(), help: 'Posts, Loop Grid, Loop Carousel, Posts Slider and Archive Posts widgets with the same group name are filtered by this widget.' },
    { key: 'showAll', label: 'Show "All"', type: 'toggle' },
    { key: 'allLabel', label: '"All" label', type: 'text', condition: (settings) => settings.showAll !== false },
    { key: 'showCounts', label: 'Post counts', type: 'toggle' },
    { key: 'hideEmpty', label: 'Hide empty categories', type: 'toggle' },
    { key: 'layout', label: 'Layout', type: 'select', options: opts(['horizontal', 'Horizontal'], ['vertical', 'Vertical']) },
    { key: 'readUrl', label: 'Start from ?category= in the URL', type: 'toggle' },
    alignControl(),
    colorControl('itemColor', 'Text colour'),
    colorControl('itemBg', 'Background'),
    colorControl('activeColor', 'Active text colour'),
    colorControl('activeBg', 'Active background'),
    typographyControl(),
  ],
  css: (bag) => ({
    ' .rwpb-filter-bar': { 'justify-content': alignToFlex(bag.align) },
    ' .rwpb-filter-bar button': { color: color(bag.itemColor), 'background-color': color(bag.itemBg), ...typography(bag.typography as Typography | undefined) },
    ' .rwpb-filter-bar button[aria-pressed=true]': { color: color(bag.activeColor), 'background-color': color(bag.activeBg), 'border-color': color(bag.activeBg) },
  }),
  View: function TaxonomyFilterView({ node }) {
    const { mode } = useRenderContext();
    const settings = node.settings;
    const group = str(settings.filterGroup).trim();
    const state = useAsync('categories', fetchCategoryCounts);
    const current = useTaxonomyFilter(group);
    const categories = (state.data || []).filter((category) => !settings.hideEmpty || category.count > 0);

    useEffect(() => {
      if (mode !== 'view' || !settings.readUrl || !group || !state.data) return;
      const slug = new URLSearchParams(window.location.search).get('category');
      const match = slug && state.data.find((category) => category.slug === slug);
      if (match) emitTaxonomyFilter(group, match.id);
    }, [mode, settings.readUrl, group, state.data]);

    if (!group) return <EditorPlaceholder>Enter a filter group name, and the same name on the post widgets it should filter.</EditorPlaceholder>;
    if (state.error) return <WidgetError message={state.error} />;
    if (!state.data) return null;
    const total = categories.reduce((sum, category) => sum + category.count, 0);
    return (
      <div className={`rwpb-filter-bar rwpb-filter-${settings.layout === 'vertical' ? 'vertical' : 'horizontal'}`} role="group" aria-label="Filter posts by category">
        {settings.showAll !== false && (
          <button type="button" aria-pressed={!current} onClick={() => emitTaxonomyFilter(group, '')}>
            {str(settings.allLabel, 'All')}{settings.showCounts ? <span className="rwpb-filter-count"> ({total})</span> : null}
          </button>
        )}
        {categories.map((category) => (
          <button key={category.id} type="button" aria-pressed={current === category.id} onClick={() => emitTaxonomyFilter(group, category.id)}>
            {category.name}{settings.showCounts ? <span className="rwpb-filter-count"> ({category.count})</span> : null}
          </button>
        ))}
      </div>
    );
  },
};

// Mega Menu ------------------------------------------------------------------------------------------------------------------------

interface MegaItem { id: string; label: string; link?: unknown; icon?: string; templateId?: string; width?: string }

export const megaMenu: WidgetDefinition = {
  type: 'mega-menu',
  label: 'Menu (Mega Menu)',
  icon: 'square-menu',
  category: 'pro',
  keywords: ['mega menu', 'navigation', 'dropdown', 'header'],
  defaults: () => ({
    settings: {
      items: [
        { id: itemId(), label: 'Home', link: { url: '/' } },
        { id: itemId(), label: 'Products', templateId: '', width: 'widget' },
        { id: itemId(), label: 'Contact', link: { url: '#contact' } },
      ],
      openOn: 'hover', hamburgerOn: 'mobile',
    },
  }),
  controls: [
    { key: 'items', label: 'Menu items', type: 'repeater', itemLabel: 'label', newItem: () => ({ id: itemId(), label: 'Item' }), fields: [
      { key: 'label', label: 'Title', type: 'text' },
      linkControl(),
      { key: 'icon', label: 'Icon', type: 'icon' },
      { key: 'templateId', label: 'Dropdown content (template)', type: 'asyncSelect', loadOptions: templateOptions, placeholder: '— No dropdown —', help: 'Build the dropdown as a section, save it as a template and pick it here.' },
      { key: 'width', label: 'Dropdown width', type: 'select', options: opts(['widget', 'Full width of this widget'], ['content', 'Fit the content'], ['screen', 'Full width of the screen']) },
    ] },
    { key: 'openOn', label: 'Open dropdowns on', type: 'select', options: opts(['hover', 'Hover'], ['click', 'Click']) },
    { key: 'hamburgerOn', label: 'Hamburger menu on', type: 'select', options: opts(['mobile', 'Mobile'], ['tablet', 'Tablet and mobile'], ['none', 'Never']) },
    alignControl(),
    { key: 'itemGap', label: 'Space between items (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 80 },
    colorControl('linkColor', 'Item colour'),
    colorControl('linkHover', 'Item hover / open colour'),
    typographyControl(),
    colorControl('dropdownBg', 'Dropdown background'),
    { key: 'dropdownPadding', label: 'Dropdown padding (px)', type: 'slider', tab: 'style', min: 0, max: 80 },
    colorControl('toggleColor', 'Hamburger colour'),
  ],
  css: (bag, node, device) => {
    const hamburgerOn = str(node.settings.hamburgerOn, 'mobile');
    const collapsed = (device === 'mobile' && hamburgerOn !== 'none') || (device === 'tablet' && hamburgerOn === 'tablet');
    return {
      ' .rwpb-mega-list': {
        gap: collapsed ? '0' : length(bag.itemGap ?? 28, 'px'),
        'justify-content': alignToFlex(bag.align),
        display: collapsed ? 'none' : 'flex',
        'flex-direction': collapsed ? 'column' : undefined,
        'align-items': collapsed ? 'stretch' : undefined,
      },
      ' .rwpb-mega.is-open .rwpb-mega-list': { display: 'flex' },
      ' .rwpb-mega-toggle': { display: collapsed ? 'inline-flex' : 'none', color: color(bag.toggleColor) },
      ' .rwpb-mega-bar': { 'justify-content': collapsed ? 'flex-end' : alignToFlex(bag.align) },
      ' .rwpb-mega-link': { color: color(bag.linkColor), ...typography(bag.typography as Typography | undefined) },
      ' .rwpb-mega-link:hover| .rwpb-mega-item.is-open > .rwpb-mega-row .rwpb-mega-link': { color: color(bag.linkHover) },
      ' .rwpb-mega-dropdown': {
        'background-color': color(bag.dropdownBg), padding: length(bag.dropdownPadding, 'px'),
        position: collapsed ? 'static' : undefined, width: collapsed ? 'auto' : undefined, 'box-shadow': collapsed ? 'none' : undefined, transform: collapsed ? 'none' : undefined,
      },
    };
  },
  View: function MegaMenuView({ node }) {
    const { mode, dynamic } = useRenderContext();
    const items = listOf<MegaItem>(node.settings.items);
    const [open, setOpen] = useState<string | null>(null);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [visited, setVisited] = useState<string[]>([]);
    const rootRef = useRef<HTMLElement>(null);
    const clickMode = node.settings.openOn === 'click';

    const openItem = useCallback((id: string | null) => {
      setOpen(id);
      if (id) setVisited((current) => (current.includes(id) ? current : [...current, id]));
    }, []);

    useEffect(() => {
      if (!open && !mobileOpen) return undefined;
      const onClick = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) { setOpen(null); setMobileOpen(false); } };
      const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(null); setMobileOpen(false); } };
      document.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey);
      return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
    }, [open, mobileOpen]);

    if (!items.length) return <EditorPlaceholder>Add menu items in the Content tab.</EditorPlaceholder>;
    return (
      <nav ref={rootRef} className={`rwpb-mega${mobileOpen ? ' is-open' : ''}`} aria-label="Main menu">
        <div className="rwpb-mega-bar">
          <button type="button" className="rwpb-mega-toggle" aria-expanded={mobileOpen} aria-label={mobileOpen ? 'Close menu' : 'Open menu'} onClick={() => setMobileOpen((value) => !value)}>
            <Icon name={mobileOpen ? 'x' : 'menu'} size={24} />
          </button>
        </div>
        <ul className="rwpb-mega-list">
          {items.map((item, index) => {
            const id = item.id || String(index);
            const link = linkAttributes(item.link, dynamic);
            const hasDropdown = Boolean(item.templateId);
            const isOpen = open === id;
            const width = pick(item.width, ['widget', 'content', 'screen'] as const, 'widget');
            const label = <>{item.icon && <Icon name={item.icon} size="1em" />}<span>{item.label}</span></>;
            return (
              <li key={id} className={`rwpb-mega-item rwpb-mega-width-${width}${isOpen ? ' is-open' : ''}`}
                onMouseEnter={() => !clickMode && hasDropdown && openItem(id)} onMouseLeave={() => !clickMode && hasDropdown && setOpen((value) => (value === id ? null : value))}>
                <span className="rwpb-mega-row">
                  {link ? <a className="rwpb-mega-link" {...link} onClick={(event) => { if (mode === 'edit') event.preventDefault(); }}>{label}</a>
                    : <button type="button" className="rwpb-mega-link" aria-expanded={hasDropdown ? isOpen : undefined} onClick={() => hasDropdown && openItem(isOpen ? null : id)}>{label}{hasDropdown && <Icon name="chevron-down" size={14} />}</button>}
                  {link && hasDropdown && (
                    <button type="button" className="rwpb-mega-caret" aria-expanded={isOpen} aria-label={`${item.label} submenu`} onClick={() => openItem(isOpen ? null : id)}>
                      <Icon name="chevron-down" size={14} />
                    </button>
                  )}
                </span>
                {/* Dropdown content mounts the first time it opens, then stays mounted so reopening is instant. */}
                {hasDropdown && (visited.includes(id) || isOpen) && (
                  <div className="rwpb-mega-dropdown" hidden={!isOpen}>
                    <TemplateContent templateId={str(item.templateId)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    );
  },
};
