import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from '../../context/I18nContext';
import { allTranslationKeys, bundledTranslation, localeDefinition } from '../../lib/i18n';
import {
  defaultTranslationGroups, deleteTranslations, getTranslations, importTranslations, loadDiscoverySetting,
  parseTranslationFile, reloadDatabaseTranslations, rowToExportItem, setAutoDiscovery, translationsMigration,
  translationsToCsv, translationsToJson, upsertTranslation,
  type TranslationExportItem, type TranslationInput, type TranslationRow,
} from '../../lib/translations';
import settingsStyles from '../SiteSettings.module.css';
import styles from './TranslationsPanel.module.css';

type Status = 'all' | 'untranslated' | 'edited' | 'bundled';

/** One key in the chosen language: its bundled string, its database row, or both. */
interface Entry {
  key: string;
  /** English (or the text it was discovered with): what the translator translates from. */
  original: string;
  /** Shipped by core or a plugin for this language. */
  bundled?: string;
  row?: TranslationRow;
  /** '' when no row exists for the key in any language (a bundled-only string). */
  group: string;
}

const pageSize = 50;
const builtInGroup = '__built_in';

const rowId = (key: string, locale: string) => `${key}\u0000${locale}`;

/** Edited: a saved translation. Bundled: only core's or a plugin's. Untranslated: neither. */
const statusOf = (entry: Entry): Exclude<Status, 'all'> =>
  entry.row?.translation_value != null ? 'edited' : entry.bundled !== undefined ? 'bundled' : 'untranslated';

const download = (content: string, fileName: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Settings → Translations. Every key core and the active plugins ship, plus every key saved in
 * rwp_translations, for one language at a time. Saving writes one row and reloads the strings for
 * this tab straight away; visitors get them on their next page load.
 */
export default function TranslationsPanel() {
  const { settings } = useTranslation();
  const [rows, setRows] = useState<TranslationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [locale, setLocale] = useState(() =>
    settings.supported_languages.find((code) => code !== 'en') || settings.default_site_language);
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<{ key: string; value: string; group: string } | null>(null);
  const [discovery, setDiscovery] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ fileName: string; entries: TranslationInput[]; overwrite: boolean } | null>(null);
  const [draft, setDraft] = useState({ key: '', locale: '', value: '', group: 'general' });
  const addDialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [loaded, enabled] = await Promise.all([getTranslations(), loadDiscoverySetting()]);
      setRows(loaded);
      setDiscovery(enabled);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  /** Runs one change, reloads this tab's strings and reports the outcome. */
  const run = async (change: () => Promise<string>) => {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const done = await change();
      await reloadDatabaseTranslations();
      setFeedback(done);
    } catch (changeError: unknown) {
      setError(changeError instanceof Error ? changeError.message : String(changeError));
    } finally {
      setBusy(false);
    }
  };

  const localeChoices = useMemo(
    () => [...new Set([...settings.supported_languages, ...rows.map((row) => row.locale)])].map(localeDefinition),
    [rows, settings.supported_languages],
  );

  const groups = useMemo(
    () => [...new Set([...defaultTranslationGroups, ...rows.map((row) => row.group_name)])].sort(),
    [rows],
  );

  const entries = useMemo<Entry[]>(() => {
    const byId = new Map(rows.map((row) => [rowId(row.translation_key, row.locale), row]));
    const anyRow = new Map<string, TranslationRow>();
    rows.forEach((row) => { if (!anyRow.has(row.translation_key) || row.locale === locale) anyRow.set(row.translation_key, row); });
    const keys = [...new Set([...allTranslationKeys(), ...rows.map((row) => row.translation_key)])].sort();
    return keys.map((key) => {
      const row = byId.get(rowId(key, locale));
      const original = bundledTranslation('en', key)
        ?? byId.get(rowId(key, 'en'))?.translation_value
        ?? rows.find((candidate) => candidate.translation_key === key && candidate.source_text)?.source_text
        ?? '';
      return { key, original, bundled: bundledTranslation(locale, key), row, group: anyRow.get(key)?.group_name || '' };
    });
  }, [rows, locale]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (status !== 'all' && statusOf(entry) !== status) return false;
      if (group === builtInGroup ? entry.group !== '' : group && entry.group !== group) return false;
      if (!term) return true;
      return [entry.key, entry.original, entry.bundled, entry.row?.translation_value]
        .some((text) => text?.toLowerCase().includes(term));
    });
  }, [entries, search, status, group]);

  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pages);
  const shown = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const definition = localeDefinition(locale);
  const untranslatedRows = rows.filter((row) => row.translation_value === null);
  const counts = useMemo(() => entries.reduce((result, entry) => {
    result[statusOf(entry)] += 1;
    return result;
  }, { edited: 0, bundled: 0, untranslated: 0 }), [entries]);

  // Filters change what page 1 is.
  useEffect(() => { setPage(1); }, [search, status, group, locale]);

  const replaceRow = (saved: TranslationRow) => setRows((current) => [
    ...current.filter((row) => row.id !== saved.id && rowId(row.translation_key, row.locale) !== rowId(saved.translation_key, saved.locale)),
    saved,
  ]);

  const saveEdit = () => {
    if (!editing) return;
    const { key, value, group: editedGroup } = editing;
    void run(async () => {
      const saved = await upsertTranslation({ key, locale, value, group: editedGroup || 'general' });
      replaceRow(saved);
      setEditing(null);
      return saved.translation_value === null
        ? `“${key}” is marked untranslated in ${definition.name}; the default text shows until it is translated.`
        : `Saved “${key}” for ${definition.name}.`;
    });
  };

  const onEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); setEditing(null); }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); saveEdit(); }
  };

  const remove = (entry: Entry) => {
    const row = entry.row;
    if (!row) return;
    const consequence = entry.bundled !== undefined
      ? `The bundled ${definition.name} text (“${entry.bundled}”) shows again.`
      : 'The key has no bundled text in this language, so the page shows the fallback text again.';
    if (!window.confirm(`Delete the ${definition.name} translation of “${entry.key}”? ${consequence}`)) return;
    void run(async () => {
      await deleteTranslations([row.id]);
      setRows((current) => current.filter((candidate) => candidate.id !== row.id));
      return `Deleted the ${definition.name} translation of “${entry.key}”.`;
    });
  };

  const clearUntranslated = () => {
    if (!untranslatedRows.length) return;
    if (!window.confirm(`Delete ${untranslatedRows.length} untranslated row(s) in every language? Keys that are still used are discovered again while discovery is on.`)) return;
    void run(async () => {
      const deleted = await deleteTranslations(untranslatedRows.map((row) => row.id));
      setRows((current) => current.filter((row) => row.translation_value !== null));
      return `Deleted ${deleted} untranslated row(s).`;
    });
  };

  const toggleDiscovery = (enabled: boolean) => void run(async () => {
    await setAutoDiscovery(enabled);
    setDiscovery(enabled);
    return enabled
      ? 'Discovery is on. Keys without a translation are added here as visitors and admins open pages.'
      : 'Discovery is off. Keys already discovered stay listed.';
  });

  const openAdd = () => {
    setDraft({ key: '', locale, value: '', group: 'general' });
    addDialog.current?.showModal();
  };

  const existingDraftRow = rows.find((row) => row.translation_key === draft.key.trim() && row.locale === draft.locale && row.translation_value !== null);

  const submitAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      const saved = await upsertTranslation({ key: draft.key, locale: draft.locale, value: draft.value, group: draft.group });
      replaceRow(saved);
      addDialog.current?.close();
      return `Saved “${saved.translation_key}” for ${localeDefinition(saved.locale).name}.`;
    });
  };

  const exportVisible = (format: 'json' | 'csv') => {
    const items: TranslationExportItem[] = visible.map((entry) => ({
      key: entry.key,
      locale,
      value: entry.row?.translation_value ?? null,
      group: entry.group || 'general',
      source: entry.original || null,
      default: entry.bundled ?? null,
    }));
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') download(translationsToJson(items), `translations-${locale}-${stamp}.json`, 'application/json');
    else download(translationsToCsv(items), `translations-${locale}-${stamp}.csv`, 'text/csv;charset=utf-8');
  };

  const exportAll = () => {
    download(translationsToJson(rows.map(rowToExportItem)), `translations-all-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  };

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setFeedback('');
    try {
      const parsed = parseTranslationFile(await file.text(), file.name);
      if (!parsed.length) throw new Error(`"${file.name}" contains no translations.`);
      setPendingImport({ fileName: file.name, entries: parsed, overwrite: false });
    } catch (parseError: unknown) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
    }
  };

  const confirmImport = () => {
    if (!pendingImport) return;
    const { entries: toImport, overwrite, fileName } = pendingImport;
    void run(async () => {
      const report = await importTranslations(toImport, overwrite);
      setPendingImport(null);
      setRows(await getTranslations());
      return `Imported ${fileName}: ${report.created} new, ${report.updated} updated, ${report.unchanged} unchanged, ${report.skipped} skipped${overwrite ? '' : ' (existing translations and empty values are kept)'}.`;
    });
  };

  if (loading) return <div className={settingsStyles.loading} role="status">Loading translations…</div>;

  const importLocales = pendingImport ? [...new Set(pendingImport.entries.map((entry) => entry.locale))] : [];

  return (
    <div className={styles.panel}>
      {error && (
        <div className={settingsStyles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>Reload</button>
        </div>
      )}
      {feedback && <div className={settingsStyles.success} role="status">{feedback}</div>}

      <section className={settingsStyles.form} aria-label="Filters">
        <div className={styles.filters}>
          <label className={styles.searchField}>
            Search
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Key or text…" />
          </label>
          <label>
            Language
            <select value={locale} onChange={(event) => { setLocale(event.target.value); setEditing(null); }}>
              {localeChoices.map((choice) => <option key={choice.code} value={choice.code}>{choice.name} ({choice.code})</option>)}
            </select>
          </label>
          <label>
            Group
            <select value={group} onChange={(event) => setGroup(event.target.value)}>
              <option value="">All groups</option>
              <option value={builtInGroup}>Built-in strings only</option>
              {groups.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value as Status)}>
              <option value="all">All ({entries.length})</option>
              <option value="untranslated">Untranslated ({counts.untranslated})</option>
              <option value="edited">Edited here ({counts.edited})</option>
              <option value="bundled">Bundled only ({counts.bundled})</option>
            </select>
          </label>
        </div>

        <div className={styles.toolbar}>
          <button type="button" className={settingsStyles.saveButton} onClick={openAdd} disabled={busy}>＋ Add translation</button>
          <button type="button" className={settingsStyles.secondaryButton} onClick={() => fileInput.current?.click()} disabled={busy}>Import JSON / CSV…</button>
          <input ref={fileInput} type="file" accept=".json,.csv,application/json,text/csv" hidden onChange={(event) => void chooseFile(event)} />
          <button type="button" className={settingsStyles.secondaryButton} onClick={() => exportVisible('json')} disabled={!visible.length}>Export JSON</button>
          <button type="button" className={settingsStyles.secondaryButton} onClick={() => exportVisible('csv')} disabled={!visible.length}>Export CSV</button>
          <button type="button" className={settingsStyles.secondaryButton} onClick={exportAll} disabled={!rows.length}>Download all saved</button>
        </div>
        <span className={settingsStyles.help}>
          Export JSON / CSV saves the {visible.length} string(s) listed below for {definition.name}, with the original text and the
          bundled default beside each, for a translator to fill in the value column and import back. Download all saved is every
          row in the database, in every language, as a backup.
        </span>
      </section>

      {pendingImport && (
        <section className={`${settingsStyles.form} ${styles.importBox}`} aria-labelledby="import-heading">
          <h3 id="import-heading" className={styles.heading}>Import {pendingImport.fileName}</h3>
          <p className={settingsStyles.help}>
            {pendingImport.entries.length} string(s) for {importLocales.map((code) => localeDefinition(code).name).join(', ')}.
            Entries with an empty value are skipped, so nothing is blanked.
          </p>
          <label className={settingsStyles.checkboxRow}>
            <input type="checkbox" checked={pendingImport.overwrite}
              onChange={(event) => setPendingImport({ ...pendingImport, overwrite: event.target.checked })} />
            Replace translations that already exist (otherwise only keys without a translation are filled)
          </label>
          <div className={styles.toolbar}>
            <button type="button" className={settingsStyles.saveButton} disabled={busy} onClick={confirmImport}>{busy ? 'Importing…' : 'Import'}</button>
            <button type="button" className={settingsStyles.secondaryButton} disabled={busy} onClick={() => setPendingImport(null)}>Cancel</button>
          </div>
        </section>
      )}

      <section className={settingsStyles.form} aria-labelledby="strings-heading">
        <h3 id="strings-heading" className={styles.heading}>
          {definition.name} strings <small>· {visible.length} of {entries.length}</small>
        </h3>
        {visible.length === 0 ? <p className={settingsStyles.help}>No strings match these filters.</p> : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Key</th><th>Original</th><th>Translation ({locale})</th><th>Group</th><th><span className={styles.srOnly}>Actions</span></th></tr>
              </thead>
              <tbody>
                {shown.map((entry) => {
                  const isEditing = editing?.key === entry.key;
                  const value = entry.row?.translation_value;
                  return (
                    <tr key={entry.key}>
                      <td><code className={styles.key}>{entry.key}</code></td>
                      <td className={styles.text}>{entry.original || <span className={styles.muted}>—</span>}</td>
                      <td className={styles.text} lang={locale} dir={definition.dir}>
                        {isEditing ? (
                          <div className={styles.editor}>
                            <textarea autoFocus rows={Math.min(6, Math.max(2, Math.ceil((editing.value.length || 1) / 40)))}
                              value={editing.value} placeholder={entry.bundled ?? entry.original}
                              aria-label={`Translation of ${entry.key} in ${definition.name}`}
                              onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                              onKeyDown={onEditKeyDown} />
                            <div className={styles.editorRow} dir="ltr">
                              <input list="rwp-translation-groups" value={editing.group} aria-label="Group"
                                onChange={(event) => setEditing({ ...editing, group: event.target.value })} />
                              <button type="button" className={settingsStyles.saveButton} disabled={busy} onClick={saveEdit}>Save</button>
                              <button type="button" className={settingsStyles.secondaryButton} disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                            </div>
                            <span className={settingsStyles.help} dir="ltr">Ctrl+Enter saves, Esc cancels. Empty marks it untranslated.</span>
                          </div>
                        ) : value != null ? value : entry.bundled !== undefined ? (
                          <span className={styles.muted} title="Bundled with core or a plugin. Editing saves your own version.">{entry.bundled}</span>
                        ) : (
                          <span className={styles.missing}>Untranslated</span>
                        )}
                      </td>
                      <td>{entry.group || <span className={styles.muted} title="Bundled with core or a plugin, not saved here yet">built-in</span>}</td>
                      <td className={styles.actions}>
                        {!isEditing && (
                          <button type="button" className={styles.linkButton} disabled={busy}
                            onClick={() => setEditing({ key: entry.key, value: value ?? '', group: entry.group || 'general' })}>
                            Edit
                          </button>
                        )}
                        {entry.row && !isEditing && (
                          <button type="button" className={`${styles.linkButton} ${styles.danger}`} disabled={busy} onClick={() => remove(entry)}>
                            {entry.bundled !== undefined ? 'Reset' : 'Delete'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav className={styles.pagination} aria-label="Translation pages">
            <button type="button" className={settingsStyles.secondaryButton} disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>← Previous</button>
            <span>Page {currentPage} of {pages}</span>
            <button type="button" className={settingsStyles.secondaryButton} disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next →</button>
          </nav>
        )}
      </section>

      <section className={settingsStyles.form} aria-labelledby="discovery-heading">
        <h3 id="discovery-heading" className={styles.heading}>Find untranslated text</h3>
        <label className={settingsStyles.checkboxRow}>
          <input type="checkbox" checked={discovery} disabled={busy} onChange={(event) => toggleDiscovery(event.target.checked)} />
          Add keys that have no translation to this list as people browse the site
        </label>
        <span className={settingsStyles.help}>
          While this is on, every browser reports keys it had to show in a fallback language, and they appear here as
          Untranslated, with the text that was shown as the original. Nothing visitors see changes. The database accepts only
          languages the site offers and keeps at most 2,000 untranslated rows, so turn it off once you have what you need.
        </span>
        {untranslatedRows.length > 0 && (
          <div className={styles.toolbar}>
            <button type="button" className={settingsStyles.secondaryButton} disabled={busy} onClick={clearUntranslated}>
              Delete {untranslatedRows.length} untranslated row(s)
            </button>
          </div>
        )}
      </section>

      <p className={settingsStyles.help}>
        A string saved here replaces the bundled one for that language everywhere it is used: the public site, the admin,
        shortcodes and Page Builder widgets. Reset removes your version and brings the bundled one back. Category names
        and descriptions are keys too (<code>category.&lt;slug&gt;.name</code>). Needs <code>{translationsMigration}</code>.
      </p>

      <datalist id="rwp-translation-groups">{groups.map((name) => <option key={name} value={name} />)}</datalist>
      <datalist id="rwp-translation-keys">{entries.map((entry) => <option key={entry.key} value={entry.key} />)}</datalist>

      <dialog ref={addDialog} className={styles.dialog} aria-labelledby="add-translation-heading">
        <form className={settingsStyles.form} onSubmit={submitAdd}>
          <h3 id="add-translation-heading" className={styles.heading}>Add translation</h3>
          <label>
            Key
            <input required list="rwp-translation-keys" value={draft.key} placeholder="e.g. header.login or shop.cart_title"
              onChange={(event) => setDraft({ ...draft, key: event.target.value })} />
            <span className={settingsStyles.help}>Pick an existing key to reword it, or type a new one for your own <code>t()</code> call.</span>
          </label>
          <div className={styles.twoColumns}>
            <label>
              Language
              <select value={draft.locale} onChange={(event) => setDraft({ ...draft, locale: event.target.value })}>
                {localeChoices.map((choice) => <option key={choice.code} value={choice.code}>{choice.name} ({choice.code})</option>)}
              </select>
            </label>
            <label>
              Group
              <input list="rwp-translation-groups" value={draft.group} onChange={(event) => setDraft({ ...draft, group: event.target.value })} />
            </label>
          </div>
          <label>
            Translation
            <textarea required rows={3} value={draft.value} lang={draft.locale} dir={localeDefinition(draft.locale || 'en').dir}
              onChange={(event) => setDraft({ ...draft, value: event.target.value })} />
          </label>
          {existingDraftRow && (
            <div className={settingsStyles.warning} role="status">
              This key already has a {localeDefinition(draft.locale).name} translation (“{existingDraftRow.translation_value}”). Saving replaces it.
            </div>
          )}
          <div className={styles.toolbar}>
            <button type="submit" className={settingsStyles.saveButton} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className={settingsStyles.secondaryButton} onClick={() => addDialog.current?.close()}>Cancel</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
