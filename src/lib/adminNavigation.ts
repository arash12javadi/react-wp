import { hasCapability, type Capability, type UserRole } from './roles';
import { rwp, type RwpAdminSubmenuItem } from './rwp';

/** A sidebar entry: a core screen (dashboard, content, media, …) or a plugin page by its id. */
export interface AdminNavItem {
  id: string;
  label: string;
  icon: string;
  capability?: string;
  submenu?: RwpAdminSubmenuItem[];
  /** True for pages registered by a plugin. */
  plugin?: boolean;
}

/**
 * Emoji icons on purpose: they are text, so the sidebar needs no icon font, sprite or
 * network request. Keep one emoji per item; some render as two glyphs on older systems.
 */
const coreNavigation: AdminNavItem[] = [
  {
    id: 'dashboard', label: 'Dashboard', icon: '🏠',
    submenu: [
      { id: 'overview', label: 'Overview', icon: '📊' },
      { id: 'analytics', label: 'Analytics', icon: '📈', capability: 'edit_others_posts' },
      { id: 'updates', label: 'Updates', icon: '🔄', capability: 'manage_options' },
      { id: 'guide', label: 'Guide & shortcodes', icon: '📘' },
    ],
  },
  {
    id: 'content', label: 'Pages & Posts', icon: '📝', capability: 'edit_posts',
    submenu: [
      { id: 'all', label: 'All content', icon: '📄' },
      { id: 'new-post', label: 'Add post', icon: '✏️' },
      { id: 'new-page', label: 'Add page', icon: '➕', capability: 'edit_pages' },
      { id: 'categories', label: 'Categories', icon: '🏷️', capability: 'manage_options' },
    ],
  },
  {
    id: 'media', label: 'Media', icon: '🎬', capability: 'upload_files',
    submenu: [
      { id: 'library', label: 'Library', icon: '🖼️' },
      { id: 'upload-settings', label: 'Upload providers', icon: '☁️', capability: 'manage_options' },
    ],
  },
  { id: 'comments', label: 'Comments', icon: '💬', capability: 'moderate_comments' },
  {
    id: 'appearance', label: 'Appearance', icon: '🎨', capability: 'manage_options',
    submenu: [
      // The editor's area tabs (Header, Footer, …) are kept in &area=, not here.
      { id: 'theme-editor', label: 'Theme Editor', icon: '🖌️' },
    ],
  },
  {
    id: 'menus', label: 'Menus', icon: '🧭', capability: 'manage_options',
    submenu: [
      { id: 'menus', label: 'Menus', icon: '🔗' },
      { id: 'widgets', label: 'Sidebar & Widgets', icon: '🧩' },
    ],
  },
  { id: 'users', label: 'Users', icon: '👥', capability: 'list_users' },
  { id: 'plugins', label: 'Plugins', icon: '🔌', capability: 'manage_options' },
  {
    id: 'settings', label: 'Settings', icon: '⚙️', capability: 'manage_options',
    submenu: [
      { id: 'site', label: 'Site', icon: '🌐' },
      { id: 'accounts', label: 'Accounts', icon: '🔐' },
      { id: 'floating-login', label: 'Floating Login', icon: '🔑' },
      { id: 'general', label: 'General', icon: '🎛️' },
      { id: 'uploads', label: 'Uploads', icon: '📤' },
      { id: 'seo', label: 'SEO', icon: '🔍' },
      // The security engine, in the four parts an administrator actually thinks in.
      { id: 'security', label: 'Session & Security', icon: '🛟' },
      { id: 'anti-bot', label: 'Anti-bot & Verification', icon: '🤖' },
      { id: 'performance', label: 'Rate limiting & Speed', icon: '⚡' },
      { id: 'indexing', label: 'SEO & Indexing', icon: '🗺️' },
      { id: 'engagement', label: 'Engagement', icon: '❤️' },
      { id: 'languages', label: 'Languages', icon: '🗣️' },
      { id: 'translations', label: 'Translations', icon: '🔤' },
      { id: 'roles', label: 'Roles', icon: '🛡️' },
      { id: 'backup', label: 'Backup', icon: '💾' },
      // Settings already requires manage_options, which only Administrators and Super Admins
      // have; ResetSitePanel and /api/admin/reset-site check the role again regardless.
      { id: 'advanced', label: 'Advanced', icon: '⚠️' },
    ],
  },
  { id: 'profile', label: 'Profile', icon: '👤' },
];

/** Old ids still reach the right screen: bookmarks, the page builder's links, App Settings. */
const legacySections: Record<string, [string, string]> = {
  'app-settings': ['settings', 'general'],
  // Floating Login was a plugin page before it moved into Settings.
  'floating-login': ['settings', 'floating-login'],
  categories: ['content', 'categories'],
  'rwp-shop-products': ['rwp-shop', 'products'],
};

/** Renamed or merged submenu items, per section. */
const legacySubsections: Record<string, Record<string, string>> = {
  'rwp-page-builder': { pages: 'site-pages', 'shop-pages': 'templates' },
};

const allowed = (role: UserRole, capability?: string) =>
  !capability || hasCapability(role, capability as Capability);

/** The sidebar for a role: core screens, plugin pages after Comments, submenus filtered. */
export const buildAdminNavigation = (role: UserRole): AdminNavItem[] => {
  const pluginItems: AdminNavItem[] = rwp.getAdminPages().map((page) => ({
    id: page.id, label: page.label, icon: page.icon || '🧩', capability: page.capability, submenu: page.submenu, plugin: true,
  }));
  const commentsIndex = coreNavigation.findIndex((item) => item.id === 'comments') + 1;
  const combined = [...coreNavigation.slice(0, commentsIndex), ...pluginItems, ...coreNavigation.slice(commentsIndex)];
  return rwp.filters.apply('rwp_admin_navigation', combined)
    .filter((item) => allowed(role, item.capability))
    .map((item) => ({ ...item, submenu: item.submenu?.filter((sub) => allowed(role, sub.capability)) }));
};

/** Resolves a requested section/subsection against what the role can see. */
export const resolveAdminLocation = (
  navigation: AdminNavItem[],
  section: string | null | undefined,
  subsection?: string | null,
): { section: string; subsection: string } => {
  const legacy = section ? legacySections[section] : undefined;
  const wantedSection = legacy ? legacy[0] : section;
  const requestedSub = legacy && !subsection ? legacy[1] : subsection;
  const wantedSub = (wantedSection && requestedSub && legacySubsections[wantedSection]?.[requestedSub]) || requestedSub;
  // Roles admitted only for uploads have no Pages & Posts, so they land on Media.
  const item = navigation.find((entry) => entry.id === wantedSection) || navigation[0];
  if (!item) return { section: 'profile', subsection: '' };
  const submenu = item.submenu || [];
  const sub = submenu.find((entry) => entry.id === wantedSub) || submenu[0];
  return { section: item.id, subsection: sub?.id || '' };
};
