/**
 * Types for `server/pluginInstaller.mjs` — Plugins → Upload Plugin where the site's own disk can be
 * written to: `server.mjs`, and the universal engine (`src/server/routes/plugins.ts`) on a host whose
 * filesystem an install survives on, which `src/server/pluginHostMode.ts` decides.
 *
 * The implementation is plain ESM so both engines run the identical install. This declaration is what
 * lets the type-checked Hono route call it, and it is the home of the names the two installers share —
 * `pluginGitInstaller.d.mts` re-exports them rather than writing a second copy that could drift.
 */

/** The steps the dialog lists, in the order it expects them; `downloading` only applies to a URL. */
export type PluginInstallStep =
  | 'downloading'
  | 'extracting'
  | 'validating'
  | 'installing'
  | 'registering-routes'
  | 'triggering-rebuild';

/**
 * What to install: a ZIP the browser posted, or an `https://` URL to fetch, exactly as the classic
 * installer takes it — the dialog offers both.
 *
 * `zip` must be a `Buffer` where there is one: the implementation reads ZIP headers with
 * `readUInt32LE`, which a plain `Uint8Array` does not have.
 */
export interface PluginInstallSource {
  zip?: Uint8Array;
  url?: string;
}

/**
 * The two `options` calls the installer's `rwp_active_plugins` guard makes — an engine's database
 * adapter satisfies this structurally. `server.mjs` has no adapter and pins through Supabase REST
 * instead (`auth` below); this store is what the universal engine passes, whose database is whichever
 * `DB_TYPE` selects.
 */
export interface PluginInstallOptionStore {
  getOption(name: string): Promise<unknown>;
  setOption(name: string, value: unknown): Promise<boolean>;
}

/** One `.sql` file the plugin ships, for the administrator to run in the SQL editor. */
export interface PluginInstallSqlFile {
  path: string;
  sql: string;
}

/** An npm package the plugin imports that the build would not find. */
export interface PluginInstallDependency {
  name: string;
  range?: string;
  reason: 'not-declared' | 'not-installed';
  usedIn: string[];
}

/**
 * What `installPlugin` resolves with: the result the dialog renders, minus the `commit` that only the
 * Git-backed installer has. Kept equal to `PluginInstallResult` in
 * `src/components/PluginUploadModal.tsx`, which adds the `mode` the route stamps on.
 */
export interface PluginDiskInstallResult {
  plugin: { id: string; name: string; version: string; folder: string };
  files: number;
  serverRoutes: { detected: boolean; registered: boolean };
  sql: PluginInstallSqlFile[];
  dependencies: { missing: PluginInstallDependency[]; installCommand: string | null };
  deploy: { configured: boolean; triggered: boolean; status?: number; error?: string };
  /** `required: true`: this host runs the build that has to pick the folder up. */
  restart: { required: boolean; reason: string };
  warnings: string[];
}

/** An expected failure: `message` is shown to the admin as is, and `status` is the HTTP status it wants. */
export class InstallError extends Error {
  constructor(message: string, status?: number);
  status: number;
}

/** Kept equal to `MAX_PLUGIN_ZIP_BYTES` in `src/components/PluginUploadModal.tsx`. */
export const MAX_ZIP_BYTES: number;

/**
 * Pins `rwp_active_plugins` through an engine's database adapter, so an uploaded plugin arrives
 * inactive. Returns a warning to show the administrator, or `null` when the option is already set.
 */
export function pinActivePluginsWithStore(
  optionStore: PluginInstallOptionStore | null | undefined,
  existingIds: string[],
): Promise<string | null>;

/**
 * Puts the staged folder at `plugins/<id>/`, surviving a filesystem that says no: the destination is
 * cleared first (a rename onto an existing directory fails on Windows whatever its contents are), the
 * rename is retried while a handle is held anywhere in the tree (`EPERM`/`EACCES`/`EBUSY`/`EMFILE`),
 * and a rename that cannot succeed — `EXDEV` across mounts, a destination that stays in the way — is
 * replaced by a recursive copy and a delete of the original, which always works.
 *
 * Exported because that is the whole of Windows-tolerant staging: a caller that stages a folder of its
 * own must not have to re-derive it. Throws only for errors a copy cannot rescue (`ENOSPC`, `ENOENT`,
 * a lock that outlives six retries), which is what the installer rolls the install back on.
 */
export function moveIntoPlace(staging: string, target: string): Promise<void>;

/**
 * Installs one plugin into `plugins/<id>/`, staging in `.rwp-tmp/` first. Only one install runs at a
 * time: a second call while one is in flight throws an `InstallError` with status 409.
 *
 * `auth` is what `authorizePluginManager` returns, for the Supabase REST pinning `server.mjs` uses;
 * pass `null` with `options.optionStore` to pin through an engine's own adapter instead.
 */
export function installPlugin(
  source: PluginInstallSource,
  auth: { baseUrl: string; headers: Record<string, string> } | null,
  onStep: (step: PluginInstallStep) => void,
  options?: { optionStore?: PluginInstallOptionStore },
): Promise<PluginDiskInstallResult>;
