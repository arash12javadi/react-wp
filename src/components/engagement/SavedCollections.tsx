import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  fetchMyBookmarks, moveBookmark, removeBookmark, renameCollection, type SavedCollectionsResult, type SavedEntry,
} from '../../lib/engagement';
import { formatDate, formatNumber } from '../../lib/i18n';
import { useTranslation } from '../../context/I18nContext';
import './engagement.css';

const typeLabel = (type: string) => (type === 'product' ? 'Product' : type === 'page' ? 'Post' : type);

/**
 * My Saved Collections: everything the signed-in person saved, filtered by collection, with move,
 * remove, and rename or merge of a collection. Shown on the visitors' dashboard and as
 * [rwp_saved_collections]. Callers make sure someone is signed in.
 */
export default function SavedCollections() {
  const { t } = useTranslation();
  const [data, setData] = useState<SavedCollectionsResult>({ collections: [], items: [] });
  const [active, setActive] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [renaming, setRenaming] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await fetchMyBookmarks());
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Your saved items could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // A collection that was renamed or emptied away falls back to "All".
  const current = data.collections.some((collection) => collection.name === active) ? active : '';
  const visible = useMemo(() => (current ? data.items.filter((item) => item.collection_name === current) : data.items), [current, data.items]);
  const names = data.collections.map((collection) => collection.name);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
    } catch (actionError: unknown) {
      setError(actionError instanceof Error ? actionError.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    const next = renaming.trim();
    if (!current || !next || next === current) { setRenaming(''); return; }
    void run(async () => {
      await renameCollection(current, next);
      setActive(next);
      setRenaming('');
    });
  };

  return (
    <section className="rwp-saved-collections" aria-labelledby="rwp-saved-heading">
      <h3 id="rwp-saved-heading">{t('engagement.savedCollections', 'My saved collections')}</h3>
      {error && <p className="rwp-engagement-error" role="alert">{error}</p>}
      {loading ? <p className="rwp-engagement-muted">{t('engagement.loading', 'Loading…')}</p> : (
        <>
          <div className="rwp-engagement-pills" role="group" aria-label={t('engagement.collections', 'Collections')}>
            <button type="button" className="rwp-engagement-pill" aria-pressed={current === ''} onClick={() => setActive('')}>
              {t('engagement.all', 'All')} ({formatNumber(data.items.length)})
            </button>
            {data.collections.map((collection) => (
              <button key={collection.name} type="button" className="rwp-engagement-pill" aria-pressed={current === collection.name}
                onClick={() => { setActive(collection.name); setRenaming(''); }}>
                {collection.name} ({formatNumber(collection.count)})
              </button>
            ))}
          </div>

          {current && (
            <form className="rwp-engagement-actions" onSubmit={submitRename}>
              <input value={renaming} maxLength={60} placeholder={t('engagement.renameTo', 'Rename or merge into…')}
                aria-label={t('engagement.renameCollection', 'New name for this collection')} onChange={(event) => setRenaming(event.target.value)} />
              <button type="submit" className="rwp-engagement-link-button" disabled={busy || !renaming.trim()}>{t('engagement.rename', 'Rename')}</button>
              <span className="rwp-engagement-muted">{t('engagement.renameHelp', 'Use an existing name to merge the two.')}</span>
            </form>
          )}

          {!visible.length ? (
            <p className="rwp-engagement-muted">
              {data.items.length
                ? t('engagement.emptyCollection', 'Nothing in this collection.')
                : t('engagement.nothingSaved', 'You have not saved anything yet. Use the Save button on a post or product to keep it here.')}
            </p>
          ) : (
            <ul className="rwp-engagement-list is-grid">
              {visible.map((entry) => <SavedCard key={entry.id} entry={entry} names={names} busy={busy} run={run} />)}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function SavedCard({ entry, names, busy, run }: {
  entry: SavedEntry;
  names: string[];
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState('');
  const others = names.filter((name) => name !== entry.collection_name);

  return (
    <li className="rwp-engagement-item rwp-saved-item">
      {entry.image && !entry.missing && <img className="rwp-engagement-thumb" src={entry.image} alt="" loading="lazy" />}
      <span className="rwp-engagement-item-body">
        {entry.missing
          ? <span className="rwp-engagement-item-title">{t('engagement.unavailable', 'No longer available')}</span>
          : <a className="rwp-engagement-item-title" href={entry.url}>{entry.title}</a>}
        <span className="rwp-engagement-item-meta">
          <span className="rwp-engagement-badge">{typeLabel(entry.target_type)}</span>
          <span>{entry.collection_name}</span>
          <span>{t('engagement.savedOn', 'Saved {date}', { date: formatDate(entry.saved_at) })}</span>
        </span>
        {entry.excerpt && !entry.missing && <p className="rwp-engagement-item-excerpt">{entry.excerpt}</p>}
        <span className="rwp-engagement-actions">
          <select value={target} disabled={busy} aria-label={t('engagement.moveTo', 'Move to collection')} onChange={(event) => {
            const value = event.target.value;
            if (value === '__new') {
              const name = window.prompt(t('engagement.newCollectionName', 'Name of the new collection'))?.trim();
              if (name) void run(() => moveBookmark(entry, name));
            } else if (value) {
              void run(() => moveBookmark(entry, value));
            }
            setTarget('');
          }}>
            <option value="">{t('engagement.moveTo', 'Move to collection')}…</option>
            {others.map((name) => <option key={name} value={name}>{name}</option>)}
            <option value="__new">{t('engagement.newCollection', 'New collection')}…</option>
          </select>
          <button type="button" className="rwp-engagement-link-button is-danger" disabled={busy}
            onClick={() => void run(() => removeBookmark(entry.id))}>{t('engagement.remove', 'Remove')}</button>
        </span>
      </span>
    </li>
  );
}
