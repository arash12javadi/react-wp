import { useEffect, useState } from 'react';
import { getSupabaseClient } from './db';
import { fetchProfile } from './profiles';

/**
 * Menu items that change with the visitor. Labels may contain #profile_name#, #profile_avatar#
 * or #profile_both#, and URLs may contain #profile_url# (Settings → General). Each item can
 * also say what logged-out visitors see: the item itself, nothing, or another label and link.
 *
 * This is presentation only. The menu JSON is public, so hiding an item does not protect the
 * page it links to.
 */

export type LoggedOutRule = 'show' | 'hide' | 'replace';

export interface MenuItemRules {
  logged_out?: LoggedOutRule;
  logged_out_label?: string;
  logged_out_url?: string;
}

export interface DynamicMenuLink extends MenuItemRules {
  label: string;
  url: string;
  children?: DynamicMenuLink[];
}

export interface ResolvedMenuLink {
  /** Text to show; empty when the label is only an avatar. */
  label: string;
  /** Accessible name, never empty. */
  name: string;
  avatarUrl: string;
  url: string;
  children?: ResolvedMenuLink[];
}

export interface MenuViewer {
  signedIn: boolean;
  id: string;
  name: string;
  avatarUrl: string;
}

export const menuPlaceholders = [
  { token: '#profile_name#', where: 'label', description: "The visitor's display name." },
  { token: '#profile_avatar#', where: 'label', description: "The visitor's avatar image." },
  { token: '#profile_both#', where: 'label', description: 'Avatar followed by the display name.' },
  { token: '#profile_url#', where: 'URL', description: 'The profile page set under Settings → General.' },
] as const;

const placeholderPattern = /#profile_(name|avatar|both|url)#/;

export const hasProfilePlaceholder = (link: { label: string; url: string }) =>
  placeholderPattern.test(link.label) || placeholderPattern.test(link.url);

const signedOut: MenuViewer = { signedIn: false, id: '', name: '', avatarUrl: '' };

let viewerPromise: Promise<MenuViewer> | null = null;

const loadViewer = (): Promise<MenuViewer> => {
  if (!viewerPromise) {
    viewerPromise = getSupabaseClient().auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) return signedOut;
      const profile = await fetchProfile(user.id).catch(() => null);
      return {
        signedIn: true,
        id: user.id,
        name: profile?.display_name?.trim() || user.email?.split('@')[0] || 'Account',
        avatarUrl: profile?.avatar_url?.trim() || '',
      };
    }).catch(() => signedOut);
  }
  return viewerPromise;
};

/** null until the session is known, so items are not shown in the wrong state first. */
export const useMenuViewer = (): MenuViewer | null => {
  const [viewer, setViewer] = useState<MenuViewer | null>(null);
  useEffect(() => {
    let mounted = true;
    void loadViewer().then((value) => { if (mounted) setViewer(value); });
    const { data } = getSupabaseClient().auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
      viewerPromise = null;
      void loadViewer().then((value) => { if (mounted) setViewer(value); });
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return viewer;
};

export const profileUrlFor = (pattern: string, viewer: MenuViewer) =>
  pattern.replace(/\{id\}/g, encodeURIComponent(viewer.id));

export const resolveMenuLink = (
  link: DynamicMenuLink,
  viewer: MenuViewer | null,
  profileUrlPattern: string,
): ResolvedMenuLink | null => {
  const rule = link.logged_out || 'show';
  let label = link.label;
  let url = link.url;

  if (!viewer) {
    // Unknown yet: anything that differs between the two states waits.
    if (rule !== 'show' || hasProfilePlaceholder(link)) return null;
  } else if (!viewer.signedIn) {
    if (rule === 'hide') return null;
    if (rule === 'replace') {
      label = link.logged_out_label?.trim() || label;
      url = link.logged_out_url?.trim() || url;
    }
    // A logged-out visitor has no name or avatar to show.
    if (hasProfilePlaceholder({ label, url })) return null;
  }

  let avatarUrl = '';
  if (viewer?.signedIn) {
    if (/#profile_(avatar|both)#/.test(label)) avatarUrl = viewer.avatarUrl;
    label = label
      .replace(/#profile_both#/g, viewer.name)
      .replace(/#profile_name#/g, viewer.name)
      // Without an avatar image, fall back to the name so the item is not blank.
      .replace(/#profile_avatar#/g, viewer.avatarUrl ? '' : viewer.name)
      .replace(/\s+/g, ' ')
      .trim();
    url = url.replace(/#profile_url#/g, profileUrlFor(profileUrlPattern, viewer));
  }

  const children = link.children
    ?.map((child) => resolveMenuLink(child, viewer, profileUrlPattern))
    .filter((child): child is ResolvedMenuLink => Boolean(child));

  return {
    label,
    name: label || viewer?.name || 'Account',
    avatarUrl,
    url,
    ...(children ? { children } : {}),
  };
};

export const resolveMenuLinks = (links: DynamicMenuLink[], viewer: MenuViewer | null, profileUrlPattern: string) =>
  links
    .map((link) => resolveMenuLink(link, viewer, profileUrlPattern))
    .filter((link): link is ResolvedMenuLink => Boolean(link));

/** Renders a resolved label: optional round avatar, then text. */
export function MenuLabel({ link, size = 24 }: { link: ResolvedMenuLink; size?: number }) {
  return (
    <>
      {link.avatarUrl && (
        <img
          src={link.avatarUrl}
          alt={link.label ? '' : link.name}
          width={size}
          height={size}
          style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', verticalAlign: 'middle', marginRight: link.label ? 6 : 0 }}
        />
      )}
      {link.label}
    </>
  );
}
