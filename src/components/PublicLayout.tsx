import { useEffect, useMemo, useState, type ReactNode } from 'react';
import styles from './PublicLayout.module.css';
import AdminToolbar from './AdminToolbar';
import { ThemeChromeProvider, ThemeFooter, ThemeHeader, ThemePreviewBanner, useThemeDocument, type ThemeChrome } from './theme/ThemeLayoutRenderer';
import { loadWidgetAreas } from '../lib/widgets';
import { HookSlot } from '../core/HookSlot';
import SiteTemplate from './SiteTemplate';
import { canAccessAdmin, type UserRole } from '../lib/roles';
import type { AdminToolbarMode, SiteBranding } from '../lib/settings';
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
  /** Who sees the admin toolbar (Settings → Accounts). */
  toolbar?: AdminToolbarMode;
  /** A page's own "Show header & navigation" / "Show footer" switches. */
  showHeader?: boolean;
  showFooter?: boolean;
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
  toolbar = 'everyone',
  showHeader = true,
  showFooter = true,
}: PublicLayoutProps) {
  const [widgets, setWidgets] = useState<ThemeChrome['widgets']>(null);
  const showToolbar = Boolean(adminEmail) && (toolbar === 'everyone' || (toolbar === 'admins' && canAccessAdmin(role)));
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
        {showToolbar && (
          <AdminToolbar
            email={adminEmail}
            role={role}
            view="site"
            onViewAdmin={onViewAdmin}
            onLogout={onLogout}
            editLink={editLink}
          />
        )}
        {/*
          The four zones a plugin can render into around the chrome. They sit outside
          SiteTemplate so they behave the same whether the header comes from the Theme Editor
          or from a Page Builder template.
        */}
        <HookSlot name="before_header" args={{ layout }} />
        {/* A published Page Builder header or footer template replaces the Theme Editor's. */}
        {showHeader && <SiteTemplate types={['header']} layoutWidth={layout} fallback={<ThemeHeader layoutWidth={layout} />} />}
        <HookSlot name="after_header" args={{ layout }} />
        {children}
        <HookSlot name="before_footer" args={{ layout }} />
        {showFooter && <SiteTemplate types={['footer']} layoutWidth={layout} fallback={<ThemeFooter layoutWidth={layout} />} />}
        <HookSlot name="after_footer" args={{ layout }} />
        <ThemePreviewBanner />
      </div>
    </ThemeChromeProvider>
  );
}
