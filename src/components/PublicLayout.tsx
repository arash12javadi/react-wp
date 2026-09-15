import { useEffect, useMemo, useState, type ReactNode } from 'react';
import styles from './PublicLayout.module.css';
import AdminToolbar from './AdminToolbar';
import { ThemeChromeProvider, ThemeFooter, ThemeHeader, ThemePreviewBanner, useThemeDocument, type ThemeChrome } from './theme/ThemeLayoutRenderer';
import { loadWidgetAreas } from '../lib/widgets';
import type { UserRole } from '../lib/roles';
import type { SiteBranding } from '../lib/settings';
import type { DynamicMenuLink } from '../lib/dynamicMenu';

export type MenuLink = DynamicMenuLink;

interface PublicLayoutProps {
  siteTitle: string;
  /** Tagline, logo and what the brand area shows. The title comes from siteTitle, already filtered. */
  branding?: Pick<SiteBranding, 'site_tagline' | 'site_logo' | 'header_display' | 'logo_height'>;
  children: ReactNode;
  adminEmail?: string;
  onLogout?: () => void;
  role?: UserRole;
  onViewAdmin?: () => void;
  menuLinks?: MenuLink[];
  editLink?: string;
  /** Matches the header and footer width to the page's own content width. */
  layout?: string;
  showAuthLinks?: boolean;
  canRegister?: boolean;
}

const defaultLinks: MenuLink[] = [
  { label: 'Home', url: '/' },
  { label: 'Sample Page', url: '/sample-page' },
  { label: 'Admin Dashboard', url: '/admin' },
];

/** The header and footer are laid out under Appearance → Theme Editor; see ThemeLayoutRenderer. */
export default function PublicLayout({
  siteTitle,
  branding,
  children,
  adminEmail,
  onLogout,
  menuLinks,
  role = 'subscriber',
  onViewAdmin,
  editLink,
  layout,
  showAuthLinks = true,
  canRegister = true,
}: PublicLayoutProps) {
  const [widgets, setWidgets] = useState<ThemeChrome['widgets']>(null);
  useThemeDocument();

  useEffect(() => {
    loadWidgetAreas().then(setWidgets).catch(() => setWidgets({ sidebar: [], footer: [] }));
  }, []);

  const chrome = useMemo<ThemeChrome>(() => ({
    siteTitle,
    branding,
    menuLinks: menuLinks?.length ? menuLinks : defaultLinks,
    signedIn: Boolean(adminEmail),
    showAuthLinks,
    canRegister,
    widgets,
  }), [adminEmail, branding, canRegister, menuLinks, showAuthLinks, siteTitle, widgets]);

  return (
    <ThemeChromeProvider value={chrome}>
      <div className={`${styles.site} rwp-site`}>
        {adminEmail && (
          <AdminToolbar
            email={adminEmail}
            role={role}
            view="site"
            onViewAdmin={onViewAdmin}
            onLogout={onLogout}
            editLink={editLink}
          />
        )}
        <ThemeHeader layoutWidth={layout} />
        {children}
        <ThemeFooter layoutWidth={layout} />
        <ThemePreviewBanner />
      </div>
    </ThemeChromeProvider>
  );
}
