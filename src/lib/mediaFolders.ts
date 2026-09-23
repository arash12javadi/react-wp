import { describeDbError, getSupabaseClient } from './db';

/** The folder every media row belongs to unless another is chosen (the column default). */
export const DEFAULT_MEDIA_FOLDER = 'general';

/**
 * Library folders that are a conversation's worth of files rather than the site's own images.
 * They are left out of the Media Library's "All media" view and only shown when the folder
 * itself is opened, so a support inbox full of screenshots does not bury the site's pictures.
 * Everything else about them is ordinary: they can be browsed, moved out of, renamed and deleted.
 *
 * `chat_media` is where plugins/rwp-chat puts what visitors attach. The provider folder is a
 * different thing and is namespaced separately (plugins/rwp-chat/chat_media, see mediaScope.js).
 */
export const CHAT_MEDIA_FOLDER = 'chat_media';

export const quietMediaFolders: string[] = [CHAT_MEDIA_FOLDER];

export const quietFolderLabels: Record<string, string> = {
  [CHAT_MEDIA_FOLDER]: 'Chatbot media',
};

export const quietFolderIcons: Record<string, string> = {
  [CHAT_MEDIA_FOLDER]: '💬',
};

/** True when this folder (or a subfolder of it) is hidden from "All media". */
export const isQuietMediaFolder = (folder: string) =>
  quietMediaFolders.some((root) => folder === root || folder.startsWith(`${root}/`));

export const mediaFoldersMigration = 'supabase/migrations/20260927_media_folders.sql';
export const folderManagerMigration = 'supabase/migrations/20260928_media_folder_manager.sql';

/** "blog/2026/may" -> ["blog", "blog/2026", "blog/2026/may"]. */
export const folderLineage = (path: string) =>
  path.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/'));

export const isInFolder = (folder: string, root: string) => folder === root || folder.startsWith(`${root}/`);

const explainFolderError = (error: unknown): Error => {
  const message = describeDbError(error);
  if (/media_folders|rwp_(rename|delete)_media_folder|PGRST20[25]/.test(message) && /not find|does not exist|schema cache/i.test(message)) {
    return new Error(`Folder management needs ${folderManagerMigration}. Run it in the Supabase SQL Editor, then reload. Re-running it is safe.`);
  }
  if (message.includes('media_folders_path_format')) {
    return new Error('That folder name is not valid. Use letters, digits, "-" and "_", with "/" between levels.');
  }
  if (/row-level security/i.test(message)) {
    return new Error('The database refused to create this folder under row level security. Your role needs the upload_files capability.');
  }
  return new Error(message);
};

/** All folder paths, or null when the folder manager migration has not been run. */
export async function listMediaFolders(): Promise<string[] | null> {
  const { data, error } = await getSupabaseClient().from('media_folders').select('path').order('path');
  if (error) return null;
  return ((data || []) as Array<{ path: string }>).map((row) => row.path);
}

/** Creates a folder and any missing parents. Creating one that exists is not an error. */
export async function createMediaFolder(path: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('media_folders')
    .upsert(folderLineage(path).map((entry) => ({ path: entry })), { onConflict: 'path', ignoreDuplicates: true });
  if (error) throw explainFolderError(error);
}

/** Renames or moves a folder with everything in it. All-or-nothing, decided by the database. */
export async function renameMediaFolder(from: string, to: string): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc('rwp_rename_media_folder', { p_from: from, p_to: to });
  if (error) throw explainFolderError(error);
  return Number((data as { moved?: number } | null)?.moved || 0);
}

/**
 * Deletes a folder and its subfolders. With moveTo, the media inside moves there first;
 * without it the folder must already be empty.
 */
export async function deleteMediaFolder(path: string, moveTo?: string): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc('rwp_delete_media_folder', { p_path: path, p_move_to: moveTo ?? null });
  if (error) throw explainFolderError(error);
  return Number((data as { moved?: number } | null)?.moved || 0);
}

/**
 * Folder paths are segments of letters, digits, "-" and "_", separated by "/". That is the
 * common subset Cloudinary and ImageKit both accept, and the media_folder_format check enforces it.
 */
const segmentPattern = /^[A-Za-z0-9_-]+$/;

export const isValidMediaFolder = (folder: string) =>
  folder.length > 0 && folder.length <= 255 && folder.split('/').every((segment) => segmentPattern.test(segment));

/**
 * Turns what someone typed ("Blog posts / 2026 ") into a valid path ("Blog-posts/2026").
 * Returns the default folder for blank input.
 */
export const normalizeMediaFolder = (input: string | null | undefined): string => {
  const folder = (input || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9_-]+/g, ''))
    .filter(Boolean)
    .join('/')
    .slice(0, 255)
    .replace(/\/+$/, '');
  return folder || DEFAULT_MEDIA_FOLDER;
};
