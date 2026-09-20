import { useRef, useState } from 'react';
import {
  snippetLocations, snippetTypes, type CodeSnippet, type SnippetDraft, type SnippetLocation, type SnippetType,
} from '../../src/lib/snippets';
import { listSnippets, restoreSnippets } from './lib/api';
import styles from './snippets.module.css';

/**
 * Export every snippet to one .json file, and restore such a file into any React-WP site.
 *
 * The file is the whole table, active and inactive, so it doubles as a way to move a set of
 * snippets between a staging site and a live one. Imported snippets arrive switched off unless
 * the box is ticked: a backup taken from another site can contain JavaScript that assumes markup
 * this site does not have, and code that runs the instant it is imported is hard to undo.
 */

const FORMAT = 'rwp-code-snippets-backup';

export interface BackupFile {
  format: string;
  version: number;
  exported_at: string;
  site: string;
  snippets: Array<SnippetDraft & { id?: string }>;
}

type ImportMode = 'keep-both' | 'overwrite';

const isType = (value: unknown): value is SnippetType => (snippetTypes as readonly string[]).includes(String(value));
const isLocation = (value: unknown): value is SnippetLocation => (snippetLocations as readonly string[]).includes(String(value));

/** Throws with the reason a file cannot be restored, naming the row so it can be fixed by hand. */
export function parseBackup(text: string): Array<SnippetDraft & { id?: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON. Choose a .json file exported from the Code Snippets screen.');
  }
  // A bare array is accepted too: it is what someone gets by copying the "snippets" key out.
  const rows = Array.isArray(parsed) ? parsed : (parsed as BackupFile | null)?.snippets;
  const format = Array.isArray(parsed) ? FORMAT : (parsed as BackupFile | null)?.format;
  if (format !== FORMAT || !Array.isArray(rows)) {
    throw new Error(`This file is not a snippets backup (expected "format": "${FORMAT}" and a "snippets" array).`);
  }
  if (!rows.length) throw new Error('That backup contains no snippets.');

  return rows.map((row, index) => {
    const where = `Snippet ${index + 1}${row?.title ? ` (“${String(row.title).slice(0, 40)}”)` : ''}`;
    if (!row || typeof row !== 'object') throw new Error(`${where} is not an object.`);
    if (typeof row.title !== 'string' || !row.title.trim()) throw new Error(`${where} has no title.`);
    if (!isType(row.snippet_type)) throw new Error(`${where} has an unknown type “${String(row.snippet_type)}”. Expected one of ${snippetTypes.join(', ')}.`);
    if (typeof row.code !== 'string') throw new Error(`${where} has no code.`);
    if (row.location !== undefined && !isLocation(row.location)) throw new Error(`${where} has an unknown location “${String(row.location)}”.`);
    return {
      id: typeof row.id === 'string' && /^[0-9a-f-]{36}$/i.test(row.id) ? row.id : undefined,
      title: row.title,
      description: typeof row.description === 'string' ? row.description : '',
      snippet_type: row.snippet_type,
      code: row.code,
      location: isLocation(row.location) ? row.location : 'frontend',
      is_active: row.is_active === true,
      priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 10,
      tags: Array.isArray(row.tags) ? row.tags.filter((tag: unknown): tag is string => typeof tag === 'string') : [],
    };
  });
}

export const buildBackup = (snippets: CodeSnippet[]): BackupFile => ({
  format: FORMAT,
  version: 1,
  exported_at: new Date().toISOString(),
  site: window.location.origin,
  snippets: snippets.map(({ id, title, description, snippet_type, code, location, is_active, priority, tags }) => ({
    id, title, description, snippet_type, code, location, is_active, priority, tags,
  })),
});

interface Props {
  onClose: () => void;
  /** Reloads the list and re-applies the running snippets after an import. */
  onImported: (message: string) => void;
}

export default function BackupRestoreModal({ onClose, onImported }: Props) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState<ImportMode>('keep-both');
  const [activate, setActivate] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const exportAll = async () => {
    setError(''); setNotice(''); setBusy('export');
    try {
      const snippets = await listSnippets();
      if (!snippets.length) throw new Error('There are no snippets to export yet.');
      const blob = new Blob([JSON.stringify(buildBackup(snippets), null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `react-wp-snippets-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      setNotice(`Exported ${snippets.length} snippet${snippets.length === 1 ? '' : 's'}.`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'The export failed.');
    } finally {
      setBusy('');
    }
  };

  const importFile = async (file: File) => {
    setError(''); setNotice(''); setBusy('import');
    try {
      const rows = parseBackup(await file.text());
      const verb = mode === 'overwrite'
        ? `Replace any snippet in this site that has the same id, and add the rest? ${rows.length} snippet(s) from “${file.name}”.`
        : `Add ${rows.length} snippet(s) from “${file.name}” as new snippets, keeping everything already here?`;
      if (!window.confirm(verb)) return;
      const { imported } = await restoreSnippets(rows, { mode, activate });
      onImported(`Imported ${imported} snippet${imported === 1 ? '' : 's'}${activate ? '' : ', all switched off'}.`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'The import failed.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="rwp-snippets-backup-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.modal}>
        <h3 id="rwp-snippets-backup-title">Backup &amp; Restore</h3>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {notice && <p className={styles.success} role="status">{notice}</p>}

        <section>
          <h4>Export</h4>
          <p>Downloads every snippet — active and inactive, with its code, location, priority and tags — as one JSON file.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={() => void exportAll()}>
              {busy === 'export' ? 'Preparing…' : 'Download backup (.json)'}
            </button>
          </div>
        </section>

        <section>
          <h4>Restore</h4>
          <p>Reads a backup from this or any other React-WP site.</p>
          <label className={styles.choice}>
            <input type="radio" name="rwp-import-mode" checked={mode === 'keep-both'} onChange={() => setMode('keep-both')} />
            <span><strong>Keep both.</strong> Every snippet in the file is added as a new one. Nothing already here changes.</span>
          </label>
          <label className={styles.choice}>
            <input type="radio" name="rwp-import-mode" checked={mode === 'overwrite'} onChange={() => setMode('overwrite')} />
            <span><strong>Overwrite existing.</strong> A snippet whose id is already here is replaced by the version in the file. This cannot be undone.</span>
          </label>
          <label className={styles.choice}>
            <input type="checkbox" checked={activate} onChange={(event) => setActivate(event.target.checked)} />
            <span>Switch imported snippets on if they were on when the backup was taken. Off by default, so nothing starts running before you have read it.</span>
          </label>

          <div
            className={dragging ? `${styles.dropzone} ${styles.dropzoneOver}` : styles.dropzone}
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.current?.click(); } }}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void importFile(file);
            }}
          >
            <strong>{busy === 'import' ? 'Importing…' : 'Drop a backup here, or choose a file'}</strong>
            <span>.json exported from the Code Snippets screen</span>
          </div>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importFile(file);
          }} />
        </section>

        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
