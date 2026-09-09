import { useState, type ReactNode } from 'react';
import styles from './PublicLayout.module.css';
import AdminToolbar from './AdminToolbar';
import type { UserRole } from '../lib/roles';

interface PublicLayoutProps {
  siteTitle: string;
  children: ReactNode;
  adminEmail?: string;
  onLogout?: () => void;
  role?: UserRole;
  onViewAdmin?: () => void;
  menuLinks?: Array<{ label: string; url: string }>;
}

export default function PublicLayout({ siteTitle, children, adminEmail, onLogout, menuLinks, role = 'subscriber', onViewAdmin }: PublicLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={styles.site}>
      {adminEmail && <AdminToolbar email={adminEmail} role={role} view="site" onViewAdmin={onViewAdmin} onLogout={onLogout} />}
      <header className={styles.header}>
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
          {(menuLinks || [
            { label: 'Home', url: '/' },
            { label: 'Sample Page', url: '/sample-page' },
            { label: 'Admin Dashboard', url: '/admin' },
          ]).map((link) => (
            <a key={`${link.label}-${link.url}`} href={link.url} onClick={() => setMenuOpen(false)}>{link.label}</a>
          ))}
        </nav>
      </header>
      {children}
      <footer className={styles.footer}>
        <span>© {new Date().getFullYear()} {siteTitle}</span>
        <span>Powered by React-WP &amp; Supabase</span>
      </footer>
    </div>
  );
}
