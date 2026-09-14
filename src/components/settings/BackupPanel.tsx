import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { describeDbError, getSupabaseClient } from '../../lib/db';
import {
  createBackup,
  downloadBlob,
  formatBackupDate,
  mediaUploadReadiness,
  readBackupFile,
  restoreBackup,
  summarizeBackup,
  type LoadedBackup,
  type RestoreReport,
} from '../../lib/backup';
import { formatBytes } from '../../lib/uploads';
import styles from '../SiteSettings.module.css';

interface MediaStats {
  hosted: number;
  bytes: number;
  external: number;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : describeDbError(error));

export default function BackupPanel() {
  const [stats, setStats] = useState<MediaStats | null>(null);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const [exportError, setExportError] = useState('');
  const [exportDone, setExportDone] = useState<{ fileName: string; size: number; mediaIncluded: number; failed: string[] } | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<LoadedBackup | null>(null);
  const [readiness, setReadiness] = useState<{ providers: string[]; missing: string[] } | null>(null);
  const [reupload, setReupload] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [report, setReport] = useState<RestoreReport | null>(null);

  useEffect(() => {
    void (async () => {
      const { data, error } = await getSupabaseClient().from('media').select('provider,bytes');
      if (error) return;
      const rows = (data || []) as Array<{ provider: string; bytes: number | null }>;
      const hosted = rows.filter((row) => row.provider !== 'external');
      setStats({
        hosted: hosted.length,
        bytes: hosted.reduce((sum, row) => sum + (row.bytes || 0), 0),
        external: rows.length - hosted.length,
      });
    })();
  }, []);

  const busy = exporting || restoring;

  const runExport = async () => {
    setExporting(true);
    setExportError('');
    setExportDone(null);
    try {
      const result = await createBackup(includeMedia, setExportProgress);
      downloadBlob(result.blob, result.fileName);
      setExportDone({ fileName: result.fileName, size: result.blob.size, mediaIncluded: result.mediaIncluded, failed: result.failed });
    } catch (error) {
      setExportError(errorText(error));
    } finally {
      setExporting(false);
      setExportProgress('');
    }
  };

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setLoaded(null);
    setReadiness(null);
    setReport(null);
    setRestoreError('');
    setReupload(false);
    setRestoreProgress('Reading the backup file…');
    try {
      const backup = await readBackupFile(file);
      setLoaded(backup);
      if (backup.data.media_files?.length) setReadiness(await mediaUploadReadiness(backup));
    } catch (error) {
      setRestoreError(errorText(error));
    } finally {
      setRestoreProgress('');
    }
  };

  const runRestore = async () => {
    if (!loaded) return;
    const summary = summarizeBackup(loaded.data);
    if (!window.confirm(`Replace all content and settings on this site with the backup of "${summary.title}"? This cannot be undone.`)) return;
    setRestoring(true);
    setRestoreError('');
    setReport(null);
    try {
      setReport(await restoreBackup(loaded, reupload, setRestoreProgress));
      setLoaded(null);
    } catch (error) {
      setRestoreError(errorText(error));
    } finally {
      setRestoring(false);
      setRestoreProgress('');
    }
  };

  const summary = loaded ? summarizeBackup(loaded.data) : null;
  const canReupload = Boolean(readiness && readiness.missing.length === 0);

  return (
    <>
      <section className={styles.form} aria-labelledby="backup-export-heading">
        <div>
          <h3 id="backup-export-heading" className={styles.cardTitle}>Export</h3>
          <p className={styles.cardText}>
            Downloads the whole site as one <code>.zip</code> file: pages and posts, menus and widgets, settings, comments,
            the media library, shop products and orders, page builder layouts and form entries, plus user profiles and
            roles. Not included: passwords, server secrets from <code>.env.local</code>, and plugin code.
          </p>
        </div>

        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={includeMedia} disabled={busy} onChange={(event) => setIncludeMedia(event.target.checked)} />
          Include media files
        </label>
        <span className={styles.help}>
          {stats
            ? <>Your library has {stats.hosted} file{stats.hosted === 1 ? '' : 's'} in Cloudinary or ImageKit ({formatBytes(stats.bytes) === '—' ? 'size unknown' : formatBytes(stats.bytes)}). </>
            : null}
          With this on, each file is downloaded into the backup, so it can be restored even if that media account is
          closed. With it off, the backup keeps only the links, which keep working as long as the files stay where they
          are.{stats?.external ? ` ${stats.external} external image link${stats.external === 1 ? ' is' : 's are'} kept as links either way.` : ''}
        </span>

        {exportError && <div className={styles.error} role="alert"><span>{exportError}</span></div>}
        {exportDone && (
          <div className={styles.success} role="status">
            <span>
              Downloaded <strong>{exportDone.fileName}</strong> ({formatBytes(exportDone.size)})
              {includeMedia ? `, with ${exportDone.mediaIncluded} media file${exportDone.mediaIncluded === 1 ? '' : 's'}` : ''}.
            </span>
          </div>
        )}
        {exportDone && exportDone.failed.length > 0 && (
          <div className={styles.warning} role="alert">
            <strong>{exportDone.failed.length} media file{exportDone.failed.length === 1 ? ' was' : 's were'} not included</strong>
            {' '}and will only be restored as links:
            <ul>{exportDone.failed.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
        )}

        <div className={styles.actions}>
          {exporting && <span className={styles.progress} role="status">{exportProgress}</span>}
          <button type="button" className={styles.saveButton} disabled={busy} onClick={() => void runExport()}>
            {exporting ? 'Exporting…' : 'Export backup'}
          </button>
        </div>
      </section>

      <section className={styles.form} aria-labelledby="backup-import-heading">
        <div>
          <h3 id="backup-import-heading" className={styles.cardTitle}>Import</h3>
          <p className={styles.cardText}>
            Restores a backup onto this site — the same site, or a fresh installation somewhere else. Everything on this
            site is replaced by the backup's contents in a single step: if anything fails, nothing is changed.
          </p>
        </div>

        <div className={styles.warning}>
          <strong>Accounts are not replaced.</strong> People in the backup are matched to accounts on this site by email,
          and their roles and profiles are restored. Content from people with no account here is kept without an author.
          Your own role is never changed. Export this site first if you might want its current content back.
        </div>

        <input ref={fileInput} type="file" accept=".zip,.json,application/zip,application/json" hidden onChange={(event) => void chooseFile(event)} />

        {restoreError && <div className={styles.error} role="alert"><span>{restoreError}</span></div>}

        {summary && loaded && (
          <div className={styles.backupSummary}>
            <p>
              <strong>{summary.title}</strong>
              {summary.origin ? <> from <code>{summary.origin}</code></> : null}, made {formatBackupDate(summary.createdAt)}
            </p>
            <p className={styles.help}>
              {summary.pages} pages, {summary.posts} posts, {summary.media} media items
              {summary.products ? `, ${summary.products} products, ${summary.orders} orders` : ''}, {summary.users} user
              {summary.users === 1 ? '' : 's'} — {summary.totalRows} rows in total.
              {' '}{summary.mediaFiles ? `Includes ${summary.mediaFiles} media file${summary.mediaFiles === 1 ? '' : 's'}.` : 'Media files not included (links only).'}
            </p>
            <details>
              <summary>Rows per table</summary>
              <ul className={styles.tableCounts}>
                {summary.counts.map(([table, count]) => <li key={table}><code>{table}</code> {count}</li>)}
              </ul>
            </details>

            {summary.mediaFiles > 0 && (
              <>
                <label className={styles.checkboxRow}>
                  <input type="checkbox" checked={reupload} disabled={busy || !canReupload}
                    onChange={(event) => setReupload(event.target.checked)} />
                  Upload the media files to this site's media account
                </label>
                <span className={styles.help}>
                  {readiness && readiness.missing.length > 0
                    ? <>To use this, first set up {readiness.missing.join(' and ')} under <strong>Media → Upload settings</strong>. </>
                    : null}
                  Only needed if the original media account will not stay available. Every link in pages, layouts,
                  products and settings is switched to the new copies, and this site keeps its own upload settings.
                  Left off, the restored site keeps using the original links.
                </span>
              </>
            )}
          </div>
        )}

        {report && (
          <div className={styles.success} role="status">
            <span>
              Backup restored: {Object.values(report.counts).reduce((sum, count) => sum + count, 0)} rows
              {report.mediaUploaded ? `, ${report.mediaUploaded} media files uploaded` : ''},
              {' '}{report.users_matched} user{report.users_matched === 1 ? '' : 's'} matched. Reload to see the restored settings and plugins.
            </span>
            <button type="button" onClick={() => window.location.reload()}>Reload admin</button>
          </div>
        )}
        {report && report.warnings.length > 0 && (
          <div className={styles.warning} role="alert">
            <ul>{report.warnings.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
        )}

        <div className={styles.actions}>
          {restoreProgress && <span className={styles.progress} role="status">{restoreProgress}</span>}
          <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => fileInput.current?.click()}>
            {loaded ? 'Choose another file' : 'Choose backup file'}
          </button>
          {loaded && (
            <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => void runRestore()}>
              {restoring ? 'Restoring…' : 'Restore backup'}
            </button>
          )}
        </div>
      </section>
    </>
  );
}
