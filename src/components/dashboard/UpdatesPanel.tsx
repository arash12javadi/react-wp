import { useState, type FormEvent } from 'react';
import type { AdminStatus } from '../../lib/adminStatus';
import { rwp } from '../../lib/rwp';
import {
  autoCheckIntervals, availableUpdates, checkForUpdates, compareVersions, defaultFeedUrl, installedAppVersion,
  saveUpdateSettings, type AutoCheck, type UpdateSettings,
} from '../../lib/updates';
import styles from './Dashboard.module.css';

const timeAgo = (iso: string) => {
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'just now';
  const units: Array<[number, string]> = [[60, 'minute'], [3600, 'hour'], [86400, 'day'], [2592000, 'month']];
  const [size, unit] = [...units].reverse().find(([limit]) => seconds >= limit) || units[0];
  const amount = Math.floor(seconds / size);
  return `${amount} ${unit}${amount === 1 ? '' : 's'} ago`;
};

function HowToInstall() {
  return (
    <details className={styles.howTo}>
      <summary>How to install an update</summary>
      <p>
        React-WP runs from a built bundle and a Node server, so an update is installed on the machine or host that runs
        the site — the admin cannot rewrite its own code. Back up first: <strong>Settings → Backup → Export backup</strong>.
      </p>
      <h4>If you installed with git</h4>
      <ol>
        <li>Stop the server, then run <code>git pull</code> in the project folder.</li>
        <li>Run <code>npm install</code> (new packages may have been added).</li>
        <li>Run every migration listed with the update in Supabase → SQL Editor, oldest first. Each one is safe to re-run.</li>
        <li>Start again with <code>npm start</code> (it rebuilds before starting).</li>
      </ol>
      <h4>If you installed from a ZIP</h4>
      <ol>
        <li>Download the new ZIP and extract it over the old folder, <strong>keeping</strong> <code>.env.local</code> and the <code>data/</code> folder.</li>
        <li>Run <code>npm install</code>, run the listed migrations, then <code>npm start</code>.</li>
      </ol>
      <h4>On Vercel</h4>
      <ol>
        <li>Pull the update into the repository Vercel deploys from and push; Vercel rebuilds automatically.</li>
        <li>Run the listed migrations in Supabase.</li>
      </ol>
    </details>
  );
}

export default function UpdatesPanel({ status }: { status: AdminStatus }) {
  const { updateStatus, setUpdateStatus, updateSettings, setUpdateSettings } = status;
  const [form, setForm] = useState<UpdateSettings>(updateSettings);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const updates = availableUpdates(updateStatus);
  const plugins = rwp.getPlugins();

  const checkNow = async () => {
    setChecking(true);
    setError('');
    setFeedback('');
    try {
      const result = await checkForUpdates(updateSettings.feed_url);
      setUpdateStatus(result);
      if (!result.error) {
        const count = availableUpdates(result).length;
        setFeedback(count ? `${count} update${count === 1 ? '' : 's'} available.` : 'Everything is up to date.');
      }
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : 'The update check failed.');
    } finally {
      setChecking(false);
    }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setFeedback('');
    try {
      const next = { ...form, feed_url: form.feed_url.trim() || defaultFeedUrl };
      await saveUpdateSettings(next);
      setUpdateSettings(next);
      setForm(next);
      setFeedback('Update settings saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Update settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const latestFor = (id: string) => (id === 'react-wp' ? updateStatus?.feed?.app : updateStatus?.feed?.plugins?.[id]);
  const rows = [
    { id: 'react-wp', name: 'React-WP (the app)', installed: installedAppVersion, active: true },
    ...plugins.map((plugin) => ({ id: plugin.id, name: plugin.name, installed: plugin.version, active: plugin.active })),
  ];

  return (
    <div className={styles.dashboard}>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {feedback && <div className={styles.success} role="status">{feedback}</div>}

      <section className={styles.panel} aria-labelledby="updates-heading">
        <div className={styles.panelHead}>
          <div>
            <h2 id="updates-heading">🔄 Updates</h2>
            <p className={styles.muted}>
              {updateStatus?.checked_at ? `Last checked ${timeAgo(updateStatus.checked_at)} (${new Date(updateStatus.checked_at).toLocaleString()}).` : 'Not checked yet.'}
              {' '}
              {updateSettings.auto_check === 'off' ? 'Automatic checks are off.' : `Checks automatically: ${autoCheckIntervals[updateSettings.auto_check].label.toLowerCase()}.`}
            </p>
          </div>
          <button type="button" className={styles.primaryButton} disabled={checking} onClick={() => void checkNow()}>
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
        </div>

        {updateStatus?.error && <div className={styles.warning} role="status">{updateStatus.error}</div>}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Name</th><th>Installed</th><th>Latest</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const latest = latestFor(row.id);
                const newer = latest && compareVersions(latest.version, row.installed) > 0;
                return (
                  <tr key={row.id}>
                    <td><strong>{row.name}</strong>{!row.active && <span className={styles.muted}> · inactive</span>}</td>
                    <td><code>{row.installed}</code></td>
                    <td>{latest ? <code>{latest.version}</code> : <span className={styles.muted}>—</span>}</td>
                    <td>
                      {!updateStatus?.feed ? <span className={styles.muted}>Unknown</span>
                        : newer ? <span className={styles.badgeWarn}>Update available</span>
                          : latest ? <span className={styles.badgeOk}>Up to date</span>
                            : <span className={styles.muted}>Not in the update feed</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {updates.map((update) => (
        <section key={update.id} className={styles.panel} aria-labelledby={`update-${update.id}`}>
          <h2 id={`update-${update.id}`}>📦 {update.name} {update.release.version}</h2>
          <p className={styles.muted}>
            You have {update.installed}.{update.release.released && ` Released ${new Date(update.release.released).toLocaleDateString()}.`}
          </p>
          {update.release.notes && update.release.notes.length > 0 && (
            <ul className={styles.notes}>{update.release.notes.map((note) => <li key={note}>{note}</li>)}</ul>
          )}
          {update.release.migrations && update.release.migrations.length > 0 && (
            <div className={styles.warning}>
              <strong>Database migrations to run after updating, in this order:</strong>
              <ol>{update.release.migrations.map((migration) => <li key={migration}><code>{migration}</code></li>)}</ol>
            </div>
          )}
          <div className={styles.buttonRow}>
            {update.release.download_url && /^https:\/\//i.test(update.release.download_url) && (
              <a className={styles.primaryButton} href={update.release.download_url} target="_blank" rel="noreferrer">Download ↗</a>
            )}
            {update.release.changelog_url && /^https:\/\//i.test(update.release.changelog_url) && (
              <a className={styles.secondaryButton} href={update.release.changelog_url} target="_blank" rel="noreferrer">Full changelog ↗</a>
            )}
          </div>
        </section>
      ))}

      <section className={styles.panel}>
        <HowToInstall />
      </section>

      <form className={styles.panel} onSubmit={save} aria-labelledby="update-settings-heading">
        <h2 id="update-settings-heading">⏱️ Automatic update checks</h2>
        <label className={styles.field}>
          Check for updates
          <select value={form.auto_check} onChange={(event) => setForm({ ...form, auto_check: event.target.value as AutoCheck })}>
            {(Object.keys(autoCheckIntervals) as AutoCheck[]).map((key) => <option key={key} value={key}>{autoCheckIntervals[key].label}</option>)}
          </select>
          <span className={styles.help}>
            The check runs in the browser of the first administrator to open the admin once it is due, and the result is
            shared with every administrator. Nothing runs while nobody is signed in.
          </span>
        </label>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={form.notify} onChange={(event) => setForm({ ...form, notify: event.target.checked })} />
          Count available updates in the Dashboard badge in the sidebar
        </label>
        <label className={styles.field}>
          Update feed URL
          <input type="url" value={form.feed_url} placeholder={defaultFeedUrl} onChange={(event) => setForm({ ...form, feed_url: event.target.value })} />
          <span className={styles.help}>
            A JSON file listing the latest versions (see <code>updates.json</code> in the project). The default is this
            project&rsquo;s GitHub repository. Use your own address if you maintain a fork.
          </span>
        </label>
        <div className={styles.buttonRow}>
          <button type="submit" className={styles.primaryButton} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
