import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { describeDbError, getSupabaseClient } from './db';
import { loadSettings } from './settings';
import { uploadToCloudinary, uploadToImageKit } from './uploads';
import type { MediaItem } from './types';

/**
 * A backup is a ZIP holding backup.json (every table, from rwp_backup_export) and, optionally,
 * the media library's files under media/. The database half is exported and restored by SQL
 * functions so the restore is one transaction; this file only packs, unpacks and moves media.
 */

export interface BackupUser {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  role: string;
}

export interface BackupData {
  format: 'react-wp-backup';
  version: number;
  created_at: string;
  site?: { title?: string; origin?: string };
  tables: Record<string, Array<Record<string, unknown>>>;
  users: BackupUser[];
  /** Present when media files were included. path is the file's name inside the ZIP. */
  media_files?: Array<{ media_id: string; path: string }>;
}

export interface LoadedBackup {
  fileName: string;
  data: BackupData;
  files: Record<string, Uint8Array>;
}

export interface RestoreReport {
  counts: Record<string, number>;
  warnings: string[];
  users_matched: number;
  users_unmatched: number;
  mediaUploaded: number;
}

type Progress = (message: string) => void;

const MIGRATION = 'supabase/migrations/20260919_backup_restore.sql';

// Keys that describe where this site uploads to, rather than what it contains.
const MEDIA_SETTING_KEYS = ['cloudinary_cloud_name', 'cloudinary_upload_preset', 'imagekit_public_key', 'imagekit_url_endpoint'] as const;

const explainRpcError = (error: unknown, action: 'export' | 'restore'): string => {
  const { code, message = '' } = (error || {}) as { code?: string; message?: string };
  if (code === 'PGRST202' || /could not find the function/i.test(message)) {
    return `The backup functions are not in the database yet. Run ${MIGRATION} in the Supabase SQL Editor, then try again.`;
  }
  if (code === '57014') {
    return `The database cancelled the ${action} because it ran longer than the time limit for signed-in users (8 seconds by default on Supabase). Nothing was changed. `
      + `In the Supabase SQL Editor run: alter role authenticated set statement_timeout = '60s'; notify pgrst, 'reload config'; — then try again.`;
  }
  return describeDbError(error);
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : describeDbError(error));

const safeFileName = (name: string) => name.replace(/[^\w.-]+/g, '_').slice(-120) || 'file';

const urlFileName = (url: string) => {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
  } catch {
    return '';
  }
};

/** Runs tasks with a small concurrency limit, so a large library doesn't open hundreds of downloads at once. */
async function eachLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item);
    }
  });
  await Promise.all(workers);
}

export const formatBackupDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

const optionValue = (data: BackupData, name: string) =>
  String(data.tables.options?.find((row) => row.option_name === name)?.option_value ?? '');

export async function createBackup(includeMedia: boolean, onProgress: Progress) {
  onProgress('Reading the database…');
  const { data, error } = await getSupabaseClient().rpc('rwp_backup_export');
  if (error) throw new Error(explainRpcError(error, 'export'));
  const backup = data as BackupData;
  backup.site = { title: optionValue(backup, 'site_title'), origin: window.location.origin };

  const zip: Zippable = {};
  const failed: string[] = [];
  if (includeMedia) {
    const hosted = ((backup.tables.media || []) as unknown as MediaItem[]).filter((item) => item.provider !== 'external');
    backup.media_files = [];
    let done = 0;
    await eachLimited(hosted, 4, async (item) => {
      const label = item.file_name || urlFileName(item.url) || item.url;
      try {
        const response = await fetch(item.url);
        if (!response.ok) throw new Error(`the server answered HTTP ${response.status}`);
        const path = `media/${item.id}-${safeFileName(urlFileName(item.url) || item.file_name || 'file')}`;
        // Images and video are already compressed; storing them avoids burning CPU for nothing.
        zip[path] = [new Uint8Array(await response.arrayBuffer()), { level: 0 }];
        backup.media_files!.push({ media_id: item.id, path });
      } catch (downloadError) {
        const reason = downloadError instanceof TypeError
          ? 'the browser could not download it (offline, or the host does not allow cross-origin downloads)'
          : errorText(downloadError);
        failed.push(`${label}: ${reason}`);
      } finally {
        done += 1;
        onProgress(`Downloading media ${done} of ${hosted.length}…`);
      }
    });
  }

  onProgress('Compressing…');
  zip['backup.json'] = [strToU8(JSON.stringify(backup)), { level: 6 }];
  const bytes = zipSync(zip);
  const slug = (backup.site.title || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site';
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  return {
    blob: new Blob([bytes], { type: 'application/zip' }),
    fileName: `react-wp-backup-${slug}-${stamp}.zip`,
    mediaIncluded: backup.media_files?.length ?? 0,
    failed,
  };
}

export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

export async function readBackupFile(file: File): Promise<LoadedBackup> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let files: Record<string, Uint8Array> = {};
  let text: string;

  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      files = unzipSync(bytes);
    } catch (zipError) {
      throw new Error(`"${file.name}" is a ZIP file but could not be opened (${errorText(zipError)}). It may be incomplete — try downloading it again.`);
    }
    if (!files['backup.json']) {
      throw new Error(`"${file.name}" is a ZIP file without a backup.json inside, so it was not made by React-WP's Backup screen.`);
    }
    text = strFromU8(files['backup.json']);
  } else {
    text = strFromU8(bytes);
  }

  let data: BackupData;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`"${file.name}" is neither a ZIP nor a JSON file. Choose the .zip file downloaded from Settings → Backup.`);
  }
  if (data?.format !== 'react-wp-backup') {
    throw new Error(`"${file.name}" is not a React-WP backup: its "format" field is ${data?.format ? `"${data.format}"` : 'missing'}.`);
  }
  if (data.version !== 1) {
    throw new Error(`This backup uses format version ${data.version}, but this site only understands version 1. Update this site to the version that made the backup.`);
  }
  if (!data.tables || typeof data.tables !== 'object') {
    throw new Error(`"${file.name}" has no tables, so there is nothing to restore.`);
  }
  return { fileName: file.name, data, files };
}

/** Providers the backup's included files would be uploaded to, and whether this site is set up for each. */
export async function mediaUploadReadiness(loaded: LoadedBackup) {
  const media = new Map((loaded.data.tables.media || []).map((row) => [String(row.id), row]));
  const providers = new Set(
    (loaded.data.media_files || [])
      .map((entry) => String(media.get(entry.media_id)?.provider || ''))
      .filter(Boolean),
  );
  const settings = await loadSettings();
  const missing: string[] = [];
  if (providers.has('cloudinary') && (!settings.cloudinary_cloud_name || !settings.cloudinary_upload_preset)) {
    missing.push('Cloudinary (cloud name and unsigned upload preset)');
  }
  if (providers.has('imagekit') && !settings.imagekit_public_key) missing.push('ImageKit (public key)');
  return { providers: [...providers], missing };
}

export async function restoreBackup(loaded: LoadedBackup, reuploadMedia: boolean, onProgress: Progress): Promise<RestoreReport> {
  // Work on a copy: a failed upload must leave the loaded backup intact for another attempt.
  const data = structuredClone(loaded.data);
  let uploaded = 0;

  if (reuploadMedia && data.media_files?.length) {
    const settings = await loadSettings();
    const rows = new Map((data.tables.media || []).map((row) => [String(row.id), row]));
    const replacements: Array<[string, string]> = [];

    for (const [index, entry] of data.media_files.entries()) {
      const row = rows.get(entry.media_id);
      const bytes = loaded.files[entry.path];
      if (!row || !bytes) continue;
      const provider = row.provider === 'imagekit' ? 'ImageKit' : 'Cloudinary';
      const name = entry.path.split('/').pop()!.slice(entry.media_id.length + 1);
      onProgress(`Uploading media ${index + 1} of ${data.media_files.length} to ${provider}…`);
      let result;
      try {
        const file = new File([bytes], name);
        result = row.provider === 'imagekit'
          ? await uploadToImageKit(file, settings, () => {})
          : await uploadToCloudinary(file, settings, () => {});
      } catch (uploadError) {
        const leftover = uploaded ? ` The ${uploaded} file(s) uploaded before it stay in your media account, unused.` : '';
        throw new Error(`Uploading "${name}" to ${provider} failed, so nothing was restored: ${errorText(uploadError)}.${leftover}`);
      }
      uploaded += 1;
      replacements.push([String(row.url), result.url]);
      Object.assign(row, {
        url: result.url,
        provider: result.provider,
        provider_file_id: result.provider_file_id,
        width: result.width ?? row.width,
        height: result.height ?? row.height,
        bytes: result.bytes ?? row.bytes,
      });
    }

    // The old URLs are also inside page HTML, builder layouts, products, avatars and options.
    // Longest first, so a URL that is a prefix of another cannot corrupt it.
    replacements.sort((a, b) => b[0].length - a[0].length);
    let text = JSON.stringify({ tables: data.tables, users: data.users });
    for (const [from, to] of replacements) text = text.split(from).join(to);
    const rewritten = JSON.parse(text) as Pick<BackupData, 'tables' | 'users'>;
    data.tables = rewritten.tables;
    data.users = rewritten.users;

    // New uploads should keep going to this site's account, not the one the files came from.
    const options = data.tables.options || [];
    data.tables.options = options.filter((row) => !MEDIA_SETTING_KEYS.includes(row.option_name as typeof MEDIA_SETTING_KEYS[number]));
    for (const key of MEDIA_SETTING_KEYS) {
      if (settings[key]) data.tables.options.push({ option_name: key, option_value: settings[key] });
    }
  }

  // The files travel in the ZIP; the database only needs the manifest-free JSON.
  delete data.media_files;
  onProgress('Restoring the database…');
  const { data: result, error } = await getSupabaseClient().rpc('rwp_backup_import', { p_backup: data });
  if (error) {
    const leftover = uploaded ? ` The ${uploaded} media file(s) uploaded for this restore stay in your media account, unused.` : '';
    throw new Error(`${explainRpcError(error, 'restore')}${leftover}`);
  }
  return { ...(result as Omit<RestoreReport, 'mediaUploaded'>), mediaUploaded: uploaded };
}

export const summarizeBackup = (data: BackupData) => {
  const counts = Object.entries(data.tables)
    .map(([table, rows]) => [table, Array.isArray(rows) ? rows.length : 0] as const)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const count = (table: string) => data.tables[table]?.length ?? 0;
  return {
    title: data.site?.title || optionValue(data, 'site_title') || 'Untitled site',
    origin: data.site?.origin || '',
    createdAt: data.created_at,
    counts,
    totalRows: counts.reduce((sum, [, rows]) => sum + rows, 0),
    pages: (data.tables.pages || []).filter((row) => !row.is_post).length,
    posts: (data.tables.pages || []).filter((row) => row.is_post).length,
    products: count('shop_products'),
    orders: count('shop_orders'),
    media: count('media'),
    users: data.users?.length ?? 0,
    mediaFiles: data.media_files?.length ?? 0,
  };
};
