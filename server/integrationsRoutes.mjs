/**
 * /api/integrations/* and GitHub's OAuth callback — the server half of Settings → Integrations.
 *
 *   GET  /api/integrations/status        what this site is set up to do: which credentials are saved,
 *                                        and the callback URL to register on the GitHub OAuth app
 *   POST /api/integrations/ai/test       one call to the chosen AI provider, to prove the saved key
 *   POST /api/integrations/email/test    one message through the saved mail configuration
 *   GET  /api/integrations/github/start  the authorize URL for the popup, with its state already signed
 *   GET  /api/auth/github/callback       GitHub's redirect target: verifies the state, exchanges the
 *                                        code, and hands the token back to the settings screen
 *
 * Every credential these answers depend on lives in `system_settings`, written by the signed-in
 * administrator's browser. Each request therefore begins by reading those rows
 * (`server/integrationSettings.mjs` explains the four ways it can do that) and normalising them
 * (`server/integrationConfig.mjs`), and nothing here reads `process.env` for a provider's key.
 *
 * The two POSTs are the only routes on this server that borrow a credential to make an outbound call,
 * so they are the only ones that check who is asking: `authorize` is supplied by the engine (its own
 * authenticated adapter on the universal engine, `user_has_cap('manage_options')` on the classic one).
 * The reads stay public — they describe presence, never a value.
 *
 * The callback sits under `/api/auth/` rather than `/api/integrations/` because it is the URL an
 * administrator pastes into their GitHub OAuth app, and GitHub shows it back to them — so it should
 * read like what it is. Nothing here infers GitHub's own path shape from that prefix: an unknown
 * `/api/auth/...` path is not owned by this module and is answered by the generic `/api/` 404.
 *
 * Returns null for anything it does not own, the contract `handleSecurityRequest` and
 * `handleAdminRequest` follow, so `server.mjs` can keep its routing beside the other handler modules
 * and this file stays callable from a test.
 */
import { GITHUB_CALLBACK_PATH, GITHUB_SCOPES, completeGithubOAuth, describeGithubStart, requestOrigin } from './githubOAuth.mjs';
import {
  AI_CONFIG_KEY,
  EMAIL_CONFIG_KEY,
  GITHUB_CONFIG_KEY,
  INTEGRATION_CONFIG_KEYS,
  MEDIA_STORAGE_CONFIG_KEY,
  aiConfigFrom,
  describeIntegrations,
  emailConfigFrom,
  githubCredentialsFrom,
  mediaStorageConfigFrom,
  sendTestEmail,
  testAiConnection,
} from './integrationConfig.mjs';
import { readIntegrationRows } from './integrationSettings.mjs';

const STATUS_PATH = '/api/integrations/status';
const START_PATH = '/api/integrations/github/start';
const AI_TEST_PATH = '/api/integrations/ai/test';
const EMAIL_TEST_PATH = '/api/integrations/email/test';
/** GitHub's own copy of this path is in `githubOAuth.mjs`; named here so the module reads on its own. */
const CALLBACK_PATH = GITHUB_CALLBACK_PATH;

/** The paths this module answers, so `server.mjs` can skip the call without repeating the list. */
export const ownsIntegrationPath = (pathname) =>
  pathname === STATUS_PATH || pathname === START_PATH || pathname === CALLBACK_PATH
  || pathname === AI_TEST_PATH || pathname === EMAIL_TEST_PATH;


/**
 * Reads and normalises every row the hub owns, through whichever reader this deployment can offer.
 *
 * A row that does not exist yet is not an error: it is an unconfigured card, which is exactly what a
 * fresh site should show. `credentials.readable` is what lets the screen tell the two apart.
 */
const loadHubSettings = async (reader) => {
  const rows = await readIntegrationRows(INTEGRATION_CONFIG_KEYS, reader);
  const githubRow = rows.settings[GITHUB_CONFIG_KEY];
  return {
    githubRow: githubRow && typeof githubRow === 'object' ? githubRow : {},
    github: githubCredentialsFrom(githubRow),
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
 * @param {URLSearchParams|object} options.query   GitHub's own parameters, for the callback
 * @param {object} options.headers    lowercased request headers; `host`/`x-forwarded-*` decide the origin
 * @param {object} options.body       the parsed JSON body, for the two POSTs
 * @param {string} options.storage    the resolved storage driver, reported next to the media card
 * @param {object} options.config     the runtime config: `databaseUrl`, `dbType`, `supabaseUrl`, `supabasePublishableKey`
 * @param {object} options.env        the server environment, for the connection and service keys
 * @param {(key: string) => Promise<unknown>} [options.readSetting] the engine's own adapter reader
 * @param {(token: string) => Promise<{ok: boolean, status?: number, error?: string}>} [options.authorize]
 * @returns {Promise<{status: number, body?: object, html?: string} | null>} null when the path is ours
 *   but the method is not (and, defensively, when the path is not ours at all — the exported predicate
 *   above is the single list, so the two can never disagree)
 */
export async function handleIntegrationsRequest(options) {
  const { method, pathname, query, headers = {}, body = {}, storage, config = {}, env = {}, readSetting } = options;
  const origin = requestOrigin(headers, env.SITE_URL);
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
      github: { ...settings.github, scopes: GITHUB_SCOPES },
      ai: settings.ai,
      media: settings.media,
      email: settings.email,
      credentials: settings.credentials,
      storage,
      origin,
      redirectUri: `${origin}${CALLBACK_PATH}`,
    }));
  }

  if (pathname === START_PATH && method === 'GET') {
    const settings = await loadHubSettings(reader);
    const { authorizeUrl, error } = await describeGithubStart({ config: settings.githubRow, origin });
    if (!authorizeUrl) return json(501, { error });
    return json(200, { authorizeUrl });
  }

  if (pathname === GITHUB_CALLBACK_PATH && method === 'GET') {
    // Always a page: this is a browser navigation, so an API error body would leave the administrator
    // staring at JSON in a window that never closes itself.
    const settings = await loadHubSettings(reader);
    const result = await completeGithubOAuth({ query, headers, config: settings.githubRow });
    return { status: result.status, html: result.html };
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

