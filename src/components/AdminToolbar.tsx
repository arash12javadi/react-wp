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
}

export default function AdminToolbar({
  email,
  role,
  view,
  onViewSite,
  onViewAdmin,
  onProfile,
  onLogout,
  editLink,
}: AdminToolbarProps) {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="WordPress-style admin toolbar">
      <div className={styles.left}>
        <a className={styles.logo} href={view === 'admin' ? '/' : '/'} aria-label="View site">
          R
        </a>
        <a href="/" className={styles.siteLink}>React-WP</a>
        {view === 'admin' ? (
          onViewSite && <button type="button" onClick={onViewSite}>View site</button>
        ) : (
          <>
            {onViewAdmin && canAccessAdmin(role) && <button type="button" onClick={onViewAdmin}>Dashboard</button>}
            {editLink && <a className={styles.editLink} href={editLink}>✎ Edit page</a>}
          </>
        )}
      </div>
      <div className={styles.right}>
        <span className={styles.user}>{email || 'Administrator'} · {roleLabels[role]}</span>
        {onProfile && <button type="button" onClick={onProfile}>Profile</button>}
        {onLogout && <button type="button" onClick={onLogout}>Log out</button>}
      </div>
    </div>
  );
}
