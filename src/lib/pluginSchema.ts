/**
 * Browser half of per-plugin database provisioning and the site reset.
 *
 * Every call here needs the Node server (server.mjs). On Vercel the equivalent functions live in
 * api/, but a host with neither returns 404, which is reported as "this host cannot do it" rather
 * than as a database failure — the two send you to completely different places to look.
 */
import { getSupabaseClient } from './db';

export interface PluginSchemaStatus {
  plugin: string;
  name: string;
  /** The plugin ships a schema.sql and declares it in manifest.json. */
  hasSchema: boolean;
  /** It also ships an uninstall.sql, so "wipe data" can be offered. */
  canDrop: boolean;
  tables: string[];
  /** Things the plugin's uninstall.sql deliberately leaves alone, shown in the dialog. */
  retains: string[];
  /** Provider folders the plugin owns, e.g. ["plugins/rwp-shop"]. Wiped only on a wipe. */
  mediaPrefixes: string[];
  /** The server has Cloudinary API credentials, so files can actually be deleted. */
  cloudinaryConfigured: boolean;
  /** SUPABASE_DB_URL is set on the server, so no password prompt is needed. */
  storedCredentials: boolean;
  /** False when the table state could not be read; `reason` says why. */
  checked: boolean;
  reason?: string;
  present?: string[];
  missing?: string[];
  rowCounts?: Record<string, number>;
}

export interface PluginBackup {
  format: 'react-wp-plugin-backup';
  version: number;
  plugin: { id: string; name: string; version: string };
  created_at: string;
  missing_tables: string[];
  tables: Record<string, unknown[]>;
  options: Array<{ option_name: string; option_value: string }>;
}

/** What happened at Cloudinary. `attempted: false` means no credentials, not "nothing to do". */
export interface MediaWipeSummary {
  attempted: boolean;
  deleted: number;
  notFound: number;
  warnings: string[];
  /** Plugin uninstall only: the provider prefixes that were cleared. */
  prefixes?: string[];
  /** Plugin uninstall only: media library rows removed alongside the files. */
  rowsRemoved?: number;
  /** Site reset only: how many Cloudinary files the media table knew about. */
  recorded?: number;
}

export interface UninstallResult {
  plugin: string;
  mode: 'keep' | 'wipe';
  backup: PluginBackup | null;
  media: MediaWipeSummary | null;
  dropped: { dropped: string[]; plugin: string } | null;
  folderDeleted: boolean;
  serverImportRemoved?: boolean;
  warnings: string[];
}

/** Credentials the server may still need, when SUPABASE_DB_URL is not set. */
export interface DbCredentials {
  dbPassword?: string;
  connectionString?: string;
}

const accessToken = async (): Promise<string> => {
  const { data } = await getSupabaseClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session has expired. Sign in again.');
  return token;
};

/**
 * "This host cannot do it" is a different problem from "the database refused it", and the two
 * send you to completely different places. Tagged rather than string-matched so callers can
 * decide: activating a plugin on a static host should warn and carry on, but a real SQL failure
 * must stop the activation.
 */
export class EndpointUnavailableError extends Error {}

export const isEndpointUnavailable = (error: unknown): error is EndpointUnavailableError =>
  error instanceof EndpointUnavailableError;

const request = async <T>(path: string, init: RequestInit): Promise<T> => {
  const token = await accessToken();
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...init.headers, Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new EndpointUnavailableError(
      `The server could not be reached for ${path}. In development, is server.mjs running on :3000?`);
  }
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    if (response.status === 404 && !body.error) {
      throw new EndpointUnavailableError(
        `This host has no ${path} endpoint. Per-plugin database setup needs the Node server (npm start); it is not available on a static deployment.`);
    }
    throw new Error(body.error || `${path} returned HTTP ${response.status}.`);
  }
  return body;
};

export const fetchPluginSchemaStatus = (id: string) =>
  request<PluginSchemaStatus>(`/api/admin/plugins/schema-status?id=${encodeURIComponent(id)}`, { method: 'GET' });

/**
 * Runs the plugin's schema.sql. Idempotent, so this is safe to call on every activation rather
 * than tracking installed-ness in a column that can drift from the actual database.
 */
export const installPluginSchema = (id: string, credentials: DbCredentials = {}) =>
  request<{ installed: boolean; reason?: string; plugin: string; tables: string[]; created?: string[]; stillMissing?: string[] }>(
    '/api/admin/plugins/install-schema',
    { method: 'POST', body: JSON.stringify({ id, ...credentials }) },
  );

export const uninstallPlugin = (
  id: string,
  options: { mode: 'keep' | 'wipe'; backup: boolean; confirm?: string; deleteFolder?: boolean } & DbCredentials,
) => request<UninstallResult>('/api/admin/plugins/uninstall', { method: 'POST', body: JSON.stringify({ id, ...options }) });

export const resetSite = (options: { password: string; confirm: string; wipeMedia?: boolean } & DbCredentials) =>
  request<{ success: true; usersDeleted: number; remoteFiles: number; media: MediaWipeSummary; next: string }>(
    '/api/admin/reset-site',
    { method: 'POST', body: JSON.stringify(options) },
  );

/** Hands the browser a .json file. Used for the pre-wipe backup, which exists only in that response. */
export const downloadJson = (filename: string, value: unknown) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick: Safari cancels the download if the object URL goes away immediately.
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
};

export const backupFilename = (pluginId: string) =>
  `${pluginId}-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
