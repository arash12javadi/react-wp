import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { describeDbError, getSupabaseClient } from '../lib/db';
import { loadSettings, type SiteSettings, defaultSettings } from '../lib/settings';
import { describeDimensions, formatBytes, uploadToCloudinary, uploadToImageKit } from '../lib/uploads';
import type { MediaItem, MediaProvider } from '../lib/types';
import styles from './MediaManager.module.css';

type Tab = 'library' | 'upload' | 'url';

interface MediaManagerProps {
  onSelect?: (item: MediaItem) => void;
  onClose?: () => void;
  heading?: string;
}

const providerLabels: Record<MediaProvider, string> = {
  cloudinary: 'Cloudinary',
  imagekit: 'ImageKit',
  external: 'External URL',
};

const migrationHint =
  'Run supabase/migrations/20260912_profiles_capabilities_media.sql in the Supabase SQL Editor, then reload. Re-running it is safe.';

/** Turns the common Postgres/PostgREST failures on this table into something actionable. */
const explainMediaError = (error: unknown): string => {
  const message = describeDbError(error);
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
    return 'The database rejected this write under row level security. Your role needs the upload_files capability (Author or above), and the profiles table must exist.';
  }
  return message;
};

export default function MediaManager({ onSelect, onClose, heading = 'Media Library' }: MediaManagerProps) {
  const [tab, setTab] = useState<Tab>('library');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [selected, setSelected] = useState<MediaItem | null>(null);
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
      const [{ data, error: queryError }, loadedSettings] = await Promise.all([
        getSupabaseClient().from('media').select('*').order('created_at', { ascending: false }),
        loadSettings().catch(() => defaultSettings),
      ]);
      if (queryError) throw queryError;
      setItems((data || []) as MediaItem[]);
      setSettings(loadedSettings);
    } catch (loadError: unknown) {
      setError(explainMediaError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) =>
      (providerFilter === 'all' || item.provider === providerFilter) &&
      (!term || `${item.title || ''} ${item.file_name || ''} ${item.alt_text || ''}`.toLowerCase().includes(term)));
  }, [items, providerFilter, search]);

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
    setProgress(0);
    try {
      for (const file of Array.from(files)) {
        const upload = uploadProvider === 'imagekit'
          ? await uploadToImageKit(file, settings, setProgress)
          : await uploadToCloudinary(file, settings, setProgress);
        await insertRecord({
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
      }
      setFeedback('Upload complete.');
      setTab('library');
    } catch (uploadError: unknown) {
      setError(explainMediaError(uploadError));
    } finally {
      setProgress(null);
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
        const { data: sessionData } = await getSupabaseClient().auth.getSession();
        const response = await fetch('/api/media-delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionData.session?.access_token || ''}`,
          },
          body: JSON.stringify({
            provider: selected.provider,
            providerFileId: selected.provider_file_id,
            // Lets the server recover a Cloudinary public id for rows saved before that
            // column existed.
            url: selected.url,
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          const detail = payload.error || 'The file could not be deleted at the provider.';
          if (!window.confirm(`${detail}\n\nRemove it from the library anyway? The file will stay in your ${providerLabels[selected.provider]} account.`)) {
            setError(detail);
            return;
          }
        }
      }

      const { error: deleteError } = await getSupabaseClient().from('media').delete().eq('id', selected.id);
      if (deleteError) throw deleteError;
      setItems((current) => current.filter((item) => item.id !== selected.id));
      setSelected(null);
      setFeedback('Media deleted.');
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
            {loading ? <p className={styles.muted}>Loading media…</p> : visible.length === 0 ? (
              <p className={styles.muted}>No media yet. Upload a file or add one by URL.</p>
            ) : (
              <div className={styles.grid}>
                {visible.map((item) => (
                  <button type="button" key={item.id}
                    className={selected?.id === item.id ? styles.thumbActive : styles.thumb}
                    onClick={() => setSelected(item)}>
                    <img src={item.url} alt={item.alt_text || item.title || ''} loading="lazy" />
                    <span>{item.title || item.file_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selected && (
            <aside className={styles.details} aria-label="Media details">
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
                <input value={selected.title || ''} onChange={(event) => void updateSelected({ title: event.target.value })} />
              </label>
              <label>Alt text
                <input value={selected.alt_text || ''} onChange={(event) => void updateSelected({ alt_text: event.target.value })} />
              </label>
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
            <p><strong>Drag files here</strong></p>
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
