import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getSupabaseClient } from '../lib/db';
import { fetchProfile } from '../lib/profiles';
import { getUserRole, type UserRole } from '../lib/roles';
import { defaultSettings, loadSettings, type SiteSettings } from '../lib/settings';
import { rwp } from '../lib/rwp';
import PublicLayout, { type MenuLink } from './PublicLayout';

export interface PublicChromeState {
  settings: SiteSettings;
  userId: string;
  email: string;
  role: UserRole;
  /** False until the session and profile have been resolved. */
  ready: boolean;
}

const PublicChromeContext = createContext<PublicChromeState>({
  settings: defaultSettings,
  userId: '',
  email: '',
  role: 'subscriber',
  ready: false,
});

/** Site settings and the signed-in user, for components rendered inside plugin routes. */
export const usePublicChrome = () => useContext(PublicChromeContext);

const defaultMenuLinks: MenuLink[] = [{ label: 'Home', url: '/' }];

/**
 * The public header, menu and footer for pages that are not rows in the pages table,
 * such as plugin routes. Mirrors what PublicContent loads for a regular page.
 */
export default function PublicChrome({ children, layout = 'wide' }: { children: ReactNode; layout?: string }) {
  const [state, setState] = useState<PublicChromeState>({
    settings: defaultSettings, userId: '', email: '', role: 'subscriber', ready: false,
  });
  const [menuLinks, setMenuLinks] = useState<MenuLink[]>(defaultMenuLinks);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const supabase = getSupabaseClient();
      const [settings, { data: menuOption }, { data: sessionData }] = await Promise.all([
        loadSettings().catch(() => defaultSettings),
        supabase.from('options').select('option_value').eq('option_name', 'menu_links').maybeSingle(),
        supabase.auth.getSession(),
      ]);
      if (!mounted) return;
      if (menuOption?.option_value) {
        try {
          const parsed = JSON.parse(menuOption.option_value);
          if (Array.isArray(parsed)) setMenuLinks(rwp.filters.apply('rwp_public_menu', parsed));
        } catch {
          // Keep the default menu when the option contains invalid JSON.
        }
      }
      const user = sessionData.session?.user;
      let role: UserRole = 'subscriber';
      if (user) {
        const profile = await fetchProfile(user.id).catch(() => null);
        role = profile ? profile.role : getUserRole(user);
      }
      if (mounted) {
        setState({ settings, userId: user?.id || '', email: user?.email || '', role, ready: true });
      }
    };
    void load();
    return () => { mounted = false; };
  }, []);

  return (
    <PublicChromeContext.Provider value={state}>
      <PublicLayout
        siteTitle={state.ready ? rwp.filters.apply('rwp_site_title', state.settings.site_title) : ''}
        branding={state.settings}
        menuLinks={menuLinks}
        adminEmail={state.email || undefined}
        role={state.role}
        layout={layout}
        showAuthLinks={state.settings.show_auth_links}
        canRegister={state.settings.users_can_register}
        onViewAdmin={() => { window.location.href = '/admin'; }}
        onLogout={async () => {
          await getSupabaseClient().auth.signOut();
          window.location.reload();
        }}
      >
        {children}
      </PublicLayout>
    </PublicChromeContext.Provider>
  );
}
