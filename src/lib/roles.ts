export const roles = ['administrator', 'shop_manager', 'editor', 'author', 'contributor', 'subscriber', 'super_admin'] as const;
export type UserRole = (typeof roles)[number];

export const roleLabels: Record<UserRole, string> = {
  administrator: 'Administrator',
  shop_manager: 'Shop Manager',
  editor: 'Editor',
  author: 'Author',
  contributor: 'Contributor',
  subscriber: 'Subscriber',
  super_admin: 'Super Admin',
};

export const capabilities = [
  'read',
  'edit_posts',
  'edit_others_posts',
  'publish_posts',
  'delete_posts',
  'delete_others_posts',
  'edit_pages',
  'publish_pages',
  'manage_categories',
  'moderate_comments',
  'upload_files',
  'manage_options',
  'activate_plugins',
  'list_users',
  'edit_users',
  'promote_users',
  'manage_shop',
] as const;
export type Capability = (typeof capabilities)[number];

export const capabilityLabels: Record<Capability, string> = {
  read: 'Read content',
  edit_posts: 'Edit own posts',
  edit_others_posts: "Edit others' posts",
  publish_posts: 'Publish posts',
  delete_posts: 'Delete own posts',
  delete_others_posts: "Delete others' posts",
  edit_pages: 'Edit pages',
  publish_pages: 'Publish pages',
  manage_categories: 'Manage categories',
  moderate_comments: 'Moderate comments',
  upload_files: 'Upload media',
  manage_options: 'Manage settings',
  activate_plugins: 'Activate plugins',
  list_users: 'List users',
  edit_users: 'Edit users',
  promote_users: 'Change user roles',
  manage_shop: 'Manage shop (products, orders, shop settings)',
};

const subscriber: Capability[] = ['read'];
const contributor: Capability[] = [...subscriber, 'edit_posts', 'delete_posts'];
const author: Capability[] = [...contributor, 'publish_posts', 'upload_files'];
const editor: Capability[] = [
  ...author,
  'edit_others_posts',
  'delete_others_posts',
  'edit_pages',
  'publish_pages',
  'manage_categories',
  'moderate_comments',
];
// Mirrors WooCommerce's Shop Manager: an editor who also runs the shop, without site settings.
const shopManager: Capability[] = [...editor, 'manage_shop', 'list_users'];
const administrator: Capability[] = [
  ...editor,
  'manage_options',
  'activate_plugins',
  'list_users',
  'edit_users',
  'promote_users',
  'manage_shop',
];

export const roleCapabilities: Record<UserRole, Capability[]> = {
  subscriber,
  contributor,
  author,
  editor,
  shop_manager: shopManager,
  administrator,
  super_admin: [...capabilities],
};

/**
 * Extra capabilities an administrator can switch on under App Settings → Roles. The same four
 * (and only these) are honoured by public.user_has_cap(), which reads them from the
 * rwp_app_settings option — change both or neither.
 */
export interface CapabilityGrants {
  subscriber_upload_files: boolean;
  subscriber_edit_posts: boolean;
  contributor_upload_files: boolean;
  contributor_publish_posts: boolean;
}

export const capabilityGrantDefinitions: Record<keyof CapabilityGrants, { role: UserRole; capabilities: Capability[] }> = {
  subscriber_upload_files: { role: 'subscriber', capabilities: ['upload_files'] },
  subscriber_edit_posts: { role: 'subscriber', capabilities: ['edit_posts', 'delete_posts'] },
  contributor_upload_files: { role: 'contributor', capabilities: ['upload_files'] },
  contributor_publish_posts: { role: 'contributor', capabilities: ['publish_posts'] },
};

let grantedCapabilities: Partial<Record<UserRole, Capability[]>> = {};

/** Called once the app settings have loaded, before any screen checks a capability. */
export const applyCapabilityGrants = (grants: Partial<CapabilityGrants>) => {
  const next: Partial<Record<UserRole, Capability[]>> = {};
  (Object.keys(capabilityGrantDefinitions) as Array<keyof CapabilityGrants>).forEach((key) => {
    if (grants[key] !== true) return;
    const { role, capabilities: extra } = capabilityGrantDefinitions[key];
    next[role] = [...(next[role] || []), ...extra];
  });
  grantedCapabilities = next;
};

export const capabilitiesFor = (role: UserRole): Capability[] =>
  [...new Set([...(roleCapabilities[role] || []), ...(grantedCapabilities[role] || [])])];

export const hasCapability = (role: UserRole, capability: Capability): boolean =>
  capabilitiesFor(role).includes(capability);

// upload_files alone is enough: a subscriber granted uploads uses the Media and Profile screens.
export const canAccessAdmin = (role: UserRole) => hasCapability(role, 'edit_posts') || hasCapability(role, 'upload_files');
export const canManageSettings = (role: UserRole) => hasCapability(role, 'manage_options');
export const canManageComments = (role: UserRole) => hasCapability(role, 'moderate_comments');
export const canManageAllPosts = (role: UserRole) => hasCapability(role, 'edit_others_posts');
export const canPublishPosts = (role: UserRole) => hasCapability(role, 'publish_posts');
export const canUploadMedia = (role: UserRole) => hasCapability(role, 'upload_files');
export const canManageUsers = (role: UserRole) => hasCapability(role, 'list_users');
export const canManageShop = (role: UserRole) => hasCapability(role, 'manage_shop');

/** Legacy fallback only. Roles are authoritative in public.profiles; user_metadata is user-writable. */
export const getUserRole = (user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }): UserRole => {
  const value = user.app_metadata?.role || user.user_metadata?.role;
  if (value === 'superadmin' || value === 'super-admin') return 'super_admin';
  return roles.includes(value as UserRole) ? value as UserRole : 'subscriber';
};
