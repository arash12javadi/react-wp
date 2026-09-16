/** Site (theme builder) widgets: sidebar, logo, titles, author box, comments, post navigation, archive, breadcrumbs, sitemap. */
import { useEffect, useMemo, useState } from 'react';
import CommentSection from '../../../../src/components/CommentSection';
import PublicSidebar from '../../../../src/components/PublicSidebar';
import WidgetRenderer from '../../../../src/components/WidgetRenderer';
import { getSupabaseClient } from '../../../../src/lib/db';
import { loadWidgetAreas } from '../../../../src/lib/widgets';
import { alignControl, colorControl, headingTags, linkControl, opts, typographyControl } from '../../lib/controls';
import { Icon } from '../../lib/icons';
import type { WidgetDefinition } from '../../lib/registry';
import { safeMediaUrl } from '../../lib/sanitize';
import { alignToFlex, color, isSet, length, typography, type Typography } from '../../lib/style';
import { useRenderContext, useTemplateContext } from '../context';
import { fetchAdjacentPosts, fetchAuthorName, fetchAuthorProfile, fetchCategories, fetchPageCategoryId, fetchPostLinks } from '../data';
import { posts } from './posts';
import { EditorPlaceholder, useLinkProps, useMediaUrl, useText } from './shared';
import { clamp, formatDate, headingTag, num, pick, str, useAsync, useCurrentPost, useSiteSettings, WidgetError } from './kit';

const alignCss = (bag: Record<string, unknown>) => ({ 'text-align': isSet(bag.align) ? String(bag.align) : undefined });
const textStyle = (key: string, label: string) => [colorControl(`${key}Color`, `${label} colour`), typographyControl(`${key}Typography`, `${label} typography`)];
const textCss = (bag: Record<string, unknown>, key: string) => ({ color: color(bag[`${key}Color`]), ...typography(bag[`${key}Typography`] as Typography | undefined) });

const urlParam = (name: string) => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get(name) || '');

// Sidebar ------------------------------------------------------------------------------------------------------------

export const sidebar: WidgetDefinition = {
  type: 'sidebar',
  label: 'Sidebar',
  icon: 'panel-right',
  category: 'site',
  keywords: ['widgets', 'widget area', 'aside', 'theme sidebar'],
  defaults: () => ({ settings: { source: 'theme' } }),
  controls: [
    {
      key: 'source', label: 'Show', type: 'select',
      options: opts(['theme', 'The website sidebar (as set in Appearance → Theme Editor)'], ['sidebar', 'Only the Sidebar widget area'], ['footer', 'Only the Footer widget area']),
      help: 'The same widgets as the rest of the site: change them under Menus → Sidebar & Widgets, and the sidebar layout under Appearance → Theme Editor → Sidebar.',
    },
    colorControl('headingColor', 'Widget title colour'),
    typographyControl('headingTypography', 'Widget title typography'),
    colorControl('textColor', 'Text colour'),
    colorControl('linkColor', 'Link colour'),
    { key: 'widgetGap', label: 'Space between widgets (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 80 },
  ],
  css: (bag) => ({
    ' .rwpb-sidebar': { color: color(bag.textColor), '--rwpb-sidebar-gap': length(bag.widgetGap, 'px') },
    ' .rwpb-sidebar h2': textCss(bag, 'heading'),
    ' .rwpb-sidebar a': { color: color(bag.linkColor) },
  }),
  View: function SidebarView({ node }) {
    const source = pick(node.settings.source, ['theme', 'sidebar', 'footer'] as const, 'theme');
    const areas = useAsync(source === 'theme' ? null : 'widget-areas', loadWidgetAreas);
    if (source === 'theme') return <div className="rwpb-sidebar rwpb-sidebar-theme"><PublicSidebar /></div>;
    if (areas.error) return <WidgetError message={`Could not load the widget areas: ${areas.error}`} />;
    if (!areas.data) return null;
    const widgets = areas.data[source];
    if (!widgets.length) return <EditorPlaceholder>The {source === 'footer' ? 'Footer' : 'Sidebar'} widget area is empty. Add widgets under Menus → Sidebar &amp; Widgets.</EditorPlaceholder>;
    return (
      <aside className="rwpb-sidebar rwp-sidebar" aria-label={source === 'footer' ? 'Footer widgets' : 'Sidebar'}>
        <div className="rwpt-widget-stack">{widgets.map((widget) => <WidgetRenderer key={widget.id} widget={widget} />)}</div>
      </aside>
    );
  },
};

// Site Logo and Site Title ---------------------------------------------------------------------------------------------------

export const siteLogo: WidgetDefinition = {
  type: 'site-logo',
  label: 'Site Logo',
  icon: 'image',
  category: 'site',
  keywords: ['logo', 'brand', 'header'],
  defaults: () => ({ settings: { customImage: '', linkHome: true }, style: { logoWidth: { size: 180, unit: 'px' } } }),
  controls: [
    { key: 'customImage', label: 'Different image (optional)', type: 'image', help: 'Leave empty to use the logo from Settings → Site.' },
    { key: 'linkHome', label: 'Link to the home page', type: 'toggle' },
    { ...linkControl('link', 'Or link to'), condition: (settings) => !settings.linkHome },
    alignControl(),
    { key: 'logoWidth', label: 'Width', type: 'size', tab: 'style', responsive: true, units: ['px', '%'] },
  ],
  css: (bag) => ({
    '': alignCss(bag),
    ' .rwpb-site-logo img': { width: bag.logoWidth ? length((bag.logoWidth as { size?: number }).size, (bag.logoWidth as { unit?: string }).unit || 'px') : undefined },
  }),
  View: function SiteLogoView({ node }) {
    const site = useSiteSettings();
    const custom = useMediaUrl(node.settings.customImage);
    const link = useLinkProps(node.settings.link);
    if (!site) return null;
    const src = custom || safeMediaUrl(site.site_logo);
    if (!src) return <EditorPlaceholder>No logo yet: upload one under Settings → Site, or choose an image here.</EditorPlaceholder>;
    const image = <img src={src} alt={site.site_title} />;
    const href = node.settings.linkHome !== false ? { href: '/', rel: 'home' } : link;
    return <div className="rwpb-site-logo">{href ? <a {...href}>{image}</a> : image}</div>;
  },
};

export const siteTitle: WidgetDefinition = {
  type: 'site-title',
  label: 'Site Title',
  icon: 'heading',
  category: 'site',
  keywords: ['site name', 'brand', 'tagline'],
  defaults: () => ({ settings: { tag: 'p', linkHome: true, showTagline: false } }),
  controls: [
    { key: 'tag', label: 'HTML tag', type: 'select', options: headingTags },
    { key: 'linkHome', label: 'Link to the home page', type: 'toggle' },
    { key: 'showTagline', label: 'Show the tagline', type: 'toggle' },
    alignControl(),
    ...textStyle('title', 'Title'),
    ...textStyle('tagline', 'Tagline'),
  ],
  css: (bag) => ({ '': alignCss(bag), ' .rwpb-site-title': textCss(bag, 'title'), ' .rwpb-site-tagline': textCss(bag, 'tagline') }),
  View: function SiteTitleView({ node }) {
    const site = useSiteSettings();
    const Tag = headingTag(node.settings.tag);
    if (!site) return null;
    return (
      <div className="rwpb-site-brand">
        <Tag className="rwpb-site-title">{node.settings.linkHome !== false ? <a href="/" rel="home">{site.site_title}</a> : site.site_title}</Tag>
        {Boolean(node.settings.showTagline) && site.site_tagline && <p className="rwpb-site-tagline">{site.site_tagline}</p>}
      </div>
    );
  },
};

export const pageTitle: WidgetDefinition = {
  type: 'page-title',
  label: 'Page Title',
  icon: 'heading',
  category: 'site',
  keywords: ['title', 'h1'],
  defaults: () => ({ settings: { tag: 'h1', before: '', after: '' } }),
  controls: [
    { key: 'tag', label: 'HTML tag', type: 'select', options: headingTags },
    { key: 'before', label: 'Text before', type: 'text' },
    { key: 'after', label: 'Text after', type: 'text' },
    linkControl(),
    alignControl('align', 'Alignment', true),
    colorControl('color', 'Colour'),
    typographyControl(),
  ],
  css: (bag) => ({ '': alignCss(bag), ' .rwpb-page-heading': { color: color(bag.color), ...typography(bag.typography as Typography | undefined) } }),
  View: function PageTitleView({ node }) {
    const post = useCurrentPost();
    const link = useLinkProps(node.settings.link);
    const Tag = headingTag(node.settings.tag);
    if (!post) return <EditorPlaceholder>Page title</EditorPlaceholder>;
    const text = `${str(node.settings.before)}${post.title}${str(node.settings.after)}`;
    return <Tag className="rwpb-page-heading">{link ? <a {...link}>{text}</a> : text}</Tag>;
  },
};

// Author Box ------------------------------------------------------------------------------------------------------------------

export const authorBox: WidgetDefinition = {
  type: 'author-box',
  label: 'Author Box',
  icon: 'circle-user',
  category: 'site',
  keywords: ['author', 'bio', 'about the author'],
  defaults: () => ({ settings: { source: 'current', showAvatar: true, showName: true, showBio: true, layout: 'left', nameTag: 'h4' } }),
  controls: [
    { key: 'source', label: 'Source', type: 'select', options: opts(['current', 'The author of this post'], ['custom', 'Custom']) },
    { key: 'customName', label: 'Name', type: 'text', condition: (settings) => settings.source === 'custom' },
    { key: 'customAvatar', label: 'Picture', type: 'image', condition: (settings) => settings.source === 'custom' },
    { key: 'customBio', label: 'Biography', type: 'textarea', condition: (settings) => settings.source === 'custom' },
    { key: 'showAvatar', label: 'Picture', type: 'toggle' },
    { key: 'showName', label: 'Name', type: 'toggle' },
    { key: 'nameTag', label: 'Name HTML tag', type: 'select', options: headingTags },
    { key: 'showBio', label: 'Biography', type: 'toggle' },
    { key: 'buttonText', label: 'Button text', type: 'text', placeholder: 'All posts' },
    { ...linkControl('link', 'Button link'), condition: (settings) => Boolean(settings.buttonText) },
    { key: 'layout', label: 'Picture position', type: 'select', options: opts(['left', 'Left'], ['top', 'Top'], ['right', 'Right']) },
    alignControl(),
    { key: 'avatarSize', label: 'Picture size (px)', type: 'slider', tab: 'style', min: 32, max: 240 },
    ...textStyle('name', 'Name'),
    ...textStyle('bio', 'Biography'),
  ],
  css: (bag) => ({
    ' .rwpb-author-box': alignCss(bag),
    ' .rwpb-author-avatar': { width: length(bag.avatarSize, 'px'), height: length(bag.avatarSize, 'px') },
    ' .rwpb-author-name': textCss(bag, 'name'),
    ' .rwpb-author-bio': textCss(bag, 'bio'),
  }),
  View: function AuthorBoxView({ node }) {
    const settings = node.settings;
    const post = useCurrentPost();
    const custom = settings.source === 'custom';
    const state = useAsync(!custom && post ? `author:${post.id}` : null, () => fetchAuthorProfile(post!.id));
    const customAvatar = useMediaUrl(settings.customAvatar);
    const link = useLinkProps(settings.link);
    const NameTag = headingTag(settings.nameTag, 'h4');
    if (!custom && !post) return <EditorPlaceholder>Shows the author of the current post.</EditorPlaceholder>;
    if (state.error) return <WidgetError message={state.error} />;
    const author = custom
      ? { display_name: str(settings.customName), avatar_url: customAvatar, bio: str(settings.customBio) }
      : state.data;
    if (!author) return state.loading ? null : <EditorPlaceholder>This page has no author.</EditorPlaceholder>;
    const avatar = safeMediaUrl(author.avatar_url);
    const layout = pick(settings.layout, ['left', 'top', 'right'] as const, 'left');
    return (
      <div className={`rwpb-author-box rwpb-author-${layout}`}>
        {settings.showAvatar !== false && (avatar
          ? <img className="rwpb-author-avatar" src={avatar} alt="" loading="lazy" />
          : <span className="rwpb-author-avatar rwpb-author-initial" aria-hidden="true">{(author.display_name || '?').charAt(0)}</span>)}
        <div className="rwpb-author-text">
          {settings.showName !== false && <NameTag className="rwpb-author-name">{author.display_name}</NameTag>}
          {settings.showBio !== false && author.bio && <p className="rwpb-author-bio">{author.bio}</p>}
          {str(settings.buttonText) && link && <a className="rwpb-button rwpb-button-sm" {...link}>{str(settings.buttonText)}</a>}
        </div>
      </div>
    );
  },
};

// Post Comments ------------------------------------------------------------------------------------------------------------------

export const postComments: WidgetDefinition = {
  type: 'post-comments',
  label: 'Post Comments',
  icon: 'message',
  category: 'site',
  keywords: ['comments', 'discussion', 'replies'],
  defaults: () => ({ settings: {} }),
  controls: [],
  View: function PostCommentsView() {
    const { mode } = useRenderContext();
    const post = useCurrentPost();
    const site = useSiteSettings();
    const open = useAsync(post ? `comments-open:${post.id}` : null, async () => {
      const { data } = await getSupabaseClient().from('pages').select('comments_open').eq('id', post!.id).maybeSingle();
      return (data as { comments_open?: boolean } | null)?.comments_open !== false;
    });
    if (mode === 'edit') return <div className="rwpb-placeholder"><Icon name="message" size={16} /> The comments of this page appear here on the live site. They follow the site&apos;s comment settings (on/off, moderation, nesting) and this page&apos;s “Allow comments” option.</div>;
    if (!post || !site || open.data === null) return null;
    if (!site.comments_enabled) return null;
    return (
      <div className="rwpb-post-comments">
        <CommentSection pageId={post.id} commentsOpen={open.data} moderated={site.comment_moderation} maxDepth={site.comment_max_depth} />
      </div>
    );
  },
};

// Post Navigation ---------------------------------------------------------------------------------------------------------------------

export const postNavigation: WidgetDefinition = {
  type: 'post-navigation',
  label: 'Post Navigation',
  icon: 'signpost',
  category: 'site',
  keywords: ['next post', 'previous post', 'pagination'],
  defaults: () => ({ settings: { showLabel: true, prevLabel: 'Previous', nextLabel: 'Next', showTitle: true, showArrows: true, sameCategory: false } }),
  controls: [
    { key: 'showLabel', label: 'Labels', type: 'toggle' },
    { key: 'prevLabel', label: 'Previous label', type: 'text', condition: (settings) => Boolean(settings.showLabel) },
    { key: 'nextLabel', label: 'Next label', type: 'text', condition: (settings) => Boolean(settings.showLabel) },
    { key: 'showTitle', label: 'Post titles', type: 'toggle' },
    { key: 'showArrows', label: 'Arrows', type: 'toggle' },
    { key: 'sameCategory', label: 'Stay in the same category', type: 'toggle' },
    { key: 'showDivider', label: 'Divider between', type: 'toggle', tab: 'style' },
    ...textStyle('label', 'Label'),
    ...textStyle('title', 'Title'),
    colorControl('arrowColor', 'Arrow colour'),
  ],
  css: (bag) => ({
    ' .rwpb-post-nav': { '--rwpb-post-nav-divider': bag.showDivider ? '1px solid #e2e8f0' : undefined },
    ' .rwpb-post-nav-label': textCss(bag, 'label'),
    ' .rwpb-post-nav-title': textCss(bag, 'title'),
    ' .rwpb-post-nav svg': { color: color(bag.arrowColor) },
  }),
  View: function PostNavigationView({ node }) {
    const post = useCurrentPost();
    const settings = node.settings;
    const state = useAsync(post ? `adjacent:${post.id}:${post.created_at}:${Boolean(settings.sameCategory)}` : null, async () => {
      const categoryId = settings.sameCategory ? await fetchPageCategoryId(post!.id) : null;
      return fetchAdjacentPosts({ id: post!.id, created_at: post!.created_at }, categoryId);
    });
    if (!post) return <EditorPlaceholder>Links to the previous and next posts.</EditorPlaceholder>;
    if (state.error) return <WidgetError message={state.error} />;
    if (!state.data) return null;
    const { previous, next } = state.data;
    if (!previous && !next) return <EditorPlaceholder>There is no earlier or later published post.</EditorPlaceholder>;
    const side = (target: typeof previous, direction: 'prev' | 'next') => (
      <div className={`rwpb-post-nav-${direction}`}>
        {target && (
          <a href={`/${target.slug}`} rel={direction}>
            {settings.showArrows !== false && direction === 'prev' && <Icon name="chevron-left" size={22} />}
            <span className="rwpb-post-nav-text">
              {settings.showLabel !== false && <span className="rwpb-post-nav-label">{str(direction === 'prev' ? settings.prevLabel : settings.nextLabel, direction === 'prev' ? 'Previous' : 'Next')}</span>}
              {settings.showTitle !== false && <span className="rwpb-post-nav-title">{target.title}</span>}
            </span>
            {settings.showArrows !== false && direction === 'next' && <Icon name="chevron-right" size={22} />}
          </a>
        )}
      </div>
    );
    return (
      <nav className="rwpb-post-nav" aria-label="More posts">
        {side(previous, 'prev')}
        {side(next, 'next')}
      </nav>
    );
  },
};

// Archive Title and Archive Posts -----------------------------------------------------------------------------------------------------

export const archiveTitle: WidgetDefinition = {
  type: 'archive-title',
  label: 'Archive Title',
  icon: 'heading',
  category: 'site',
  keywords: ['category title', 'search results title', 'author archive', 'date archive'],
  defaults: () => ({ settings: { tag: 'h1', categoryPrefix: 'Category: ', authorPrefix: 'Author: ', datePrefix: 'Archives: ', searchPrefix: 'Search results for: ', fallback: 'page' } }),
  controls: [
    { key: 'categoryPrefix', label: 'Category prefix', type: 'text' },
    { key: 'authorPrefix', label: 'Author prefix', type: 'text' },
    { key: 'datePrefix', label: 'Date prefix', type: 'text' },
    { key: 'searchPrefix', label: 'Search prefix', type: 'text' },
    { key: 'fallback', label: 'On other pages show', type: 'select', options: opts(['page', 'The page title'], ['custom', 'Custom text'], ['nothing', 'Nothing']) },
    { key: 'fallbackText', label: 'Custom text', type: 'text', dynamic: true, condition: (settings) => settings.fallback === 'custom' },
    { key: 'tag', label: 'HTML tag', type: 'select', options: headingTags },
    alignControl(),
    colorControl('color', 'Colour'),
    typographyControl(),
  ],
  css: (bag) => ({ '': alignCss(bag), ' .rwpb-archive-title': { color: color(bag.color), ...typography(bag.typography as Typography | undefined) } }),
  View: function ArchiveTitleView({ node }) {
    const post = useCurrentPost();
    const archive = useTemplateContext()?.archive;
    const Tag = headingTag(node.settings.tag, 'h2');
    // An archive template (/category/news, /search?s=…) knows what it lists; ordinary pages read ?category= and ?s=.
    const slug = archive ? (archive.kind === 'category' ? archive.slug : '') : urlParam('category');
    const term = archive ? (archive.kind === 'search' ? archive.term : '') : urlParam('s');
    const authorId = archive?.kind === 'author' ? archive.id : '';
    const categories = useAsync(slug ? 'categories-list' : null, fetchCategories);
    const author = useAsync(authorId ? `author-name:${authorId}` : null, () => fetchAuthorName(authorId));
    const fallbackText = useText(node.settings.fallbackText);
    let text = '';
    if (archive?.kind === 'search' || term) text = `${str(node.settings.searchPrefix)}${term}`;
    else if (slug) text = categories.data ? `${str(node.settings.categoryPrefix)}${categories.data.find((category) => category.slug === slug)?.name || slug}` : '';
    else if (authorId) text = author.data !== null ? `${str(node.settings.authorPrefix)}${author.data || 'Unknown author'}` : '';
    else if (archive?.kind === 'date') text = `${str(node.settings.datePrefix)}${archive.month ? `${new Date(2000, archive.month - 1, 1).toLocaleString(undefined, { month: 'long' })} ` : ''}${archive.year}`;
    else if (node.settings.fallback === 'custom') text = fallbackText;
    else if (node.settings.fallback !== 'nothing') text = post?.title || '';
    if (!text) return <EditorPlaceholder>Shows “Category: News”, “Author: …”, “Archives: May 2026” or “Search results for: …” on archive and search pages.</EditorPlaceholder>;
    return <Tag className="rwpb-archive-title">{text}</Tag>;
  },
};

const NO_MATCH = '00000000-0000-0000-0000-000000000000';

/** The Posts widget, filtered by the archive template being shown, or by ?category=slug and ?s=term in the URL. */
export const archivePosts: WidgetDefinition = {
  ...posts,
  type: 'archive-posts',
  label: 'Archive Posts',
  icon: 'newspaper',
  category: 'site',
  keywords: ['archive', 'category page', 'search results', 'blog'],
  controls: posts.controls.map((control) => (control.key === 'categoryId'
    ? { ...control, label: 'Category when the URL has none', help: 'Visitors see the category in ?category=slug and the search in ?s=term when the page URL has them, e.g. /blog?category=news.' }
    : control)),
  View: function ArchivePostsView({ node }) {
    const { mode } = useRenderContext();
    const archive = useTemplateContext()?.archive;
    const fromUrl = mode === 'view' && !archive;
    const slug = archive?.kind === 'category' ? archive.slug : fromUrl ? urlParam('category') : '';
    // A search template with an empty term matches nothing rather than listing every post.
    const term = archive?.kind === 'search' ? (archive.term.trim() || NO_MATCH) : fromUrl ? urlParam('s') : '';
    const extra = useMemo(() => {
      if (archive?.kind === 'author') return { authorId: archive.id };
      if (archive?.kind === 'date') {
        const from = new Date(Date.UTC(archive.year, (archive.month || 1) - 1, 1));
        const to = archive.month ? new Date(Date.UTC(archive.year, archive.month, 1)) : new Date(Date.UTC(archive.year + 1, 0, 1));
        return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
      }
      return {};
    }, [archive]);
    const categories = useAsync(slug ? 'categories-list' : null, fetchCategories);
    const [settings, setSettings] = useState<Record<string, unknown> | null>(slug ? null : { ...node.settings, ...extra, search: term });
    useEffect(() => {
      if (!slug) { setSettings({ ...node.settings, ...extra, search: term }); return; }
      if (!categories.data) return;
      // An unknown slug must show nothing, not every post.
      const categoryId = categories.data.find((category) => category.slug === slug)?.id || NO_MATCH;
      setSettings({ ...node.settings, ...extra, categoryId, search: term });
    }, [slug, term, extra, categories.data, node.settings]);
    if (categories.error) return <WidgetError message={categories.error} />;
    if (!settings) return null;
    const PostsView = posts.View;
    return <PostsView node={{ ...node, settings }} />;
  },
};

// Breadcrumbs -----------------------------------------------------------------------------------------------------------------------------

export const breadcrumbs: WidgetDefinition = {
  type: 'breadcrumbs',
  label: 'Breadcrumbs',
  icon: 'chevron-right',
  category: 'site',
  keywords: ['breadcrumb', 'trail', 'navigation', 'seo'],
  defaults: () => ({ settings: { homeLabel: 'Home', separator: '›', showCategory: true, showCurrent: true, schema: true } }),
  controls: [
    { key: 'homeLabel', label: 'Home label', type: 'text' },
    { key: 'separator', label: 'Separator', type: 'text' },
    { key: 'showCategory', label: 'Category', type: 'toggle' },
    { key: 'showCurrent', label: 'Current page', type: 'toggle' },
    { key: 'schema', label: 'BreadcrumbList structured data', type: 'toggle' },
    alignControl(),
    colorControl('textColor', 'Text colour'),
    colorControl('linkColor', 'Link colour'),
    colorControl('separatorColor', 'Separator colour'),
    typographyControl(),
  ],
  css: (bag) => ({
    ' .rwpb-breadcrumbs ol': { 'justify-content': alignToFlex(bag.align), color: color(bag.textColor), ...typography(bag.typography as Typography | undefined) },
    ' .rwpb-breadcrumbs a': { color: color(bag.linkColor) },
    ' .rwpb-breadcrumbs-sep': { color: color(bag.separatorColor) },
  }),
  View: function BreadcrumbsView({ node }) {
    const { mode } = useRenderContext();
    const post = useCurrentPost();
    const settings = node.settings;
    const trail: Array<{ label: string; href?: string }> = [{ label: str(settings.homeLabel, 'Home'), href: '/' }];
    if (post && settings.showCategory !== false && post.category_name) trail.push({ label: post.category_name, href: `/?category=${encodeURIComponent(post.category_slug)}` });
    if (post && settings.showCurrent !== false) trail.push({ label: post.title });
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    const schema = settings.schema && mode === 'view' ? JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: trail.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.label, ...(item.href ? { item: `${origin}${item.href}` } : {}) })),
    }).replace(/</g, '\\u003c') : '';
    return (
      <nav className="rwpb-breadcrumbs" aria-label="Breadcrumb">
        <ol>
          {trail.map((item, index) => (
            <li key={`${item.label}-${index}`}>
              {index > 0 && <span className="rwpb-breadcrumbs-sep" aria-hidden="true">{str(settings.separator, '›')}</span>}
              {item.href ? <a href={item.href}>{item.label}</a> : <span aria-current="page">{item.label}</span>}
            </li>
          ))}
        </ol>
        {schema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema }} />}
      </nav>
    );
  },
};

// Sitemap ----------------------------------------------------------------------------------------------------------------------------

export const sitemap: WidgetDefinition = {
  type: 'sitemap',
  label: 'Sitemap',
  icon: 'network',
  category: 'site',
  keywords: ['site map', 'all pages', 'index', 'html sitemap'],
  defaults: () => ({ settings: { showPages: true, showPosts: true, showCategories: true, pagesTitle: 'Pages', postsTitle: 'Posts', categoriesTitle: 'Categories', orderBy: 'title', limit: 100, showDates: false }, style: { columns: 3 } }),
  controls: [
    { key: 'showPages', label: 'Pages', type: 'toggle' },
    { key: 'pagesTitle', label: 'Pages heading', type: 'text', condition: (settings) => Boolean(settings.showPages) },
    { key: 'showPosts', label: 'Posts', type: 'toggle' },
    { key: 'postsTitle', label: 'Posts heading', type: 'text', condition: (settings) => Boolean(settings.showPosts) },
    { key: 'showCategories', label: 'Categories', type: 'toggle' },
    { key: 'categoriesTitle', label: 'Categories heading', type: 'text', condition: (settings) => Boolean(settings.showCategories) },
    { key: 'orderBy', label: 'Order by', type: 'select', options: opts(['title', 'Title (A–Z)'], ['created_at', 'Newest first']) },
    { key: 'limit', label: 'Maximum items per list', type: 'number', min: 1, max: 1000 },
    { key: 'showDates', label: 'Dates next to posts', type: 'toggle' },
    { key: 'columns', label: 'Columns', type: 'slider', store: 'style', responsive: true, min: 1, max: 4 },
    ...textStyle('heading', 'Heading'),
    colorControl('linkColor', 'Link colour'),
  ],
  css: (bag) => ({
    ' .rwpb-sitemap': { 'grid-template-columns': `repeat(${clamp(Math.round(num(bag.columns, 3)), 1, 4)}, minmax(0, 1fr))` },
    ' .rwpb-sitemap-heading': textCss(bag, 'heading'),
    ' .rwpb-sitemap a': { color: color(bag.linkColor) },
  }),
  View: function SitemapView({ node }) {
    const settings = node.settings;
    const limit = clamp(Math.round(num(settings.limit, 100)), 1, 1000);
    const byTitle = settings.orderBy !== 'created_at';
    const state = useAsync(JSON.stringify(['sitemap', settings.showPages, settings.showPosts, settings.showCategories, limit, byTitle]), async () => {
      const [pages, postLinks, categories] = await Promise.all([
        settings.showPages !== false ? fetchPostLinks({ pages: true, limit, orderBy: byTitle ? 'title' : 'created_at', ascending: byTitle }) : Promise.resolve([]),
        settings.showPosts !== false ? fetchPostLinks({ limit, orderBy: byTitle ? 'title' : 'created_at', ascending: byTitle }) : Promise.resolve([]),
        settings.showCategories !== false ? fetchCategories() : Promise.resolve([]),
      ]);
      return { pages, posts: postLinks, categories };
    });
    if (state.error) return <WidgetError message={state.error} />;
    if (!state.data) return null;
    const sections = [
      settings.showPages !== false && { key: 'pages', title: str(settings.pagesTitle, 'Pages'), items: state.data.pages.map((page) => ({ id: String(page.id), label: page.title, href: `/${page.slug}`, date: '' })) },
      settings.showPosts !== false && { key: 'posts', title: str(settings.postsTitle, 'Posts'), items: state.data.posts.map((post) => ({ id: String(post.id), label: post.title, href: `/${post.slug}`, date: settings.showDates ? formatDate(post.created_at) : '' })) },
      settings.showCategories !== false && { key: 'categories', title: str(settings.categoriesTitle, 'Categories'), items: state.data.categories.slice(0, limit).map((category) => ({ id: category.id, label: category.name, href: `/?category=${encodeURIComponent(category.slug)}`, date: '' })) },
    ].filter(Boolean) as Array<{ key: string; title: string; items: Array<{ id: string; label: string; href: string; date: string }> }>;
    if (!sections.length) return <EditorPlaceholder>Turn on pages, posts or categories in the Content tab.</EditorPlaceholder>;
    return (
      <div className="rwpb-sitemap">
        {sections.map((section) => (
          <section key={section.key} className="rwpb-sitemap-section">
            {section.title && <h2 className="rwpb-sitemap-heading">{section.title}</h2>}
            {section.items.length ? (
              <ul>{section.items.map((item) => <li key={item.id}><a href={item.href}>{item.label}</a>{item.date && <span className="rwpb-sitemap-date"> {item.date}</span>}</li>)}</ul>
            ) : <p className="rwpb-muted">Nothing published yet.</p>}
          </section>
        ))}
      </div>
    );
  },
};
