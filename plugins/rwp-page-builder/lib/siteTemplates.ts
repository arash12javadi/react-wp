/**
 * Site templates (Page Builder → Templates) and the default pages installed on first use.
 *
 * A template is a pages row with is_site_template and a template_type, one row per type. While
 * published and builder-enabled it replaces a part of the public site: the header and footer
 * (PublicLayout), single posts and pages without their own layout, 404 (PublicContent), search and
 * archives (PublicArchive) and the shop screens (plugins/rwp-shop/builder/ShopLayoutRoute.tsx).
 * No editor code here: the public site imports this.
 */
import { describeDbError, getSupabaseClient } from '../../../src/lib/db';
import { newId } from './tree';
import { getWidget } from './registry';
import type { BuilderDocument, BuilderPage, ColumnNode, SectionNode, WidgetNode } from './types';

export const SITE_TEMPLATES_MIGRATION = 'supabase/migrations/20260925_site_templates.sql';

export type TemplateGroup = 'parts' | 'content' | 'archive' | 'shop';

type WidgetSpec = string | { type: string; settings?: Record<string, unknown>; style?: Record<string, unknown> };
interface SectionSpec {
  columns: WidgetSpec[][];
  /** Full width, no padding: for the header and footer. */
  flush?: boolean;
}

export interface TemplateSlot {
  type: string;
  label: string;
  icon: string;
  group: TemplateGroup;
  /** Where the template shows, for the admin table. */
  routes: string;
  /** A real URL to see it live. */
  viewHref: string;
  description: string;
  starter: SectionSpec[];
  /** Archive overrides fall back to this shared template until customised. */
  overrides?: string;
}

const archiveStarter: SectionSpec[] = [{
  columns: [['archive-title', { type: 'archive-posts', settings: { limit: 9, pagination: 'numbers' } }]],
}];

export const templateSlots: TemplateSlot[] = [
  // Layout parts
  {
    type: 'header', label: 'Header', icon: '🔝', group: 'parts', routes: 'Every public page', viewHref: '/',
    description: 'Starts with the Theme Editor header, so the site looks the same. Replace it with Site Logo, Nav Menu and Search widgets to redesign it.',
    starter: [{ columns: [['theme-header']], flush: true }],
  },
  {
    type: 'footer', label: 'Footer', icon: '🔚', group: 'parts', routes: 'Every public page', viewHref: '/',
    description: 'Starts with the Theme Editor footer. Use {{date.year}} in a Text widget for a copyright year that updates itself.',
    starter: [{ columns: [['theme-footer']], flush: true }],
  },
  // Content
  {
    type: 'page', label: 'Standard Pages', icon: '📄', group: 'content', routes: 'Pages without their own builder layout', viewHref: '/sample-page',
    description: 'Page Title and Post Content show each page’s own title and text (Privacy Policy, Sample Page…).',
    starter: [{ columns: [[{ type: 'page-title', settings: { tag: 'h1' } }, 'post-content', 'post-comments']] }],
  },
  {
    type: 'single_post', label: 'Single Post', icon: '📰', group: 'content', routes: 'Posts without their own builder layout', viewHref: '/blog',
    description: 'Applied to every blog post: title, featured image, author, content and comments.',
    starter: [{
      columns: [['breadcrumbs', { type: 'post-title', settings: { tag: 'h1' } }, 'post-meta', 'featured-image', 'post-content', 'author-box', 'post-navigation', 'post-comments']],
    }],
  },
  {
    type: '404', label: '404 Error Page', icon: '🚧', group: 'content', routes: 'Addresses that do not exist', viewHref: '/this-page-does-not-exist',
    description: 'A search box and a way back home for visitors who followed a broken link.',
    starter: [{
      columns: [[
        { type: 'heading', settings: { title: 'Page not found', tag: 'h1' } },
        { type: 'text', settings: { html: '<p>This page does not exist or is no longer published. Try a search, or go back to the home page.</p>' } },
        'search',
        { type: 'button', settings: { text: 'Return home', link: { url: '/' } } },
      ]],
    }],
  },
  {
    type: 'search', label: 'Search Results', icon: '🔍', group: 'content', routes: '/search?s=…', viewHref: '/search?s=a',
    description: 'Archive Title shows the search term; Archive Posts lists the matching posts with pagination.',
    starter: [{
      columns: [['archive-title', 'search', { type: 'archive-posts', settings: { limit: 9, pagination: 'numbers', emptyText: 'No posts match your search.' } }]],
    }],
  },
  // Archives
  {
    type: 'archive', label: 'Archives (shared)', icon: '🗂️', group: 'archive', routes: '/category/…, /author/…, /date/…', viewHref: '/date/2026',
    description: 'One layout for every archive. Customize a single archive type below to give it its own.',
    starter: archiveStarter,
  },
  { type: 'archive_category', label: 'Category Archives', icon: '🏷️', group: 'archive', routes: '/category/:slug', viewHref: '/date/2026', description: 'Posts in one category.', starter: archiveStarter, overrides: 'archive' },
  { type: 'archive_author', label: 'Author Archives', icon: '✍️', group: 'archive', routes: '/author/:id', viewHref: '/date/2026', description: 'Posts by one author.', starter: archiveStarter, overrides: 'archive' },
  { type: 'archive_date', label: 'Date Archives', icon: '📅', group: 'archive', routes: '/date/:year/:month', viewHref: '/date/2026', description: 'Posts from one year or month.', starter: archiveStarter, overrides: 'archive' },
  // Shop
  {
    type: 'shop', label: 'Store Catalog', icon: '🏬', group: 'shop', routes: '/shop', viewHref: '/shop',
    description: 'The main shop page.',
    starter: [{ columns: [['shop-archive-description', 'shop-archive-products']] }],
  },
  {
    type: 'product', label: 'Single Product Layout', icon: '📦', group: 'shop', routes: '/product/:slug', viewHref: '/shop',
    description: 'One layout for every product. Product widgets left on “from the page URL” show the product being viewed.',
    starter: [
      { columns: [['shop-product-images'], ['shop-product-title', 'shop-product-rating', 'shop-product-price', 'shop-short-description', 'shop-add-to-cart', 'shop-product-meta']] },
      { columns: [['shop-product-data-tabs', 'shop-product-related']] },
    ],
  },
  {
    type: 'product_category', label: 'Product Category Archives', icon: '🗃️', group: 'shop', routes: '/product-category/:slug, /product-tag/:slug', viewHref: '/shop',
    description: 'Category and tag listings. Archive widgets follow the category in the URL.',
    starter: [{ columns: [['shop-archive-description', 'shop-archive-products']] }],
  },
  {
    type: 'cart', label: 'Cart Page', icon: '🛒', group: 'shop', routes: '/cart', viewHref: '/cart',
    description: 'Design around the Cart widget; totals are still calculated by the database.',
    starter: [{ columns: [['shop-cart']] }],
  },
  {
    type: 'checkout', label: 'Checkout Page', icon: '💳', group: 'shop', routes: '/checkout', viewHref: '/checkout',
    description: 'Design around the Checkout widget; payment and order placement are unchanged.',
    starter: [{ columns: [['shop-checkout']] }],
  },
  {
    type: 'my_account', label: 'My Account Layout', icon: '👤', group: 'shop', routes: '/my-account', viewHref: '/my-account',
    description: 'Design around the My Account widget (orders, addresses, details).',
    starter: [{ columns: [['shop-my-account']] }],
  },
];

export const templateSlot = (type: string | null | undefined) => templateSlots.find((slot) => slot.type === type);

const missingTemplateSchema = (message: string) =>
  /is_site_template|template_type|builder_create_site_template|rwp_install_default_content/.test(message)
  && /does not exist|schema cache|42703|42883|PGRST20[0-9]|Could not find/i.test(message);

function templateError(error: unknown, action: string): Error {
  const message = describeDbError(error);
  if (missingTemplateSchema(message)) {
    return new Error(`${action} failed because site templates are not set up in the database. Run ${SITE_TEMPLATES_MIGRATION} in the Supabase SQL Editor, then reload. (${message})`);
  }
  return new Error(`${action} failed: ${message}`);
}

// Layout documents ----------------------------------------------------------------------------------

function buildDocument(sections: SectionSpec[]): BuilderDocument {
  const widget = (spec: WidgetSpec): WidgetNode | null => {
    const { type, settings = {}, style = {} } = typeof spec === 'string' ? { type: spec } : spec;
    const definition = getWidget(type);
    // A widget from a plugin that is switched off (e.g. the shop) is left out rather than saved broken.
    if (!definition) return null;
    const defaults = definition.defaults();
    return {
      id: newId(), kind: 'widget', type,
      settings: { ...defaults.settings, ...settings },
      style: { desktop: { ...(defaults.style || {}), ...style } },
      advanced: {},
    };
  };
  const section = ({ columns, flush }: SectionSpec): SectionNode => ({
    id: newId(), kind: 'section', type: 'section',
    settings: { layout: flush ? 'full' : 'boxed', stackOn: 'mobile' },
    style: { desktop: flush ? { padding: { top: 0, right: 0, bottom: 0, left: 0, unit: 'px' } } : {} },
    advanced: {},
    children: columns.map((specs): ColumnNode => ({
      id: newId(), kind: 'column', type: 'column', settings: {}, advanced: {},
      style: { desktop: { width: Math.round((100 / columns.length) * 100) / 100, ...(flush ? { padding: { top: 0, right: 0, bottom: 0, left: 0, unit: 'px' } } : {}) } },
      children: specs.map(widget).filter((node): node is WidgetNode => node !== null),
    })),
  });
  return { version: 1, settings: {}, content: sections.map(section) };
}

export const starterDocument = (slot: TemplateSlot) => buildDocument(slot.starter);

// Admin -------------------------------------------------------------------------------------------------

export type TemplateRow = Pick<BuilderPage, 'id' | 'title' | 'slug' | 'status' | 'is_builder_enabled' | 'updated_at'> & { template_type: string };

export async function listSiteTemplates(): Promise<TemplateRow[]> {
  const { data, error } = await getSupabaseClient().from('pages')
    .select('id,title,slug,status,is_builder_enabled,updated_at,template_type')
    .eq('is_site_template', true);
  if (error) throw templateError(error, 'Loading site templates');
  return (data || []) as TemplateRow[];
}

/** Returns the template's page id, creating it the first time (as a draft unless a status is given). */
export async function createSiteTemplate(slot: TemplateSlot, options: { doc?: BuilderDocument; status?: 'draft' | 'published' } = {}): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc('builder_create_site_template', {
    p_type: slot.type, p_title: slot.label, p_builder_data: options.doc || starterDocument(slot), p_status: options.status || 'draft',
  });
  if (error) throw templateError(error, `Creating the ${slot.label} template`);
  if (typeof data !== 'number' && typeof data !== 'string') throw new Error(`Creating the ${slot.label} template returned no page id.`);
  return Number(data);
}

/** An archive override starts as a copy of the shared archive template, so it can be changed on its own. */
export async function customizeArchive(slot: TemplateSlot): Promise<number> {
  const { data } = await getSupabaseClient().from('pages').select('builder_data').eq('template_type', slot.overrides || 'archive').maybeSingle();
  const shared = (data as { builder_data?: BuilderDocument | null } | null)?.builder_data;
  return createSiteTemplate(slot, { doc: shared && Array.isArray(shared.content) ? shared : undefined, status: 'published' });
}

// Default content -----------------------------------------------------------------------------------

const templateItem = (type: string) => {
  const slot = templateSlot(type)!;
  return { key: type, title: slot.label, template_type: type, builder_data: starterDocument(slot) };
};

const policyText = (name: string) => `<p><strong>This is a starting point, not legal advice.</strong> Replace it with a ${name} that fits your site and the laws that apply to you.</p>`;

function siteDefaults() {
  const home = buildDocument([
    { columns: [[
      { type: 'heading', settings: { title: '{{site.title}}', tag: 'h1' } },
      { type: 'text', settings: { html: '<p>{{site.tagline}}</p>' } },
      { type: 'button', settings: { text: 'Read the blog', link: { url: '/blog' } } },
    ]] },
    { columns: [[
      { type: 'heading', settings: { title: 'Latest posts', tag: 'h2' } },
      { type: 'posts', settings: { limit: 6, pagination: 'none' } },
    ]] },
  ]);
  const blog = buildDocument([{ columns: [[
    { type: 'heading', settings: { title: 'Blog', tag: 'h1' } },
    { type: 'archive-posts', settings: { limit: 9, pagination: 'numbers' } },
  ]] }]);
  return [
    { key: 'home', title: 'Home', slug: 'home', builder_data: home },
    { key: 'blog', title: 'Blog', slug: 'blog', builder_data: blog },
    { key: 'sample', title: 'Sample Page', slug: 'sample-page', content: '<p>This is an example page. Unlike a post, a page stays in one place and shows up in your site navigation. Edit it under Pages &amp; Posts, or delete it.</p>' },
    {
      key: 'privacy', title: 'Privacy Policy', slug: 'privacy-policy',
      content: `${policyText('privacy policy')}<h2>Who we are</h2><p>Our website address is this site.</p><h2>What personal data we collect</h2><p>When you register, comment or place an order we store the details you enter. Our server logs may record your IP address.</p><h2>Cookies</h2><p>See our <a href="/cookie-policy">Cookie Policy</a>.</p><h2>Your rights</h2><p>You can ask to receive or delete the personal data we hold about you.</p>`,
    },
    {
      key: 'cookie', title: 'Cookie Policy', slug: 'cookie-policy',
      content: `${policyText('cookie policy')}<h2>What cookies are</h2><p>Cookies and similar browser storage keep you signed in and remember your cart.</p><h2>How we use them</h2><p>We use them to run the site. If you add analytics or advertising scripts, list them here.</p>`,
    },
    ...['header', 'footer', 'page', 'single_post', '404', 'search', 'archive'].map(templateItem),
  ];
}

const shopDefaults = () => ['shop', 'product', 'product_category', 'cart', 'checkout', 'my_account'].map(templateItem);

const installing = new Set<string>();

/**
 * Creates the default pages and templates once per group (recorded in the database, so deleted
 * defaults are not recreated). Everything is published straight away. Failures are logged, never
 * shown: they must not get in the way of the dashboard.
 */
export async function installDefaultContent(group: 'site' | 'shop'): Promise<void> {
  if (installing.has(group)) return;
  installing.add(group);
  try {
    const { data: done } = await getSupabaseClient().from('options').select('option_value').eq('option_name', 'rwp_default_content').maybeSingle();
    try {
      if ((JSON.parse(done?.option_value || '[]') as string[]).includes(group)) return;
    } catch {
      // An unreadable marker is rewritten by the install below.
    }
    const { error } = await getSupabaseClient().rpc('rwp_install_default_content', {
      p_group: group, p_items: group === 'site' ? siteDefaults() : shopDefaults(), p_reading: group === 'site',
    });
    if (error) {
      console.warn(templateError(error, `Installing the default ${group} pages`).message);
      installing.delete(group);
    }
  } catch (error) {
    console.warn(`Installing the default ${group} pages failed: ${describeDbError(error)}`);
    installing.delete(group);
  }
}

// Public site ---------------------------------------------------------------------------------------

let liveTemplates: Map<string, BuilderPage> | null = null;
let loading: Promise<void> | null = null;

/** Loads every published template in one request. Resolves even on failure (the site then uses its defaults). */
export function preloadLiveTemplates(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      const { data, error } = await getSupabaseClient().from('pages').select('*')
        .eq('is_site_template', true).eq('status', 'published').eq('is_builder_enabled', true);
      if (error) {
        const message = describeDbError(error);
        console.warn(missingTemplateSchema(message)
          ? `Site templates are off: run ${SITE_TEMPLATES_MIGRATION} to enable them. (${message})`
          : `Could not load the site templates, showing the default screens: ${message}`);
        liveTemplates = new Map();
        return;
      }
      liveTemplates = new Map(((data || []) as BuilderPage[])
        .filter((page) => page.template_type && Array.isArray(page.builder_data?.content))
        .map((page) => [page.template_type as string, page]));
    })();
  }
  return loading;
}

/** The published template of a type, or null. Null until preloadLiveTemplates() has resolved. */
export const liveTemplate = (type: string): BuilderPage | null => liveTemplates?.get(type) || null;
