import { useEffect, useMemo, useState } from 'react';
import { localeDefinition } from '../../../src/lib/i18n';
import { getTranslations, type TranslationRow } from '../../../src/lib/translations';
import settingsStyles from '../../../src/components/SiteSettings.module.css';
import {
  bundledFaPhrases, deletePhrase, phraseKey, phrasePrefix, phraseTarget, savePhrase,
} from '../lib/phrases';
import styles from './admin.module.css';

/**
 * Persian Origins → Site text: every piece of text on the public site, by its original.
 *
 * Rows come from two places: the Farsi this plugin ships for core, theme, builder and shop text,
 * and what was collected while an administrator browsed the site (menus, widget titles, the
 * footer, page text…). The fastest way to translate a page is still its own "Translate this
 * page" button, which shows each text where it is used.
 */

type Status = 'all' | 'untranslated' | 'saved' | 'bundled';

interface Entry {
  key: string;
  source: string;
  bundled?: string;
  row?: TranslationRow;
}

const pageSize = 50;

export default function SiteTextTab({ navigate }: { navigate: (section: string, subsection?: string) => void }) {
  const target = phraseTarget();
  const definition = localeDefinition(target);
  const [rows, setRows] = useState<TranslationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status>('untranslated');
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const all = await getTranslations({ locale: target });
      setRows(all.filter((row) => row.translation_key.startsWith(phrasePrefix)));
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const entries = useMemo<Entry[]>(() => {
    const byKey = new Map<string, Entry>();
    if (target === 'fa') {
      bundledFaPhrases.forEach((fa, source) => byKey.set(phraseKey(source), { key: phraseKey(source), source, bundled: fa }));
    }
    rows.forEach((row) => {
      const existing = byKey.get(row.translation_key);
      byKey.set(row.translation_key, { key: row.translation_key, source: existing?.source || row.source_text || '', bundled: existing?.bundled, row });
    });
    return [...byKey.values()].filter((entry) => entry.source).sort((a, b) => a.source.localeCompare(b.source));
  }, [rows, target]);

  const statusOf = (entry: Entry): Exclude<Status, 'all'> =>
    entry.row?.translation_value ? 'saved' : entry.bundled ? 'bundled' : 'untranslated';

  const counts = entries.reduce((result, entry) => {
    result[statusOf(entry)] += 1;
    return result;
  }, { untranslated: 0, saved: 0, bundled: 0 });

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((entry) => (status === 'all' || statusOf(entry) === status)
      && (!term || [entry.source, entry.bundled, entry.row?.translation_value].some((text) => text?.toLowerCase().includes(term))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, search, status]);

  useEffect(() => { setPage(1); }, [search, status]);

  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const current = Math.min(page, pages);
  const shown = visible.slice((current - 1) * pageSize, current * pageSize);

  const run = async (key: string, work: () => Promise<void>, message: string) => {
    setBusyKey(key);
    setError('');
    setFeedback('');
    try {
      await work();
      await load();
      setDrafts((existing) => {
        const next = { ...existing };
        delete next[key];
        return next;
      });
      setFeedback(message);
    } catch (runError: unknown) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setBusyKey('');
    }
  };

  if (loading) return <div className={settingsStyles.loading} role="status">Loading site text…</div>;

  return (
    <div className={styles.panel}>
      {error && <div className={settingsStyles.error} role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Reload</button></div>}
      {feedback && <div className={settingsStyles.success} role="status">{feedback}</div>}

      <div className={settingsStyles.warning} role="note">
        Quickest way: open the site signed in as an administrator, press <strong>Translate this page</strong> (bottom left) and click
        any text. Text you have seen on the site while signed in is also listed here as Untranslated. Import and export are under{' '}
        <button type="button" className={styles.linkButton} onClick={() => navigate('settings', 'translations')}>Settings → Translations</button>{' '}
        (group <code>phrases</code>).
      </div>

      <section className={settingsStyles.form} aria-label="Site text">
        <div className={styles.filters}>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search text…" aria-label="Search" />
          <select value={status} onChange={(event) => setStatus(event.target.value as Status)} aria-label="Show">
            <option value="untranslated">Untranslated ({counts.untranslated})</option>
            <option value="saved">Translated here ({counts.saved})</option>
            <option value="bundled">Built-in {definition.name} ({counts.bundled})</option>
            <option value="all">Everything ({entries.length})</option>
          </select>
        </div>

        {shown.length === 0 ? (
          <p className={settingsStyles.help}>
            {status === 'untranslated' ? 'Nothing waiting. Browse the site while signed in to collect more text.' : 'Nothing matches.'}
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Original</th><th>{definition.name}</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead>
              <tbody>
                {shown.map((entry) => {
                  const saved = entry.row?.translation_value || '';
                  const value = drafts[entry.key] ?? (saved || entry.bundled || '');
                  const changed = value !== (saved || entry.bundled || '');
                  const busy = busyKey === entry.key;
                  const save = () => void run(entry.key, () => savePhrase(entry.source, target, value), `Saved “${entry.source.slice(0, 60)}”.`);
                  return (
                    <tr key={entry.key}>
                      <td className={styles.sourceCell} dir="auto">{entry.source}</td>
                      <td>
                        <input className={styles.phraseInput} value={value} lang={target} dir={definition.dir}
                          placeholder={statusOf(entry) === 'untranslated' ? 'Not translated yet' : ''}
                          aria-label={`${definition.name} for ${entry.source.slice(0, 80)}`}
                          onChange={(event) => setDrafts((existing) => ({ ...existing, [entry.key]: event.target.value }))}
                          onKeyDown={(event) => { if (event.key === 'Enter' && changed) save(); }} />
                        {entry.bundled && saved && <small className={styles.note}>Built-in: {entry.bundled}</small>}
                      </td>
                      <td className={styles.actionsCell}>
                        <button type="button" className={styles.linkButton} disabled={!changed || busy} onClick={save}>{busy ? '…' : 'Save'}</button>
                        {entry.row && (
                          <button type="button" className={`${styles.linkButton} ${styles.danger}`} disabled={busy}
                            onClick={() => void run(entry.key, () => deletePhrase(entry.source, target),
                              entry.bundled ? 'Your version was removed; the built-in translation shows again.' : 'Removed from the list.')}>
                            {entry.bundled ? 'Reset' : 'Remove'}
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
          <nav className={styles.pagination} aria-label="Site text pages">
            <button type="button" className={settingsStyles.secondaryButton} disabled={current <= 1} onClick={() => setPage(current - 1)}>← Previous</button>
            <span>Page {current} of {pages}</span>
            <button type="button" className={settingsStyles.secondaryButton} disabled={current >= pages} onClick={() => setPage(current + 1)}>Next →</button>
          </nav>
        )}
      </section>
    </div>
  );
}
