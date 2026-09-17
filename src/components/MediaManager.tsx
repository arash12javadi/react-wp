import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { describeDbError, getSupabaseClient } from '../lib/db';
import { loadSettings, type SiteSettings, defaultSettings } from '../lib/settings';
import { describeDimensions, formatBytes, uploadToCloudinary, uploadToImageKit } from '../lib/uploads';
import { checkUploadRules, describeAllowance, fetchUploadAllowance, useAppSettings, type UploadAllowance } from '../lib/appSettings';
import { fetchProfile } from '../lib/profiles';
import { hasCapability } from '../lib/roles';
import type { MediaItem, MediaProvider } from '../lib/types';
import {
  DEFAULT_MEDIA_FOLDER, createMediaFolder, deleteMediaFolder, folderLineage, isInFolder, listMediaFolders, mediaFoldersMigration,
  normalizeMediaFolder, renameMediaFolder,
} from '../lib/mediaFolders';
import FolderSidebar, { MEDIA_DRAG_TYPE, type FolderDeleteChoice, type FolderNode } from './media/FolderSidebar';
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
  if (message.includes('media_folder_format')) {
    return 'The database rejected that folder name. Use letters, digits, "-" and "_", with "/" between levels (for example blog/2026).';
  }
  if (/'folder' column|column media\.folder|column "folder"/i.test(message)) {
    return `The media table has no folder column yet. Run ${mediaFoldersMigration} in the Supabase SQL Editor, then reload. Re-running it is safe.`;
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
  // null while unknown; false until the media folders migration has been run.
  const [folderSupport, setFolderSupport] = useState<boolean | null>(null);
  const [folderFilter, setFolderFilter] = useState<string>('all');
  // Rows of media_folders; null when the folder manager migration has not been run.
  const [folderRows, setFolderRows] = useState<string[] | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [uploadFolder, setUploadFolder] = useState(DEFAULT_MEDIA_FOLDER);
  const [moveFolder, setMoveFolder] = useState('');
  const [movingFolder, setMovingFolder] = useState(false);
  const [folderDraft, setFolderDraft] = useState('');
  const folderListId = useId();

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
      const [{ data, error: queryError }, loadedSettings, { data: userData }, loadedAllowance, { error: folderError }, storedFolders] = await Promise.all([
        getSupabaseClient().from('media').select('*').order('created_at', { ascending: false }),
        loadSettings().catch(() => defaultSettings),
        getSupabaseClient().auth.getUser(),
        fetchUploadAllowance().catch(() => null),
        // Folders need the 20260927 migration; until then the library works exactly as before.
        getSupabaseClient().from('media').select('folder').limit(1),
        // Creating, renaming and deleting folders need 20260928; null until it has been run.
        listMediaFolders(),
      ]);
      if (queryError) throw queryError;
      setFolderSupport(!folderError);
      setFolderRows(storedFolders);
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

  // Media the viewer may see at all; the folder list and its counts are built from this.
  const scoped = useMemo(() => {
    const ownOnly = appSettings.general.scope_media_to_owner && ownerFilter;
    return ownOnly ? items.filter((item) => item.uploaded_by === ownerFilter) : items;
  }, [appSettings.general.scope_media_to_owner, items, ownerFilter]);

  // Stored folders (including empty ones) plus every folder media is in, with parents, as a tree.
  const folders = useMemo<FolderNode[]>(() => {
    const direct = new Map<string, number>();
    const total = new Map<string, number>();
    const paths = new Set<string>([DEFAULT_MEDIA_FOLDER, ...(folderRows || [])]);
    scoped.forEach((item) => {
      const folder = item.folder || DEFAULT_MEDIA_FOLDER;
      direct.set(folder, (direct.get(folder) || 0) + 1);
      folderLineage(folder).forEach((path) => {
        paths.add(path);
        total.set(path, (total.get(path) || 0) + 1);
      });
    });
    [...paths].forEach((path) => folderLineage(path).forEach((parent) => paths.add(parent)));
    // Segment by segment, so "blog/2026" sorts under "blog" and before "blog-archive".
    const byTree = (a: string, b: string) => {
      const left = a.split('/');
      const right = b.split('/');
      for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
        const order = left[index].localeCompare(right[index]);
        if (order) return order;
      }
      return left.length - right.length;
    };
    return [...paths].sort(byTree).map((path) => ({
      path,
      name: path.split('/').pop() || path,
      depth: path.split('/').length - 1,
      count: direct.get(path) || 0,
      total: total.get(path) || 0,
    }));
  }, [folderRows, scoped]);
  const activeFolder = folderFilter !== 'all' && folders.some((folder) => folder.path === folderFilter) ? folderFilter : 'all';

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return scoped.filter((item) =>
      // A folder shows its subfolders' media too, matching the count beside it.
      (activeFolder === 'all' || isInFolder(item.folder || DEFAULT_MEDIA_FOLDER, activeFolder)) &&
      (providerFilter === 'all' || item.provider === providerFilter) &&
      (!term || `${item.title || ''} ${item.file_name || ''} ${item.alt_text || ''} ${item.folder || ''}`.toLowerCase().includes(term)));
  }, [activeFolder, providerFilter, scoped, search]);

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
  const selectedFolder = selected?.folder || DEFAULT_MEDIA_FOLDER;
  useEffect(() => { setFolderDraft(selectedFolder); }, [selectedId, selectedFolder]);
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
      const folder = folderSupport ? normalizeMediaFolder(uploadFolder) : undefined;
      for (const [index, file] of list.entries()) {
        if (list.length > 1) setUploadStep(`File ${index + 1} of ${list.length}: ${file.name}`);
        setProgress(0);
        const upload = uploadProvider === 'imagekit'
          ? await uploadToImageKit(file, settings, setProgress, folder)
          : await uploadToCloudinary(file, settings, setProgress, folder);
        const item = await insertRecord({
          ...(folder ? { folder } : {}),
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
      if (uploaded.length && folderSupport) refreshFolders();
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
        ...(folderSupport ? { folder: normalizeMediaFolder(uploadFolder) } : {}),
        url,
        title: urlForm.title.trim() || url.split('/').pop() || 'Untitled',
        alt_text: urlForm.alt_text.trim(),
        provider: 'external',
        file_name: url.split('/').pop() || null,
      });
      setUrlForm({ url: '', title: '', alt_text: '' });
      if (folderSupport) refreshFolders();
      setFeedback('Saved to the library.');
      setTab('library');
    } catch (saveError: unknown) {
      setError(explainMediaError(saveError));
    } finally {
      setSavingUrl(false);
    }
  };

  /**
   * Moves library items to another folder. This changes the library only: the file stays where it
   * was uploaded at the provider, because moving it there can change its URL (Cloudinary's fixed
   * folder mode puts the folder in the public id) and break every page that uses the image.
   */
  const moveToFolder = async (targets: MediaItem[], rawFolder: string) => {
    const folder = normalizeMediaFolder(rawFolder);
    const moving = targets.filter((item) => (item.folder || DEFAULT_MEDIA_FOLDER) !== folder);
    setError('');
    if (!moving.length) {
      setFeedback(`Already in “${folder}”.`);
      return;
    }
    setFeedback('');
    setMovingFolder(true);
    try {
      // .select() because row level security skips rows silently instead of raising an error.
      const { data, error: moveError } = await getSupabaseClient()
        .from('media').update({ folder }).in('id', moving.map((item) => item.id)).select('id');
      if (moveError) throw moveError;
      const moved = new Set(((data || []) as Array<{ id: string }>).map((row) => row.id));
      setItems((current) => current.map((item) => (moved.has(item.id) ? { ...item, folder } : item)));
      setSelected((current) => (current && moved.has(current.id) ? { ...current, folder } : current));
      if (moved.size) setFeedback(`Moved ${moved.size} item(s) to “${folder}”.`);
      // The media_record_folder trigger adds a folder typed here for the first time.
      refreshFolders();
      if (moved.size < moving.length) {
        setError(`${moving.length - moved.size} item(s) were not moved: row level security did not allow changing them. When media is limited to its uploader, you can only move files you uploaded yourself.`);
      }
      setMoveFolder('');
    } catch (moveError: unknown) {
      setError(explainMediaError(moveError));
    } finally {
      setMovingFolder(false);
    }
  };

  const refreshFolders = () => { void listMediaFolders().then(setFolderRows); };

  const selectFolder = (path: string) => {
    setFolderFilter(path);
    // Uploads default to the folder being browsed.
    if (path !== 'all') setUploadFolder(path);
  };

  const createFolder = async (raw: string) => {
    const path = normalizeMediaFolder(raw);
    setError('');
    setFeedback('');
    setFolderBusy(true);
    try {
      await createMediaFolder(path);
      setFolderRows((current) => [...new Set([...(current || []), ...folderLineage(path)])]);
      selectFolder(path);
      setFeedback(`Folder “${path}” is ready. Upload into it, or drag images onto it.`);
      return true;
    } catch (createError: unknown) {
      setError(createError instanceof Error ? createError.message : describeDbError(createError));
      return false;
    } finally {
      setFolderBusy(false);
    }
  };

  const renameFolder = async (from: string, raw: string) => {
    const to = normalizeMediaFolder(raw);
    if (to === from) return true;
    setError('');
    setFeedback('');
    setFolderBusy(true);
    try {
      const moved = await renameMediaFolder(from, to);
      const remap = (folder: string) => (isInFolder(folder, from) ? to + folder.slice(from.length) : folder);
      setItems((current) => current.map((item) => ({ ...item, folder: remap(item.folder || DEFAULT_MEDIA_FOLDER) })));
      setSelected((current) => (current ? { ...current, folder: remap(current.folder || DEFAULT_MEDIA_FOLDER) } : current));
      if (activeFolder !== 'all') setFolderFilter(remap(activeFolder));
      setUploadFolder((current) => remap(normalizeMediaFolder(current)));
      refreshFolders();
      setFeedback(`Renamed “${from}” to “${to}”${moved ? ` and moved ${moved} item(s)` : ''}.`);
      return true;
    } catch (renameError: unknown) {
      setError(renameError instanceof Error ? renameError.message : describeDbError(renameError));
      return false;
    } finally {
      setFolderBusy(false);
    }
  };

  const deleteFolder = async (path: string, choice: FolderDeleteChoice) => {
    setError('');
    setFeedback('');
    setFolderBusy(true);
    try {
      if (choice.mode === 'delete-media') {
        const targets = scoped.filter((item) => isInFolder(item.folder || DEFAULT_MEDIA_FOLDER, path));
        if (targets.length && !(await deleteMediaItems(targets))) {
          setError((current) => `${current ? `${current} ` : ''}The folder “${path}” was kept, because some of its media could not be deleted.`);
          return false;
        }
      }
      const destination = choice.mode === 'move' ? normalizeMediaFolder(choice.to) : undefined;
      const moved = await deleteMediaFolder(path, destination);
      if (destination && moved) {
        setItems((current) => current.map((item) => (isInFolder(item.folder || DEFAULT_MEDIA_FOLDER, path) ? { ...item, folder: destination } : item)));
      }
      if (activeFolder !== 'all' && isInFolder(activeFolder, path)) setFolderFilter(destination || 'all');
      if (isInFolder(normalizeMediaFolder(uploadFolder), path)) setUploadFolder(destination || DEFAULT_MEDIA_FOLDER);
      refreshFolders();
      setFeedback(`Deleted the folder “${path}”${moved ? ` and moved ${moved} item(s) to “${destination}”` : ''}.`);
      return true;
    } catch (deleteError: unknown) {
      setError((current) => `${current && choice.mode === 'delete-media' ? `${current} ` : ''}${deleteError instanceof Error ? deleteError.message : describeDbError(deleteError)}`);
      return false;
    } finally {
      setFolderBusy(false);
    }
  };

  const dropOnFolder = (path: string, ids: string[]) => {
    const targets = scoped.filter((item) => ids.includes(item.id));
    if (targets.length) void moveToFolder(targets, path);
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
    await deleteMediaItems(targets);
  };

  /**
   * Deletes items at their provider and from the library, after the caller has confirmed.
   * Returns true only when every item is gone from the library.
   */
  const deleteMediaItems = async (targets: MediaItem[]): Promise<boolean> => {
    const atProvider = targets.filter((item) => item.provider !== 'external');
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

      let deletedCount = 0;
      if (removable.length) {
        // .select() because row level security skips rows silently instead of raising an error.
        const { data, error: deleteError } = await getSupabaseClient()
          .from('media').delete().in('id', removable.map((item) => item.id)).select('id');
        if (deleteError) throw deleteError;
        const deleted = new Set(((data || []) as Array<{ id: string }>).map((row) => row.id));
        deletedCount = deleted.size;
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
      return deletedCount === targets.length;
    } catch (removeError: unknown) {
      setError(explainMediaError(removeError));
      return false;
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
      {folderSupport && (
        <datalist id={folderListId}>
          {folders.map((folder) => <option key={folder.path} value={folder.path} />)}
        </datalist>
      )}

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
        <div className={folderSupport ? styles.libraryLayoutFolders : styles.libraryLayout}>
          {folderSupport && (
            <FolderSidebar
              nodes={folders}
              allCount={scoped.length}
              active={activeFolder}
              onSelect={selectFolder}
              manageable={folderRows !== null}
              busy={folderBusy || movingFolder || deleting}
              folderListId={folderListId}
              onCreate={createFolder}
              onRename={renameFolder}
              onDelete={deleteFolder}
              onDropMedia={dropOnFolder}
            />
          )}
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
            {folderSupport && activeFolder !== 'all' && (
              <p className={styles.folderCrumb}>
                <button type="button" onClick={() => selectFolder('all')}>All media</button>
                {folderLineage(activeFolder).map((path) => (
                  <span key={path}> / <button type="button" onClick={() => selectFolder(path)}>{path.split('/').pop()}</button></span>
                ))}
              </p>
            )}
            {folderSupport === false && !loading && (
              <p className={styles.muted} role="status">
                Folders are available after running <code>{mediaFoldersMigration}</code> in the Supabase SQL Editor.
              </p>
            )}
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
                    {folderSupport && (
                      // Not a <form>: pickers open inside editor forms, and nested forms submit the outer one.
                      <div className={styles.moveForm}>
                        <input list={folderListId} value={moveFolder} onChange={(event) => setMoveFolder(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter') return;
                            event.preventDefault();
                            if (moveFolder.trim()) void moveToFolder(checkedItems, moveFolder);
                          }}
                          placeholder="Move to folder…" aria-label="Move selected to folder" />
                        <button type="button" className={styles.bulkGhost} disabled={movingFolder || !moveFolder.trim()}
                          onClick={() => void moveToFolder(checkedItems, moveFolder)}>
                          {movingFolder ? 'Moving…' : 'Move'}
                        </button>
                      </div>
                    )}
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
              activeFolder !== 'all' && !search.trim() && providerFilter === 'all' ? (
                <div className={styles.emptyFolder}>
                  <p>The folder “{activeFolder}” is empty.</p>
                  <button type="button" className={styles.primary} onClick={() => { setUploadFolder(activeFolder); setTab('upload'); }}>
                    Upload files into it
                  </button>
                  <span className={styles.muted}>or drag images from another folder onto it in the sidebar.</span>
                </div>
              ) : (
                <p className={styles.muted}>{scoped.length ? 'No media matches this search or filter.' : 'No media yet. Upload a file or add one by URL.'}</p>
              )
            ) : (
              <div className={styles.grid} ref={gridRef}>
                {visible.map((item) => {
                  const isChecked = checked.includes(item.id);
                  const label = item.title || item.file_name || 'media item';
                  return (
                    <div key={item.id} data-media-id={item.id} className={isChecked ? styles.thumbWrapChecked : styles.thumbWrap}
                      draggable={Boolean(folderSupport)}
                      onDragStart={(event) => {
                        // Dragging a ticked image carries every ticked image with it.
                        const ids = isChecked ? checkedItems.map((entry) => entry.id) : [item.id];
                        event.dataTransfer.setData(MEDIA_DRAG_TYPE, JSON.stringify(ids));
                        event.dataTransfer.effectAllowed = 'move';
                      }}>
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
              {folderSupport && (
                <label>Folder
                  <input list={folderListId} value={folderDraft} onChange={(event) => setFolderDraft(event.target.value)}
                    onBlur={() => { if (normalizeMediaFolder(folderDraft) !== selectedFolder) void moveToFolder([selected], folderDraft); else setFolderDraft(selectedFolder); }}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />
                </label>
              )}
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
          {folderSupport && (
            <label className={styles.folderField}>Upload to folder
              <input list={folderListId} value={uploadFolder} onChange={(event) => setUploadFolder(event.target.value)}
                onBlur={() => setUploadFolder(normalizeMediaFolder(uploadFolder))} placeholder={DEFAULT_MEDIA_FOLDER} />
              <span className={styles.muted}>Pick an existing folder or type a new one, e.g. <code>blog/2026</code>. Files are stored in this folder at the provider too.</span>
            </label>
          )}
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
          {folderSupport && (
            <label>Folder
              <input list={folderListId} value={uploadFolder} onChange={(event) => setUploadFolder(event.target.value)}
                onBlur={() => setUploadFolder(normalizeMediaFolder(uploadFolder))} placeholder={DEFAULT_MEDIA_FOLDER} />
            </label>
          )}
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
