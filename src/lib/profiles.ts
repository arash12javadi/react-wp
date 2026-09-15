import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { describeDbError, getSupabaseClient } from './db';
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

export const socialNetworks = [
  { id: 'x', label: 'X (Twitter)', placeholder: 'https://x.com/yourname' },
  { id: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/yourname' },
  { id: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/yourname' },
  { id: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/in/yourname' },
  { id: 'github', label: 'GitHub', placeholder: 'https://github.com/yourname' },
  { id: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@yourname' },
  { id: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@yourname' },
] as const;

export type SocialNetwork = (typeof socialNetworks)[number]['id'];

/** Optional details in public.profile_details, readable only by the person and user managers. */
export interface ProfileDetails {
  first_name: string;
  last_name: string;
  pronouns: string;
  job_title: string;
  company: string;
  website: string;
  location: string;
  timezone: string;
  phone: string;
  birth_date: string;
  social_links: Partial<Record<SocialNetwork, string>>;
}

export const emptyProfileDetails: ProfileDetails = {
  first_name: '', last_name: '', pronouns: '', job_title: '', company: '', website: '', location: '',
  timezone: '', phone: '', birth_date: '', social_links: {},
};

export const profileDetailsMigration = 'supabase/migrations/20260921_profile_details.sql';

const detailTextKeys = ['first_name', 'last_name', 'pronouns', 'job_title', 'company', 'website', 'location', 'timezone', 'phone', 'birth_date'] as const;

/** Explains the failures a person can actually fix, instead of a raw PostgREST message. */
export const explainProfileDetailsError = (error: unknown): string => {
  const message = describeDbError(error);
  if (/profile_details/.test(message) && /schema cache|does not exist|PGRST205|42P01/i.test(message)) {
    return `The profile details table does not exist yet. Run ${profileDetailsMigration} in the Supabase SQL Editor, then reload. (${message})`;
  }
  if (/profile_details_website_check/.test(message)) return 'The website must be a full address starting with http:// or https://.';
  if (/profile_details_lengths_check/.test(message)) return 'One of the fields is too long (names 100 characters, phone 40, the others 120; website 300).';
  if (/profile_details_birth_date_check/.test(message)) return 'The birth date must be after 1 January 1900.';
  if (/profile_details_social_links_check/.test(message)) return 'The social links are too long to save.';
  if (/profile_details_id_fkey|foreign key/i.test(message)) {
    return 'Your profile row does not exist yet, so the details have nothing to attach to. Save "Public details" first, then save these again.';
  }
  return message;
};

export const fetchProfileDetails = async (userId: string): Promise<ProfileDetails> => {
  const { data, error } = await getSupabaseClient()
    .from('profile_details').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return emptyProfileDetails;
  const links = data.social_links && typeof data.social_links === 'object' ? data.social_links as Record<string, unknown> : {};
  return {
    ...Object.fromEntries(detailTextKeys.map((key) => [key, typeof data[key] === 'string' ? data[key] : ''])) as Omit<ProfileDetails, 'social_links'>,
    social_links: Object.fromEntries(socialNetworks
      .filter((network) => typeof links[network.id] === 'string' && links[network.id])
      .map((network) => [network.id, links[network.id] as string])),
  };
};

const isHttpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value);

/** Validates in the browser first so the database constraints are a backstop, not the error message. */
export const saveProfileDetails = async (userId: string, details: ProfileDetails): Promise<ProfileDetails> => {
  const trimmed = Object.fromEntries(detailTextKeys.map((key) => [key, details[key].trim()])) as Omit<ProfileDetails, 'social_links'>;
  if (trimmed.website && !isHttpUrl(trimmed.website)) {
    throw new Error('The website must be a full address starting with http:// or https://.');
  }
  const social: Partial<Record<SocialNetwork, string>> = {};
  for (const network of socialNetworks) {
    const value = (details.social_links[network.id] || '').trim();
    if (!value) continue;
    if (!isHttpUrl(value)) throw new Error(`The ${network.label} link must be a full address starting with https://.`);
    social[network.id] = value;
  }
  if (trimmed.birth_date && new Date(trimmed.birth_date) > new Date()) {
    throw new Error('The birth date is in the future.');
  }
  const row = {
    id: userId,
    ...Object.fromEntries(detailTextKeys.map((key) => [key, trimmed[key] || null])),
    social_links: social,
    updated_at: new Date().toISOString(),
  };
  // .select(): an upsert blocked by row level security can return no row and no error.
  const { data, error } = await getSupabaseClient().from('profile_details').upsert(row).select('id');
  if (error) throw new Error(explainProfileDetailsError(error));
  if (!data?.length) {
    throw new Error('The database accepted the request but saved nothing, which means row level security blocked it. You can only change your own details unless your role can edit users.');
  }
  return { ...trimmed, social_links: social };
};

export const missingProfilesTable =(message: string) =>
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
