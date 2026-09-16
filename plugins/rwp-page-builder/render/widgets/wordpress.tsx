/** Classic WordPress widgets: Pages, Calendar, Archives, Categories, Recent Posts, Search, Tag Cloud, Recent Comments, Meta. */
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { getSupabaseClient } from '../../../../src/lib/db';
import { colorControl, headingTags, opts, typographyControl } from '../../lib/controls';
import type { Control, WidgetDefinition } from '../../lib/registry';
import { color, typography, type Typography } from '../../lib/style';
import { useRenderContext } from '../context';
import { fetchCategoryCounts, fetchPostLinks, fetchRecentComments, type PostLink } from '../data';
import { EditorPlaceholder } from './shared';
import { clamp, formatDate, headingTag, num, str, useAsync, WidgetError } from './kit';

const titleControls = (title: string): Control[] => [
  { key: 'title', label: 'Title', type: 'text', placeholder: title },
  { key: 'titleTag', label: 'Title HTML tag', type: 'select', options: headingTags },
];

const styleControls: Control[] = [
  colorControl('titleColor', 'Title colour'),
  typographyControl('titleTypography', 'Title typography'),
  colorControl('textColor', 'Text colour'),
  colorControl('linkColor', 'Link colour'),
  colorControl('linkHover', 'Link hover colour'),
  typographyControl('listTypography', 'List typography'),
];

const widgetCss = (bag: Record<string, unknown>) => ({
  ' .rwpb-wp-title': { color: color(bag.titleColor), ...typography(bag.titleTypography as Typography | undefined) },
  ' .rwpb-wp-widget': { color: color(bag.textColor), ...typography(bag.listTypography as Typography | undefined) },
  ' .rwpb-wp-widget a': { color: color(bag.linkColor) },
  ' .rwpb-wp-widget a:hover': { color: color(bag.linkHover) },
});

function WpWidget({ settings, fallbackTitle, className, children }: { settings: Record<string, unknown>; fallbackTitle: string; className: string; children: ReactNode }) {
  const Tag = headingTag(settings.titleTag, 'h2');
  const title = settings.title === undefined ? fallbackTitle : str(settings.title);
  return (
    <div className={`rwpb-wp-widget ${className}`}>
      {title && <Tag className="rwpb-wp-title">{title}</Tag>}
      {children}
    </div>
  );
}

/** A dropdown that navigates when a choice is made (WordPress's "Display as dropdown"). */
function JumpSelect({ label, options, placeholder }: { label: string; options: Array<{ value: string; label: string }>; placeholder: string }) {
  const { mode } = useRenderContext();
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="rwpb-sr-only">{label}</label>
      <select id={id} className="rwpb-form-control rwpb-wp-select" defaultValue="" onChange={(event) => { if (mode === 'view' && event.target.value) window.location.href = event.target.value; }}>
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </>
  );
}

// Pages ---------------------------------------------------------------------------------------------------------------

export const wpPages: WidgetDefinition = {
  type: 'wp-pages',
  label: 'Pages',
  icon: 'file-text',
  category: 'wordpress',
  keywords: ['page list', 'wordpress'],
  defaults: () => ({ settings: { title: 'Pages', sortBy: 'title', exclude: '' } }),
  controls: [
    ...titleControls('Pages'),
    { key: 'sortBy', label: 'Sort by', type: 'select', options: opts(['title', 'Page title'], ['created_at', 'Newest first'], ['created_at_asc', 'Oldest first']) },
    { key: 'exclude', label: 'Exclude', type: 'text', placeholder: 'about, contact', help: 'Page slugs or ids, separated by commas.' },
    ...styleControls,
  ],
  css: widgetCss,
  View: function PagesView({ node }) {
    const sortBy = str(node.settings.sortBy, 'title');
    const state = useAsync(`wp-pages:${sortBy}`, () => fetchPostLinks({ pages: true, orderBy: sortBy === 'title' ? 'title' : 'created_at', ascending: sortBy !== 'created_at', limit: 300 }));
    const excluded = str(node.settings.exclude).split(',').map((item) => item.trim()).filter(Boolean);
    if (state.error) return <WidgetError message={state.error} />;
    if (!state.data) return null;
    const pages = state.data.filter((page) => !excluded.includes(page.slug) && !excluded.includes(String(page.id)));
    return (
      <WpWidget settings={node.settings} fallbackTitle="Pages" className="rwpb-wp-pages">
        {pages.length ? <ul>{pages.map((page) => <li key={page.id}><a href={`/${page.slug}`}>{page.title}</a></li>)}</ul> : <p className="rwpb-muted">No pages yet.</p>}
      </WpWidget>
    );
  },
};

// Calendar ---------------------------------------------------------------------------------------------------------------

const monthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`;

export const wpCalendar: WidgetDefinition = {
  type: 'wp-calendar',
  label: 'Calendar',
  icon: 'calendar-days',
  category: 'wordpress',
  keywords: ['posts calendar', 'wordpress', 'dates'],
  defaults: () => ({ settings: { title: '', weekStart: '1' } }),
  controls: [
    ...titleControls(''),
    { key: 'weekStart', label: 'Week starts on', type: 'select', options: opts(['1', 'Monday'], ['0', 'Sunday'], ['6', 'Saturday']) },
    ...styleControls,
    colorControl('highlightBg', 'Days with posts background'),
    colorControl('todayColor', 'Today outline colour'),
  ],
  css: (bag) => ({
    ...widgetCss(bag),
    ' .rwpb-calendar td.has-posts a': { 'background-color': color(bag.highlightBg) },
    ' .rwpb-calendar td.is-today': { 'outline-color': color(bag.todayColor) },
  }),
  View: function CalendarView({ node }) {
    const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
    const [openDay, setOpenDay] = useState<number | null>(null);
    const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const state = useAsync(`wp-calendar:${monthKey(month)}`, () => fetchPostLinks({ from: month.toISOString(), to: next.toISOString(), ascending: true, limit: 500 }));
    // Is there anything older or newer to page to? One cheap query each way.
    const bounds = useAsync('wp-calendar-bounds', async () => {
      const [oldest, newest] = await Promise.all([fetchPostLinks({ ascending: true, limit: 1 }), fetchPostLinks({ limit: 1 })]);
      return { oldest: oldest[0]?.created_at || '', newest: newest[0]?.created_at || '' };
    });
    useEffect(() => setOpenDay(null), [month]);
    const weekStart = Number(node.settings.weekStart ?? 1);
    const byDay = useMemo(() => {
      const map = new Map<number, PostLink[]>();
      (state.data || []).forEach((post) => {
        const day = new Date(post.created_at).getDate();
        map.set(day, [...(map.get(day) || []), post]);
      });
      return map;
    }, [state.data]);
    if (state.error) return <WidgetError message={state.error} />;
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const lead = (month.getDay() - weekStart + 7) % 7;
    const cells: Array<number | null> = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
    while (cells.length % 7) cells.push(null);
    const weekdays = Array.from({ length: 7 }, (_, index) => new Date(2024, 0, 7 + ((weekStart + index) % 7)));
    const today = new Date();
    const isThisMonth = today.getFullYear() === month.getFullYear() && today.getMonth() === month.getMonth();
    const hasOlder = Boolean(bounds.data?.oldest && new Date(bounds.data.oldest) < month);
    const hasNewer = Boolean(bounds.data?.newest && new Date(bounds.data.newest) >= next);
    const openPosts = openDay ? byDay.get(openDay) || [] : [];
    return (
      <WpWidget settings={node.settings} fallbackTitle="" className="rwpb-wp-calendar">
        <table className="rwpb-calendar">
          <caption>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</caption>
          <thead><tr>{weekdays.map((day) => <th key={day.getDay()} scope="col" title={day.toLocaleDateString(undefined, { weekday: 'long' })}>{day.toLocaleDateString(undefined, { weekday: 'narrow' })}</th>)}</tr></thead>
          <tbody>
            {Array.from({ length: cells.length / 7 }, (_, row) => (
              <tr key={row}>
                {cells.slice(row * 7, row * 7 + 7).map((day, index) => {
                  if (!day) return <td key={index} className="is-empty" />;
                  const posts = byDay.get(day);
                  const classes = [posts ? 'has-posts' : '', isThisMonth && today.getDate() === day ? 'is-today' : ''].filter(Boolean).join(' ');
                  return (
                    <td key={index} className={classes || undefined}>
                      {posts ? (
                        posts.length === 1
                          ? <a href={`/${posts[0].slug}`} title={posts[0].title}>{day}</a>
                          : <a href="#" role="button" aria-expanded={openDay === day} title={`${posts.length} posts`} onClick={(event) => { event.preventDefault(); setOpenDay(openDay === day ? null : day); }}>{day}</a>
                      ) : day}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {openPosts.length > 1 && <ul className="rwpb-calendar-day">{openPosts.map((post) => <li key={post.id}><a href={`/${post.slug}`}>{post.title}</a></li>)}</ul>}
        <nav className="rwpb-calendar-nav" aria-label="Previous and next months">
          <button type="button" disabled={!hasOlder} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>« {new Date(month.getFullYear(), month.getMonth() - 1, 1).toLocaleDateString(undefined, { month: 'short' })}</button>
          <button type="button" disabled={!hasNewer} onClick={() => setMonth(next)}>{next.toLocaleDateString(undefined, { month: 'short' })} »</button>
        </nav>
      </WpWidget>
    );
  },
};

// Archives ---------------------------------------------------------------------------------------------------------------------

export const wpArchives: WidgetDefinition = {
  type: 'wp-archives',
  label: 'Archives',
  icon: 'archive',
  category: 'wordpress',
  keywords: ['monthly archive', 'wordpress', 'by month'],
  defaults: () => ({ settings: { title: 'Archives', showCounts: true, group: 'month' } }),
  controls: [
    ...titleControls('Archives'),
    { key: 'group', label: 'Group by', type: 'select', options: opts(['month', 'Month'], ['year', 'Year']) },
    { key: 'showCounts', label: 'Show post counts', type: 'toggle', help: 'Each month (or year) expands to list its posts.' },
    ...styleControls,
  ],
  css: widgetCss,
  View: function ArchivesView({ node }) {
    const state = useAsync('wp-archives', () => fetchPostLinks({ limit: 1000 }));
    const [open, setOpen] = useState<string | null>(null);
    const byYear = node.settings.group === 'year';
    const groups = useMemo(() => {
      const map = new Map<string, { label: string; posts: PostLink[] }>();
      (state.data || []).forEach((post) => {
        const date = new Date(post.created_at);
        const key = byYear ? String(date.getFullYear()) : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const label = byYear ? String(date.getFullYear()) : date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        const group = map.get(key) || { label, posts: [] };
        group.posts.push(post);
        map.set(key, group);
      });
      return [...map.entries()];
    }, [state.data, byYear]);
    if (state.error) return <WidgetError message={state.error} />;
    if (!state.data) return null;
    const count = (group: { posts: PostLink[] }) => (node.settings.showCounts !== false ? ` (${group.posts.length})` : '');
    return (
      <WpWidget settings={node.settings} fallbackTitle="Archives" className="rwpb-wp-archives">
        {!groups.length && <p className="rwpb-muted">No posts yet.</p>}
        {groups.length > 0 && (
          <ul>
            {groups.map(([key, group]) => (
              <li key={key}>
                <button type="button" className="rwpb-link-button" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>{group.label}{count(group)}</button>
                {open === key && <ul className="rwpb-wp-sublist">{group.posts.map((post) => <li key={post.id}><a href={`/${post.slug}`}>{post.title}</a></li>)}</ul>}
              </li>
            ))}
          </ul>
        )}
      </WpWidget>
    );
  },
};

// Categories ----------------------------------------------------------------------------------------------------------------------

export const wpCategories: WidgetDefinition = {
  type: 'wp-categories',
  label: 'Categories',
  icon: 'folder-tree',
  category: 'wordpress',
  keywords: ['category list', 'wordpress', 'topics'],
  defaults: () => ({ settings: { title: 'Categories', showCounts: true, hideEmpty: false, display: 'list' } }),
  controls: [
    ...titleControls('Categories'),
    { key: 'display', label: 'Display as', type: 'select', options: opts(['list', 'List'], ['dropdown', 'Dropdown']) },
    { key: 'showCounts', label: 'Show post counts', type: 'toggle' },
    { key: 'hideEmpty', label: 'Hide empty categories', type: 'toggle' },
    ...styleControls,
  ],
  css: widgetCss,
  View: function CategoriesView({ node }) {
    const state = useAsync('categories', fetchCategoryCounts);
    if (state.error) return <WidgetError message={state.error} />;
    if (!state.data) return null;
    const categories = state.data.filter((category) => !node.settings.hideEmpty || category.count > 0);
    const label = (category: { name: string; count: number }) => `${category.name}${node.settings.showCounts !== false ? ` (${category.count})` : ''}`;
    return (
      <WpWidget settings={node.settings} fallbackTitle="Categories" className="rwpb-wp-categories">
        {!categories.length ? <p className="rwpb-muted">No categories yet.</p>
          : node.settings.display === 'dropdown'
            ? <JumpSelect label="Categories" placeholder="Select category" options={categories.map((category) => ({ value: `/?category=${encodeURIComponent(category.slug)}`, label: label(category) }))} />
            : <ul>{categories.map((category) => <li key={category.id}><a href={`/?category=${encodeURIComponent(category.slug)}`}>{category.name}</a>{node.settings.showCounts !== false && <span className="rwpb-wp-count"> ({category.count})</span>}</li>)}</ul>}
      </WpWidget>
    );
  },
};

// Recent Posts ----------------------------------------------------------------------------------------------------------------------

export const wpRecentPosts: WidgetDefinition = {
  type: 'wp-recent-posts',
  label: 'Recent Posts',
  icon: 'clock',
  category: 'wordpress',
  keywords: ['latest posts', 'wordpress', 'news'],
  defaults: () => ({ settings: { title: 'Recent Posts', count: 5, showDate: false } }),
  controls: [
    ...titleControls('Recent Posts'),
    { key: 'count', label: 'Number of posts', type: 'number', min: 1, max: 30 },
    { key: 'showDate', label: 'Show post date', type: 'toggle' },
    ...styleControls,
  ],
  css: widgetCss,
  View: function RecentPostsView({ node }) {
    const count = clamp(Math.round(num(node.settings.count, 5)), 1, 30);
    const state = useAsync(`wp-recent:${count}`, () => fetchPostLinks({ limit: count }));
    if (state.error) return <WidgetError message={state.error} />;
    if (!state.data) return null;
    return (
      <WpWidget settings={node.settings} fallbackTitle="Recent Posts" className="rwpb-wp-recent">
        {state.data.length ? (
          <ul>{state.data.map((post) => <li key={post.id}><a href={`/${post.slug}`}>{post.title}</a>{Boolean(node.settings.showDate) && <span className="rwpb-wp-date">{formatDate(post.created_at)}</span>}</li>)}</ul>
        ) : <p className="rwpb-muted">No posts yet.</p>}
      </WpWidget>
    );
  },
};

// Search ------------------------------------------------------------------------------------------------------------------------------

export const wpSearch: WidgetDefinition = {
  type: 'wp-search',
  label: 'Search (widget)',
  icon: 'search',
  category: 'wordpress',
  keywords: ['search box', 'wordpress'],
  defaults: () => ({ settings: { title: 'Search', placeholder: 'Search…', buttonText: 'Search' } }),
  controls: [
    ...titleControls('Search'),
    { key: 'placeholder', label: 'Placeholder', type: 'text' },
    { key: 'buttonText', label: 'Button text', type: 'text', help: 'Leave empty to hide the button.' },
    ...styleControls,
  ],
  css: widgetCss,
  View: function SearchWidgetView({ node }) {
    const { mode } = useRenderContext();
    const [term, setTerm] = useState(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('s') || ''));
    const id = useId();
    const submit = (event: FormEvent) => {
      event.preventDefault();
      if (mode === 'view' && term.trim()) window.location.href = `/?s=${encodeURIComponent(term.trim())}`;
    };
    return (
      <WpWidget settings={node.settings} fallbackTitle="Search" className="rwpb-wp-search">
        <form role="search" className="rwpb-wp-search-form" onSubmit={submit}>
          <label htmlFor={id} className="rwpb-sr-only">Search for:</label>
          <input id={id} className="rwpb-form-control" type="search" value={term} placeholder={str(node.settings.placeholder, 'Search…')} onChange={(event) => setTerm(event.target.value)} />
          {str(node.settings.buttonText) && <button type="submit" className="rwpb-button rwpb-button-sm">{str(node.settings.buttonText)}</button>}
        </form>
      </WpWidget>
    );
  },
};

// Tag Cloud -------------------------------------------------------------------------------------------------------------------------------

export const wpTagCloud: WidgetDefinition = {
  type: 'wp-tag-cloud',
  label: 'Tag Cloud',
  icon: 'tags',
  category: 'wordpress',
  keywords: ['tags', 'category cloud', 'wordpress'],
  defaults: () => ({ settings: { title: 'Tags', showCounts: false, minSize: 12, maxSize: 22 } }),
  controls: [
    ...titleControls('Tags'),
    { key: 'showCounts', label: 'Show post counts', type: 'toggle', help: 'Posts on this site are organised by category, so the cloud shows categories, sized by how many posts they have.' },
    { key: 'minSize', label: 'Smallest size (px)', type: 'slider', min: 8, max: 30 },
    { key: 'maxSize', label: 'Largest size (px)', type: 'slider', min: 12, max: 60 },
    ...styleControls,
    colorControl('chipBg', 'Tag background'),
  ],
  css: (bag) => ({ ...widgetCss(bag), ' .rwpb-tag-cloud a': { 'background-color': color(bag.chipBg) } }),
  View: function TagCloudView({ node }) {
    const state = useAsync('categories', fetchCategoryCounts);
    if (state.error) return <WidgetError message={state.error} />;
    if (!state.data) return null;
    const categories = state.data.filter((category) => category.count > 0);
    const minSize = num(node.settings.minSize, 12);
    const maxSize = Math.max(minSize, num(node.settings.maxSize, 22));
    const counts = categories.map((category) => category.count);
    const low = Math.min(...counts);
    const high = Math.max(...counts);
    return (
      <WpWidget settings={node.settings} fallbackTitle="Tags" className="rwpb-wp-tags">
        {categories.length ? (
          <div className="rwpb-tag-cloud">
            {categories.map((category) => {
              const scale = high === low ? 0.5 : (category.count - low) / (high - low);
              return (
                <a key={category.id} href={`/?category=${encodeURIComponent(category.slug)}`} style={{ fontSize: `${Math.round(minSize + scale * (maxSize - minSize))}px` }}
                  aria-label={`${category.name} (${category.count} post${category.count === 1 ? '' : 's'})`}>
                  {category.name}{node.settings.showCounts ? <span className="rwpb-wp-count"> ({category.count})</span> : null}
                </a>
              );
            })}
          </div>
        ) : <EditorPlaceholder>No categories have published posts yet.</EditorPlaceholder>}
      </WpWidget>
    );
  },
};

// Recent Comments ------------------------------------------------------------------------------------------------------------------------

export const wpRecentComments: WidgetDefinition = {
  type: 'wp-recent-comments',
  label: 'Recent Comments',
  icon: 'message',
  category: 'wordpress',
  keywords: ['latest comments', 'wordpress', 'discussion'],
  defaults: () => ({ settings: { title: 'Recent Comments', count: 5, showExcerpt: false } }),
  controls: [
    ...titleControls('Recent Comments'),
    { key: 'count', label: 'Number of comments', type: 'number', min: 1, max: 20 },
    { key: 'showExcerpt', label: 'Show a short excerpt', type: 'toggle' },
    ...styleControls,
  ],
  css: widgetCss,
  View: function RecentCommentsView({ node }) {
    const count = clamp(Math.round(num(node.settings.count, 5)), 1, 20);
    const state = useAsync(`wp-comments:${count}`, () => fetchRecentComments(count));
    if (state.error) return <WidgetError message={state.error} />;
    if (!state.data) return null;
    return (
      <WpWidget settings={node.settings} fallbackTitle="Recent Comments" className="rwpb-wp-comments">
        {state.data.length ? (
          <ul>
            {state.data.map((comment) => (
              <li key={comment.id}>
                <span className="rwpb-wp-comment-author">{comment.author?.display_name || comment.author_name || 'Someone'}</span>
                {comment.page && <> on <a href={`/${comment.page.slug}#comments`}>{comment.page.title}</a></>}
                {Boolean(node.settings.showExcerpt) && <span className="rwpb-wp-comment-excerpt">{comment.content.length > 90 ? `${comment.content.slice(0, 90)}…` : comment.content}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="rwpb-muted">No comments yet.</p>}
      </WpWidget>
    );
  },
};

// Meta ---------------------------------------------------------------------------------------------------------------------------------------

export const wpMeta: WidgetDefinition = {
  type: 'wp-meta',
  label: 'Meta',
  icon: 'log-in',
  category: 'wordpress',
  keywords: ['login', 'site admin', 'wordpress', 'account'],
  defaults: () => ({ settings: { title: 'Meta', showRegister: true, showAdmin: true } }),
  controls: [
    ...titleControls('Meta'),
    { key: 'showAdmin', label: '"Site admin" link when signed in', type: 'toggle' },
    { key: 'showRegister', label: '"Register" link when signed out', type: 'toggle' },
    ...styleControls,
  ],
  css: widgetCss,
  View: function MetaView({ node }) {
    const [signedIn, setSignedIn] = useState<boolean | null>(null);
    useEffect(() => {
      const supabase = getSupabaseClient();
      let active = true;
      void supabase.auth.getSession().then(({ data }) => active && setSignedIn(Boolean(data.session)));
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => active && setSignedIn(Boolean(session)));
      return () => { active = false; listener.subscription.unsubscribe(); };
    }, []);
    if (signedIn === null) return null;
    const here = typeof window === 'undefined' ? '/' : window.location.pathname;
    return (
      <WpWidget settings={node.settings} fallbackTitle="Meta" className="rwpb-wp-meta">
        <ul>
          {signedIn ? (
            <>
              {node.settings.showAdmin !== false && <li><a href="/admin">Site admin</a></li>}
              <li><button type="button" className="rwpb-link-button" onClick={async () => { await getSupabaseClient().auth.signOut(); window.location.reload(); }}>Log out</button></li>
            </>
          ) : (
            <>
              {node.settings.showRegister !== false && <li><a href={`/register?redirect=${encodeURIComponent(here)}`}>Register</a></li>}
              <li><a href={`/login?redirect=${encodeURIComponent(here)}`}>Log in</a></li>
            </>
          )}
        </ul>
      </WpWidget>
    );
  },
};
