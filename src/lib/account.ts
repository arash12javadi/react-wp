import { getSupabaseClient } from './db';
import { loadCapabilityGrants } from './capabilityGrants';
import { fetchProfile } from './profiles';
import { canAccessAdmin } from './roles';
import { loadSettings, type SiteSettings } from './settings';
import { rwp } from './rwp';

/**
 * The account pages: sign in, register, lost password, profile and the visitors' dashboard.
 *
 * Each one has a fixed public path that every link on the site uses (/login?redirect=…). What
 * that path shows is chosen under Settings: the built-in screen, any page (the defaults are pages
 * holding one shortcode, so they can be edited like any other page), or a custom address such as
 * a shop's /my-account. Changing the choice therefore never breaks a link.
 */

export type AccountPageKey = 'login' | 'register' | 'lost_password' | 'profile' | 'dashboard';

export interface AccountPageDefinition {
  key: AccountPageKey;
  path: string;
  label: string;
  description: string;
  /** The default page created on install. */
  title: string;
  slug: string;
  shortcode: string;
}

export const accountPages: AccountPageDefinition[] = [
  {
    key: 'login', path: '/login', label: 'Log in page', title: 'Log In', slug: 'login', shortcode: '[rwp_login_form]',
    description: 'Every "Log in" link on the site opens /login, which shows this.',
  },
  {
    key: 'register', path: '/register', label: 'Registration page', title: 'Register', slug: 'register', shortcode: '[rwp_register_form]',
    description: 'Shown at /register while "Anyone can register" is on.',
  },
  {
    key: 'lost_password', path: '/lost-password', label: 'Lost password page', title: 'Lost Password', slug: 'lost-password', shortcode: '[rwp_lost_password_form]',
    description: 'Sends the reset email, and is where its link returns to choose a new password.',
  },
  {
    key: 'profile', path: '/profile', label: 'User profile page', title: 'User Profile', slug: 'profile', shortcode: '[rwp_user_profile]',
    description: 'Where people edit their name, avatar, email and password. #profile_url# in menus points here.',
  },
  {
    key: 'dashboard', path: '/dashboard', label: 'User dashboard page', title: 'Dashboard', slug: 'dashboard', shortcode: '[rwp_user_dashboard]',
    description: 'Where people land after signing in when they cannot use the admin.',
  },
];

export const accountPageByPath = (pathname: string) =>
  accountPages.find((page) => page.path === `/${pathname.replace(/^\/+|\/+$/g, '')}`);

export const accountIdKey = (key: AccountPageKey) => `${key}_page_id` as const;
export const accountUrlKey = (key: AccountPageKey) => `${key}_page_url` as const;

/** An address a plugin offers for an account page, through the `rwp_account_page_choices` filter. */
export interface AccountPageChoice {
  label: string;
  url: string;
}

export const accountPageChoices = (key: AccountPageKey): AccountPageChoice[] =>
  rwp.filters.apply<AccountPageChoice[]>('rwp_account_page_choices', [], key)
    .filter((choice) => choice && typeof choice.url === 'string' && isSafeUrl(choice.url));

/** What a fixed account path shows: the built-in screen, a page row, or another address. */
export type AccountTarget = { kind: 'builtin' } | { kind: 'page'; pageId: string } | { kind: 'url'; url: string };

/** Only site-relative paths and http(s) addresses; never javascript: or protocol-relative //host. */
export const isSafeUrl = (value: string) => /^\/(?!\/)/.test(value) || /^https?:\/\//i.test(value);

export const accountTarget = (settings: SiteSettings, key: AccountPageKey): AccountTarget => {
  const id = settings[accountIdKey(key)];
  if (id === 'custom') {
    const url = settings[accountUrlKey(key)].trim();
    const own = accountPages.find((page) => page.key === key)!.path;
    // A custom address equal to the fixed path would redirect to itself forever.
    return url && isSafeUrl(url) && url.split(/[?#]/)[0] !== own ? { kind: 'url', url } : { kind: 'builtin' };
  }
  return /^\d+$/.test(id) ? { kind: 'page', pageId: id } : { kind: 'builtin' };
};

/** The ?redirect= a sign-in link carried, when it is a path on this site. */
export const requestedRedirect = () => {
  const value = new URLSearchParams(window.location.search).get('redirect') || '';
  return /^\/(?!\/)/.test(value) ? value : '';
};

export const loginHref = (returnTo = window.location.pathname) => `/login?redirect=${encodeURIComponent(returnTo)}`;

/**
 * Where to go after signing in or registering: the link's ?redirect=, then the Accounts setting,
 * then the admin for roles that can use it and the dashboard for everyone else.
 */
export const afterLoginUrl = async (userId: string, settings?: SiteSettings): Promise<string> => {
  const requested = requestedRedirect();
  if (requested) return requested;
  const configured = (settings || await loadSettings().catch(() => null))?.login_redirect.trim() || '';
  if (configured && isSafeUrl(configured)) return configured;
  // The grants were loaded while signed out, so load them again for the person who just signed in.
  await loadCapabilityGrants().catch(() => undefined);
  const profile = await fetchProfile(userId).catch(() => null);
  return profile && canAccessAdmin(profile.role) ? '/admin' : '/dashboard';
};

/** Signs out everywhere on the site and goes where Settings → Accounts says. */
export const signOutAndRedirect = async (settings?: SiteSettings) => {
  const target = (settings || await loadSettings().catch(() => null))?.logout_redirect.trim() || '';
  await getSupabaseClient().auth.signOut();
  rwp.actions.do('rwp_user_logged_out');
  if (target && isSafeUrl(target)) window.location.href = target;
  else window.location.reload();
};
