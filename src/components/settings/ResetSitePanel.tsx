import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../lib/db';
import { fetchProfile } from '../../lib/profiles';
import { resetSite, type MediaWipeSummary } from '../../lib/pluginSchema';
import styles from './ResetSitePanel.module.css';

/** Roles allowed to reset. Deliberately not a capability: manage_options can be granted. */
const resetRoles = ['administrator', 'super_admin'];

interface ResetSummary {
  usersDeleted: number;
  /** ImageKit rows: those files are not deleted, so they are reported instead. */
  remoteFiles: number;
  media: MediaWipeSummary;
}

const consequences = [
  'Every table in the public schema is dropped: pages, posts, comments, media records, menus, options, theme settings and every plugin table.',
  'Every Cloudinary file this site uploaded is deleted, in the Media Library and in every plugin folder.',
  'Every user account is deleted, including yours. You will be signed out.',
  'The site returns to the Setup Wizard, where it has to be installed again from scratch.',
];

/**
 * Settings → Advanced → Reset Website.
 *
 * The confirmation is deliberately three separate acts — open the dialog, type RESET, enter the
 * account password — because each one is easy to do by accident and hard to do all three of.
 * None of them is the real guard: /api/admin/reset-site re-checks the role and re-verifies the
 * password against Supabase Auth, since anything the browser decides can be skipped.
 */
export default function ResetSitePanel() {
  const [role, setRole] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  /** Opt-out, not opt-in: a factory reset that leaves the files behind is not a factory reset. */
  const [wipeMedia, setWipeMedia] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<ResetSummary | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const { data } = await getSupabaseClient().auth.getUser();
      if (!data.user) {
        if (mounted) setRole('');
        return;
      }
      const profile = await fetchProfile(data.user.id).catch(() => null);
      if (!mounted) return;
      setEmail(data.user.email || '');
      setRole(profile?.role || '');
    })();
    return () => { mounted = false; };
  }, []);

  const reset = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await resetSite({
        password,
        confirm: confirmText,
        wipeMedia,
        ...(dbPassword ? { dbPassword } : {}),
      });
      setDone({ usersDeleted: result.usersDeleted, remoteFiles: result.remoteFiles, media: result.media });
      // Local session tokens now point at accounts that no longer exist. Cleared before the
      // redirect, or the wizard loads with a stale session and fails in a confusing way.
      await getSupabaseClient().auth.signOut().catch(() => {});
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch {
        // Private mode: the sign-out above is enough.
      }
      window.setTimeout(() => { window.location.href = result.next || '/'; }, 2500);
    } catch (resetError: unknown) {
      setError(resetError instanceof Error ? resetError.message : 'The site could not be reset.');
      setBusy(false);
    }
  };

  if (role === null) return <div className={styles.loading} role="status">Checking your permissions…</div>;

  if (!resetRoles.includes(role)) {
    return (
      <div className={styles.denied} role="status">
        <strong>Resetting the site is restricted to Administrators.</strong>
        <span>Your role is {role ? <code>{role}</code> : 'not set'}, so this screen is read-only.</span>
      </div>
    );
  }

  if (done) {
    return (
      <div className={styles.done} role="status">
        <strong>The site has been reset.</strong>
        <p>
          {done.usersDeleted} account{done.usersDeleted === 1 ? ' was' : 's were'} deleted and the
          database is empty. Taking you to the Setup Wizard…
        </p>
        {done.media.attempted && (
          <p>
            {done.media.deleted} Cloudinary file{done.media.deleted === 1 ? '' : 's'} deleted
            {done.media.notFound > 0 && `, ${done.media.notFound} already gone`}.
          </p>
        )}
        {done.media.warnings.length > 0 && (
          <p className={styles.leftover}>{done.media.warnings.join(' ')}</p>
        )}
        {done.remoteFiles > 0 && (
          <p className={styles.leftover}>
            {done.remoteFiles} file{done.remoteFiles === 1 ? '' : 's'} had been uploaded to
            ImageKit. Those were <strong>not</strong> deleted: ImageKit has no bulk or
            prefix delete, so wiping them would mean one request per file. Remove them from the
            ImageKit dashboard if you want them gone.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.danger}>
        <h3>Reset Website</h3>
        <p>
          Returns this installation to a blank slate, as if it had just been downloaded. There is no
          undo and no confirmation email.
        </p>
        <ul>{consequences.map((line) => <li key={line}>{line}</li>)}</ul>
        <p className={styles.advice}>
          <strong>Take a backup first.</strong> Settings → Backup downloads the whole site as one
          file, and it is the only thing that can bring any of this back.
        </p>
      </div>

      {!open ? (
        <button type="button" className={styles.open} onClick={() => setOpen(true)}>
          Reset this website…
        </button>
      ) : (
        <div className={styles.dialog} role="group" aria-label="Confirm site reset">
          <p className={styles.dialogIntro}>
            This will permanently wipe all database tables, users, uploads and configuration. The
            website will return to the initial Setup Wizard stage.
          </p>

          <label className={styles.ack}>
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>I have a backup, or I accept that this data is not coming back.</span>
          </label>

          <label className={styles.ack}>
            <input
              type="checkbox"
              checked={wipeMedia}
              disabled={busy}
              onChange={(event) => setWipeMedia(event.target.checked)}
            />
            <span>
              Also delete every uploaded file from Cloudinary.
              <small>
                Deletes what this site recorded in its Media Library, plus everything under{' '}
                <code>media/</code> and <code>plugins/</code>. It never touches other folders, so
                a Cloudinary account shared with another site keeps its files. Clear this box to
                leave all files in place.
              </small>
            </span>
          </label>

          <label className={styles.field} htmlFor="reset-confirm">
            Type <code>RESET</code> to confirm
            <input
              id="reset-confirm"
              type="text"
              value={confirmText}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder="RESET"
            />
          </label>

          <label className={styles.field} htmlFor="reset-password">
            Your administrator password{email && <small>for {email}</small>}
            <input
              id="reset-password"
              type="password"
              value={password}
              autoComplete="current-password"
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <label className={styles.field} htmlFor="reset-db-password">
            Supabase database password
            <small>
              Only needed if this server has no <code>SUPABASE_DB_URL</code> in <code>.env.local</code>.
              Leave blank to use the server&apos;s own credentials. This is the database password from
              Project Settings → Database, not your Supabase account password.
            </small>
            <input
              id="reset-db-password"
              type="password"
              value={dbPassword}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setDbPassword(event.target.value)}
            />
          </label>

          {error && <div className={styles.error} role="alert">{error}</div>}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancel}
              disabled={busy}
              onClick={() => { setOpen(false); setConfirmText(''); setPassword(''); setDbPassword(''); setAcknowledged(false); setError(''); }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.confirm}
              disabled={busy || !acknowledged || confirmText !== 'RESET' || !password}
              onClick={() => void reset()}
            >
              {busy ? 'Resetting…' : 'Permanently reset this website'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
