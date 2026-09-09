import { useState, type ReactNode } from 'react';
import styles from './AdminLayout.module.css';
import { canManageComments, canManageSettings, type UserRole, roleLabels } from '../lib/roles';
import AdminToolbar from './AdminToolbar';

export type AdminSection = 'dashboard' | 'posts' | 'comments' | 'settings' | 'profile';

interface AdminLayoutProps {
  children: ReactNode;
  activeSection: AdminSection;
  onNavigate: (section: AdminSection) => void;
  onLogout: () => void;
  userEmail?: string;
  siteTitle?: string;
  role: UserRole;
  onViewSite: () => void;
}

const baseNavigation: Array<{ id: AdminSection; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'posts', label: 'Posts', icon: '▤' },
  { id: 'comments', label: 'Comments', icon: '◌' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
  { id: 'profile', label: 'Profile', icon: '◉' },
];

export default function AdminLayout({
  children,
  activeSection,
  onNavigate,
  onLogout,
  userEmail,
  siteTitle = 'React-WP',
  role,
  onViewSite,
}: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigation = baseNavigation.filter((item) =>
    (item.id !== 'comments' || canManageComments(role)) &&
    (item.id !== 'settings' || canManageSettings(role)),
  );

  const navigate = (section: AdminSection) => {
    onNavigate(section);
    setSidebarOpen(false);
  };

  return (
    <div className={styles.shell}>
      <AdminToolbar
        email={userEmail}
        role={role}
        view="admin"
        onViewSite={onViewSite}
        onProfile={() => onNavigate('profile')}
        onLogout={onLogout}
      />
      <div className={styles.workspace}>
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
              <button type="button" className={styles.viewSiteButton} onClick={onViewSite}>View site</button>
              <span className={styles.avatar} aria-hidden="true">{(userEmail || 'A').charAt(0).toUpperCase()}</span>
              <span className={styles.email}>{userEmail || 'Administrator'} · {roleLabels[role]}</span>
            </div>
          </header>
          <main className={styles.main}>{children}</main>
        </div>
      </div>
    </div>
  );
}
