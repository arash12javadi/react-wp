import { getSupabaseClient, updateOption } from './db';
import { defaultExcerptLength, type ExcerptUnit } from './excerpt';

/** What the public header shows in its brand area (Settings → Site). */
export type HeaderDisplay = 'text' | 'title' | 'logo' | 'logo_title' | 'logo_text';

export const headerDisplayLabels: Record<HeaderDisplay, string> = {
  text: 'Site title and tagline',
  title: 'Site title only',
  logo: 'Logo only',
  logo_title: 'Logo and site title',
  logo_text: 'Logo, site title and tagline',
};

/** Who sees the admin toolbar across the top of the public site (Settings → Accounts). */
export type AdminToolbarMode = 'everyone' | 'admins' | 'nobody';

export const adminToolbarLabels: Record<AdminToolbarMode, string> = {
  everyone: 'Everyone who is signed in',
  admins: 'Only people who can use the admin',
  nobody: 'Nobody',
};

export interface SiteSettings {
  site_title: string;
  site_tagline: string;
  site_icon: string;
  site_logo: string;
  header_display: HeaderDisplay;
  /** Logo height in the public header, in pixels. */
  logo_height: number;
  home_page_id: string;
  posts_page_id: string;
  posts_per_page: number;
  excerpt_length: number;
  excerpt_unit: ExcerptUnit;
  home_layout: string;
  cloudinary_cloud_name: string;
  cloudinary_upload_preset: string;
  imagekit_public_key: string;
  imagekit_url_endpoint: string;
  users_can_register: boolean;
  default_user_role: string;
  show_auth_links: boolean;
  auth_google_enabled: boolean;
  auth_facebook_enabled: boolean;
  comments_enabled: boolean;
  comment_moderation: boolean;
  comment_max_depth: number;
  /**
   * Account pages (src/lib/account.ts). Each is '' (the built-in screen), a page id, or 'custom'
   * with the address in the matching _url key, e.g. a shop's /my-account. The fixed paths
   * /login, /register, /lost-password, /profile and /dashboard always show the chosen one.
   */
  login_page_id: string;
  login_page_url: string;
  register_page_id: string;
  register_page_url: string;
  lost_password_page_id: string;
  lost_password_page_url: string;
  profile_page_id: string;
  profile_page_url: string;
  dashboard_page_id: string;
  dashboard_page_url: string;
  /** Where signing in leads when the link did not ask for a page. Empty: admin or dashboard, by role. */
  login_redirect: string;
  /** Where signing out leads. Empty: stay on the current page. */
  logout_redirect: string;
  admin_toolbar: AdminToolbarMode;
}

export const defaultSettings: SiteSettings = {
  site_title: 'My React-WP Site',
  site_tagline: 'Just another React-WP site',
  site_icon: '',
  site_logo: '',
  header_display: 'text',
  logo_height: 44,
  home_page_id: '',
  posts_page_id: '',
  posts_per_page: 6,
  excerpt_length: defaultExcerptLength,
  excerpt_unit: 'words',
  home_layout: 'boxed',
  cloudinary_cloud_name: '',
  cloudinary_upload_preset: '',
  imagekit_public_key: '',
  imagekit_url_endpoint: '',
  users_can_register: true,
  default_user_role: 'subscriber',
  show_auth_links: true,
  auth_google_enabled: false,
  auth_facebook_enabled: false,
  comments_enabled: true,
  comment_moderation: true,
  comment_max_depth: 5,
  login_page_id: '',
  login_page_url: '',
  register_page_id: '',
  register_page_url: '',
  lost_password_page_id: '',
  lost_password_page_url: '',
  profile_page_id: '',
  profile_page_url: '',
  dashboard_page_id: '',
  dashboard_page_url: '',
  login_redirect: '',
  logout_redirect: '',
  admin_toolbar: 'everyone',
};

export const settingKeys = Object.keys(defaultSettings) as Array<keyof SiteSettings>;

const toNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const toBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
};

export const loadSettings = async (): Promise<SiteSettings> => {
  const { data, error } = await getSupabaseClient()
    .from('options')
    .select('option_name,option_value')
    // site_description is the pre-rename key for the tagline.
    .in('option_name', [...settingKeys, 'site_description']);
  if (error) throw error;

  const values = (data || []).reduce<Record<string, string>>((result, row) => {
    result[row.option_name] = row.option_value;
    return result;
  }, {});

  return {
    ...defaultSettings,
    site_title: values.site_title || defaultSettings.site_title,
    site_tagline: values.site_tagline || values.site_description || defaultSettings.site_tagline,
    site_icon: values.site_icon || '',
    site_logo: values.site_logo || '',
    header_display: values.header_display && values.header_display in headerDisplayLabels
      ? values.header_display as HeaderDisplay
      : defaultSettings.header_display,
    logo_height: Math.min(200, toNumber(values.logo_height, defaultSettings.logo_height)),
    home_page_id: values.home_page_id || '',
    posts_page_id: values.posts_page_id || '',
    posts_per_page: toNumber(values.posts_per_page, defaultSettings.posts_per_page),
    excerpt_length: toNumber(values.excerpt_length, defaultSettings.excerpt_length),
    excerpt_unit: values.excerpt_unit === 'characters' ? 'characters' : 'words',
    home_layout: values.home_layout || defaultSettings.home_layout,
    cloudinary_cloud_name: values.cloudinary_cloud_name || '',
    cloudinary_upload_preset: values.cloudinary_upload_preset || '',
    imagekit_public_key: values.imagekit_public_key || '',
    imagekit_url_endpoint: values.imagekit_url_endpoint || '',
    users_can_register: toBoolean(values.users_can_register, defaultSettings.users_can_register),
    default_user_role: values.default_user_role || defaultSettings.default_user_role,
    show_auth_links: toBoolean(values.show_auth_links, defaultSettings.show_auth_links),
    auth_google_enabled: toBoolean(values.auth_google_enabled, false),
    auth_facebook_enabled: toBoolean(values.auth_facebook_enabled, false),
    comments_enabled: toBoolean(values.comments_enabled, defaultSettings.comments_enabled),
    comment_moderation: toBoolean(values.comment_moderation, defaultSettings.comment_moderation),
    comment_max_depth: toNumber(values.comment_max_depth, defaultSettings.comment_max_depth),
    login_page_id: values.login_page_id || '',
    login_page_url: values.login_page_url || '',
    register_page_id: values.register_page_id || '',
    register_page_url: values.register_page_url || '',
    lost_password_page_id: values.lost_password_page_id || '',
    lost_password_page_url: values.lost_password_page_url || '',
    profile_page_id: values.profile_page_id || '',
    profile_page_url: values.profile_page_url || '',
    dashboard_page_id: values.dashboard_page_id || '',
    dashboard_page_url: values.dashboard_page_url || '',
    login_redirect: values.login_redirect || '',
    logout_redirect: values.logout_redirect || '',
    admin_toolbar: values.admin_toolbar && values.admin_toolbar in adminToolbarLabels
      ? values.admin_toolbar as AdminToolbarMode
      : defaultSettings.admin_toolbar,
  };
};

export const saveSettings = async (settings: Partial<SiteSettings>): Promise<void> => {
  const entries = Object.entries(settings) as Array<[keyof SiteSettings, string | number | boolean]>;
  const results = await Promise.all(entries.map(([key, value]) => updateOption(key, value)));
  if (results.some((saved) => !saved)) {
    throw new Error('Some settings could not be saved. Check that your role can manage settings.');
  }
};

export type SiteBranding = Pick<SiteSettings, 'site_title' | 'site_tagline' | 'site_icon' | 'site_logo' | 'header_display' | 'logo_height'>;

export const brandingFrom = (settings: SiteSettings): SiteBranding => ({
  site_title: settings.site_title,
  site_tagline: settings.site_tagline,
  site_icon: settings.site_icon,
  site_logo: settings.site_logo,
  header_display: settings.header_display,
  logo_height: settings.logo_height,
});

/**
 * The browser tab title for screens that are not a page row (admin, login, plugin routes).
 * index.html ships a placeholder title, and nothing replaced it on those screens, so the tab
 * kept saying "react-wp" whatever the site title was set to.
 */
/** Which parts of the brand the public header shows. A logo choice with no logo falls back to text. */
export const brandParts = (branding: Partial<SiteBranding>) => {
  const display = branding.header_display || 'text';
  const logo = Boolean(branding.site_logo) && display.startsWith('logo');
  return {
    logo,
    title: !logo || display === 'logo_title' || display === 'logo_text',
    tagline: Boolean(branding.site_tagline) && (logo ? display === 'logo_text' : display !== 'title'),
  };
};

/** Must match <title> in index.html. */
export const placeholderTitle = 'React-WP';

export const applyDocumentTitle = (siteTitle: string, screen?: string) => {
  const site = siteTitle.trim() || defaultSettings.site_title;
  document.title = screen ? `${screen} ‹ ${site}` : site;
};

export const applySiteIcon = (iconUrl: string) => {
  if (!iconUrl) return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = iconUrl;
};
