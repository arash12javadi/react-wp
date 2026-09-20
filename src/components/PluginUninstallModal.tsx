import { useEffect, useRef, useState } from 'react';
import {
  backupFilename, downloadJson, fetchPluginSchemaStatus, uninstallPlugin,
  type PluginSchemaStatus,
} from '../lib/pluginSchema';
import styles from './PluginUninstallModal.module.css';

type Choice = 'backup-keep' | 'backup-wipe' | 'wipe';

const choices: Array<{ id: Choice; label: string; detail: string; danger: boolean }> = [
  {
    id: 'backup-keep',
    label: 'Download a backup and keep the data',
    detail: 'Saves every row to a JSON file, then removes the plugin\'s code. Its tables stay in the database, so reinstalling the plugin brings everything back exactly as it was.',
    danger: false,
  },
  {
    id: 'backup-wipe',
    label: 'Download a backup, then wipe the data',
    detail: 'Saves the JSON file first and only drops the tables if that succeeded. The backup file is the only copy afterwards, so keep it somewhere safe.',
    danger: true,
  },
  {
    id: 'wipe',
    label: 'Wipe the data without a backup',
    detail: 'Drops the tables immediately. There is no undo and nothing to restore from.',
    danger: true,
  },
];

interface Props {
  plugin: { plugin_id: string; name: string; active: boolean };
  /** Deactivates the plugin first; the folder cannot be removed while it is active. */
  onDeactivate: () => Promise<void>;
  onClose: () => void;
  onFinished: (summary: string) => void;
}

/**
 * The uninstall dialog. Uninstalling is three separate decisions that WordPress collapses into one
 * button and then regrets: does the code go, does the data go, and is there a copy first. Each is
 * shown with what it actually costs, and the destructive ones are gated behind typing DELETE.
 */
export default function PluginUninstallModal({ plugin, onDeactivate, onClose, onFinished }: Props) {
  const [status, setStatus] = useState<PluginSchemaStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [choice, setChoice] = useState<Choice>('backup-keep');
  const [confirmText, setConfirmText] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    let mounted = true;
    fetchPluginSchemaStatus(plugin.plugin_id)
      .then((value) => mounted && setStatus(value))
      .catch((statusError: unknown) => mounted
        && setLoadError(statusError instanceof Error ? statusError.message : 'The plugin\'s database status could not be read.'));
    return () => { mounted = false; };
  }, [plugin.plugin_id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const wipes = choice === 'backup-wipe' || choice === 'wipe';
  const wantsBackup = choice === 'backup-keep' || choice === 'backup-wipe';
  const hasTables = (status?.tables.length ?? 0) > 0;
  // Without credentials on the server the modal has to collect them, but only for the steps that
  // actually open a database connection.
  const needsPassword = Boolean(status && !status.storedCredentials && (wipes || wantsBackup) && hasTables);
  const confirmed = !wipes || confirmText === 'DELETE';
  const blocked = wipes && status !== null && hasTables && !status.canDrop;

  const rowTotal = status?.rowCounts
    ? Object.values(status.rowCounts).reduce((sum, count) => sum + count, 0)
    : null;

  const run = async () => {
    setError('');
    setBusy('Deactivating…');
    try {
      if (plugin.active) await onDeactivate();

      setBusy(wantsBackup ? 'Exporting data…' : 'Dropping tables…');
      const result = await uninstallPlugin(plugin.plugin_id, {
        mode: wipes ? 'wipe' : 'keep',
        backup: wantsBackup,
        confirm: wipes ? confirmText : undefined,
        ...(needsPassword && dbPassword ? { dbPassword } : {}),
      });

      if (result.backup) downloadJson(backupFilename(plugin.plugin_id), result.backup);

      const parts = [`${plugin.name} was uninstalled.`];
      if (result.backup) {
        const rows = Object.values(result.backup.tables).reduce((sum, list) => sum + list.length, 0);
        parts.push(`A backup of ${rows} row${rows === 1 ? '' : 's'} was downloaded.`);
      }
      if (result.media?.attempted) {
        parts.push(`${result.media.deleted} file${result.media.deleted === 1 ? '' : 's'} deleted from Cloudinary under ${result.media.prefixes?.join(', ')}.`);
      }
      if (result.dropped) parts.push(`${result.dropped.dropped.length} tables were dropped.`);
      else if (hasTables) parts.push('Its tables were left in the database.');
      if (!result.folderDeleted) parts.push('The plugin folder is still on disk.');
      parts.push(...result.warnings);
      onFinished(parts.join(' '));
    } catch (runError: unknown) {
      setError(runError instanceof Error ? runError.message : 'The plugin could not be uninstalled.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="plugin-uninstall-title" tabIndex={-1}>
        <div className={styles.header}>
          <h3 id="plugin-uninstall-title">Uninstall {plugin.name}</h3>
          <button type="button" className={styles.close} onClick={onClose} disabled={Boolean(busy)} aria-label="Close">×</button>
        </div>

        <div className={styles.warning} role="alert">
          <strong>This removes the plugin&apos;s code from the server.</strong>
          <span>
            Whether it also removes its database records is your choice below. Deactivating a plugin
            is reversible; uninstalling it is not.
          </span>
        </div>

        {loadError && <div className={styles.error} role="alert">{loadError}</div>}

        {status && (
          <div className={styles.summary}>
            {hasTables ? (
              <>
                <p>
                  <strong>{plugin.name}</strong> owns {status.tables.length} database table
                  {status.tables.length === 1 ? '' : 's'}
                  {status.checked && rowTotal !== null
                    ? <> holding roughly <strong>{rowTotal.toLocaleString()}</strong> rows</>
                    : null}.
                </p>
                <ul className={styles.tableList}>
                  {status.tables.map((table) => (
                    <li key={table}>
                      <code>{table}</code>
                      {status.checked && (
                        status.present?.includes(table)
                          ? <span className={styles.count}>{(status.rowCounts?.[table] ?? 0).toLocaleString()} rows</span>
                          : <span className={styles.absent}>not in this database</span>
                      )}
                    </li>
                  ))}
                </ul>
                {!status.checked && status.reason && (
                  <p className={styles.note}>Row counts are unavailable: {status.reason}</p>
                )}
              </>
            ) : (
              <p>{plugin.name} stores nothing in the database, so only its code will be removed.</p>
            )}

            {status.retains.length > 0 && (
              <div className={styles.retains}>
                <strong>Kept either way</strong>
                <ul>{status.retains.map((line) => <li key={line}>{line}</li>)}</ul>
              </div>
            )}

            {wipes && (
              <div className={styles.media}>
                <strong>Uploaded files</strong>
                {status.cloudinaryConfigured ? (
                  <p>
                    Cloudinary files under {status.mediaPrefixes.map((prefix) => <code key={prefix}>{prefix}/</code>)} will
                    be deleted, along with their Media Library rows. Files in the main Media
                    Library (<code>media/</code>) are never touched — including any this plugin
                    points at, because those are library assets you may also use elsewhere.
                  </p>
                ) : (
                  <p>
                    No Cloudinary files will be deleted: this server has no{' '}
                    <code>CLOUDINARY_API_KEY</code> / <code>CLOUDINARY_API_SECRET</code>. Any files
                    under {status.mediaPrefixes.map((prefix) => <code key={prefix}>{prefix}/</code>)} stay
                    in your Cloudinary account.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {status && hasTables && (
          <fieldset className={styles.choices} disabled={Boolean(busy)}>
            <legend>What should happen to the data?</legend>
            {choices.map((option) => (
              <label key={option.id} className={choice === option.id ? styles.choiceActive : styles.choice}>
                <input
                  type="radio"
                  name="uninstall-choice"
                  value={option.id}
                  checked={choice === option.id}
                  onChange={() => { setChoice(option.id); setConfirmText(''); setError(''); }}
                />
                <span>
                  <strong>{option.label}{option.danger && <em className={styles.dangerTag}>destructive</em>}</strong>
                  <small>{option.detail}</small>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {blocked && (
          <div className={styles.error} role="alert">
            {plugin.name} ships no <code>uninstall.sql</code>, so its tables cannot be dropped from here.
            Choose &ldquo;keep the data&rdquo; and remove them by hand in the Supabase SQL Editor.
          </div>
        )}

        {wipes && !blocked && (
          <div className={styles.gate}>
            <label htmlFor="uninstall-confirm">
              Type <code>DELETE</code> to confirm that {status?.tables.length ?? 0} table
              {(status?.tables.length ?? 0) === 1 ? '' : 's'} will be dropped.
            </label>
            <input
              id="uninstall-confirm"
              type="text"
              value={confirmText}
              autoComplete="off"
              spellCheck={false}
              disabled={Boolean(busy)}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder="DELETE"
            />
          </div>
        )}

        {needsPassword && (
          <div className={styles.gate}>
            <label htmlFor="uninstall-db-password">
              Supabase database password
              <small>
                This server has no <code>SUPABASE_DB_URL</code>, so it needs the password to reach
                the database. It is used for this request only and never stored. Find it under
                Project Settings → Database.
              </small>
            </label>
            <input
              id="uninstall-db-password"
              type="password"
              value={dbPassword}
              autoComplete="off"
              disabled={Boolean(busy)}
              onChange={(event) => setDbPassword(event.target.value)}
            />
          </div>
        )}

        {error && <div className={styles.error} role="alert">{error}</div>}

        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose} disabled={Boolean(busy)}>Cancel</button>
          <button
            type="button"
            className={wipes ? styles.confirmDanger : styles.confirm}
            disabled={Boolean(busy) || !status || !confirmed || blocked || (needsPassword && !dbPassword)}
            onClick={() => void run()}
          >
            {busy || (wipes ? 'Uninstall and wipe data' : 'Uninstall')}
          </button>
        </div>
      </div>
    </div>
  );
}
