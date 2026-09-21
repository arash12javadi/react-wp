import { useState, type ReactNode } from 'react';
import styles from './AdminLayout.module.css';
import { type UserRole, roleLabels } from '../lib/roles';
import type { AdminNavItem } from '../lib/adminNavigation';
import type { SiteBranding } from '../lib/settings';
import AdminToolbar from './AdminToolbar';

interface AdminLayoutProps {
  children: ReactNode;
  navigation: AdminNavItem[];
  activeSection: string;
  activeSubsection: string;
  onNavigate: (section: string, subsection?: string) => void;
  onLogout: () => void;
  userEmail?: string;
  branding: SiteBranding;
  role: UserRole;
  onViewSite: () => void;
  /** While a page or post is open in the editor: its public address ("View page" / "Preview page"). */
  viewPage?: { href: string; label: string };
  /** Shown as a count bubble next to Dashboard, like WordPress's update counts. */
  dashboardBadge?: number;
}

export default function AdminLayout({
  children,
  navigation,
  activeSection,
  activeSubsection,
  onNavigate,
  onLogout,
  userEmail,
  branding,
  role,
  onViewSite,
  viewPage,
  dashboardBadge = 0,
}: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const active = navigation.find((item) => item.id === activeSection);
  const activeSub = active?.submenu?.find((sub) => sub.id === activeSubsection);

  const navigate = (section: string, subsection?: string) => {
    onNavigate(section, subsection);
    setSidebarOpen(false);
  };

  const mark = branding.site_icon || branding.site_logo;

  return (
    <div className={styles.shell}>
      <AdminToolbar
        email={userEmail}
        role={role}
        view="admin"
        onViewSite={onViewSite}
        viewPage={viewPage}
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
          <a className={styles.brand} href="/" title="View site">
            {mark
              ? <img className={styles.brandImage} src={mark} alt="" />
              : <span className={styles.brandMark} aria-hidden="true">{(branding.site_title || 'R').charAt(0).toUpperCase()}</span>}
            <span>{branding.site_title}</span>
          </a>
          <nav>
            <p className={styles.navLabel}>Manage</p>
            <ul className={styles.navList}>
              {navigation.map((item) => {
                const isActive = item.id === activeSection;
                const submenu = item.submenu || [];
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
                      aria-current={isActive && !submenu.length ? 'page' : undefined}
                      aria-expanded={submenu.length ? isActive : undefined}
                      onClick={() => navigate(item.id)}
                    >
                      <span className={styles.navIcon} aria-hidden="true">{item.icon}</span>
                      <span className={styles.navText}>{item.label}</span>
                      {item.id === 'dashboard' && dashboardBadge > 0 && (
                        <span className={styles.badge} title={`${dashboardBadge} setup item(s) need attention`}>{dashboardBadge}</span>
                      )}
                    </button>
                    {isActive && submenu.length > 0 && (
                      <ul className={styles.submenu}>
                        {submenu.map((sub) => (
                          <li key={sub.id}>
                            <button
                              type="button"
                              className={`${styles.subItem} ${sub.id === activeSubsection ? styles.subItemActive : ''}`}
                              aria-current={sub.id === activeSubsection ? 'page' : undefined}
                              onClick={() => navigate(item.id, sub.id)}
                            >
                              {sub.icon && <span className={styles.subIcon} aria-hidden="true">{sub.icon}</span>}
                              {sub.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className={styles.sidebarFooter}>
            <button type="button" className={styles.logoutButton} onClick={onLogout}>
              <span className={styles.navIcon} aria-hidden="true">🚪</span>
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
              <span className={styles.eyebrow}>{activeSub ? active?.label : 'Admin'}</span>
              <h1>
                {(activeSub || active)?.icon && <span className={styles.headerIcon} aria-hidden="true">{(activeSub || active)?.icon}</span>}
                {activeSub ? activeSub.label : active?.label}
              </h1>
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
