/**
 * Building blocks shared by the widget pack: a carousel, a gallery lightbox, template rendering,
 * post cards and queries, the taxonomy filter bus and a small async hook.
 */
import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { defaultSettings, type SiteSettings } from '../../../../src/lib/settings';
import { colorControl, headingTags, opts } from '../../lib/controls';
import { resolveText, type DynamicContext, type DynamicPost } from '../../lib/dynamic';
import { Icon } from '../../lib/icons';
import type { Control } from '../../lib/registry';
import { safeMediaUrl, safeUrl } from '../../lib/sanitize';
import { color, length } from '../../lib/style';
import type { StyleBag } from '../../lib/types';
import { RenderProvider, useRenderContext } from '../context';
import { fetchPosts, fetchSiteSettings, fetchTemplateContent, type PostQuery } from '../data';
import { generateCss } from '../generateCss';
import { NodeView } from '../NodeView';
import { asLink, EditorPlaceholder, useText } from './shared';

// Values ----------------------------------------------------------------------------------------------

export const str = (value: unknown, fallback = ''): string =>
  (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback);

export const num = (value: unknown, fallback: number): number => {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

export const headingTag = (value: unknown, fallback: 'h2' | 'h3' | 'h4' = 'h3') =>
  (headingTags.some((option) => option.value === value) ? value : fallback) as 'h3';

export const listOf = <T,>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);

export const itemId = () => Math.random().toString(36).slice(2, 8);

export const prefersReducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

export const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** Link attributes for repeater items and lists, where the useLinkProps hook cannot be called per item. */
export function linkAttributes(value: unknown, dynamic: DynamicContext | null) {
  const link = asLink(value);
  const href = safeUrl(resolveText(link.url || '', dynamic));
  if (!href) return null;
  const rel = [link.newTab ? 'noopener noreferrer' : '', link.nofollow ? 'nofollow' : ''].filter(Boolean).join(' ');
  return { href, target: link.newTab ? '_blank' : undefined, rel: rel || undefined };
}

/** Props for a CSS custom property on style={} without casts everywhere. */
export const cssVars = (vars: Record<string, string | number | undefined>): CSSProperties =>
  Object.fromEntries(Object.entries(vars).filter(([, value]) => value !== undefined)) as CSSProperties;

// Async ---------------------------------------------------------------------------------------------------

export interface AsyncState<T> { data: T | null; error: string; loading: boolean }

/** Runs load() whenever key changes; ignores results that arrive after a newer key. */
export function useAsync<T>(key: string | null, load: () => Promise<T>): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: '', loading: key !== null });
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    if (key === null) {
      setState({ data: null, error: '', loading: false });
      return undefined;
    }
    let active = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    loader.current()
      .then((data) => active && setState({ data, error: '', loading: false }))
      .catch((error: unknown) => active && setState({ data: null, error: errorText(error, 'Could not load this content.'), loading: false }));
    return () => { active = false; };
  }, [key]);
  return state;
}

/** Load errors are shown to editors on the canvas and hidden from visitors. */
export function WidgetError({ message }: { message: string }) {
  const { mode } = useRenderContext();
  return mode === 'edit' && message ? <div className="rwpb-placeholder rwpb-placeholder-error" role="alert">{message}</div> : null;
}

export function useSiteSettings(): SiteSettings | null {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  useEffect(() => {
    let active = true;
    fetchSiteSettings().then((loaded) => active && setSettings(loaded)).catch(() => active && setSettings(defaultSettings));
    return () => { active = false; };
  }, []);
  return settings;
}

export function useCurrentPost(): DynamicPost | null {
  return useRenderContext().dynamic?.page || null;
}

/** Plays once, when the element first scrolls into view. Always "in view" in the editor. */
export function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
  const { mode } = useRenderContext();
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (mode === 'edit' || seen) return undefined;
    const element = ref.current;
    if (!element || !('IntersectionObserver' in window)) {
      setSeen(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    }, { threshold: 0.2 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode, seen]);
  return [ref, mode === 'edit' || seen];
}

// Carousel ------------------------------------------------------------------------------------------------

export interface CarouselOptions {
  arrows?: boolean;
  dots?: boolean;
  autoplay?: boolean;
  interval?: number;
  loop?: boolean;
  pauseOnHover?: boolean;
  /** 'page' moves by the number of visible slides. */
  scrollBy?: string;
}

/** Content-tab and style-tab controls every carousel shares. perView and gap are responsive. */
export const carouselControls = (options: { perViewMax?: number } = {}): Control[] => [
  { key: '_carousel', label: 'Carousel', type: 'heading' },
  { key: 'perView', label: 'Slides visible', type: 'slider', store: 'style', responsive: true, min: 1, max: options.perViewMax || 6 },
  { key: 'scrollBy', label: 'Move by', type: 'select', options: opts(['one', 'One slide'], ['page', 'All visible slides']) },
  { key: 'arrows', label: 'Arrows', type: 'toggle' },
  { key: 'dots', label: 'Dots', type: 'toggle' },
  { key: 'loop', label: 'Loop back to the start', type: 'toggle' },
  { key: 'autoplay', label: 'Autoplay', type: 'toggle', help: 'Pauses on hover and focus, and never runs for visitors who prefer reduced motion.' },
  { key: 'interval', label: 'Autoplay interval (ms)', type: 'slider', min: 1500, max: 15000, step: 250, condition: (settings) => Boolean(settings.autoplay) },
  { key: 'gap', label: 'Space between slides (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 80 },
  colorControl('navColor', 'Arrows and dots colour'),
];

export const carouselCss = (bag: StyleBag, fallbackPerView = 1) => ({
  ' .rwpb-carousel': {
    '--rwpb-per-view': Math.round(clamp(num(bag.perView, fallbackPerView), 1, 8)),
    '--rwpb-gap': length(bag.gap ?? 20, 'px') || '0px',
    '--rwpb-nav-color': color(bag.navColor),
  },
});

export const carouselOptions = (settings: Record<string, unknown>): CarouselOptions => ({
  arrows: settings.arrows !== false,
  dots: settings.dots !== false,
  autoplay: Boolean(settings.autoplay),
  interval: num(settings.interval, 5000),
  loop: Boolean(settings.loop),
  pauseOnHover: true,
  scrollBy: str(settings.scrollBy, 'one'),
});

export function Carousel({ slides, options, label, className = '', onIndexChange }: {
  slides: ReactNode[];
  options: CarouselOptions;
  label: string;
  className?: string;
  onIndexChange?: (index: number) => void;
}) {
  const { mode } = useRenderContext();
  const rootRef = useRef<HTMLDivElement>(null);
  const [perView, setPerView] = useState(1);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const drag = useRef<{ x: number; id: number } | null>(null);
  const count = slides.length;
  const maxIndex = Math.max(0, count - perView);
  const step = options.scrollBy === 'page' ? perView : 1;

  // The number of visible slides comes from CSS (it is responsive), so read it back after layout.
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return undefined;
    const measure = () => {
      const value = Math.round(parseFloat(getComputedStyle(element).getPropertyValue('--rwpb-per-view')));
      setPerView(Number.isFinite(value) && value >= 1 ? value : 1);
    };
    measure();
    if (!('ResizeObserver' in window)) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });

  useEffect(() => { if (index > maxIndex) setIndex(maxIndex); }, [index, maxIndex]);
  useEffect(() => { onIndexChange?.(index); }, [index, onIndexChange]);

  const go = useCallback((target: number) => {
    setIndex((current) => {
      if (target > maxIndex) return options.loop ? (current >= maxIndex ? 0 : maxIndex) : maxIndex;
      if (target < 0) return options.loop ? (current <= 0 ? maxIndex : 0) : 0;
      return target;
    });
  }, [maxIndex, options.loop]);

  useEffect(() => {
    if (mode === 'edit' || !options.autoplay || paused || maxIndex === 0 || prefersReducedMotion()) return undefined;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + step > maxIndex ? (current >= maxIndex ? 0 : maxIndex) : current + step));
    }, Math.max(1500, options.interval || 5000));
    return () => window.clearInterval(timer);
  }, [mode, options.autoplay, options.interval, paused, maxIndex, step]);

  if (!count) return null;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    drag.current = { x: event.clientX, id: event.pointerId };
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start || start.id !== event.pointerId) return;
    const delta = event.clientX - start.x;
    if (Math.abs(delta) > 45) go(index + (delta < 0 ? step : -step));
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); go(index + step); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - step); }
  };

  const dotCount = Math.ceil(maxIndex / step) + 1;
  return (
    <div ref={rootRef} className={`rwpb-carousel ${className}`.trim()} role="region" aria-roledescription="carousel" aria-label={label}
      onMouseEnter={() => options.pauseOnHover && setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)} onKeyDown={onKeyDown}>
      <div className="rwpb-carousel-viewport" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; }}>
        <div className="rwpb-carousel-track" style={cssVars({ '--rwpb-index': index })}>
          {slides.map((slide, slideIndex) => {
            const hidden = slideIndex < index || slideIndex >= index + perView;
            return (
              <div key={slideIndex} className={`rwpb-carousel-slide${hidden ? '' : ' is-visible'}`} role="group" aria-roledescription="slide"
                aria-label={`${slideIndex + 1} of ${count}`} aria-hidden={hidden} inert={hidden}>
                {slide}
              </div>
            );
          })}
        </div>
      </div>
      {options.arrows && maxIndex > 0 && (
        <>
          <button type="button" className="rwpb-carousel-arrow rwpb-carousel-prev" aria-label="Previous" disabled={!options.loop && index === 0} onClick={() => go(index - step)}><Icon name="chevron-left" size={22} /></button>
          <button type="button" className="rwpb-carousel-arrow rwpb-carousel-next" aria-label="Next" disabled={!options.loop && index >= maxIndex} onClick={() => go(index + step)}><Icon name="chevron-right" size={22} /></button>
        </>
      )}
      {options.dots && maxIndex > 0 && (
        <div className="rwpb-carousel-dots">
          {Array.from({ length: dotCount }, (_, dot) => {
            const target = Math.min(maxIndex, dot * step);
            const current = index >= target && (dot === dotCount - 1 || index < Math.min(maxIndex, (dot + 1) * step));
            return <button key={dot} type="button" aria-label={`Go to slide ${target + 1}`} aria-current={current} onClick={() => go(target)} />;
          })}
        </div>
      )}
    </div>
  );
}

// Gallery lightbox ----------------------------------------------------------------------------------------

export interface LightboxItem { src: string; alt?: string; caption?: string; video?: string }

export function GalleryLightbox({ items, index, onClose, onNavigate }: {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const count = items.length;
  const item = items[index];
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight' && count > 1) onNavigate((index + 1) % count);
      if (event.key === 'ArrowLeft' && count > 1) onNavigate((index - 1 + count) % count);
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [index, count, onClose, onNavigate]);
  if (!item) return null;
  return createPortal(
    <div className="rwpb-lightbox rwpb-lightbox-gallery" role="dialog" aria-modal="true" aria-label={item.alt || `Item ${index + 1} of ${count}`} onClick={onClose}>
      <button type="button" className="rwpb-lightbox-close" aria-label="Close" onClick={onClose}>×</button>
      {count > 1 && <button type="button" className="rwpb-lightbox-nav rwpb-lightbox-prev" aria-label="Previous" onClick={(event) => { event.stopPropagation(); onNavigate((index - 1 + count) % count); }}><Icon name="chevron-left" size={30} /></button>}
      <figure className="rwpb-lightbox-figure" onClick={(event) => event.stopPropagation()}>
        {item.video
          ? <div className="rwpb-lightbox-video"><iframe src={item.video} title={item.alt || 'Video'} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen /></div>
          : <img src={item.src} alt={item.alt || ''} />}
        {(item.caption || count > 1) && <figcaption>{item.caption}{count > 1 && <span>{index + 1} / {count}</span>}</figcaption>}
      </figure>
      {count > 1 && <button type="button" className="rwpb-lightbox-nav rwpb-lightbox-next" aria-label="Next" onClick={(event) => { event.stopPropagation(); onNavigate((index + 1) % count); }}><Icon name="chevron-right" size={30} /></button>}
    </div>,
    document.body,
  );
}

/** Opens a gallery lightbox at an index; closed in the editor so clicks keep selecting the widget. */
export function useGalleryLightbox(items: LightboxItem[]) {
  const { mode } = useRenderContext();
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const element = open === null ? null : <GalleryLightbox items={items} index={open} onClose={close} onNavigate={setOpen} />;
  return { open: (index: number) => { if (mode === 'view') setOpen(index); }, element };
}

// Templates -----------------------------------------------------------------------------------------------

const TemplateChain = createContext<string[]>([]);

/**
 * Renders a saved template inside a widget. The template is read-only here (no editor chrome),
 * generates its own CSS, and may nest other templates up to three deep. Custom HTML inside a
 * template renders as it does on a page: builder_guard_html guards elementor_templates too.
 */
export function TemplateContent({ templateId, css = true, emptyText = 'Choose a template in the Content tab.' }: { templateId: string; css?: boolean; emptyText?: string }) {
  const context = useRenderContext();
  const chain = useContext(TemplateChain);
  const looped = chain.includes(templateId) || chain.length >= 3;
  const { data, error } = useAsync(templateId && !looped ? `template:${templateId}` : null, () => fetchTemplateContent(templateId));
  const content = useMemo(() => (data || []).filter((section) => section && section.kind === 'section'), [data]);
  const stylesheet = useMemo(
    () => (css && content.length ? generateCss({ version: 1, settings: {}, content }, context.mode === 'edit' ? { device: context.device } : {}) : ''),
    [css, content, context.mode, context.device],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const inner = useMemo(() => ({ ...context, editor: null }), [context]);

  // Content arrives after BuilderRenderer's entrance-animation observer ran, so observe it here.
  useEffect(() => {
    const root = rootRef.current;
    if (context.mode !== 'view' || !root) return undefined;
    const elements = root.querySelectorAll<HTMLElement>('.rwpb-anim:not(.rwpb-visible)');
    if (!elements.length) return undefined;
    if (!('IntersectionObserver' in window)) {
      elements.forEach((element) => element.classList.add('rwpb-visible'));
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('rwpb-visible');
        observer.unobserve(entry.target);
      }
    }), { threshold: 0.05 });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [context.mode, content]);

  if (!templateId) return <EditorPlaceholder>{emptyText}</EditorPlaceholder>;
  if (looped) return <EditorPlaceholder>This template contains itself (or nests more than three deep), so it is not shown again here.</EditorPlaceholder>;
  if (error) return <WidgetError message={error} />;
  if (!data) return null;
  return (
    <TemplateChain.Provider value={[...chain, templateId]}>
      <RenderProvider value={inner}>
        {stylesheet && <style>{stylesheet}</style>}
        <div ref={rootRef} className="rwpb-template">
          {context.mode === 'edit' && !content.length && <div className="rwpb-placeholder">This template is empty.</div>}
          {content.map((node) => <NodeView key={node.id} node={node} />)}
        </div>
      </RenderProvider>
    </TemplateChain.Provider>
  );
}

/** Renders children with {{post.*}} tags and post widgets pointing at another post (loop items). */
export function PostScope({ post, children }: { post: DynamicPost; children: ReactNode }) {
  const context = useRenderContext();
  const value = useMemo(() => {
    const base: DynamicContext = context.dynamic || { page: null, user: null, site: { title: '', tagline: '', url: typeof window === 'undefined' ? '' : window.location.origin } };
    return { ...context, dynamic: { ...base, page: post } };
  }, [context, post]);
  return <RenderProvider value={value}>{children}</RenderProvider>;
}

// Taxonomy filter -------------------------------------------------------------------------------------------

const FILTER_EVENT = 'rwpb:taxonomy-filter';
const activeFilters = new Map<string, string>();

export const filterGroupControl = (): Control => ({
  key: 'filterGroup', label: 'Taxonomy filter group', type: 'text', placeholder: 'posts',
  help: 'A Taxonomy Filter widget with the same group name filters this list. Leave empty to ignore filters.',
});

export function emitTaxonomyFilter(group: string, categoryId: string) {
  activeFilters.set(group, categoryId);
  window.dispatchEvent(new CustomEvent(FILTER_EVENT, { detail: { group, categoryId } }));
}

/** The category chosen in a Taxonomy Filter of this group, or null when none has been used. */
export function useTaxonomyFilter(group: unknown): string | null {
  const name = str(group).trim();
  const [value, setValue] = useState<string | null>(() => (name && activeFilters.has(name) ? activeFilters.get(name)! : null));
  useEffect(() => {
    if (!name) return undefined;
    const onFilter = (event: Event) => {
      const detail = (event as CustomEvent<{ group: string; categoryId: string }>).detail;
      if (detail?.group === name) setValue(detail.categoryId);
    };
    window.addEventListener(FILTER_EVENT, onFilter);
    return () => window.removeEventListener(FILTER_EVENT, onFilter);
  }, [name]);
  return name ? value : null;
}

// Posts -------------------------------------------------------------------------------------------------------

export const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export const postQueryControls = (): Control[] => [
  { key: '_query', label: 'Query', type: 'heading' },
  { key: 'categoryId', label: 'Category', type: 'category' },
  { key: 'orderBy', label: 'Order by', type: 'select', options: opts(['created_at', 'Date published'], ['updated_at', 'Date modified'], ['title', 'Title']) },
  { key: 'order', label: 'Order', type: 'select', options: opts(['desc', 'Descending (newest first)'], ['asc', 'Ascending (oldest first)']) },
  { key: 'excludeCurrent', label: 'Exclude the current post', type: 'toggle' },
  filterGroupControl(),
];

export const postCardControls = (): Control[] => [
  { key: '_card', label: 'Card', type: 'heading' },
  { key: 'showImage', label: 'Featured image', type: 'toggle', help: "Uses each post's social image (SEO panel → og:image)." },
  { key: 'imageRatio', label: 'Image ratio', type: 'select', options: opts(['16/9', '16:9'], ['4/3', '4:3'], ['1/1', '1:1'], ['3/4', '3:4'], ['', 'Original']), condition: (settings) => Boolean(settings.showImage) },
  { key: 'titleTag', label: 'Title HTML tag', type: 'select', options: headingTags },
  { key: 'showMeta', label: 'Date and category', type: 'toggle' },
  { key: 'showAuthor', label: 'Author', type: 'toggle', condition: (settings) => Boolean(settings.showMeta) },
  { key: 'showExcerpt', label: 'Excerpt', type: 'toggle' },
  { key: 'excerptLength', label: 'Excerpt length (words)', type: 'number', min: 5, max: 100, condition: (settings) => Boolean(settings.showExcerpt) },
  { key: 'showReadMore', label: 'Read more link', type: 'toggle' },
  { key: 'readMoreText', label: 'Read more text', type: 'text', condition: (settings) => Boolean(settings.showReadMore) },
];

export function PostCard({ post, settings }: { post: DynamicPost; settings: Record<string, unknown> }) {
  const readMore = useText(settings.readMoreText || 'Read more');
  const TitleTag = headingTag(settings.titleTag);
  const imageUrl = safeMediaUrl(post.featured_image);
  const href = `/${post.slug}`;
  const ratio = settings.imageRatio === '' ? undefined : str(settings.imageRatio, '16/9');
  return (
    <article className="rwpb-post">
      {Boolean(settings.showImage) && imageUrl && (
        <a className="rwpb-post-media" href={href} tabIndex={-1} aria-hidden="true" style={ratio ? { aspectRatio: ratio } : undefined}>
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
}

/** The post query every list widget builds from its settings (category may be overridden by a filter). */
export function postQueryFrom(settings: Record<string, unknown>, pageId: number | null, filterCategory: string | null, limit: number, page: number): PostQuery {
  return {
    categoryId: (filterCategory ?? str(settings.categoryId)) || undefined,
    limit,
    page,
    orderBy: pick(settings.orderBy, ['created_at', 'updated_at', 'title'] as const, 'created_at'),
    order: settings.order === 'asc' ? 'asc' : 'desc',
    excludeId: settings.excludeCurrent ? pageId : null,
    search: str(settings.search) || undefined,
  };
}

const noPosts: DynamicPost[] = [];

export function usePostsPage(query: PostQuery, excerptLength: number, enabled = true) {
  const key = enabled ? JSON.stringify([query, excerptLength]) : null;
  const state = useAsync(key, () => fetchPosts(query, excerptLength));
  // A stable empty array: a new [] each render would re-run effects that depend on it.
  return { posts: state.data?.posts || noPosts, total: state.data?.total || 0, loading: state.loading, error: state.error };
}

export function Pagination({ page, pages, onPage, mode = 'numbers', loading = false, label = 'Pages' }: {
  page: number; pages: number; onPage: (page: number) => void; mode?: string; loading?: boolean; label?: string;
}) {
  if (pages <= 1 || mode === 'none') return null;
  if (mode === 'load-more') {
    return page < pages ? <div className="rwpb-pagination"><button type="button" disabled={loading} onClick={() => onPage(page + 1)}>{loading ? 'Loading…' : 'Load more'}</button></div> : null;
  }
  if (mode === 'prev-next') {
    return (
      <nav className="rwpb-pagination" aria-label={label}>
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Previous</button>
        <span>{page} / {pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
      </nav>
    );
  }
  // Long ranges collapse to 1 … 4 5 6 … 20.
  const numbers = Array.from({ length: pages }, (_, index) => index + 1)
    .filter((number) => number === 1 || number === pages || Math.abs(number - page) <= 2);
  return (
    <nav className="rwpb-pagination" aria-label={label}>
      <button type="button" disabled={page <= 1} aria-label="Previous page" onClick={() => onPage(page - 1)}>‹</button>
      {numbers.map((number, index) => (
        <span key={number} className="rwpb-pagination-group">
          {index > 0 && number - numbers[index - 1] > 1 && <span className="rwpb-pagination-gap" aria-hidden="true">…</span>}
          <button type="button" aria-current={number === page ? 'page' : undefined} onClick={() => onPage(number)}>{number}</button>
        </span>
      ))}
      <button type="button" disabled={page >= pages} aria-label="Next page" onClick={() => onPage(page + 1)}>›</button>
    </nav>
  );
}

export const scrollToWidget = (nodeId: string) => {
  document.querySelector(`.rwpb-n-${nodeId}`)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
};

