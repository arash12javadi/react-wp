import { useMemo, useState, type ChangeEvent } from 'react';
import { downloadBlob, formatBackupDate } from '../../../src/lib/backup';
import {
  backupSections, createShopBackup, dataSections, importShopBackup, modesFor, readShopBackupFile, reportTotals, sectionCount,
  sectionInfo, tableLabels, type BackupSection, type DataSection, type ImportMode, type ImportReport, type LoadedShopBackup,
} from '../lib/backup';
import { loadShopSettings } from '../lib/settings';
import { Feedback, Tabs } from './common';
import styles from './admin.module.css';

type Tab = 'export' | 'import';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Shop → Backup: export chosen parts of the shop to a ZIP, and import one back with a mode per part. */
export default function BackupAdmin() {
  const [tab, setTab] = useState<Tab>('export');
  return (
    <div className={styles.wrap}>
      <Tabs tabs={[['export', 'Export'], ['import', 'Import / restore']]} active={tab} onChange={setTab} />
      {tab === 'export' ? <ExportPanel /> : <ImportPanel />}
    </div>
  );
}

function SectionToggle({ id, checked, onChange, detail }: { id: BackupSection; checked: boolean; onChange: (checked: boolean) => void; detail?: string }) {
  const info = sectionInfo(id);
  return (
    <label className={checked ? styles.optionCardOn : styles.optionCard}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className={styles.optionIcon} aria-hidden="true">{info.icon}</span>
      <span className={styles.optionText}>
        <strong>{info.label}{detail ? <span className={styles.muted}> · {detail}</span> : null}</strong>
        <span className={styles.hint}>{info.description}</span>
      </span>
    </label>
  );
}

function ExportPanel() {
  const [chosen, setChosen] = useState<BackupSection[]>(backupSections.map((section) => section.id));
  const [ordersFrom, setOrdersFrom] = useState('');
  const [ordersTo, setOrdersTo] = useState('');
  const [includeTrash, setIncludeTrash] = useState(true);
  const [spreadsheets, setSpreadsheets] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const toggle = (id: BackupSection, on: boolean) =>
    setChosen((current) => (on ? [...new Set([...current, id])] : current.filter((entry) => entry !== id)));
  const has = (id: BackupSection) => chosen.includes(id);
  const personal = has('orders') || has('customers') || has('reviews') || has('questions') || has('offers') || has('alerts');

  const run = async () => {
    setError('');
    setSuccess('');
    if (ordersFrom && ordersTo && ordersFrom > ordersTo) {
      setError('The order date range ends before it starts.');
      return;
    }
    try {
      const result = await createShopBackup({ sections: chosen, ordersFrom, ordersTo, includeTrash, spreadsheets }, setBusy);
      downloadBlob(result.blob, result.fileName);
      const parts = backupSections
        .filter((section) => chosen.includes(section.id))
        .map((section) => (section.id === 'reports'
          ? `the sales report (${sectionCount(result.backup, 'reports')} orders)`
          : `${sectionCount(result.backup, section.id)} ${section.label.toLowerCase()}`));
      setSuccess(`Downloaded ${result.fileName}: ${parts.join(', ')}.`);
    } catch (exportError) {
      setError(errorText(exportError));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div>
          <h2>Export the shop</h2>
          <p className={styles.muted}>Choose what goes into the backup file (.zip). Keep one before big changes, or use it to move the shop to another site.</p>
        </div>
        <div className={styles.toolbarGroup}>
          <button type="button" className={styles.buttonSecondary} onClick={() => setChosen(backupSections.map((section) => section.id))}>Select all</button>
          <button type="button" className={styles.buttonSecondary} onClick={() => setChosen([])}>Select none</button>
        </div>
      </div>

      <div className={styles.optionGrid}>
        {backupSections.map((section) => (
          <SectionToggle key={section.id} id={section.id} checked={has(section.id)} onChange={(on) => toggle(section.id, on)} />
        ))}
      </div>

      <div className={styles.boxed}>
        <h3>Options</h3>
        {(has('orders') || has('reports')) && (
          <div className={styles.grid2}>
            <label className={styles.field}>
              Orders from
              <input className={styles.input} type="date" value={ordersFrom} onChange={(event) => setOrdersFrom(event.target.value)} />
            </label>
            <label className={styles.field}>
              Orders to
              <input className={styles.input} type="date" value={ordersTo} onChange={(event) => setOrdersTo(event.target.value)} />
            </label>
            <span className={`${styles.hint} ${styles.full}`}>Leave both empty for every order. The report covers the same period.</span>
          </div>
        )}
        {has('products') && (
          <label className={styles.check}>
            <input type="checkbox" checked={includeTrash} onChange={(event) => setIncludeTrash(event.target.checked)} />
            Include products in the trash
          </label>
        )}
        <label className={styles.check}>
          <input type="checkbox" checked={spreadsheets} onChange={(event) => setSpreadsheets(event.target.checked)} />
          Also add spreadsheet (CSV) copies of every table, for Excel or Google Sheets
        </label>
        <span className={styles.hint}>
          Import only reads shop-backup.json inside the ZIP; editing a spreadsheet does not change what is imported.
          Product and category images are saved as their URLs: the files stay in your media library (Settings → Backup includes them).
        </span>
      </div>

      {personal && (
        <p className={styles.warning}>
          This backup holds customers&apos; names, email and postal addresses. Store it somewhere private and delete copies you no longer need.
        </p>
      )}
      <Feedback error={error} success={success} />
      <div className={styles.toolbarGroup}>
        <button type="button" className={styles.button} onClick={() => void run()} disabled={Boolean(busy) || chosen.length === 0}>
          {busy ? 'Working…' : '⬇ Download backup'}
        </button>
        {busy && <span className={styles.muted} role="status">{busy}</span>}
      </div>
    </div>
  );
}

const defaultMode: ImportMode = 'update';

function ImportPanel() {
  const [loaded, setLoaded] = useState<LoadedShopBackup | null>(null);
  const [modes, setModes] = useState<Partial<Record<DataSection, ImportMode>>>({});
  const [safetyCopy, setSafetyCopy] = useState(true);
  const [confirmText, setConfirmText] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const available = useMemo(
    () => (loaded ? dataSections.filter((section) => loaded.data.sections.includes(section)) : []),
    [loaded],
  );
  const chosen = available.filter((section) => modes[section]);
  const replacing = chosen.filter((section) => modes[section] === 'replace');
  const confirmed = replacing.length === 0 || confirmText.trim() === 'REPLACE';

  // Any change of plan makes an earlier preview wrong.
  const changePlan = (next: Partial<Record<DataSection, ImportMode>>) => {
    setModes(next);
    setReport(null);
    setSuccess('');
  };

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setSuccess('');
    setReport(null);
    setConfirmText('');
    try {
      const next = await readShopBackupFile(file);
      setLoaded(next);
      setModes(Object.fromEntries(next.data.sections.map((section) => [section, defaultMode])));
    } catch (readError) {
      setLoaded(null);
      setError(errorText(readError));
    }
  };

  const setAll = (mode: Exclude<ImportMode, 'duplicate'>) =>
    changePlan(Object.fromEntries(available.map((section) => [section, mode])));

  const run = async (dryRun: boolean) => {
    if (!loaded || chosen.length === 0) return;
    setError('');
    setSuccess('');
    const plan = Object.fromEntries(chosen.map((section) => [section, modes[section]])) as Partial<Record<DataSection, ImportMode>>;
    try {
      if (!dryRun && safetyCopy) {
        const copy = await createShopBackup({ sections: chosen, ordersFrom: '', ordersTo: '', includeTrash: true, spreadsheets: false },
          (message) => setBusy(`Safety copy: ${message}`));
        downloadBlob(copy.blob, copy.fileName.replace('shop-backup-', 'shop-backup-before-import-'));
      }
      setBusy(dryRun ? 'Previewing the import…' : 'Importing…');
      const result = await importShopBackup(loaded, plan, dryRun);
      setReport(result);
      if (!dryRun) {
        setConfirmText('');
        void loadShopSettings(true).catch(() => { /* The next screen load reads them again. */ });
        const totals = reportTotals(result);
        setSuccess(`Import finished: ${totals.inserted} added, ${totals.updated} updated, ${totals.skipped} left as they were, ${totals.deleted} deleted.`);
      }
    } catch (importError) {
      setError(errorText(importError));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className={styles.panel}>
      <div>
        <h2>Import or restore a backup</h2>
        <p className={styles.muted}>
          Choose a file from Shop → Backup (a full site backup from Settings → Backup works too: only its shop part is used).
          You decide per part what happens to items that already exist, and can preview the result before anything changes.
        </p>
      </div>

      <label className={styles.field}>
        Backup file
        <input className={styles.input} type="file" accept=".zip,.json,application/zip,application/json" onChange={(event) => void pickFile(event)} disabled={Boolean(busy)} />
      </label>

      {loaded && (
        <>
          <p className={styles.notice}>
            <strong>{loaded.fileName}</strong>
            {loaded.data.created_at ? <> · made {formatBackupDate(loaded.data.created_at)}</> : null}
            {loaded.data.site?.origin ? <> on {loaded.data.site.title ? `${loaded.data.site.title} (${loaded.data.site.origin})` : loaded.data.site.origin}</> : null}
            {loaded.data.site?.plugin_version ? <> · shop {loaded.data.site.plugin_version}</> : null}
            {loaded.source === 'site' ? <> · full site backup, shop part only</> : null}
            {' · '}{loaded.data.users.length} account(s) referenced
          </p>

          <div className={styles.toolbar}>
            <h3>What to import</h3>
            <div className={styles.toolbarGroup}>
              <span className={styles.muted}>Set all to:</span>
              <button type="button" className={styles.buttonSecondary} onClick={() => setAll('update')}>Update &amp; add</button>
              <button type="button" className={styles.buttonSecondary} onClick={() => setAll('skip')}>Add missing only</button>
              <button type="button" className={styles.buttonSecondary} onClick={() => setAll('replace')}>Replace (full restore)</button>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Part</th><th>In backup</th><th>When an item already exists</th></tr></thead>
              <tbody>
                {available.map((section) => {
                  const info = sectionInfo(section);
                  const mode = modes[section];
                  return (
                    <tr key={section}>
                      <td>
                        <label className={styles.check}>
                          <input type="checkbox" checked={Boolean(mode)}
                            onChange={(event) => changePlan({ ...modes, [section]: event.target.checked ? defaultMode : undefined })} />
                          <span aria-hidden="true">{info.icon}</span> {info.label}
                        </label>
                      </td>
                      <td>{sectionCount(loaded.data, section)}</td>
                      <td>
                        <select className={styles.select} value={mode || ''} disabled={!mode} aria-label={`Import mode for ${info.label}`}
                          onChange={(event) => changePlan({ ...modes, [section]: event.target.value as ImportMode })}>
                          {!mode && <option value="">Not imported</option>}
                          {modesFor(section).map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                        </select>
                        {mode && <span className={styles.hint}>{modesFor(section).find((entry) => entry.id === mode)?.description}</span>}
                      </td>
                    </tr>
                  );
                })}
                {loaded.data.reports && (
                  <tr>
                    <td><span aria-hidden="true">📈</span> Reports</td>
                    <td>{loaded.data.reports.orders} orders</td>
                    <td className={styles.muted}>Nothing to import: reports are calculated from the orders, so importing Orders brings them back.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <details className={styles.details}>
            <summary>How existing items are recognised, and what happens to accounts</summary>
            <ul className={styles.muted}>
              {available.map((section) => (
                <li key={section}><strong>{sectionInfo(section).label}:</strong> by {sectionInfo(section).matchedBy}.</li>
              ))}
              <li>
                Accounts are never created (a backup holds no passwords). People are matched to this site&apos;s accounts by email.
                Orders of someone without an account here are kept with their billing details, and come back to that person when they
                sign up with the same email and open My Account. Their saved addresses, questions, offers and price alerts are skipped.
              </li>
              <li>Everything is imported in one step: if anything fails, nothing is changed.</li>
            </ul>
          </details>

          {chosen.includes('products') && modes.products === 'replace' && (
            <p className={styles.warning}>
              Replacing products deletes every product that is not in the backup, together with its reviews, questions, offers,
              price alerts and bundles. Orders keep their items, without a link to the deleted product.
            </p>
          )}
          {chosen.includes('orders') && modes.orders === 'replace' && (
            <p className={styles.warning}>Replacing orders deletes every order that is not in the backup, and with them the sales figures in Reports.</p>
          )}

          <label className={styles.check}>
            <input type="checkbox" checked={safetyCopy} onChange={(event) => setSafetyCopy(event.target.checked)} />
            Download a backup of the same parts of this shop first (recommended)
          </label>

          {replacing.length > 0 && (
            <label className={styles.field}>
              Type REPLACE to confirm that items missing from the backup are deleted ({replacing.map((section) => sectionInfo(section).label).join(', ')})
              <input className={styles.input} value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="REPLACE" />
            </label>
          )}

          <Feedback error={error} success={success} />
          <div className={styles.toolbarGroup}>
            <button type="button" className={styles.buttonSecondary} disabled={Boolean(busy) || chosen.length === 0} onClick={() => void run(true)}>
              Preview changes
            </button>
            <button type="button" className={replacing.length ? styles.buttonDanger : styles.button}
              disabled={Boolean(busy) || chosen.length === 0 || !confirmed} onClick={() => void run(false)}>
              {replacing.length ? 'Import and replace' : 'Import'}
            </button>
            {busy && <span className={styles.muted} role="status">{busy}</span>}
          </div>

          {report && <ImportResult report={report} />}
        </>
      )}
      {!loaded && <Feedback error={error} />}
    </div>
  );
}

function ImportResult({ report }: { report: ImportReport }) {
  const rows = Object.entries(report.counts)
    .filter(([, counts]) => counts.inserted + counts.updated + counts.skipped + counts.dropped + counts.deleted > 0)
    .sort(([a], [b]) => Object.keys(tableLabels).indexOf(a) - Object.keys(tableLabels).indexOf(b));
  return (
    <div className={styles.boxed}>
      <h3>{report.dry_run ? 'Preview — nothing has been changed yet' : 'What the import did'}</h3>
      {report.dry_run && <p className={styles.muted}>This is exactly what Import will do with the current choices. Change a choice and preview again to compare.</p>}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>Items</th><th>Added</th><th>Updated</th><th>Left as they were</th><th>Deleted</th><th>Not imported</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className={styles.muted}>The backup had nothing to import for the chosen parts.</td></tr>}
            {rows.map(([table, counts]) => (
              <tr key={table}>
                <td>{tableLabels[table] || table}</td>
                <td>{counts.inserted || ''}</td>
                <td>{counts.updated || ''}</td>
                <td>{counts.skipped || ''}</td>
                <td>{counts.deleted ? <strong>{counts.deleted}</strong> : ''}</td>
                <td>{counts.dropped || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted}>
        {report.users_matched} account(s) matched by email{report.users_unmatched ? `, ${report.users_unmatched} not found on this site` : ''}.
      </p>
      {report.warnings.length > 0 && (
        <div className={styles.warning}>
          <ul>{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
