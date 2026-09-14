import { useEffect, useState, type ReactNode } from 'react';
import styles from './PublicLayout.module.css';
import AdminToolbar from './AdminToolbar';
import LoginButton from './LoginButton';
import WidgetRenderer from './WidgetRenderer';
import { loadWidgetAreas, type Widget } from '../lib/widgets';
import type { UserRole } from '../lib/roles';
import { rwp } from '../lib/rwp';
import { useAppSettings } from '../lib/appSettings';
import { MenuLabel, resolveMenuLinks, useMenuViewer, type DynamicMenuLink, type ResolvedMenuLink } from '../lib/dynamicMenu';

export type MenuLink = DynamicMenuLink;

interface PublicLayoutProps {
  siteTitle: string;
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

const widthClass = (layout: string | undefined, base: string, wide: string, full: string) =>
  layout === 'full' ? full : layout === 'wide' ? wide : base;

const defaultLinks: MenuLink[] = [
  { label: 'Home', url: '/' },
  { label: 'Sample Page', url: '/sample-page' },
  { label: 'Admin Dashboard', url: '/admin' },
];

function NavItem({ link, onNavigate }: { link: ResolvedMenuLink; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const accessibleName = link.label ? undefined : link.name;

  if (!link.children?.length) {
    return <a href={link.url} onClick={onNavigate} aria-label={accessibleName}><MenuLabel link={link} /></a>;
  }

  return (
    <div
      className={styles.hasChildren}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      // Focus events bubble, so this also opens when a keyboard user tabs into the submenu.
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <a href={link.url} aria-haspopup="true" aria-expanded={open} onClick={onNavigate} aria-label={accessibleName}>
        <MenuLabel link={link} /> <span aria-hidden="true">▾</span>
      </a>
      <div className={`${styles.submenu} ${open ? styles.submenuOpen : ''}`}>
        {link.children.map((child) => (
          <a key={`${child.name}-${child.url}`} href={child.url} onClick={onNavigate} aria-label={child.label ? undefined : child.name}>
            <MenuLabel link={child} />
          </a>
        ))}
      </div>
    </div>
  );
}

export default function PublicLayout({
  siteTitle,
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [footerWidgets, setFooterWidgets] = useState<Widget[]>([]);
  const [, refresh] = useState(0);
  useEffect(() => rwp.subscribe(() => refresh((value) => value + 1)), []);
  const headerItems = rwp.getHeaderItems();
  const viewer = useMenuViewer();
  const { settings: appSettings } = useAppSettings();
  const links = resolveMenuLinks(menuLinks?.length ? menuLinks : defaultLinks, viewer, appSettings.menu.profile_url);
  const headerClass = widthClass(layout, styles.header, styles.headerWide, styles.headerFull);
  const footerClass = widthClass(layout, styles.footer, styles.footerWide, styles.footerFull);

  useEffect(() => {
    loadWidgetAreas().then((areas) => setFooterWidgets(areas.footer)).catch(() => setFooterWidgets([]));
  }, []);

  return (
    <div className={styles.site}>
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
      <header className={headerClass}>
        <a className={styles.brand} href="/">
          <strong>{siteTitle}</strong>
          <span>Just another React-WP site</span>
        </a>
        <button
          type="button"
          className={styles.menuButton}
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <nav className={`${styles.nav} ${menuOpen ? styles.navOpen : ''}`} aria-label="Primary navigation">
          {links.map((link) => (
            <NavItem key={`${link.name}-${link.url}`} link={link} onNavigate={() => setMenuOpen(false)} />
          ))}
          {headerItems.map(({ id, component: Item }) => <Item key={id} />)}
          {showAuthLinks && (
            <span className={styles.authLinks}>
              {!adminEmail && canRegister && <a href="/register">Register</a>}
              <LoginButton variant="button" />
            </span>
          )}
        </nav>
      </header>
      {children}
      {footerWidgets.length > 0 && (
        <div className={footerClass}>
          <div className={styles.footerWidgets}>
            {footerWidgets.map((widget) => <WidgetRenderer key={widget.id} widget={widget} />)}
          </div>
        </div>
      )}
      <footer className={footerClass}>
        <span>© {new Date().getFullYear()} {siteTitle}</span>
        <span>Powered by React-WP &amp; Supabase</span>
      </footer>
    </div>
  );
}
