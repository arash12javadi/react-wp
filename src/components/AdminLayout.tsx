import { useState, type ReactNode } from 'react';
import styles from './AdminLayout.module.css';

export type AdminSection = 'dashboard' | 'posts' | 'settings';

interface AdminLayoutProps {
  children: ReactNode;
  activeSection: AdminSection;
  onNavigate: (section: AdminSection) => void;
  onLogout: () => void;
  userEmail?: string;
  siteTitle?: string;
}

const navigation: Array<{ id: AdminSection; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'posts', label: 'Posts', icon: '▤' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export default function AdminLayout({
  children,
  activeSection,
  onNavigate,
  onLogout,
  userEmail,
  siteTitle = 'React-WP',
}: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navigate = (section: AdminSection) => {
    onNavigate(section);
    setSidebarOpen(false);
  };

  return (
    <div className={styles.shell}>
      {sidebarOpen && (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Close navigation menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`} aria-label="Admin navigation">
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">R</span>
          <span>{siteTitle}</span>
        </div>
        <nav>
          <p className={styles.navLabel}>Manage</p>
          {navigation.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`${styles.navItem} ${activeSection === item.id ? styles.navItemActive : ''}`}
              aria-current={activeSection === item.id ? 'page' : undefined}
              onClick={() => navigate(item.id)}
            >
              <span className={styles.navIcon} aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <button type="button" className={styles.logoutButton} onClick={onLogout}>
            <span aria-hidden="true">↪</span>
            Log out
          </button>
        </div>
      </aside>

      <div className={styles.content}>
        <header className={styles.header}>
          <button
            type="button"
            className={styles.menuButton}
            aria-label="Open navigation menu"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <span aria-hidden="true">☰</span>
          </button>
          <div className={styles.headerTitle}>
            <span className={styles.eyebrow}>Admin</span>
            <h1>{navigation.find((item) => item.id === activeSection)?.label}</h1>
          </div>
          <div className={styles.account}>
            <span className={styles.avatar} aria-hidden="true">{(userEmail || 'A').charAt(0).toUpperCase()}</span>
            <span className={styles.email}>{userEmail || 'Administrator'}</span>
          </div>
        </header>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
