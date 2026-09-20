import { useEffect, useState } from 'react';
import { describeDbError, getSupabaseClient } from './db';
import { sanitizeTrackingHtml } from './scriptSanitizer.js';

/**
 * Appearance → Theme Editor. The whole theme is one row in public.theme_settings: a block
 * layout per structural area (layout_structure) plus the raw code from each area's Code mode.
 *
 * The public site always renders through the layout, and the default layout reproduces the
 * header, footer, sidebar, comments and home page as they were before the editor existed, so a
 * site that never opens the editor (or has not run the migration) looks the same.
 *
 * Layout JSON is public and editable by hand in Code mode, so everything read from it goes
 * through normalizeLayout: unknown block types, settings and containers are dropped.
 */

export const themeMigration = 'supabase/migrations/20260922_theme_editor.sql';

export type ThemeAreaId = 'header' | 'footer' | 'sidebar' | 'comments' | 'index';

export const themeAreaIds: ThemeAreaId[] = ['header', 'footer', 'sidebar', 'comments', 'index'];

export const themeAreaLabels: Record<ThemeAreaId, string> = {
  header: 'Header',
  footer: 'Footer',
  sidebar: 'Sidebar',
  comments: 'Comments',
  index: 'Layout / Index',
};

// Blocks -----------------------------------------------------------------------------------

export type ThemeBlockType =
  | 'site-logo' | 'primary-menu' | 'search' | 'header-actions' | 'social-icons' | 'custom-html' | 'text' | 'area-code'
  | 'widget-area' | 'copyright' | 'menu' | 'recent-posts' | 'categories' | 'login'
  | 'comments-list' | 'comment-form' | 'comments-pagination' | 'discussion-rules'
  | 'hero' | 'posts-feed' | 'posts-pagination';

export type BlockSettingValue = string | number | boolean;
export type BlockSettings = Record<string, BlockSettingValue>;

export type BlockAlign = 'inherit' | 'left' | 'center' | 'right';

export interface BlockStyle {
  align: BlockAlign;
  /** Pixels on all sides. */
  padding: number;
  background: string;
  color: string;
  visible: boolean;
  hide_mobile: boolean;
  hide_desktop: boolean;
}

export interface ThemeBlock {
  id: string;
  type: ThemeBlockType;
  settings: BlockSettings;
  style: BlockStyle;
}

export interface ThemeContainer {
  id: string;
  blocks: ThemeBlock[];
}

export type BlockFieldKind = 'text' | 'textarea' | 'html' | 'number' | 'checkbox' | 'select' | 'menu' | 'url';

export interface BlockField {
  key: string;
  label: string;
  kind: BlockFieldKind;
  help?: string;
  options?: Array<[string, string]>;
  min?: number;
  max?: number;
}

export interface BlockDefinition {
  type: ThemeBlockType;
  label: string;
  icon: string;
  description: string;
  areas: ThemeAreaId[];
  /** At most one per area: the block owns something singular (the comment form, the post feed). */
  unique?: boolean;
  defaults: BlockSettings;
  fields: BlockField[];
}

const titleField: BlockField = { key: 'title', label: 'Heading', kind: 'text', help: 'Leave blank for no heading.' };
const placeholderHelp = 'You can use {site_title}, {site_tagline} and {year}.';

export const socialNetworks: Array<[string, string]> = [
  ['facebook', 'Facebook'], ['x', 'X (Twitter)'], ['instagram', 'Instagram'],
  ['linkedin', 'LinkedIn'], ['youtube', 'YouTube'], ['github', 'GitHub'],
];

export const blockDefinitions: BlockDefinition[] = [
  {
    type: 'site-logo', label: 'Site title / logo', icon: '🏷️', areas: ['header', 'footer'],
    description: 'The logo, title and tagline set under Settings → Site.', defaults: {}, fields: [],
  },
  {
    type: 'primary-menu', label: 'Navigation menu', icon: '🧭', areas: ['header'], unique: true,
    description: 'A menu with dropdowns and a mobile toggle.',
    defaults: { menu_id: '' },
    fields: [{ key: 'menu_id', label: 'Menu', kind: 'menu', help: 'The primary menu is the one edited under Menus → Menus.' }],
  },
  {
    type: 'search', label: 'Search bar', icon: '🔍', areas: ['header', 'footer', 'sidebar'],
    description: 'Searches posts on the home page.',
    defaults: { title: '', placeholder: 'Search posts…' },
    fields: [titleField, { key: 'placeholder', label: 'Placeholder', kind: 'text' }],
  },
  {
    type: 'header-actions', label: 'Header action buttons', icon: '🔘', areas: ['header'], unique: true,
    description: 'Register and log in links, the language switcher, plus buttons plugins add to the header (such as the cart).',
    defaults: { show_register: true, show_login: true, show_plugin_items: true, show_language_switcher: true },
    fields: [
      { key: 'show_register', label: 'Show Register', kind: 'checkbox', help: 'Only when registration is open under Settings → Accounts.' },
      { key: 'show_login', label: 'Show Log in / account', kind: 'checkbox' },
      { key: 'show_plugin_items', label: 'Show plugin buttons', kind: 'checkbox' },
      {
        key: 'show_language_switcher', label: 'Show the language switcher', kind: 'checkbox',
        help: 'Only when the site offers more than one language and Settings → Languages allows it.',
      },
    ],
  },
  {
    type: 'social-icons', label: 'Social links', icon: '🔗', areas: ['header', 'footer', 'sidebar'],
    description: 'Links to your social profiles. Empty ones are hidden.',
    defaults: { title: '', ...Object.fromEntries(socialNetworks.map(([key]) => [key, ''])) },
    fields: [titleField, ...socialNetworks.map(([key, label]): BlockField => ({ key, label, kind: 'url' }))],
  },
  {
    type: 'custom-html', label: 'Custom HTML box', icon: '🧱', areas: ['header', 'footer', 'sidebar', 'comments', 'index'],
    description: 'Your own markup. Scripts and event handlers are removed; shortcodes work.',
    defaults: { title: '', html: '' },
    fields: [titleField, { key: 'html', label: 'HTML', kind: 'html' }],
  },
  {
    type: 'text', label: 'Text', icon: '📝', areas: ['header', 'footer', 'sidebar', 'comments', 'index'],
    description: 'A short line of plain text.',
    defaults: { text: '' },
    fields: [{ key: 'text', label: 'Text', kind: 'textarea', help: placeholderHelp }],
  },
  {
    type: 'area-code', label: 'Code snippet (Code mode)', icon: '💻', areas: ['header', 'footer', 'sidebar'], unique: true,
    description: 'Places the HTML written in this area\'s Code mode. Without this block it goes at the end.',
    defaults: {}, fields: [],
  },
  {
    type: 'widget-area', label: 'Widget area', icon: '🧩', areas: ['footer', 'sidebar'],
    description: 'The widgets arranged under Menus → Sidebar & Widgets.',
    defaults: { source: 'sidebar' },
    fields: [{ key: 'source', label: 'Widgets from', kind: 'select', options: [['sidebar', 'Sidebar widgets'], ['footer', 'Footer widgets']] }],
  },
  {
    type: 'copyright', label: 'Copyright text', icon: '©️', areas: ['footer'],
    description: 'Defaults to © year and the site title.',
    defaults: { text: '© {year} {site_title}' },
    fields: [{ key: 'text', label: 'Text', kind: 'text', help: placeholderHelp }],
  },
  {
    type: 'menu', label: 'Menu links', icon: '📋', areas: ['footer', 'sidebar'],
    description: 'A list of links from one of your menus.',
    defaults: { title: '', menu_id: '' },
    fields: [titleField, { key: 'menu_id', label: 'Menu', kind: 'menu' }],
  },
  {
    type: 'recent-posts', label: 'Recent posts', icon: '🕒', areas: ['footer', 'sidebar'],
    description: 'Links to your latest posts.',
    defaults: { title: 'Recent Posts', count: 5 },
    fields: [titleField, { key: 'count', label: 'Number of posts', kind: 'number', min: 1, max: 20 }],
  },
  {
    type: 'categories', label: 'Category list', icon: '🗂️', areas: ['footer', 'sidebar'],
    description: 'Every category, with optional post counts.',
    defaults: { title: 'Categories', show_counts: true },
    fields: [titleField, { key: 'show_counts', label: 'Show post counts', kind: 'checkbox' }],
  },
  {
    type: 'login', label: 'Login / account', icon: '🔐', areas: ['footer', 'sidebar'],
    description: 'A sign-in button, or account details when signed in.',
    defaults: { title: '', label: '', style: 'button' },
    fields: [
      titleField,
      { key: 'label', label: 'Button label', kind: 'text' },
      { key: 'style', label: 'Style', kind: 'select', options: [['button', 'Button'], ['link', 'Link']] },
    ],
  },
  {
    type: 'comments-list', label: 'Comments list', icon: '💬', areas: ['comments'], unique: true,
    description: 'The approved comments, with replies.', defaults: {}, fields: [],
  },
  {
    type: 'comment-form', label: 'Comment form', icon: '✍️', areas: ['comments'], unique: true,
    description: 'Where signed-in readers write a comment. Without it, only replies are possible.',
    defaults: { placeholder: 'Join the discussion…' },
    fields: [{ key: 'placeholder', label: 'Placeholder', kind: 'text' }],
  },
  {
    type: 'comments-pagination', label: 'Comments pagination', icon: '📄', areas: ['comments'], unique: true,
    description: 'Page links for long discussions. Set comments per page in the area settings.', defaults: {}, fields: [],
  },
  {
    type: 'discussion-rules', label: 'Discussion rules', icon: '📜', areas: ['comments'],
    description: 'A short note about how to comment.',
    defaults: { title: 'Discussion rules', text: 'Be kind, stay on topic, and do not share personal information.' },
    fields: [titleField, { key: 'text', label: 'Rules', kind: 'textarea' }],
  },
  {
    type: 'hero', label: 'Hero section', icon: '🌅', areas: ['index'],
    description: 'A large welcome banner with a button.',
    defaults: {
      kicker: 'A fresh start',
      heading: 'Welcome to {site_title}',
      text: 'This is your new React-WP website. Customize this homepage, publish your first post, and make it yours from the Admin Dashboard.',
      button_label: 'Go to Admin Dashboard',
      button_url: '/admin',
      full_width: true,
    },
    fields: [
      { key: 'kicker', label: 'Small heading', kind: 'text' },
      { key: 'heading', label: 'Heading', kind: 'text', help: placeholderHelp },
      { key: 'text', label: 'Text', kind: 'textarea', help: placeholderHelp },
      { key: 'button_label', label: 'Button label', kind: 'text', help: 'Leave blank for no button.' },
      { key: 'button_url', label: 'Button link', kind: 'url' },
    ],
  },
  {
    type: 'posts-feed', label: 'Main content feed', icon: '📰', areas: ['index'], unique: true,
    description: 'Your latest posts, filtered by the search bar.',
    defaults: {
      kicker: 'From the blog', heading: 'Latest posts', show_excerpt: true, show_meta: true,
      read_more: 'Read More', columns: 1, full_width: false,
    },
    fields: [
      { key: 'kicker', label: 'Small heading', kind: 'text' },
      { key: 'heading', label: 'Heading', kind: 'text' },
      { key: 'columns', label: 'Columns', kind: 'number', min: 1, max: 3 },
      { key: 'show_excerpt', label: 'Show excerpts', kind: 'checkbox' },
      { key: 'show_meta', label: 'Show post date (post meta)', kind: 'checkbox', help: 'Also needs Show publish dates under Settings → General.' },
      { key: 'read_more', label: 'Read more label', kind: 'text' },
    ],
  },
  {
    type: 'posts-pagination', label: 'Pagination', icon: '🔢', areas: ['index'], unique: true,
    description: 'Page links for the post feed. Pick the style in the area settings.',
    defaults: { full_width: false }, fields: [],
  },
];

const definitionsByType = new Map(blockDefinitions.map((definition) => [definition.type, definition]));

export const getBlockDefinition = (type: string): BlockDefinition | undefined =>
  definitionsByType.get(type as ThemeBlockType);

export const blocksForArea = (area: ThemeAreaId) => blockDefinitions.filter((definition) => definition.areas.includes(area));

export const defaultBlockStyle: BlockStyle = {
  align: 'inherit', padding: 0, background: '', color: '', visible: true, hide_mobile: false, hide_desktop: false,
};

// Areas ------------------------------------------------------------------------------------

export interface HeaderOptions { sticky: boolean }
export interface FooterOptions { columns: number }
export interface SidebarOptions { sticky: boolean }
export interface CommentsOptions {
  show_avatars: boolean;
  nested_replies: boolean;
  /** Top-level comments per page; 0 shows all. Needs the Comments pagination block. */
  per_page: number;
  order: 'oldest' | 'newest';
}
export interface IndexOptions {
  sidebar_position: 'right' | 'left' | 'hidden';
  pagination_style: 'numbered' | 'prev-next' | 'load-more';
}

export interface AreaLayout<O> {
  containers: ThemeContainer[];
  options: O;
}

export interface ThemeLayout {
  version: 1;
  header: AreaLayout<HeaderOptions>;
  footer: AreaLayout<FooterOptions>;
  sidebar: AreaLayout<SidebarOptions>;
  comments: AreaLayout<CommentsOptions>;
  index: AreaLayout<IndexOptions>;
}

export type AnyAreaLayout = ThemeLayout[ThemeAreaId];

export const maxFooterColumns = 4;

/** Container ids for an area. Footer columns come first, then the bottom bar. */
export const containerIdsFor = (area: ThemeAreaId, options?: { columns?: number }): string[] => {
  if (area !== 'footer') return ['main'];
  const columns = clampInt(options?.columns, 1, maxFooterColumns, 1);
  return [...Array.from({ length: columns }, (_, index) => `col-${index + 1}`), 'bottom'];
};

export const containerLabel = (area: ThemeAreaId, containerId: string): string => {
  if (area === 'footer') return containerId === 'bottom' ? 'Bottom bar' : `Column ${containerId.replace('col-', '')}`;
  return themeAreaLabels[area];
};

/** Header and the footer's bottom bar lay blocks out in a row; everything else stacks. */
export const containerDirection = (area: ThemeAreaId, containerId: string): 'row' | 'column' =>
  area === 'header' || (area === 'footer' && containerId === 'bottom') ? 'row' : 'column';

const block = (id: string, type: ThemeBlockType, settings: BlockSettings = {}, style: Partial<BlockStyle> = {}): ThemeBlock => ({
  id,
  type,
  settings: { ...getBlockDefinition(type)!.defaults, ...settings },
  style: { ...defaultBlockStyle, ...style },
});

/** Ids are fixed so an untouched default layout compares equal to a freshly built one. */
export const defaultAreaLayout = (area: ThemeAreaId): AnyAreaLayout => {
  switch (area) {
    case 'header':
      return {
        containers: [{ id: 'main', blocks: [
          block('default-site-logo', 'site-logo'),
          block('default-primary-menu', 'primary-menu', {}, { align: 'right' }),
          block('default-header-actions', 'header-actions'),
        ] }],
        options: { sticky: false },
      };
    case 'footer':
      return {
        containers: [
          { id: 'col-1', blocks: [block('default-footer-widgets', 'widget-area', { source: 'footer' })] },
          { id: 'bottom', blocks: [
            block('default-copyright', 'copyright'),
            block('default-powered-by', 'text', { text: 'Powered by React-WP & Supabase' }),
          ] },
        ],
        options: { columns: 1 },
      };
    case 'sidebar':
      return {
        containers: [{ id: 'main', blocks: [block('default-sidebar-widgets', 'widget-area', { source: 'sidebar' })] }],
        options: { sticky: false },
      };
    case 'comments':
      return {
        containers: [{ id: 'main', blocks: [block('default-comments-list', 'comments-list'), block('default-comment-form', 'comment-form')] }],
        options: { show_avatars: true, nested_replies: true, per_page: 0, order: 'oldest' },
      };
    case 'index':
    default:
      return {
        containers: [{ id: 'main', blocks: [block('default-hero', 'hero'), block('default-posts-feed', 'posts-feed')] }],
        options: { sidebar_position: 'right', pagination_style: 'numbered' },
      };
  }
};

export const defaultLayout = (): ThemeLayout => ({
  version: 1,
  header: defaultAreaLayout('header') as ThemeLayout['header'],
  footer: defaultAreaLayout('footer') as ThemeLayout['footer'],
  sidebar: defaultAreaLayout('sidebar') as ThemeLayout['sidebar'],
  comments: defaultAreaLayout('comments') as ThemeLayout['comments'],
  index: defaultAreaLayout('index') as ThemeLayout['index'],
});

// Normalisation ----------------------------------------------------------------------------

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {});

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly unknown[]).includes(value) ? value as T : fallback;

// Colours go into React style objects, which cannot break out of the property, but a value the
// browser rejects silently would look like a bug in the editor.
const colorPattern = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(rgb|rgba|hsl|hsla)\([\d\s.,%/]+\)|var\(--[\w-]+\))$/i;
export const cleanColor = (value: unknown): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  return colorPattern.test(text) ? text : '';
};

/** http(s), site-relative, mailto: and tel: links only; anything else (javascript:) becomes empty. */
export const cleanUrl = (value: unknown): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return /^(https?:\/\/|\/(?!\/)|#|mailto:|tel:)/i.test(text) ? text.slice(0, 2000) : '';
};

const normalizeSettings = (definition: BlockDefinition, raw: unknown): BlockSettings => {
  const source = asObject(raw);
  const settings: BlockSettings = {};
  Object.entries(definition.defaults).forEach(([key, fallback]) => {
    const value = source[key];
    const field = definition.fields.find((item) => item.key === key);
    if (typeof fallback === 'boolean') {
      settings[key] = typeof value === 'boolean' ? value : fallback;
    } else if (typeof fallback === 'number') {
      settings[key] = clampInt(value, field?.min ?? 0, field?.max ?? 1000, fallback);
    } else if (typeof value !== 'string') {
      settings[key] = fallback;
    } else if (field?.kind === 'url') {
      settings[key] = cleanUrl(value);
    } else if (field?.kind === 'select' && field.options) {
      settings[key] = field.options.some(([option]) => option === value) ? value : fallback;
    } else {
      settings[key] = value.slice(0, field?.kind === 'html' ? 50000 : 2000);
    }
  });
  return settings;
};

export const normalizeStyle = (raw: unknown): BlockStyle => {
  const style = asObject(raw);
  return {
    align: pick(style.align, ['inherit', 'left', 'center', 'right'] as const, 'inherit'),
    padding: clampInt(style.padding, 0, 200, 0),
    background: cleanColor(style.background),
    color: cleanColor(style.color),
    visible: style.visible !== false,
    hide_mobile: style.hide_mobile === true,
    hide_desktop: style.hide_desktop === true,
  };
};

const normalizeOptions = (area: ThemeAreaId, raw: unknown): AnyAreaLayout['options'] => {
  const options = asObject(raw);
  switch (area) {
    case 'header': return { sticky: options.sticky === true };
    case 'footer': return { columns: clampInt(options.columns, 1, maxFooterColumns, 1) };
    case 'sidebar': return { sticky: options.sticky === true };
    case 'comments': return {
      show_avatars: options.show_avatars !== false,
      nested_replies: options.nested_replies !== false,
      per_page: clampInt(options.per_page, 0, 200, 0),
      order: pick(options.order, ['oldest', 'newest'] as const, 'oldest'),
    };
    case 'index':
    default: return {
      sidebar_position: pick(options.sidebar_position, ['right', 'left', 'hidden'] as const, 'right'),
      pagination_style: pick(options.pagination_style, ['numbered', 'prev-next', 'load-more'] as const, 'numbered'),
    };
  }
};

/**
 * Coerces one area. `problems` collects what was dropped, which Code mode shows to the person
 * editing the JSON. A missing area gets the default; an area with empty containers stays empty,
 * because removing every block is a legitimate choice.
 */
export const normalizeArea = (area: ThemeAreaId, raw: unknown, problems: string[] = []): AnyAreaLayout => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (raw !== undefined) problems.push(`${themeAreaLabels[area]}: expected an object, so the default layout is used.`);
    return defaultAreaLayout(area);
  }
  const source = raw as Json;
  const options = normalizeOptions(area, source.options);
  const rawContainers = Array.isArray(source.containers) ? source.containers.map(asObject) : [];
  if (!Array.isArray(source.containers)) problems.push(`${themeAreaLabels[area]}: "containers" must be an array.`);
  const wanted = containerIdsFor(area, options as { columns?: number });
  const seenIds = new Set<string>();
  const seenUnique = new Set<string>();

  rawContainers.forEach((container) => {
    if (!wanted.includes(String(container.id))) {
      problems.push(`${themeAreaLabels[area]}: container "${String(container.id)}" does not exist here and was dropped${area === 'footer' ? ' (raise the column count to use it)' : ''}.`);
    }
  });

  const containers = wanted.map((id) => {
    const found = rawContainers.find((container) => container.id === id);
    const blocks: ThemeBlock[] = [];
    (Array.isArray(found?.blocks) ? found.blocks : []).forEach((item: unknown, index: number) => {
      const candidate = asObject(item);
      const definition = getBlockDefinition(String(candidate.type));
      const where = `${themeAreaLabels[area]} › ${containerLabel(area, id)} › block ${index + 1}`;
      if (!definition) {
        problems.push(`${where}: unknown block type "${String(candidate.type)}" was dropped.`);
        return;
      }
      if (!definition.areas.includes(area)) {
        problems.push(`${where}: "${definition.label}" cannot be used in the ${themeAreaLabels[area]} area and was dropped.`);
        return;
      }
      if (definition.unique && seenUnique.has(definition.type)) {
        problems.push(`${where}: only one "${definition.label}" is allowed; the extra one was dropped.`);
        return;
      }
      let blockId = typeof candidate.id === 'string' && /^[\w-]{1,80}$/.test(candidate.id) ? candidate.id : '';
      if (!blockId || seenIds.has(blockId)) blockId = newBlockId(definition.type);
      seenIds.add(blockId);
      if (definition.unique) seenUnique.add(definition.type);
      blocks.push({ id: blockId, type: definition.type, settings: normalizeSettings(definition, candidate.settings), style: normalizeStyle(candidate.style) });
    });
    return { id, blocks };
  });

  return { containers, options } as AnyAreaLayout;
};

export const normalizeLayout = (raw: unknown, problems: string[] = []): ThemeLayout => {
  const source = asObject(raw);
  return {
    version: 1,
    header: normalizeArea('header', source.header, problems) as ThemeLayout['header'],
    footer: normalizeArea('footer', source.footer, problems) as ThemeLayout['footer'],
    sidebar: normalizeArea('sidebar', source.sidebar, problems) as ThemeLayout['sidebar'],
    comments: normalizeArea('comments', source.comments, problems) as ThemeLayout['comments'],
    index: normalizeArea('index', source.index, problems) as ThemeLayout['index'],
  };
};

// Layout state operations (pure: the editor's reducer is built from these) ---------------------

export function newBlockId(type: string): string {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const createBlock = (type: ThemeBlockType, settings: BlockSettings = {}): ThemeBlock =>
  block(newBlockId(type), type, settings);

export const findBlock = (layout: AnyAreaLayout, blockId: string): { containerId: string; index: number; block: ThemeBlock } | null => {
  for (const container of layout.containers) {
    const index = container.blocks.findIndex((item) => item.id === blockId);
    if (index >= 0) return { containerId: container.id, index, block: container.blocks[index] };
  }
  return null;
};

export const areaHasType = (layout: AnyAreaLayout, type: ThemeBlockType) =>
  layout.containers.some((container) => container.blocks.some((item) => item.type === type));

const withContainers = <L extends AnyAreaLayout>(layout: L, update: (containers: ThemeContainer[]) => ThemeContainer[]): L =>
  ({ ...layout, containers: update(layout.containers.map((container) => ({ ...container, blocks: [...container.blocks] }))) });

/** Inserts a new block. Refuses (returns the layout unchanged) when a unique block is already there. */
export const insertBlock = <L extends AnyAreaLayout>(layout: L, area: ThemeAreaId, item: ThemeBlock, containerId: string, index: number): L => {
  const definition = getBlockDefinition(item.type);
  if (!definition?.areas.includes(area)) return layout;
  if (definition.unique && areaHasType(layout, item.type)) return layout;
  return withContainers(layout, (containers) => {
    const target = containers.find((container) => container.id === containerId) || containers[0];
    target.blocks.splice(Math.max(0, Math.min(index, target.blocks.length)), 0, item);
    return containers;
  });
};

/**
 * Moves a block. `index` is the drop position in the target container as it looks during the
 * drag, with the block still in its old place, so moving down within a container shifts by one.
 */
export const moveBlock = <L extends AnyAreaLayout>(layout: L, blockId: string, containerId: string, index: number): L => {
  const found = findBlock(layout, blockId);
  if (!found) return layout;
  return withContainers(layout, (containers) => {
    const source = containers.find((container) => container.id === found.containerId)!;
    const target = containers.find((container) => container.id === containerId) || source;
    source.blocks.splice(found.index, 1);
    const adjusted = target === source && found.index < index ? index - 1 : index;
    target.blocks.splice(Math.max(0, Math.min(adjusted, target.blocks.length)), 0, found.block);
    return containers;
  });
};

export const removeBlock = <L extends AnyAreaLayout>(layout: L, blockId: string): L =>
  withContainers(layout, (containers) => containers.map((container) => ({
    ...container, blocks: container.blocks.filter((item) => item.id !== blockId),
  })));

export const duplicateBlock = <L extends AnyAreaLayout>(layout: L, area: ThemeAreaId, blockId: string): L => {
  const found = findBlock(layout, blockId);
  if (!found || getBlockDefinition(found.block.type)?.unique) return layout;
  const copy: ThemeBlock = { ...found.block, id: newBlockId(found.block.type), settings: { ...found.block.settings }, style: { ...found.block.style } };
  return insertBlock(layout, area, copy, found.containerId, found.index + 1);
};

export const updateBlock = <L extends AnyAreaLayout>(
  layout: L, blockId: string, changes: { settings?: BlockSettings; style?: Partial<BlockStyle> },
): L => withContainers(layout, (containers) => containers.map((container) => ({
  ...container,
  blocks: container.blocks.map((item) => {
    if (item.id !== blockId) return item;
    const definition = getBlockDefinition(item.type)!;
    return {
      ...item,
      settings: changes.settings ? normalizeSettings(definition, { ...item.settings, ...changes.settings }) : item.settings,
      style: changes.style ? normalizeStyle({ ...item.style, ...changes.style }) : item.style,
    };
  }),
})));

/** Changing the footer's column count keeps every block: removed columns empty into the last one kept. */
export const setFooterColumns = (layout: ThemeLayout['footer'], columns: number): ThemeLayout['footer'] => {
  const count = clampInt(columns, 1, maxFooterColumns, 1);
  const ids = containerIdsFor('footer', { columns: count });
  const lastKept = `col-${count}`;
  const byId = new Map(layout.containers.map((container) => [container.id, [...container.blocks]]));
  layout.containers.forEach((container) => {
    if (!ids.includes(container.id)) byId.set(lastKept, [...(byId.get(lastKept) || []), ...container.blocks]);
  });
  return { options: { columns: count }, containers: ids.map((id) => ({ id, blocks: byId.get(id) || [] })) };
};

export const fillPlaceholders = (text: string, values: { site_title?: string; site_tagline?: string }) =>
  text
    .replace(/\{year\}/g, String(new Date().getFullYear()))
    .replace(/\{site_title\}/g, values.site_title || '')
    .replace(/\{site_tagline\}/g, values.site_tagline || '');

// Theme row --------------------------------------------------------------------------------

export const themeCodeFields = [
  'custom_header_code', 'custom_header_html', 'custom_footer_code', 'custom_footer_html',
  'custom_sidebar_code', 'custom_comments_css', 'custom_css',
] as const;

export type ThemeCodeField = (typeof themeCodeFields)[number];

export type ThemeCode = Record<ThemeCodeField, string>;

export interface ThemeSettings extends ThemeCode {
  /** null until a row has been read. */
  id: string | null;
  updated_at: string | null;
  active_theme: string;
  layout: ThemeLayout;
}

/** Fields that are <head>/<body> tags (scriptSanitizer.js), not page markup. */
export const scriptFields: ThemeCodeField[] = ['custom_header_code', 'custom_footer_code'];

export const defaultTheme = (): ThemeSettings => ({
  id: null,
  updated_at: null,
  active_theme: 'default',
  layout: defaultLayout(),
  custom_header_code: '',
  custom_header_html: '',
  custom_footer_code: '',
  custom_footer_html: '',
  custom_sidebar_code: '',
  custom_comments_css: '',
  custom_css: '',
});

const rowToTheme = (row: Json): ThemeSettings => {
  const theme = defaultTheme();
  theme.id = typeof row.id === 'string' ? row.id : null;
  theme.updated_at = typeof row.updated_at === 'string' ? row.updated_at : null;
  theme.active_theme = typeof row.active_theme === 'string' && row.active_theme ? row.active_theme : 'default';
  theme.layout = normalizeLayout(row.layout_structure);
  themeCodeFields.forEach((field) => { theme[field] = typeof row[field] === 'string' ? row[field] as string : ''; });
  return theme;
};

const themeToRow = (theme: ThemeSettings) => ({
  active_theme: theme.active_theme,
  layout_structure: theme.layout,
  ...Object.fromEntries(themeCodeFields.map((field) => [field, theme[field]])) as ThemeCode,
});

/** The stylesheet written into the page. server/seo.mjs concatenates the same two columns. */
export const themeStylesheet = (theme: Pick<ThemeSettings, 'custom_css' | 'custom_comments_css'>) =>
  [theme.custom_css, theme.custom_comments_css].filter((part) => part.trim()).join('\n\n');

const isMissingTable = (message: string) => /PGRST205|42P01|schema cache|does not exist/i.test(message);

export class ThemeMigrationMissingError extends Error {
  constructor() {
    super(`The theme_settings table does not exist yet. Run ${themeMigration} in the Supabase SQL Editor, then reload. Until then the site uses the default layout.`);
  }
}

/** For the editor: the saved row, with errors explained. */
export const fetchTheme = async (): Promise<ThemeSettings> => {
  const { data, error } = await getSupabaseClient().from('theme_settings').select('*').limit(1).maybeSingle();
  if (error) {
    const message = describeDbError(error);
    if (isMissingTable(message)) throw new ThemeMigrationMissingError();
    throw new Error(`Could not load the theme: ${message}`);
  }
  return data ? rowToTheme(data as Json) : defaultTheme();
};

const explainSaveError = (error: unknown): Error => {
  const message = describeDbError(error);
  if (isMissingTable(message)) return new ThemeMigrationMissingError();
  if (/row-level security|42501/i.test(message)) {
    return new Error(`The database refused to save the theme: your role needs the manage_options capability (Administrator). (${message})`);
  }
  if (/theme_settings_code_length_check/.test(message)) {
    return new Error('The database rejected the theme: a code field is too long (100,000 characters each, 200,000 for Custom CSS).');
  }
  if (/theme_settings_layout_check/.test(message)) {
    return new Error('The database rejected the theme: the layout JSON is larger than 500 KB.');
  }
  if (/23505|theme_settings_singleton/.test(message)) {
    return new Error('Another administrator created the theme while you were editing. Reload to load their version, then apply your changes again.');
  }
  return new Error(`Could not save the theme: ${message}`);
};

/**
 * Saves only if nobody else saved since `theme` was loaded (updated_at still matches), so two
 * administrators cannot silently overwrite each other. Script fields are stored sanitised.
 */
export const saveTheme = async (theme: ThemeSettings): Promise<ThemeSettings> => {
  const supabase = getSupabaseClient();
  const payload = themeToRow(theme);
  scriptFields.forEach((field) => { payload[field] = sanitizeTrackingHtml(payload[field]).html; });

  if (!theme.id || !theme.updated_at) {
    const { data, error } = await supabase.from('theme_settings').insert({ ...payload, singleton: true }).select('*');
    if (error) throw explainSaveError(error);
    if (!data?.length) throw new Error('The theme was not saved: row level security blocked the insert. Your role needs the manage_options capability.');
    return rowToTheme(data[0] as Json);
  }

  const { data, error } = await supabase
    .from('theme_settings')
    .update(payload)
    .eq('id', theme.id)
    .eq('updated_at', theme.updated_at)
    .select('*');
  if (error) throw explainSaveError(error);
  if (data?.length) return rowToTheme(data[0] as Json);

  // Zero rows and no error: either someone else saved in between, or RLS hid the row.
  const { data: current } = await supabase.from('theme_settings').select('id,updated_at').eq('id', theme.id).maybeSingle();
  if (!current) {
    throw new Error('The theme was not saved: its row no longer exists (it was deleted or a backup was restored). Reload the Theme Editor, then apply your changes again.');
  }
  if (current.updated_at !== theme.updated_at) {
    throw new Error(`The theme was not saved: another administrator saved it at ${new Date(current.updated_at).toLocaleString()} after you opened the editor. Reload to see their version; saving now would discard it.`);
  }
  throw new Error('The theme was not saved: the database accepted the request but changed no rows, which means row level security blocked it. Your role needs the manage_options capability.');
};

// Public site: shared load and live preview ------------------------------------------------

const previewDraftKey = 'rwp_theme_preview_draft';
const previewFlagKey = 'rwp_theme_preview';

let cached: Promise<ThemeSettings> | null = null;
let current: ThemeSettings | null = null;
let previewMode = false;
const listeners = new Set<(theme: ThemeSettings) => void>();

const publish = (theme: ThemeSettings) => {
  current = theme;
  listeners.forEach((listener) => listener(theme));
};

const readPreviewDraft = (): ThemeSettings | null => {
  try {
    const raw = localStorage.getItem(previewDraftKey);
    return raw ? rowToTheme(JSON.parse(raw) as Json) : null;
  } catch {
    return null;
  }
};

/** Called by the editor. Only this browser sees the draft: it never leaves localStorage. */
export const writePreviewDraft = (theme: ThemeSettings) => {
  try {
    localStorage.setItem(previewDraftKey, JSON.stringify(themeToRow(theme)));
  } catch {
    // Storage full or blocked: the preview tab keeps its last draft.
  }
};

export const clearPreviewDraft = () => {
  try {
    localStorage.removeItem(previewDraftKey);
  } catch {
    // Nothing to clear.
  }
};

/**
 * Enters preview mode for this tab when opened with ?theme_preview=1 and a draft exists. The flag
 * is kept in sessionStorage so following links inside the preview stays in preview. Returns
 * whether preview is on. Call once on public routes, before loadTheme.
 */
export const initThemePreview = (): boolean => {
  try {
    const param = new URLSearchParams(window.location.search).get('theme_preview');
    if (param === '1') sessionStorage.setItem(previewFlagKey, '1');
    if (param === '0') sessionStorage.removeItem(previewFlagKey);
    previewMode = sessionStorage.getItem(previewFlagKey) === '1' && readPreviewDraft() !== null;
  } catch {
    previewMode = false;
  }
  if (previewMode) {
    // The editor writes a new draft on every change; the storage event reaches other tabs only.
    window.addEventListener('storage', (event) => {
      if (event.key !== previewDraftKey) return;
      const draft = readPreviewDraft();
      if (draft) publish(draft);
    });
  }
  return previewMode;
};

export const isThemePreview = () => previewMode;

export const exitThemePreview = () => {
  try {
    sessionStorage.removeItem(previewFlagKey);
  } catch {
    // Already gone.
  }
  window.location.href = window.location.pathname;
};

/** The theme for the public site. Any failure falls back to the default layout, never an error page. */
export const loadTheme = (force = false): Promise<ThemeSettings> => {
  if (previewMode) {
    const draft = readPreviewDraft();
    if (draft) {
      publish(draft);
      return Promise.resolve(draft);
    }
  }
  if (!cached || force) {
    cached = fetchTheme()
      .catch((error: unknown) => {
        console.warn(`Theme settings could not be loaded, so the default layout is used: ${describeDbError(error)}`);
        return defaultTheme();
      })
      .then((theme) => {
        publish(theme);
        return theme;
      });
  }
  return cached;
};

export const useTheme = (): { theme: ThemeSettings; loaded: boolean; preview: boolean } => {
  const [theme, setTheme] = useState<ThemeSettings | null>(current);
  useEffect(() => {
    listeners.add(setTheme);
    void loadTheme();
    return () => { listeners.delete(setTheme); };
  }, []);
  return { theme: theme || fallbackTheme, loaded: Boolean(theme), preview: previewMode };
};

// One shared instance, so components rendered before the load compare equal between renders.
const fallbackTheme = defaultTheme();
