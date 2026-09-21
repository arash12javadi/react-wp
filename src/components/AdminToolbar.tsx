import type { UserRole } from '../lib/roles';
import { canAccessAdmin } from '../lib/roles';
import { roleLabels } from '../lib/roles';
import styles from './AdminToolbar.module.css';

interface AdminToolbarProps {
  email?: string;
  role: UserRole;
  view: 'site' | 'admin';
  onViewSite?: () => void;
  onViewAdmin?: () => void;
  onProfile?: () => void;
  onLogout?: () => void;
  /** Set on the public site when the viewer may edit the page being displayed. */
  editLink?: string;
  /** Set in the admin while a page or post is being edited. Opens in a new tab, so unsaved edits stay. */
  viewPage?: { href: string; label: string };
}

/**
 * On the public site, whether it shows at all is Settings → Accounts → Admin toolbar
 * (see PublicLayout). /profile and /dashboard show whichever pages Settings chose for them.
 */
export default function AdminToolbar({
  email,
  role,
  view,
  onViewSite,
  onViewAdmin,
  onProfile,
  onLogout,
  editLink,
  viewPage,
}: AdminToolbarProps) {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="WordPress-style admin toolbar">
      <div className={styles.left}>
        <a className={styles.logo} href="/" aria-label="View site">
          R
        </a>
        <a href="/" className={styles.siteLink}>React-WP</a>
        {view === 'admin' ? (
          <>
            {onViewSite && <button type="button" onClick={onViewSite}>View site</button>}
            {viewPage && <a className={styles.editLink} href={viewPage.href} target="_blank" rel="noreferrer">👁 {viewPage.label}</a>}
          </>
        ) : (
          <>
            {onViewAdmin && canAccessAdmin(role) && <button type="button" onClick={onViewAdmin}>Dashboard</button>}
            {!canAccessAdmin(role) && <a className={styles.editLink} href="/dashboard">My account</a>}
            {editLink && <a className={styles.editLink} href={editLink}>✎ Edit page</a>}
          </>
        )}
      </div>
      <div className={styles.right}>
        <span className={styles.user}>{email || 'Administrator'} · {roleLabels[role]}</span>
        {view === 'site'
          ? <a className={styles.editLink} href="/profile">Profile</a>
          : onProfile && <button type="button" onClick={onProfile}>Profile</button>}
        {onLogout && <button type="button" onClick={onLogout}>Log out</button>}
      </div>
    </div>
  );
}
