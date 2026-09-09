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

export const canAccessAdmin = (role: UserRole) => role !== 'subscriber';
export const canManageSettings = (role: UserRole) => role === 'administrator' || role === 'super_admin';
export const canManageComments = (role: UserRole) =>
  role === 'administrator' || role === 'super_admin' || role === 'editor';
export const canManageAllPosts = (role: UserRole) =>
  role === 'administrator' || role === 'super_admin' || role === 'editor';
export const canPublishPosts = (role: UserRole) =>
  canManageAllPosts(role) || role === 'author';
export const canUploadMedia = (role: UserRole) =>
  canManageAllPosts(role) || role === 'author';

export const getUserRole = (user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }): UserRole => {
  const value = user.app_metadata?.role || user.user_metadata?.role;
  if (value === 'superadmin' || value === 'super-admin') return 'super_admin';
  return roles.includes(value as UserRole) ? value as UserRole : 'subscriber';
};
