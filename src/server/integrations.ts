/**
 * Settings → Integrations, on the universal engine.
 *
 * The routing, the credential rows and the two probes live in `server/integrationsRoutes.mjs` +
 * `server/integrationConfig.mjs`, which `server.mjs` also runs — two copies of "which `code` may be
 * trusted", or of which field holds a private key, is exactly the duplication that ends with one of
 * them being wrong. This file is the Hono half: the routes, the database adapter that can read the
 * credential rows, and the capability check the two POSTs need. Both shared modules are imported as
 * plain ESM rather than re-implemented, the same way the plugin installer has always been shared with
 * the classic server.
 *
 * Registration is a function rather than a mounted router because the callback path belongs to
 * GitHub's own view of this server (`/api/auth/github/callback`, pasted into the OAuth app) while the
 * rest belongs to `/api/integrations/`, and mounting one router at two prefixes to hide that would be
 * less clear than saying it once.
 */
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getRuntimeConfig } from './config';
import { createServerDbAdapter } from '../lib/db/index';
import { createServerAuthAdapter } from '../lib/auth/index';
import { hasCapability, type Capability, type UserRole } from '../lib/roles';
import { handleIntegrationsRequest, ownsIntegrationPath } from '../../server/integrationsRoutes.mjs';

/** `process.env` where there is one, and nothing where there is not (Workers, Deno, Bun). */
const serverEnvironment = (): Record<string, string | undefined> =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

const requestHeaders = (c: Context) => c.req.header() ?? {};

const requestBody = async (c: Context): Promise<Record<string, unknown>> =>
  (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

/**
 * The capability the two POSTs require. Both spend a saved credential on an outbound call — an AI
 * request, an email — so they are administrator-only, exactly like the screen that configures them.
 */
async function authorizeSettingsManager(token: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!token) return { ok: false, status: 401, error: 'Sign in as an administrator to test integrations.' };
  const config = await getRuntimeConfig();
  let db;
  try {
    db = await createServerDbAdapter(config);
    const auth = await createServerAuthAdapter(config, db);
    const user = await auth.authenticate(token);
    const role = user?.role as UserRole | undefined;
    if (!role) return { ok: false, status: 401, error: 'Your session is not valid. Sign in again.' };
    if (!hasCapability(role, 'manage_options' as Capability)) {
      return { ok: false, status: 403, error: 'Your role cannot test integrations: it does not have the manage_options capability.' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, status: 502, error: `Could not check your permission: ${error instanceof Error ? error.message : 'unknown error'}` };
  } finally {
    await db?.close().catch(() => undefined);
  }
}

/**
 * What the shared module needs to read the credential rows: the runtime config, the environment, and —
 * on every backend except Supabase — the database adapter this engine already knows how to open.
 *
 * Supabase is deliberately left without a reader: its adapter speaks the publishable key, which RLS
 * does not let near `system_settings`, so passing it would turn "this server cannot read the rows" into
 * "every card is unconfigured". The shared module answers that case with the sentence naming the
 * variable to set instead.
 */
async function integrationAccess(): Promise<{
  config: Record<string, unknown>;
  env: Record<string, string | undefined>;
  readSetting?: (key: string) => Promise<unknown>;
  authorize: (token: string) => Promise<{ ok: boolean; status?: number; error?: string }>;
}> {
  const config = await getRuntimeConfig();
  const env = serverEnvironment();
  const readSetting = config.dbType !== 'supabase'
    ? async (key: string) => {
      // One adapter per read, closed again: these rows are read on a settings screen, not per request
      // for the whole site, so a shared connection would buy nothing and leak a handle per engine.
      const db = await createServerDbAdapter(config);
      try {
        return await db.getSystemSetting(key);
      } finally {
        await db.close().catch(() => undefined);
      }
    }
    : undefined;
  return {
    config: config as unknown as Record<string, unknown>,
    env,
    readSetting,
    authorize: authorizeSettingsManager,
  };
}


/** Registers the integration reads, the two credential tests and GitHub's callback. */
export function registerIntegrationRoutes(app: Hono): void {
  /**
   * Everything under the prefix, matched once: `ownsIntegrationPath` — the shared module's own list —
   * decides whether a path is one of the five, so a route added there cannot be forgotten here.
   */
  app.all('/api/integrations/*', (c) => handleRequest(c));
  /**
   * GitHub's redirect target. Always a page, including the failures: the request is a top-level
   * navigation in the OAuth window, so a JSON body there is a dead end.
   */
  app.get('/api/auth/github/callback', (c) => handleRequest(c));
}

async function handleRequest(c: Context): Promise<Response> {
  const { pathname, searchParams } = new URL(c.req.url);
  if (!ownsIntegrationPath(pathname)) {
    // A sub-path this module does not answer. The `/api/integrations/*` pattern matched, so the honest
    // answer is the same 404 the rest of the API gives, not an empty 200.
    return c.json({ success: false, ok: false, error: `No API endpoint at ${pathname}.` }, 404);
  }

  const access = await integrationAccess();
  const result = await handleIntegrationsRequest({
    method: c.req.method,
    pathname,
    query: searchParams,
    headers: requestHeaders(c),
    body: c.req.method === 'POST' ? await requestBody(c) : {},
    storage: String((access.config.storage as string) ?? 'local'),
    config: access.config,
    env: access.env,
    readSetting: access.readSetting,
    authorize: access.authorize,
  });

  if (!result) {
    // Ours, wrong verb: 405 with Allow beats a 404 that hides the mistake.
    const allowed = c.req.method === 'POST' ? 'GET' : 'POST';
    c.header('Allow', allowed);
    return c.json({ success: false, ok: false, error: `Only ${allowed} is supported at ${pathname}.` }, 405);
  }

  if (result.html !== undefined) {
    // A callback answer is good once: a cached copy would let the browser replay an old token.
    c.header('Cache-Control', 'no-store');
    return c.html(result.html, result.status as ContentfulStatusCode);
  }

  return c.json(result.body ?? {}, result.status as ContentfulStatusCode);
}
