import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseClient } from './db';
import { getUserRole, roles, type UserRole } from './roles';

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

const toRole = (value: unknown): UserRole =>
  roles.includes(value as UserRole) ? (value as UserRole) : 'subscriber';

const profileColumns = 'id,email,display_name,avatar_url,bio,role,created_at,updated_at';

export const fetchProfile = async (userId: string): Promise<Profile | null> => {
  const { data, error } = await getSupabaseClient()
    .from('profiles')
    .select(profileColumns)
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...data, role: toRole(data.role) } as Profile : null;
};

export const fetchProfiles = async (): Promise<Profile[]> => {
  const { data, error } = await getSupabaseClient()
    .from('profiles')
    .select(profileColumns)
    .order('created_at');
  if (error) throw error;
  return ((data || []) as Profile[]).map((profile) => ({ ...profile, role: toRole(profile.role) }));
};

export const missingProfilesTable = (message: string) =>
  message.includes('public.profiles') || message.includes('relation "profiles"') || message.includes("'profiles'");

/**
 * Resolves the signed-in user's role from public.profiles. Falls back to user_metadata
 * only when the table is absent, i.e. before the 20260912 migration has been run.
 */
export const useCurrentProfile = (user: User | null | undefined) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<UserRole>('subscriber');
  const [loading, setLoading] = useState(Boolean(user));
  // Keyed on the id, not the object: onAuthStateChange hands back a new object each time.
  const userId = user?.id;

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setRole('subscriber');
      setLoading(false);
      return;
    }
    let mounted = true;
    setLoading(true);
    fetchProfile(user.id)
      .then((result) => {
        if (!mounted) return;
        setProfile(result);
        setRole(result ? result.role : getUserRole(user));
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : '';
        setRole(missingProfilesTable(message) ? getUserRole(user) : 'subscriber');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return { profile, role, loading };
};
