export const roles = ['administrator', 'editor', 'author', 'contributor', 'subscriber', 'super_admin'] as const;
export type UserRole = (typeof roles)[number];

export const roleLabels: Record<UserRole, string> = {
  administrator: 'Administrator',
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
const administrator: Capability[] = [
  ...editor,
  'manage_options',
  'activate_plugins',
  'list_users',
  'edit_users',
  'promote_users',
];

export const roleCapabilities: Record<UserRole, Capability[]> = {
  subscriber,
  contributor,
  author,
  editor,
  administrator,
  super_admin: [...capabilities],
};

export const hasCapability = (role: UserRole, capability: Capability): boolean =>
  roleCapabilities[role]?.includes(capability) ?? false;

export const canAccessAdmin = (role: UserRole) => hasCapability(role, 'edit_posts');
export const canManageSettings = (role: UserRole) => hasCapability(role, 'manage_options');
export const canManageComments = (role: UserRole) => hasCapability(role, 'moderate_comments');
export const canManageAllPosts = (role: UserRole) => hasCapability(role, 'edit_others_posts');
export const canPublishPosts = (role: UserRole) => hasCapability(role, 'publish_posts');
export const canUploadMedia = (role: UserRole) => hasCapability(role, 'upload_files');
export const canManageUsers = (role: UserRole) => hasCapability(role, 'list_users');

/** Legacy fallback only. Roles are authoritative in public.profiles; user_metadata is user-writable. */
export const getUserRole = (user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }): UserRole => {
  const value = user.app_metadata?.role || user.user_metadata?.role;
  if (value === 'superadmin' || value === 'super-admin') return 'super_admin';
  return roles.includes(value as UserRole) ? value as UserRole : 'subscriber';
};
