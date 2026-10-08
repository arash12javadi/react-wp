/**
 * Types for `server/integrationSettings.mjs` — how the server reads the hub's credential rows.
 *
 * See the implementation for why there is more than one way to read them, and why
 * `readable: false` is an answer rather than an error.
 */
export interface IntegrationRowsResult {
  settings: Record<string, unknown>;
  readable: boolean;
  source: 'adapter' | 'database' | 'rest' | 'unavailable';
  error: string;
}

export function parseSettingValue(raw: unknown): unknown;

export function readIntegrationRows(
  keys: string[],
  options?: {
    /** A reader the caller already has, e.g. the universal engine's database adapter. */
    readSetting?: (key: string) => Promise<unknown>;
    databaseUrl?: string;
    dbType?: string;
    supabaseUrl?: string;
    supabaseKey?: string;
    env?: Record<string, string | undefined>;
  },
): Promise<IntegrationRowsResult>;

export function authorizeSettingsManager(
  supabaseUrl: string,
  supabaseKey: string,
  accessToken: string,
): Promise<{ ok: boolean; status?: number; error?: string }>;
