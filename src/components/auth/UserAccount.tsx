import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../lib/db';
import { fetchProfile, type Profile } from '../../lib/profiles';
import { canAccessAdmin, getUserRole, roleLabels, type UserRole } from '../../lib/roles';
import { defaultSettings, loadSettings, type SiteSettings } from '../../lib/settings';
import { loginHref, signOutAndRedirect } from '../../lib/account';
import { HookSlot } from '../../core/HookSlot';
import ProfileManager from '../ProfileManager';
import DashboardCard from './DashboardCard';
import authStyles from '../AuthPage.module.css';
import styles from './UserAccount.module.css';

interface Viewer {
  user: User;
  profile: Profile | null;
  role: UserRole;
}

/** Loads the signed-in person, or asks a visitor to sign in first. */
function SignedIn({ children, what }: { children: (viewer: Viewer, settings: SiteSettings) => ReactNode; what: string }) {
  const [state, setState] = useState<{ viewer: Viewer | null; settings: SiteSettings; ready: boolean }>({
    viewer: null, settings: defaultSettings, ready: false,
  });

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [settings, { data }] = await Promise.all([
        loadSettings().catch(() => defaultSettings),
        getSupabaseClient().auth.getSession(),
      ]);
      const user = data.session?.user;
      const profile = user ? await fetchProfile(user.id).catch(() => null) : null;
      if (!mounted) return;
      setState({
        viewer: user ? { user, profile, role: profile ? profile.role : getUserRole(user) } : null,
        settings,
        ready: true,
      });
    })();
    return () => { mounted = false; };
  }, []);

  if (!state.ready) return <p className={authStyles.muted}>Loading…</p>;
  if (!state.viewer) {
    return (
      <div className={`${authStyles.card} ${authStyles.inline} rwp-account-signin`}>
        <h2>Please sign in</h2>
        <p className={authStyles.subtitle}>Sign in to see {what}.</p>
        <a className={authStyles.primary} href={loginHref()}>Sign in</a>
        {state.settings.users_can_register && (
          <p className={authStyles.switch}>No account yet? <a href={`/register?redirect=${encodeURIComponent(window.location.pathname)}`}>Create one</a></p>
        )}
      </div>
    );
  }
  return <>{children(state.viewer, state.settings)}</>;
}

/** [rwp_user_profile]: the signed-in person's own profile form. */
export function UserProfile() {
  return (
    <SignedIn what="your profile">
      {(viewer) => <div className={authStyles.panel}><ProfileManager role={viewer.role} embedded /></div>}
    </SignedIn>
  );
}

/**
 * [rwp_user_dashboard]: what signed-in visitors land on. Plugins add cards with the
 * `user_dashboard` slot, e.g. `addSlotContent('user_dashboard', 'orders', ({ userId }) => …)`.
 */
export function UserDashboard({ title }: { title?: string }) {
  return (
    <SignedIn what="your dashboard">
      {(viewer, settings) => <DashboardView viewer={viewer} settings={settings} title={title} />}
    </SignedIn>
  );
}

function DashboardView({ viewer, settings, title }: { viewer: Viewer; settings: SiteSettings; title?: string }) {
  const { user, profile, role } = viewer;
  const name = profile?.display_name || user.email || 'there';
  const slotArgs = useMemo(() => ({ userId: user.id, role }), [role, user.id]);

  return (
    <section className={`${styles.dashboard} rwp-user-dashboard`} aria-labelledby="rwp-dashboard-heading">
      <header className={styles.header}>
        {profile?.avatar_url
          ? <img className={styles.avatar} src={profile.avatar_url} alt="" />
          : <span className={styles.avatarFallback} aria-hidden="true">{name.charAt(0).toUpperCase()}</span>}
        <div>
          <h2 id="rwp-dashboard-heading">{title || `Hello, ${name}`}</h2>
          <p>
            {user.email} · {roleLabels[role]}
            {profile && <> · Member since {new Date(profile.created_at).toLocaleDateString()}</>}
          </p>
        </div>
      </header>

      <div className={`${styles.cards} rwp-user-dashboard-cards`}>
        <DashboardCard href="/profile" title="Profile" text="Change your name, avatar, email or password." />
        {canAccessAdmin(role) && <DashboardCard href="/admin" title="Admin dashboard" text="Write and manage content." />}
        <HookSlot name="user_dashboard" args={slotArgs} />
        <button type="button" className={styles.card} onClick={() => void signOutAndRedirect(settings)}>
          <strong>Log out</strong>
          <span>Sign out of this site on this device.</span>
        </button>
      </div>
    </section>
  );
}
