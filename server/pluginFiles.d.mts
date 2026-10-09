/**
 * Types for `server/pluginFiles.mjs` — the plugin folder on disk, and the check that says whether the
 * caller may touch it.
 *
 * Only the export the TypeScript half imports is declared, as `integrationSettings.d.mts` does:
 * `server.mjs` and `server/adminRoutes.mjs` call the rest of this module directly, and a `.mjs` caller
 * needs no declaration.
 */
export function authorizePluginManager(
  supabaseUrl: string,
  supabaseKey: string,
  accessToken: string,
): Promise<{ ok: boolean; status?: number; error?: string; baseUrl?: string; headers?: Record<string, string> }>;
