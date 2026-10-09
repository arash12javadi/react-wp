/**
 * Settings → Integrations: the status the screen asks for on mount, and the two credential probes.
 *
 *   GET  /api/integrations/status        what this site is set up to do: which credentials are saved
 *   POST /api/integrations/ai/test       one call to the chosen AI provider, to prove the saved key
 *   POST /api/integrations/email/test    one message through the saved mail configuration
 *
 * Every credential these answers depend on lives in `system_settings`, written by the signed-in
 * administrator's browser. Each request therefore begins by reading those rows
 * (`server/integrationSettings.mjs` explains the four ways it can do that) and normalising them
 * (`server/integrationConfig.mjs`), and nothing here reads `process.env` for a provider's key.
 *
 * The two POSTs are the only routes on this server that borrow a credential to make an outbound call,
 * so they are the only ones that check who is asking: `authorize` is supplied by the engine (its own
 * authenticated adapter on the universal engine, `user_has_cap('manage_options')` on the classic one).
 * The status read stays public — it describes presence, never a value.
 *
 * The GitHub credential is deliberately not validated here. The hub's GitHub card proves a personal
 * access token by asking GitHub directly from the browser (`src/lib/integrations.ts`), which is where
 * the token already is — RLS lets only the signed-in browser write `system_settings` — so no request of
 * this server's is spent on it, no credential of the site's is borrowed, and no GitHub callback URL has
 * to exist for a site to publish a plugin.
 *
 * Returns null for anything it does not own, the contract `handleSecurityRequest` and
 * `handleAdminRequest` follow, so `server.mjs` can keep its routing beside the other handler modules
 * and this file stays callable from a test.
 */
import {
  AI_CONFIG_KEY,
  EMAIL_CONFIG_KEY,
  GITHUB_CONFIG_KEY,
  INTEGRATION_CONFIG_KEYS,
  MEDIA_STORAGE_CONFIG_KEY,
  aiConfigFrom,
  describeIntegrations,
  emailConfigFrom,
  githubStatusFrom,
  mediaStorageConfigFrom,
  sendTestEmail,
  testAiConnection,
} from './integrationConfig.mjs';
import { readIntegrationRows } from './integrationSettings.mjs';

const STATUS_PATH = '/api/integrations/status';
const AI_TEST_PATH = '/api/integrations/ai/test';
const EMAIL_TEST_PATH = '/api/integrations/email/test';

/** The paths this module answers, so `server.mjs` can skip the call without repeating the list. */
export const ownsIntegrationPath = (pathname) =>
  pathname === STATUS_PATH || pathname === AI_TEST_PATH || pathname === EMAIL_TEST_PATH;


/**
 * Reads and normalises every row the hub owns, through whichever reader this deployment can offer.
 *
 * A row that does not exist yet is not an error: it is an unconfigured card, which is exactly what a
 * fresh site should show. `credentials.readable` is what lets the screen tell the two apart.
 */
const loadHubSettings = async (reader) => {
  const rows = await readIntegrationRows(INTEGRATION_CONFIG_KEYS, reader);
  return {
    github: githubStatusFrom(rows.settings[GITHUB_CONFIG_KEY]),
    ai: aiConfigFrom(rows.settings[AI_CONFIG_KEY]),
    media: mediaStorageConfigFrom(rows.settings[MEDIA_STORAGE_CONFIG_KEY]),
    email: emailConfigFrom(rows.settings[EMAIL_CONFIG_KEY]),
    credentials: { readable: rows.readable, source: rows.source, error: rows.error },
  };
};

/** `Authorization: Bearer …`, read the way the rest of the server reads it. */
const bearerToken = (headers = {}) =>
  String(headers.authorization || headers.Authorization || '').replace(/^Bearer\s+/i, '');

/** A JSON answer in the shape every other endpoint on this server uses. */
const json = (status, payload) => ({ status, body: { success: status < 400, ok: status < 400, ...payload } });

/**
 * The two POSTs spend a saved credential on an outbound call, so they are the only routes here that
 * check who is asking. An engine that cannot authorize says so rather than quietly skipping the check.
 */
const authorize = async ({ authorize: check, headers }) => {
  if (typeof check !== 'function') {
    return {
      ok: false,
      status: 501,
      error: 'This host cannot authorize integration tests. Test AI and email on a host running the Node server.',
    };
  }
  return check(bearerToken(headers));
};

/**
 * @param {object} options
 * @param {string} options.method     HTTP method, straight from the request
 * @param {string} options.pathname   the path, without the query string
 * @param {object} options.headers    lowercased request headers; only `authorization` is read, by `authorize`
 * @param {object} options.body       the parsed JSON body, for the two POSTs
 * @param {string} options.storage    the resolved storage driver, reported next to the media card
 * @param {object} options.config     the runtime config: `databaseUrl`, `dbType`, `supabaseUrl`, `supabasePublishableKey`
 * @param {object} options.env        the server environment, for the connection and service keys
 * @param {(key: string) => Promise<unknown>} [options.readSetting] the engine's own adapter reader
 * @param {(token: string) => Promise<{ok: boolean, status?: number, error?: string}>} [options.authorize]
 * @returns {Promise<{status: number, body?: object} | null>} null when the path is ours
 *   but the method is not (and, defensively, when the path is not ours at all — the exported predicate
 *   above is the single list, so the two can never disagree)
 */
export async function handleIntegrationsRequest(options) {
  const { method, pathname, headers = {}, body = {}, storage, config = {}, env = {}, readSetting } = options;
  const reader = {
    readSetting,
    databaseUrl: config.databaseUrl,
    dbType: config.dbType,
    supabaseUrl: config.supabaseUrl,
    supabaseKey: config.supabasePublishableKey,
    env,
  };

  if (pathname === STATUS_PATH && method === 'GET') {
    // Presence only, plus whether this server could read the rows at all — never a value, which is what
    // makes it safe for the settings screen to ask for this before it knows anything.
    const settings = await loadHubSettings(reader);
    return json(200, describeIntegrations({
      github: settings.github,
      ai: settings.ai,
      media: settings.media,
      email: settings.email,
      credentials: settings.credentials,
      storage,
    }));
  }

  if (pathname === AI_TEST_PATH && method === 'POST') {
    const permission = await authorize(options);
    if (!permission.ok) return json(permission.status || 403, { error: permission.error });
    const settings = await loadHubSettings(reader);
    // The form may test values it has not saved yet — typing a key and pressing Test before Save is the
    // normal way round — so the body wins, and the stored row is the fallback for a field left blank.
    const candidate = aiConfigFrom({
      provider: body.provider || settings.ai.provider,
      api_key: body.apiKey || settings.ai.api_key,
      model: body.model || settings.ai.model,
    });
    const result = await testAiConnection(candidate);
    return json(result.ok ? 200 : 400, result.ok ? { message: result.message } : { error: result.error });
  }

  if (pathname === EMAIL_TEST_PATH && method === 'POST') {
    const permission = await authorize(options);
    if (!permission.ok) return json(permission.status || 403, { error: permission.error });
    const settings = await loadHubSettings(reader);
    // Unlike the AI test this uses only what is stored: the message goes to a third party, so the
    // configuration behind it has to be the one the site will really use.
    const result = await sendTestEmail(settings.email, {
      to: String(body.to || '').trim(),
      siteTitle: String(env.SITE_NAME || '').trim() || 'this site',
    });
    return json(result.ok ? 200 : 400, result.ok ? { message: result.message } : { error: result.error });
  }

  // Ours, wrong verb: a null the engine turns into a 405 with an Allow header. A path that is not ours
  // at all also lands here, and the exported predicate above is the single list of both cases.
  return null;
}

