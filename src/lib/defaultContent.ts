import { describeDbError, getSupabaseClient } from './db';
import { accountIdKey, accountPages } from './account';
import { rwp } from './rwp';

/**
 * The pages a new site starts with, created once per group by public.rwp_install_default_content
 * the first time an administrator opens the admin. The database records each installed group in
 * the rwp_default_content option, so deleted defaults are never recreated.
 *
 *   site     Home (made the front page), Blog (the posts page), Sample Page, Sample Post and the
 *            policy pages. Only on a site with no pages yet, so an upgrade never changes the
 *            chosen front page.
 *   account  Log In, Register, Lost Password, User Profile and Dashboard, each holding one
 *            shortcode, and chosen under Settings → Accounts / Site.
 *
 * Plugins change the items with the `rwp_default_content` filter, (items, group) → items; the
 * Page Builder uses it to give Home and Blog a layout and to add the site templates.
 */

export interface DefaultContentItem {
  key: string;
  title: string;
  slug?: string;
  content?: string;
  template_type?: string;
  builder_data?: unknown;
  is_post?: boolean;
  category?: { name: string; slug: string };
  comments_open?: boolean;
  noindex?: boolean;
  /** An option that gets the new page's id while it is unset (home_page_id, login_page_id, …). */
  option?: string;
}

export type DefaultContentGroup = 'site' | 'account';

export const defaultContentMigration = 'supabase/migrations/20261001_account_pages_capabilities.sql';

const policyText = (name: string) => `<p><strong>This is a starting point, not legal advice.</strong> Replace it with a ${name} that fits your site and the laws that apply to you.</p>`;

const siteItems = (): DefaultContentItem[] => [
  {
    key: 'home', title: 'Home', slug: 'home', option: 'home_page_id',
    content: '<h2>Welcome to your new site</h2><p>This is your home page. It is a normal page chosen as the front page under <strong>Settings → Site</strong>, so you can edit it under Pages &amp; Posts or choose another one.</p><p><a href="/blog">Read the blog</a></p>',
  },
  // The feed of posts needs an address once the front page is a static page.
  { key: 'blog', title: 'Blog', slug: 'blog', option: 'posts_page_id', content: '' },
  { key: 'sample', title: 'Sample Page', slug: 'sample-page', content: '<p>This is an example page. Unlike a post, a page stays in one place and shows up in your site navigation. Edit it under Pages &amp; Posts, or delete it.</p>' },
  {
    key: 'sample-post', title: 'Sample Post', slug: 'sample-post', is_post: true, comments_open: true,
    category: { name: 'Uncategorized', slug: 'uncategorized' },
    content: '<p>Welcome to React-WP. This is your first post. Edit or delete it, then start writing!</p><p>Posts appear on the blog, newest first, and can be sorted into categories under <strong>Pages &amp; Posts → Categories</strong>.</p>',
  },
  {
    key: 'privacy', title: 'Privacy Policy', slug: 'privacy-policy',
    content: `${policyText('privacy policy')}<h2>Who we are</h2><p>Our website address is this site.</p><h2>What personal data we collect</h2><p>When you register, comment or place an order we store the details you enter. Our server logs may record your IP address.</p><h2>Cookies</h2><p>See our <a href="/cookie-policy">Cookie Policy</a>.</p><h2>Your rights</h2><p>You can ask to receive or delete the personal data we hold about you.</p>`,
  },
  {
    key: 'cookie', title: 'Cookie Policy', slug: 'cookie-policy',
    content: `${policyText('cookie policy')}<h2>What cookies are</h2><p>Cookies and similar browser storage keep you signed in and remember your cart.</p><h2>How we use them</h2><p>We use them to run the site. If you add analytics or advertising scripts, list them here.</p>`,
  },
];

/** One page per account screen, holding its shortcode. Also used by "Create page" in Settings. */
export const accountPageItems = (): DefaultContentItem[] => accountPages.map((page) => ({
  key: page.key, title: page.title, slug: page.slug, content: `<p>${page.shortcode}</p>`, noindex: true, option: accountIdKey(page.key),
}));

const itemsFor = (group: DefaultContentGroup) => rwp.filters.apply<DefaultContentItem[]>(
  'rwp_default_content', group === 'site' ? siteItems() : accountPageItems(), group,
);

let running: Promise<void> | null = null;

/**
 * Installs whichever groups are still missing. Failures are logged, never shown: they must not
 * get in the way of the dashboard, and the next admin visit tries again.
 */
export const installDefaultContent = (): Promise<void> => {
  if (running) return running;
  running = (async () => {
    const supabase = getSupabaseClient();
    // The function before this migration would turn the Sample Post into a page and choose no front
    // page, then mark 'site' as done for good; the capability table arrived with it, so it is the probe.
    const probe = await supabase.from('rwp_role_capabilities').select('role', { count: 'exact', head: true });
    if (probe.error) {
      console.warn(`The default pages were not created: run ${defaultContentMigration} in the Supabase SQL Editor first. (${describeDbError(probe.error)})`);
      running = null;
      return;
    }
    const { data: done } = await supabase.from('options').select('option_value').eq('option_name', 'rwp_default_content').maybeSingle();
    let installed: string[] = [];
    try {
      installed = JSON.parse(done?.option_value || '[]') as string[];
    } catch {
      // An unreadable marker is rewritten by the install below.
    }
    // 'site' first: it only runs on a site without pages, and the account pages are pages.
    for (const group of ['site', 'account'] as const) {
      if (installed.includes(group)) continue;
      const { error } = await supabase.rpc('rwp_install_default_content', { p_group: group, p_items: itemsFor(group), p_reading: false });
      if (error) {
        const message = describeDbError(error);
        console.warn(`The default ${group} pages were not created: ${message}`);
        running = null;
        return;
      }
    }
  })().catch((error: unknown) => {
    console.warn(`Installing the default pages failed: ${describeDbError(error)}`);
    running = null;
  });
  return running;
};
