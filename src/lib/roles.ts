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

/** Roles whose capabilities can be extended under Settings → Roles. The others already have all of them. */
export const grantableRoles = ['shop_manager', 'editor', 'author', 'contributor', 'subscriber'] as const satisfies readonly UserRole[];

/**
 * Capabilities that hand over control of the whole site. Granting one is allowed, but the Roles
 * screen asks first: someone with manage_options can restore a backup, and activate_plugins
 * runs uploaded code.
 */
export const sensitiveCapabilities: Capability[] = ['manage_options', 'activate_plugins', 'edit_users', 'promote_users'];

export const isCapability = (value: unknown): value is Capability => capabilities.includes(value as Capability);

/**
 * Grants added under Settings → Roles: rwp_role_capabilities (per role) and rwp_user_capabilities
 * (per person), loaded by src/lib/capabilityGrants.ts before the first render. public.user_has_cap()
 * reads the same two tables, so the database enforces what this file shows — change both or neither.
 */
let roleGrants: Partial<Record<UserRole, Capability[]>> = {};
let viewerGrants: { role: UserRole | null; capabilities: Capability[] } = { role: null, capabilities: [] };

export const setRoleGrants = (grants: Partial<Record<UserRole, Capability[]>>) => { roleGrants = grants; };

/** The signed-in person's own grants. */
export const setViewerGrants = (role: UserRole | null, granted: Capability[]) => { viewerGrants = { role, capabilities: granted }; };

export const roleGrantsFor = (role: UserRole): Capability[] => roleGrants[role] || [];

/** What every account with this role can do: the built-in set plus the role's grants. Never a person's own grants. */
export const capabilitiesFor = (role: UserRole): Capability[] =>
  [...new Set([...(roleCapabilities[role] || []), ...roleGrantsFor(role)])];

/**
 * Almost every caller passes the signed-in person's role, so their own grants count when the role
 * matches theirs. To show what someone else can do, use capabilitiesFor plus their grants instead.
 */
export const hasCapability = (role: UserRole, capability: Capability): boolean =>
  capabilitiesFor(role).includes(capability)
  || (viewerGrants.role === role && viewerGrants.capabilities.includes(capability));

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
