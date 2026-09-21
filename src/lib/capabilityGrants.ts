import { describeDbError, getSupabaseClient } from './db';
import {
  grantableRoles, isCapability, roles, setRoleGrants, setViewerGrants, type Capability, type UserRole,
} from './roles';

/**
 * Settings → Roles: extra capabilities for a role (rwp_role_capabilities) or for one person
 * (rwp_user_capabilities). public.user_has_cap() reads the same tables, so these are enforced by
 * the database; this module only keeps the UI in step. Only an Administrator or Super Admin may
 * write either table (checked on profiles.role by their policies).
 */

export const capabilityGrantsMigration = 'supabase/migrations/20261001_account_pages_capabilities.sql';

export interface UserGrant {
  user_id: string;
  capability: Capability;
}

const isMissingTable = (message: string) => /rwp_(role|user)_capabilities/.test(message) && /schema cache|does not exist|PGRST205|42P01/i.test(message);

/** Names the real cause, so a failed save is not reported as a generic error. */
export const explainGrantError = (error: unknown): Error => {
  const message = describeDbError(error);
  if (isMissingTable(message)) {
    return new Error(`The capability tables do not exist yet. Run ${capabilityGrantsMigration} in the Supabase SQL Editor, then reload. (${message})`);
  }
  if (/row-level security|42501/i.test(message)) {
    return new Error(`The database refused this: only an Administrator or Super Admin can grant capabilities, whatever capabilities their role has. (${message})`);
  }
  return new Error(message);
};

const groupByRole = (rows: Array<{ role: string; capability: string }>) => {
  const grouped: Partial<Record<UserRole, Capability[]>> = {};
  rows.forEach(({ role, capability }) => {
    if (!roles.includes(role as UserRole) || !isCapability(capability)) return;
    grouped[role as UserRole] = [...(grouped[role as UserRole] || []), capability];
  });
  return grouped;
};

export const fetchRoleGrants = async (): Promise<Partial<Record<UserRole, Capability[]>>> => {
  const { data, error } = await getSupabaseClient().from('rwp_role_capabilities').select('role,capability');
  if (error) throw explainGrantError(error);
  return groupByRole((data || []) as Array<{ role: string; capability: string }>);
};

/** Everyone's grants (list_users), or only your own for anyone else — the table's policy decides. */
export const fetchUserGrants = async (userId?: string): Promise<UserGrant[]> => {
  let query = getSupabaseClient().from('rwp_user_capabilities').select('user_id,capability');
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query;
  if (error) throw explainGrantError(error);
  return ((data || []) as Array<{ user_id: string; capability: string }>)
    .filter((row): row is UserGrant => isCapability(row.capability));
};

/**
 * Loads the role grants and the signed-in person's own grants into src/lib/roles.ts. Resolves
 * even when the tables are missing (migration not run): the built-in capabilities still apply.
 */
export const loadCapabilityGrants = async (): Promise<void> => {
  const supabase = getSupabaseClient();
  const [roleResult, { data: sessionData }] = await Promise.all([
    fetchRoleGrants().catch((error: unknown) => {
      console.warn(`Role capability grants were not loaded: ${describeDbError(error)}`);
      return {};
    }),
    supabase.auth.getSession(),
  ]);
  setRoleGrants(roleResult);
  const user = sessionData.session?.user;
  if (!user) {
    setViewerGrants(null, []);
    return;
  }
  const [grants, { data: profile }] = await Promise.all([
    fetchUserGrants(user.id).catch(() => [] as UserGrant[]),
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
  ]);
  const role = roles.includes(profile?.role as UserRole) ? profile!.role as UserRole : null;
  setViewerGrants(role, grants.map((grant) => grant.capability));
};

const checkWritten = (rows: unknown[] | null, what: string) => {
  if (!rows?.length) {
    throw new Error(`${what} changed nothing: row level security blocked it. Only an Administrator or Super Admin can change capability grants.`);
  }
};

export const addRoleGrant = async (role: UserRole, capability: Capability) => {
  if (!(grantableRoles as readonly string[]).includes(role)) throw new Error(`The ${role} role already has every capability.`);
  const { data, error } = await getSupabaseClient().from('rwp_role_capabilities')
    .upsert({ role, capability }, { onConflict: 'role,capability' }).select('role');
  if (error) throw explainGrantError(error);
  checkWritten(data, 'Adding the capability');
};

export const removeRoleGrant = async (role: UserRole, capability: Capability) => {
  const { data, error } = await getSupabaseClient().from('rwp_role_capabilities')
    .delete().eq('role', role).eq('capability', capability).select('role');
  if (error) throw explainGrantError(error);
  checkWritten(data, 'Removing the capability');
};

export const addUserGrant = async (userId: string, capability: Capability) => {
  const { data, error } = await getSupabaseClient().from('rwp_user_capabilities')
    .upsert({ user_id: userId, capability }, { onConflict: 'user_id,capability' }).select('user_id');
  if (error) throw explainGrantError(error);
  checkWritten(data, 'Adding the capability');
};

export const removeUserGrant = async (userId: string, capability: Capability) => {
  const { data, error } = await getSupabaseClient().from('rwp_user_capabilities')
    .delete().eq('user_id', userId).eq('capability', capability).select('user_id');
  if (error) throw explainGrantError(error);
  checkWritten(data, 'Removing the capability');
};
