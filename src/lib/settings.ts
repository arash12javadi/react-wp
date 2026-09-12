import { getSupabaseClient, updateOption } from './db';
import { defaultExcerptLength } from './excerpt';

export interface SiteSettings {
  site_title: string;
  site_tagline: string;
  site_icon: string;
  home_page_id: string;
  posts_page_id: string;
  posts_per_page: number;
  excerpt_length: number;
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
}

export const defaultSettings: SiteSettings = {
  site_title: 'My React-WP Site',
  site_tagline: 'Just another React-WP site',
  site_icon: '',
  home_page_id: '',
  posts_page_id: '',
  posts_per_page: 6,
  excerpt_length: defaultExcerptLength,
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
    home_page_id: values.home_page_id || '',
    posts_page_id: values.posts_page_id || '',
    posts_per_page: toNumber(values.posts_per_page, defaultSettings.posts_per_page),
    excerpt_length: toNumber(values.excerpt_length, defaultSettings.excerpt_length),
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
  };
};

export const saveSettings = async (settings: Partial<SiteSettings>): Promise<void> => {
  const entries = Object.entries(settings) as Array<[keyof SiteSettings, string | number | boolean]>;
  const results = await Promise.all(entries.map(([key, value]) => updateOption(key, value)));
  if (results.some((saved) => !saved)) {
    throw new Error('Some settings could not be saved. Check that your role can manage settings.');
  }
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
