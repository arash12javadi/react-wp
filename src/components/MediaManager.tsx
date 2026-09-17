import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { describeDbError, getSupabaseClient } from '../lib/db';
import { loadSettings, type SiteSettings, defaultSettings } from '../lib/settings';
import { describeDimensions, formatBytes, uploadToCloudinary, uploadToImageKit } from '../lib/uploads';
import { checkUploadRules, describeAllowance, fetchUploadAllowance, useAppSettings, type UploadAllowance } from '../lib/appSettings';
import { fetchProfile } from '../lib/profiles';
import { hasCapability } from '../lib/roles';
import type { MediaItem, MediaProvider } from '../lib/types';
import styles from './MediaManager.module.css';

type Tab = 'library' | 'upload' | 'url';

interface MediaManagerProps {
  onSelect?: (item: MediaItem) => void;
  /** Makes the picker multi-select: ticked items are handed over together, in the order they were ticked. */
  onSelectMany?: (items: MediaItem[]) => void;
  onClose?: () => void;
  heading?: string;
}

/** Runs `task` over `list` with at most `limit` calls in flight, keeping result order. */
const mapLimited = async <T, R>(list: T[], limit: number, task: (entry: T) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next++;
      results[index] = await task(list[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return results;
};

/** True when an image still needs a title or alt text. */
const isMissingText = (item: MediaItem) => !item.alt_text?.trim() || !item.title?.trim();

const providerLabels: Record<MediaProvider, string> = {
  cloudinary: 'Cloudinary',
  imagekit: 'ImageKit',
  external: 'External URL',
};

const migrationHint =
  'Run supabase/migrations/20260912_profiles_capabilities_media.sql in the Supabase SQL Editor, then reload. Re-running it is safe.';

/** Turns the common Postgres/PostgREST failures on this table into something actionable. */
const explainMediaError = (error: unknown): string => {
  // The upload-rules trigger still names the screen by its old title; it now lives under Settings.
  const message = describeDbError(error).replace(/App Settings →/g, 'Settings →');
  // PGRST205: the table may well exist, but PostgREST has not reloaded its schema cache.
  if (/schema cache/i.test(message) || message.includes('PGRST205')) {
    return 'Supabase cannot see the media table yet. If you have already run the migration, its schema cache is stale — run "notify pgrst, \'reload schema\';" in the SQL Editor, or wait a minute and reload. ' +
      `If you have not run it: ${migrationHint}`;
  }
  if (message.includes('relation "media"') || message.includes('42P01')) {
    return `The media table does not exist. ${migrationHint}`;
  }
  if (message.includes('provider_file_id')) {
    return `Your media table predates the provider_file_id column, which is needed to delete files at the provider. ${migrationHint}`;
  }
  if (/row-level security|violates row-level/i.test(message)) {
    return 'The database rejected this write under row level security. Your role needs the upload_files capability (Author or above, or granted under Settings → Roles), and when media is limited to its uploader you can only change your own files.';
  }
  return message;
};

export default function MediaManager({ onSelect, onSelectMany, onClose, heading = 'Media Library' }: MediaManagerProps) {
  const [tab, setTab] = useState<Tab>('library');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  // Ids ticked for bulk actions, in tick order (the order a multi-pick inserts them).
  const [checked, setChecked] = useState<string[]>([]);
  const rangeAnchor = useRef<string | null>(null);
  const [uploadStep, setUploadStep] = useState('');
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<'all' | MediaProvider>('all');
  const [settings, setSettings] = useState<SiteSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const [uploadProvider, setUploadProvider] = useState<MediaProvider>('cloudinary');
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [urlForm, setUrlForm] = useState({ url: '', title: '', alt_text: '' });
  const [savingUrl, setSavingUrl] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteSupport, setDeleteSupport] = useState<{ cloudinary: boolean; imagekit: boolean } | null>(null);
  const { settings: appSettings } = useAppSettings();
  const [allowance, setAllowance] = useState<UploadAllowance | null>(null);
  // Set when the library is limited to the viewer's own uploads (Settings → General).
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);

  useEffect(() => {
    // Surfaced up front rather than only when a delete fails, so orphaned files at the
    // provider are not discovered after the fact.
    fetch('/api/media-config')
      .then((response) => (response.ok ? response.json() : null))
      .then(setDeleteSupport)
      .catch(() => setDeleteSupport(null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [{ data, error: queryError }, loadedSettings, { data: userData }, loadedAllowance] = await Promise.all([
        getSupabaseClient().from('media').select('*').order('created_at', { ascending: false }),
        loadSettings().catch(() => defaultSettings),
        getSupabaseClient().auth.getUser(),
        fetchUploadAllowance().catch(() => null),
      ]);
      if (queryError) throw queryError;
      setItems((data || []) as MediaItem[]);
      setSettings(loadedSettings);
      setAllowance(loadedAllowance);
      const user = userData.user;
      const profile = user ? await fetchProfile(user.id).catch(() => null) : null;
      // Media rows are public, so this is a view filter; the database enforces who may change them.
      setOwnerFilter(user && !(profile && hasCapability(profile.role, 'edit_others_posts')) ? user.id : null);
    } catch (loadError: unknown) {
      setError(explainMediaError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const ownOnly = appSettings.general.scope_media_to_owner && ownerFilter;
    return items.filter((item) =>
      (!ownOnly || item.uploaded_by === ownerFilter) &&
      (providerFilter === 'all' || item.provider === providerFilter) &&
      (!term || `${item.title || ''} ${item.file_name || ''} ${item.alt_text || ''}`.toLowerCase().includes(term)));
  }, [appSettings.general.scope_media_to_owner, items, ownerFilter, providerFilter, search]);

  // Bulk actions only touch ticked items that are currently visible, so a filter never hides
  // what is about to be deleted.
  const checkedItems = useMemo(() => {
    const byId = new Map(visible.map((item) => [item.id, item]));
    return checked.map((id) => byId.get(id)).filter((item): item is MediaItem => Boolean(item));
  }, [checked, visible]);
  const allVisibleChecked = visible.length > 0 && checkedItems.length === visible.length;

  // Details panel navigation, so titles and alt text can be filled in image after image.
  const gridRef = useRef<HTMLDivElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const altInput = useRef<HTMLInputElement>(null);
  const selectedIndex = selected ? visible.findIndex((item) => item.id === selected.id) : -1;
  const missingCount = useMemo(() => visible.filter(isMissingText).length, [visible]);

  const goTo = (index: number) => {
    const target = visible[index];
    if (target) setSelected(target);
  };

  /** Opens the next image (wrapping around) that still lacks a title or alt text. */
  const goToNextMissing = () => {
    for (let step = 1; step <= visible.length; step += 1) {
      const index = (selectedIndex + step) % visible.length;
      if (isMissingText(visible[index])) {
        goTo(index);
        const target = visible[index];
        (target.title?.trim() ? altInput : titleInput).current?.focus();
        return;
      }
    }
  };

  // Keeps the image being edited in view when Prev/Next moves past the visible rows.
  const selectedId = selected?.id;
  useEffect(() => {
    if (!selectedId) return;
    const thumb = gridRef.current?.querySelector(`[data-media-id="${CSS.escape(selectedId)}"]`);
    thumb?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  const toggleChecked = (id: string, range: boolean) => {
    const anchor = rangeAnchor.current;
    setChecked((current) => {
      if (range && anchor && anchor !== id) {
        const ids = visible.map((item) => item.id);
        const from = ids.indexOf(anchor);
        const to = ids.indexOf(id);
        if (from >= 0 && to >= 0) {
          const span = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
          return [...current, ...span.filter((spanId) => !current.includes(spanId))];
        }
      }
      return current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id];
    });
    rangeAnchor.current = id;
  };

  const toggleAllVisible = () => {
    const ids = visible.map((item) => item.id);
    setChecked((current) => (allVisibleChecked
      ? current.filter((id) => !ids.includes(id))
      : [...current, ...ids.filter((id) => !current.includes(id))]));
  };

  const insertRecord = async (record: Partial<MediaItem>) => {
    const { data: userData } = await getSupabaseClient().auth.getUser();
    const { data, error: insertError } = await getSupabaseClient()
      .from('media')
      .insert({ ...record, uploaded_by: userData.user?.id ?? null })
      .select()
      .single();
    if (insertError) throw insertError;
    const item = data as MediaItem;
    setItems((current) => [item, ...current]);
    setSelected(item);
    return item;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    setFeedback('');
    const uploaded: string[] = [];
    try {
      // Everything is checked before anything is sent: a file rejected after upload would be
      // left behind at the provider with no library record.
      const current = await fetchUploadAllowance().catch(() => allowance);
      const problems: string[] = [];
      let pendingBytes = 0;
      for (const file of Array.from(files)) {
        const fileProblems = await checkUploadRules(file, appSettings.uploads, current, pendingBytes);
        if (fileProblems.length) problems.push(`"${file.name}" was not uploaded: ${fileProblems.join('; ')}.`);
        pendingBytes += file.size;
      }
      if (problems.length) {
        setError(problems.join(' '));
        return;
      }

      setProgress(0);
      const list = Array.from(files);
      for (const [index, file] of list.entries()) {
        if (list.length > 1) setUploadStep(`File ${index + 1} of ${list.length}: ${file.name}`);
        setProgress(0);
        const upload = uploadProvider === 'imagekit'
          ? await uploadToImageKit(file, settings, setProgress)
          : await uploadToCloudinary(file, settings, setProgress);
        const item = await insertRecord({
          url: upload.url,
          title: upload.file_name,
          alt_text: '',
          provider: upload.provider,
          file_name: upload.file_name,
          provider_file_id: upload.provider_file_id,
          width: upload.width,
          height: upload.height,
          bytes: upload.bytes,
          mime_type: upload.mime_type,
        });
        uploaded.push(item.id);
      }
      setFeedback(uploaded.length > 1
        ? `Uploaded ${uploaded.length} files. They are selected below${onSelectMany ? ', ready to insert' : ''}.`
        : 'Upload complete.');
      setTab('library');
    } catch (uploadError: unknown) {
      setError(uploaded.length
        ? `${uploaded.length} file(s) uploaded before this failure, and are selected in the library. ${explainMediaError(uploadError)}`
        : explainMediaError(uploadError));
    } finally {
      // A batch lands ticked, so it can be inserted or deleted together straight away.
      if (uploaded.length > 1 || (onSelectMany && uploaded.length)) setChecked(uploaded);
      setProgress(null);
      setUploadStep('');
      void fetchUploadAllowance().then(setAllowance).catch(() => {});
    }
  };

  const saveExternal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingUrl(true);
    setError('');
    setFeedback('');
    try {
      const url = urlForm.url.trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('Enter a full URL starting with http:// or https://');
      await insertRecord({
        url,
        title: urlForm.title.trim() || url.split('/').pop() || 'Untitled',
        alt_text: urlForm.alt_text.trim(),
        provider: 'external',
        file_name: url.split('/').pop() || null,
      });
      setUrlForm({ url: '', title: '', alt_text: '' });
      setFeedback('Saved to the library.');
      setTab('library');
    } catch (saveError: unknown) {
      setError(explainMediaError(saveError));
    } finally {
      setSavingUrl(false);
    }
  };

  const updateSelected = async (changes: Partial<MediaItem>) => {
    if (!selected) return;
    const next = { ...selected, ...changes };
    setSelected(next);
    setItems((current) => current.map((item) => (item.id === next.id ? next : item)));
    const { error: updateError } = await getSupabaseClient()
      .from('media').update(changes).eq('id', selected.id);
    if (updateError) setError(explainMediaError(updateError));
  };

  /** Deletes the file at its provider. Returns why it failed, or null on success. */
  const deleteAtProvider = async (item: MediaItem, accessToken: string): Promise<string | null> => {
    const response = await fetch('/api/media-delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      // The server reads the provider, file id and URL from the stored row and checks that
      // this user may delete it; nothing else from the browser is trusted.
      body: JSON.stringify({ id: item.id }),
    }).catch(() => null);
    if (response?.ok) return null;
    const payload = response ? await response.json().catch(() => ({})) : {};
    // No JSON error means the request never reached server.mjs, e.g. the Vite dev proxy
    // could not connect to port 3000.
    return payload.error
      || `The media server did not handle the delete (${response ? `HTTP ${response.status}` : 'no response'}). If you are using npm run dev, npm start must also be running on port 3000.`;
  };

  const accessToken = async () => {
    const { data: sessionData } = await getSupabaseClient().auth.getSession();
    return sessionData.session?.access_token || '';
  };

  const removeSelected = async () => {
    if (!selected) return;
    const atProvider = selected.provider !== 'external';
    const question = atProvider
      ? `Delete "${selected.title || selected.file_name}" from ${providerLabels[selected.provider]} and the library? This cannot be undone.`
      : `Remove "${selected.title || selected.file_name}" from the library?`;
    if (!window.confirm(question)) return;

    setError('');
    setFeedback('');
    setDeleting(true);
    try {
      if (atProvider) {
        const detail = await deleteAtProvider(selected, await accessToken());
        if (detail && !window.confirm(`${detail}\n\nRemove it from the library anyway? The file will stay in your ${providerLabels[selected.provider]} account.`)) {
          setError(detail);
          return;
        }
      }

      const { error: deleteError } = await getSupabaseClient().from('media').delete().eq('id', selected.id);
      if (deleteError) throw deleteError;
      setItems((current) => current.filter((item) => item.id !== selected.id));
      setChecked((current) => current.filter((id) => id !== selected.id));
      setSelected(null);
      setFeedback('Media deleted.');
      void fetchUploadAllowance().then(setAllowance).catch(() => {});
    } catch (removeError: unknown) {
      setError(explainMediaError(removeError));
    } finally {
      setDeleting(false);
    }
  };

  const removeChecked = async () => {
    const targets = checkedItems;
    if (!targets.length) return;
    const atProvider = targets.filter((item) => item.provider !== 'external');
    const providerNames = [...new Set(atProvider.map((item) => providerLabels[item.provider]))].join(' and ');
    const question = atProvider.length
      ? `Delete ${targets.length} selected item(s)? ${atProvider.length} file(s) will also be deleted from ${providerNames}. This cannot be undone.`
      : `Remove ${targets.length} selected item(s) from the library?`;
    if (!window.confirm(question)) return;

    setError('');
    setFeedback('');
    setDeleting(true);
    try {
      const token = await accessToken();
      const details = await mapLimited(atProvider, 4, (item) => deleteAtProvider(item, token));
      const failures = atProvider
        .map((item, index) => ({ item, detail: details[index] }))
        .filter((entry): entry is { item: MediaItem; detail: string } => Boolean(entry.detail));

      let removable = targets;
      if (failures.length) {
        const listed = failures.slice(0, 5)
          .map(({ item, detail }) => `• "${item.title || item.file_name}": ${detail}`).join('\n');
        const more = failures.length > 5 ? `\n…and ${failures.length - 5} more.` : '';
        const keepAnyway = window.confirm(
          `${failures.length} of ${atProvider.length} file(s) could not be deleted at the provider:\n\n${listed}${more}\n\n` +
          'Remove them from the library anyway? Those files will stay in your provider account.\n' +
          'Cancel keeps them in the library; the others are deleted either way.',
        );
        if (!keepAnyway) {
          const failed = new Set(failures.map(({ item }) => item.id));
          removable = targets.filter((item) => !failed.has(item.id));
        }
      }

      if (removable.length) {
        // .select() because row level security skips rows silently instead of raising an error.
        const { data, error: deleteError } = await getSupabaseClient()
          .from('media').delete().in('id', removable.map((item) => item.id)).select('id');
        if (deleteError) throw deleteError;
        const deleted = new Set(((data || []) as Array<{ id: string }>).map((row) => row.id));
        setItems((current) => current.filter((item) => !deleted.has(item.id)));
        setChecked((current) => current.filter((id) => !deleted.has(id)));
        if (selected && deleted.has(selected.id)) setSelected(null);

        const blocked = removable.length - deleted.size;
        if (blocked) {
          setError(`${blocked} of ${removable.length} item(s) were not removed from the library: row level security did not allow deleting them. ` +
            'When media is limited to its uploader, you can only delete files you uploaded yourself. They are still selected.');
        }
        if (deleted.size) setFeedback(`Deleted ${deleted.size} item(s).`);
      }
      if (failures.length && removable.length < targets.length) {
        setError((current) => [current, `${targets.length - removable.length} item(s) were kept because their provider delete failed.`].filter(Boolean).join(' '));
      }
      void fetchUploadAllowance().then(setAllowance).catch(() => {});
    } catch (removeError: unknown) {
      setError(explainMediaError(removeError));
    } finally {
      setDeleting(false);
    }
  };

  const copyUrl = async () => {
    if (!selected) return;
    await navigator.clipboard.writeText(selected.url);
    setFeedback('URL copied to clipboard.');
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void handleFiles(event.dataTransfer.files);
  };

  const body = (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2>{heading}</h2>
        {onClose && <button type="button" className={styles.close} onClick={onClose} aria-label="Close media library">✕</button>}
      </div>

      <div className={styles.tabs} role="tablist">
        {([['library', 'Media Library'], ['upload', 'Upload Files'], ['url', 'Add via URL']] as Array<[Tab, string]>).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            className={tab === id ? styles.tabActive : styles.tab} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {feedback && <div className={styles.feedback} role="status">{feedback}</div>}

      {deleteSupport && !deleteSupport.cloudinary && items.some((item) => item.provider === 'cloudinary') && (
        <div className={styles.warning} role="status">
          <strong>Deleting will not remove files from Cloudinary.</strong>
          <span>
            Set <code>CLOUDINARY_API_KEY</code> and <code>CLOUDINARY_API_SECRET</code> in <code>.env.local</code> and
            restart the server. Until then, deleted items are removed from this library but the files stay in your
            Cloudinary account.
          </span>
        </div>
      )}
      {deleteSupport && !deleteSupport.imagekit && items.some((item) => item.provider === 'imagekit') && (
        <div className={styles.warning} role="status">
          <strong>Deleting will not remove files from ImageKit.</strong>
          <span>Set <code>IMAGEKIT_PRIVATE_KEY</code> in <code>.env.local</code> and restart the server.</span>
        </div>
      )}

      {tab === 'library' && (
        <div className={styles.libraryLayout}>
          <div className={styles.libraryMain}>
            <div className={styles.filters}>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
                placeholder="Search media…" aria-label="Search media" />
              <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value as 'all' | MediaProvider)} aria-label="Filter by source">
                <option value="all">All sources</option>
                <option value="cloudinary">Cloudinary</option>
                <option value="imagekit">ImageKit</option>
                <option value="external">External URL</option>
              </select>
            </div>
            {!loading && visible.length > 0 && (
              <div className={styles.bulkBar}>
                <label className={styles.selectAll}>
                  <input type="checkbox" checked={allVisibleChecked}
                    ref={(input) => { if (input) input.indeterminate = checkedItems.length > 0 && !allVisibleChecked; }}
                    onChange={toggleAllVisible} />
                  Select all ({visible.length})
                </label>
                {checkedItems.length > 0 ? (
                  <>
                    <span className={styles.bulkCount}>{checkedItems.length} selected</span>
                    <button type="button" className={styles.bulkGhost} onClick={() => setChecked([])}>Clear selection</button>
                    <button type="button" className={styles.danger} disabled={deleting} onClick={() => void removeChecked()}>
                      {deleting ? 'Deleting…' : `Delete selected (${checkedItems.length})`}
                    </button>
                    {onSelectMany && (
                      <button type="button" className={styles.primary} onClick={() => onSelectMany(checkedItems)}>
                        Insert {checkedItems.length} selected
                      </button>
                    )}
                  </>
                ) : (
                  <span className={styles.muted}>
                    {onSelectMany ? 'Click images to select several.' : 'Tick images, or Ctrl/Shift-click, to select several.'}
                  </span>
                )}
              </div>
            )}
            {loading ? <p className={styles.muted}>Loading media…</p> : visible.length === 0 ? (
              <p className={styles.muted}>No media yet. Upload a file or add one by URL.</p>
            ) : (
              <div className={styles.grid} ref={gridRef}>
                {visible.map((item) => {
                  const isChecked = checked.includes(item.id);
                  const label = item.title || item.file_name || 'media item';
                  return (
                    <div key={item.id} data-media-id={item.id} className={isChecked ? styles.thumbWrapChecked : styles.thumbWrap}>
                      <button type="button"
                        className={selected?.id === item.id ? styles.thumbActive : styles.thumb}
                        onClick={(event) => {
                          // A multi-pick ticks on plain click; elsewhere a plain click only opens details.
                          if (onSelectMany || event.shiftKey || event.ctrlKey || event.metaKey) toggleChecked(item.id, event.shiftKey);
                          setSelected(item);
                        }}>
                        <img src={item.url} alt={item.alt_text || item.title || ''} loading="lazy" />
                        <span>{item.title || item.file_name}</span>
                        {isMissingText(item) && (
                          <em className={styles.missingBadge} title={!item.alt_text?.trim() ? 'No alt text' : 'No title'}>
                            {!item.alt_text?.trim() ? 'No alt' : 'No title'}
                          </em>
                        )}
                      </button>
                      <input type="checkbox" className={styles.thumbCheck} checked={isChecked}
                        aria-label={`Select ${label}`}
                        onChange={(event) => {
                          // React fires a checkbox's change from its click, so the native event carries Shift.
                          const native = event.nativeEvent as Partial<MouseEvent>;
                          toggleChecked(item.id, Boolean(native.shiftKey));
                        }} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {selected && (
            <aside className={styles.details} aria-label="Media details">
              {selectedIndex >= 0 && (
                <div className={styles.detailNav}>
                  <button type="button" onClick={() => goTo(selectedIndex - 1)} disabled={selectedIndex === 0}
                    aria-label="Previous image" title="Previous image">‹ Prev</button>
                  <span aria-live="polite">{selectedIndex + 1} of {visible.length}</span>
                  <button type="button" onClick={() => goTo(selectedIndex + 1)} disabled={selectedIndex === visible.length - 1}
                    aria-label="Next image" title="Next image">Next ›</button>
                </div>
              )}
              {selectedIndex >= 0 && missingCount > 0 && (
                <button type="button" className={styles.nextMissing} onClick={goToNextMissing}
                  disabled={missingCount === 1 && isMissingText(selected)}>
                  Next missing title/alt ({missingCount} left)
                </button>
              )}
              <img className={styles.preview} src={selected.url} alt={selected.alt_text || ''} />
              <dl>
                <div><dt>Source</dt><dd>{providerLabels[selected.provider]}</dd></div>
                <div><dt>Dimensions</dt><dd>{describeDimensions(selected)}</dd></div>
                <div><dt>File size</dt><dd>{formatBytes(selected.bytes)}</dd></div>
                <div><dt>Uploaded</dt><dd>{new Date(selected.created_at).toLocaleDateString()}</dd></div>
              </dl>
              <label>Public URL
                <span className={styles.urlRow}>
                  <input readOnly value={selected.url} onFocus={(event) => event.target.select()} />
                  <button type="button" onClick={() => void copyUrl()}>Copy</button>
                </span>
              </label>
              <label>Title
                <input ref={titleInput} value={selected.title || ''} onChange={(event) => void updateSelected({ title: event.target.value })}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); altInput.current?.focus(); } }} />
              </label>
              <label>Alt text
                <input ref={altInput} value={selected.alt_text || ''} onChange={(event) => void updateSelected({ alt_text: event.target.value })}
                  onKeyDown={(event) => {
                    // Enter moves on to the next image's title, so a whole library can be captioned from the keyboard.
                    if (event.key === 'Enter' && selectedIndex < visible.length - 1) {
                      event.preventDefault();
                      goTo(selectedIndex + 1);
                      titleInput.current?.focus();
                    }
                  }} />
              </label>
              <p className={styles.detailHint}>Enter in Title jumps to Alt text; Enter in Alt text opens the next image.</p>
              <div className={styles.detailActions}>
                <button type="button" className={styles.danger} disabled={deleting} onClick={() => void removeSelected()}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
                {onSelect && (
                  <button type="button" className={styles.primary} onClick={() => onSelect(selected)}>
                    Select / Insert
                  </button>
                )}
              </div>
            </aside>
          )}
        </div>
      )}

      {tab === 'upload' && (
        <div className={styles.uploadTab}>
          <div className={styles.providerToggle} role="radiogroup" aria-label="Upload destination">
            {(['cloudinary', 'imagekit'] as MediaProvider[]).map((provider) => (
              <button key={provider} type="button" role="radio" aria-checked={uploadProvider === provider}
                className={uploadProvider === provider ? styles.providerActive : styles.provider}
                onClick={() => setUploadProvider(provider)}>
                Upload via {providerLabels[provider]}
              </button>
            ))}
          </div>
          <div
            className={dragging ? styles.dropzoneActive : styles.dropzone}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <p><strong>Drag files here</strong> — several at once is fine</p>
            <p className={styles.muted}>or</p>
            <button type="button" className={styles.primary} onClick={() => fileInput.current?.click()}>Choose files</button>
            <input ref={fileInput} type="file" multiple accept="image/*" hidden
              onChange={(event) => void handleFiles(event.target.files)} />
          </div>
          {progress !== null && (
            <div className={styles.progressRow}>
              <progress className={styles.progress} value={progress} max={100} />
              <span>{progress}%</span>
            </div>
          )}
          {progress !== null && uploadStep && (
            <p className={styles.muted} role="status">{uploadStep}</p>
          )}
          {allowance && <p className={styles.muted} role="status">{describeAllowance(allowance)}</p>}
          <p className={styles.muted}>
            {uploadProvider === 'cloudinary'
              ? 'Cloudinary uses the unsigned upload preset configured under Upload settings. No API secret is needed to upload.'
              : 'ImageKit uploads are signed by the server, which needs IMAGEKIT_PRIVATE_KEY set.'}
          </p>
        </div>
      )}

      {tab === 'url' && (
        <form className={styles.urlTab} onSubmit={saveExternal}>
          <label>Image URL
            <input value={urlForm.url} onChange={(event) => setUrlForm((current) => ({ ...current, url: event.target.value }))}
              placeholder="https://example.com/image.jpg" required />
          </label>
          <label>Title
            <input value={urlForm.title} onChange={(event) => setUrlForm((current) => ({ ...current, title: event.target.value }))} />
          </label>
          <label>Alt text
            <input value={urlForm.alt_text} onChange={(event) => setUrlForm((current) => ({ ...current, alt_text: event.target.value }))} />
          </label>
          {/^https?:\/\//i.test(urlForm.url.trim()) && (
            <img className={styles.preview} src={urlForm.url.trim()} alt="Preview" />
          )}
          <button type="submit" className={styles.primary} disabled={savingUrl}>
            {savingUrl ? 'Saving…' : 'Save to Library'}
          </button>
        </form>
      )}
    </div>
  );

  if (!onClose) return body;
  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={heading}>
      {body}
    </div>
  );
}
