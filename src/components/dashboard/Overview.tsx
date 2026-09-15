import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../lib/db';
import { hasCapability, type Capability, type UserRole } from '../../lib/roles';
import { rwp, type RwpSetupLevel } from '../../lib/rwp';
import type { AdminStatus } from '../../lib/adminStatus';
import type { SetupNotice } from '../../lib/setupChecks';
import { availableUpdates } from '../../lib/updates';
import styles from './Dashboard.module.css';

type Navigate = (section: string, subsection?: string) => void;

const levelLabels: Record<RwpSetupLevel, string> = { required: 'Required', recommended: 'Recommended', optional: 'Optional' };
const levelIcons: Record<RwpSetupLevel, string> = { required: '⛔', recommended: '⚠️', optional: '💡' };

function NoticeRow({ notice, hidden, onToggleHidden, navigate }: {
  notice: SetupNotice;
  hidden: boolean;
  onToggleHidden: () => void;
  navigate: Navigate;
}) {
  const [open, setOpen] = useState(notice.level === 'required');
  const { action } = notice;
  return (
    <li className={`${styles.notice} ${styles[`notice_${notice.level}`]} ${hidden ? styles.noticeHidden : ''}`}>
      <div className={styles.noticeHead}>
        <button type="button" className={styles.noticeToggle} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <span className={styles.noticeIcon} aria-hidden="true">{levelIcons[notice.level]}</span>
          <span className={styles.noticeTitle}>{notice.title}</span>
          <span className={styles.levelPill}>{levelLabels[notice.level]}</span>
          <span className={styles.chevron} aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
        <button type="button" className={styles.hideButton} onClick={onToggleHidden}
          title={hidden ? 'Show this again' : 'Hide this. You can show hidden items again below.'}>
          {hidden ? 'Unhide' : 'Hide'}
        </button>
      </div>
      {open && (
        <div className={styles.noticeBody}>
          <p>{notice.description}</p>
          {notice.steps && notice.steps.length > 0 && (
            <ol>{notice.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          )}
          {action && (action.href ? (
            <a className={styles.actionButton} href={action.href} target="_blank" rel="noreferrer">{action.label} ↗</a>
          ) : action.section ? (
            <button type="button" className={styles.actionButton} onClick={() => navigate(action.section as string, action.subsection)}>{action.label} →</button>
          ) : null)}
        </div>
      )}
    </li>
  );
}

function SetupChecklist({ status, navigate }: { status: AdminStatus; navigate: Navigate }) {
  const [showHidden, setShowHidden] = useState(false);
  const { notices, dismissed, setDismissed, noticesLoading } = status;
  const hiddenCount = notices.filter((notice) => dismissed.includes(notice.id)).length;
  const visible = notices.filter((notice) => showHidden || !dismissed.includes(notice.id));
  const counts = (['required', 'recommended', 'optional'] as RwpSetupLevel[])
    .map((level) => [level, notices.filter((notice) => notice.level === level && !dismissed.includes(notice.id)).length] as const)
    .filter(([, count]) => count > 0);

  return (
    <section className={styles.panel} aria-labelledby="setup-heading">
      <div className={styles.panelHead}>
        <div>
          <h2 id="setup-heading">🧰 Finish setting up</h2>
          <p className={styles.muted}>
            {noticesLoading ? 'Checking your site…'
              : counts.length ? counts.map(([level, count]) => `${count} ${levelLabels[level].toLowerCase()}`).join(' · ')
                : 'Nothing left to do.'}
          </p>
        </div>
        <button type="button" className={styles.secondaryButton} disabled={noticesLoading} onClick={status.refreshNotices}>
          {noticesLoading ? 'Checking…' : '↻ Re-check'}
        </button>
      </div>

      {!noticesLoading && visible.length === 0 && (
        <div className={styles.allDone}>
          <span aria-hidden="true">✅</span>
          <div>
            <strong>Everything is set up.</strong>
            <p className={styles.muted}>New suggestions appear here when something needs your attention, for example after activating a plugin.</p>
          </div>
        </div>
      )}

      {visible.length > 0 && (
        <ul className={styles.noticeList}>
          {visible.map((notice) => {
            const hidden = dismissed.includes(notice.id);
            return (
              <NoticeRow key={notice.id} notice={notice} hidden={hidden} navigate={navigate}
                onToggleHidden={() => setDismissed(hidden ? dismissed.filter((id) => id !== notice.id) : [...dismissed, notice.id])} />
            );
          })}
        </ul>
      )}

      {hiddenCount > 0 && (
        <button type="button" className={styles.linkButton} onClick={() => setShowHidden((value) => !value)}>
          {showHidden ? 'Hide the items you hid' : `Show ${hiddenCount} hidden item${hiddenCount === 1 ? '' : 's'}`}
        </button>
      )}
    </section>
  );
}

interface Glance {
  posts: number | null;
  pages: number | null;
  drafts: number | null;
  pendingComments: number | null;
  media: number | null;
  users: number | null;
}

function AtAGlance({ role, navigate }: { role: UserRole; navigate: Navigate }) {
  const [glance, setGlance] = useState<Glance | null>(null);

  useEffect(() => {
    let mounted = true;
    const supabase = getSupabaseClient();
    const count = async (query: PromiseLike<{ count: number | null; error: unknown }>) => {
      const { count: value, error } = await query;
      return error ? null : value ?? 0;
    };
    const pages = () => supabase.from('pages').select('id', { count: 'exact', head: true });
    void Promise.all([
      count(pages().eq('is_post', true).eq('status', 'published')),
      count(pages().eq('is_post', false).eq('status', 'published')),
      count(pages().eq('status', 'draft')),
      hasCapability(role, 'moderate_comments') ? count(supabase.from('comments').select('id', { count: 'exact', head: true }).eq('status', 'pending')) : Promise.resolve(null),
      hasCapability(role, 'upload_files') ? count(supabase.from('media').select('id', { count: 'exact', head: true })) : Promise.resolve(null),
      hasCapability(role, 'list_users') ? count(supabase.from('profiles').select('id', { count: 'exact', head: true })) : Promise.resolve(null),
    ]).then(([posts, pagesCount, drafts, pendingComments, media, users]) => {
      if (mounted) setGlance({ posts, pages: pagesCount, drafts, pendingComments, media, users });
    });
    return () => { mounted = false; };
  }, [role]);

  const tiles: Array<{ key: keyof Glance; icon: string; label: string; section: string; subsection?: string }> = [
    { key: 'posts', icon: '✏️', label: 'Published posts', section: 'content', subsection: 'all' },
    { key: 'pages', icon: '📄', label: 'Published pages', section: 'content', subsection: 'all' },
    { key: 'drafts', icon: '🗒️', label: 'Drafts', section: 'content', subsection: 'all' },
    { key: 'pendingComments', icon: '💬', label: 'Comments to approve', section: 'comments' },
    { key: 'media', icon: '🖼️', label: 'Media files', section: 'media', subsection: 'library' },
    { key: 'users', icon: '👥', label: 'Users', section: 'users' },
  ];

  return (
    <section className={styles.panel} aria-labelledby="glance-heading">
      <h2 id="glance-heading">📊 At a glance</h2>
      <div className={styles.tiles}>
        {tiles.filter((tile) => glance === null || glance[tile.key] !== null).map((tile) => (
          <button key={tile.key} type="button" className={styles.tile} onClick={() => navigate(tile.section, tile.subsection)}>
            <span className={styles.tileIcon} aria-hidden="true">{tile.icon}</span>
            <strong>{glance ? glance[tile.key] : '…'}</strong>
            <span>{tile.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default function Overview({ role, status, navigate, siteTitle }: {
  role: UserRole;
  status: AdminStatus;
  navigate: Navigate;
  siteTitle: string;
}) {
  const { refreshNotices, noticesLoading } = status;
  // The admin runs the checks once on load; coming back to the Dashboard later re-runs them,
  // so a notice disappears after its setting has been saved elsewhere.
  useEffect(() => {
    if (!noticesLoading) refreshNotices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAdmin = hasCapability(role, 'manage_options');
  const updates = availableUpdates(status.updateStatus);
  const widgets = rwp.getDashboardWidgets().filter((widget) => !widget.capability || hasCapability(role, widget.capability as Capability));

  return (
    <div className={styles.dashboard}>
      <section className={styles.welcome}>
        <div>
          <h2>👋 Welcome to {siteTitle}</h2>
          <p>Here is what needs your attention, and shortcuts to the things you do most.</p>
        </div>
        <div className={styles.quickActions}>
          {hasCapability(role, 'edit_posts') && <button type="button" onClick={() => navigate('content', 'new-post')}>✏️ Write a post</button>}
          {hasCapability(role, 'edit_pages') && <button type="button" onClick={() => navigate('content', 'new-page')}>➕ Add a page</button>}
          {hasCapability(role, 'upload_files') && <button type="button" onClick={() => navigate('media', 'library')}>🖼️ Upload media</button>}
          <button type="button" onClick={() => navigate('dashboard', 'guide')}>📘 Read the guide</button>
          <a href="/" target="_blank" rel="noreferrer">🌐 View site ↗</a>
        </div>
      </section>

      {isAdmin && (updates.length > 0 || status.updateStatus?.error || status.updateError) && (
        <button type="button" className={`${styles.updateBanner} ${updates.length ? '' : styles.updateBannerMuted}`} onClick={() => navigate('dashboard', 'updates')}>
          <span aria-hidden="true">🔄</span>
          {updates.length
            ? `${updates.length} update${updates.length === 1 ? ' is' : 's are'} available: ${updates.map((update) => `${update.name} ${update.release.version}`).join(', ')}.`
            : `The last update check failed: ${status.updateStatus?.error || status.updateError}`}
          <span className={styles.bannerLink}>Open Updates →</span>
        </button>
      )}

      <div className={styles.columns}>
        <div className={styles.column}>
          <SetupChecklist status={status} navigate={navigate} />
        </div>
        <div className={styles.column}>
          <AtAGlance role={role} navigate={navigate} />
          {widgets.map(({ id, title, component: Widget }) => (
            <section key={id} className={styles.panel} aria-labelledby={`${id}-heading`}>
              <h2 id={`${id}-heading`}>{title}</h2>
              <Widget />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
