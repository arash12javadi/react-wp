/**
 * Types for `server/integrationsRoutes.mjs` — the routing half of Settings → Integrations.
 *
 * The implementation is plain ESM so `server.mjs` and the bundled Hono app run the identical routes
 * (see the header of the implementation). This declaration is what lets the Hono app in
 * `src/server/integrations.ts` call them with real types.
 */
import type { IntegrationRowsResult } from './integrationSettings';

/** The runtime config the shared reader needs; a subset of `RuntimeConfig`, named as it is read. */
export interface IntegrationRuntimeConfig {
  databaseUrl?: string;
  dbType?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  storage?: string;
}

export interface IntegrationRequestOptions {
  method: string;
  pathname: string;
  headers?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  storage?: string;
  config?: IntegrationRuntimeConfig;
  env?: Record<string, string | undefined>;
  /** A reader backed by the engine's own database adapter, where it has one. */
  readSetting?: (key: string) => Promise<unknown>;
  /** Checks the caller may spend a credential on a test; supplied by the engine. */
  authorize?: (token: string) => Promise<{ ok: boolean; status?: number; error?: string }>;
}

export function ownsIntegrationPath(pathname: string): boolean;

export function handleIntegrationsRequest(
  options: IntegrationRequestOptions,
): Promise<{ status: number; body?: Record<string, unknown> } | null>;

export type { IntegrationRowsResult };
