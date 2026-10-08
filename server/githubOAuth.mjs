/**
 * GitHub OAuth 2.0 for the Integrations hub (Settings → Integrations).
 *
 * GitHub is the first integration with a real authorization handshake, so this module owns the whole
 * of it and both server engines share it: `server.mjs` imports it directly, and the universal Hono
 * app (`src/server/integrations.ts`) wraps the same entry points — `describeIntegrations` and
 * `completeGithubOAuth`. The exchange, the state check and the closing window therefore exist once,
 * so the two engines cannot drift apart on the part that decides whether a token is trusted.
 *
 * Three rules shape everything here.
 *
 *   1. **No secret reaches the browser.** The OAuth app's client secret is read from this site's own
 *      `github_config` row and used only server-side, by the token exchange. The browser does receive
 *      the access token afterwards, because on Supabase only the signed-in administrator's own session
 *      may write to `system_settings` (RLS refuses the server's publishable-key connection). It is
 *      handed over by `postMessage` to the settings screen that opened the window — never in a URL,
 *      and never on the path taken when there is no opener.
 *
 *   2. **The state is signed, not stored.** Nothing here keeps a session for the popup, so `state` is
 *      a nonce plus its issue time, signed with the client secret (HMAC-SHA256) and checked before the
 *      exchange. Without that check anyone could hand an administrator a `code` they never asked for.
 *
 *   3. **The callback always answers HTML, and says which mistake it was.** A status page that blames
 *      the wrong thing costs more than the bug it hides, so every failure route names the field or
 *      the GitHub error behind it.
 *
 * `fetch` and Web Crypto (`globalThis.crypto`) are used instead of `node:crypto` so the module runs
 * unchanged under every runtime the API bundle targets (Node 20+, Workers, Deno, Bun).
 */

/** The callback the GitHub OAuth app must be registered with, appended to the site's public origin. */
export const GITHUB_CALLBACK_PATH = '/api/auth/github/callback';

/** Where the settings screen lives; the no-opener path sends the browser back here. */
export const GITHUB_SETTINGS_PATH = '/admin?section=settings&tab=integrations';

/** The `sessionStorage` key that carries a result to the settings screen when no window was opened. */
export const GITHUB_RESULT_KEY = 'rwp-github-oauth-result';

/** The `system_settings` row the hub reads and writes. */
export const GITHUB_CONFIG_KEY = 'github_config';

/**
 * `repo` is what committing a plugin or theme back to a repository needs; `read:user` is only for the
 * account name and avatar the status card shows. Nothing wider: a site that stores a token has to be
 * able to justify every permission it holds. Keep in step with `githubScopes` in
 * `src/lib/integrations.ts`.
 */
export const GITHUB_SCOPES = ['repo', 'read:user'];

/** Messages between the callback window and the settings screen. */
export const GITHUB_MESSAGE_SOURCE = 'rwp-github-oauth';

/** How long a signed `state` may be reused, in milliseconds. */
const STATE_TTL_MS = 10 * 60 * 1000;

/** One page of repositories; GitHub's maximum. The hub says "most recently updated" for that reason. */
const REPOSITORY_LIMIT = 100;

const GITHUB_API = 'https://api.github.com';

/** GitHub asks callers to identify themselves, and refuses some routes without a User-Agent. */
const USER_AGENT = 'react-wp';

const encoder = new TextEncoder();

/** base64url without `Buffer`: the same code has to run off Node as well as on it. */
const base64url = (value) => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const hmacSignature = async (secret, message) => {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
};

/** Length-independent comparison, so a wrong signature cannot be found one character at a time. */
const sameSignature = (expected, received) => {
  if (typeof received !== 'string' || expected.length !== received.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  }
  return difference === 0;
};

/**
 * The client id and secret this *site* holds — read from the stored `github_config` row, never from
 * the environment.
 *
 * The pair is saved from the GitHub card in Settings → Integrations, which is what lets a site be
 * pointed at a different OAuth app without editing a file and restarting the server. Either being
 * absent means GitHub cannot be connected yet, and the card says which one.
 */
export function githubCredentials(config = {}) {
  const row = config && typeof config === 'object' ? config : {};
  const clientId = String(row.client_id || row.clientId || '').trim();
  const clientSecret = String(row.client_secret || row.clientSecret || '').trim();
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

/** Signs a fresh, short-lived `state` for one trip to GitHub. */
export async function createGithubState(secret) {
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const issuedAt = Date.now();
  return `${nonce}.${issuedAt}.${await hmacSignature(secret, `${nonce}.${issuedAt}`)}`;
}

/** True only for a signature this server produced, within the last ten minutes. */
export async function verifyGithubState(state, secret) {
  const parts = String(state || '').split('.');
  if (parts.length !== 3 || !secret) return false;
  const [nonce, issuedAt, signature] = parts;
  const issued = Number(issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > STATE_TTL_MS) return false;
  return sameSignature(await hmacSignature(secret, `${nonce}.${issuedAt}`), signature);
}

/** The URL the settings screen opens in a popup. */
export function buildGithubAuthorizeUrl({ clientId, redirectUri, state, scope = GITHUB_SCOPES.join(' ') }) {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  // Only an existing GitHub account may authorise this site: a fresh account signing itself up here
  // is never the administrator who pressed Connect.
  url.searchParams.set('allow_signup', 'false');
  // `URLSearchParams` writes a space as `+`, which is only a space to a form-urlencoded reader.
  // `%20` means the same thing to every reader of the query string.
  return url.toString().replace(/\+/g, '%20');
}

/**
 * The origin the browser is actually on, which is the only safe `postMessage` target for the callback
 * window. `SITE_URL` is preferred when its host matches the request, so an https site behind a proxy
 * that sets `X-Forwarded-Proto` inconsistently still gets an https target.
 */
export function requestOrigin(headers = {}, siteUrl) {
  const host = String(headers['x-forwarded-host'] || headers.host || 'localhost').split(',')[0].trim();
  const configured = String(siteUrl || '').trim().replace(/\/+$/, '');
  try {
    if (configured && new URL(configured).host === host) return configured;
  } catch {
    // An unparsable SITE_URL is not a reason to fail the callback.
  }
  const proto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  return `${proto}://${host}`;
}

/** GitHub answers its OAuth routes with either a token or an `error`/`error_description` pair. */
async function readGithubJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

const githubHeaders = (token) => ({
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': USER_AGENT,
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

/** Swaps the one-time `code` for an access token. The client secret never leaves this function. */
export async function exchangeGithubCode({ code, clientId, clientSecret, redirectUri }) {
  let response;
  try {
    response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    });
  } catch (error) {
    return { ok: false, error: `GitHub could not be reached for the token exchange: ${error instanceof Error ? error.message : 'unknown network error'}` };
  }
  const payload = await readGithubJson(response);
  if (!response.ok || payload.error || !payload.access_token) {
    const reason = payload.error_description || payload.error || `HTTP ${response.status}`;
    return { ok: false, error: `GitHub refused the token exchange: ${reason}` };
  }
  return {
    ok: true,
    accessToken: payload.access_token,
    tokenType: payload.token_type || 'bearer',
    scope: payload.scope || GITHUB_SCOPES.join(' '),
  };
}

/** The signed-in GitHub account: what the card shows, and what the configuration records. */
async function fetchGithubAccount(accessToken) {
  const response = await fetch(`${GITHUB_API}/user`, { headers: githubHeaders(accessToken) });
  const payload = await readGithubJson(response);
  if (!response.ok || !payload.login) {
    const reason = payload.message || `HTTP ${response.status}`;
    return { ok: false, error: `GitHub would not describe the authorised account: ${reason}` };
  }
  return {
    ok: true,
    account: {
      login: payload.login,
      name: payload.name || '',
      avatar_url: payload.avatar_url || '',
      profile_url: payload.html_url || `https://github.com/${payload.login}`,
    },
  };
}

/** The repositories this token may push to, most recently updated first (one page of 100). */
async function fetchGithubRepositories(accessToken) {
  const query = new URLSearchParams({
    per_page: String(REPOSITORY_LIMIT),
    sort: 'updated',
    affiliation: 'owner,collaborator,organization_member',
  });
  const response = await fetch(`${GITHUB_API}/user/repos?${query.toString()}`, { headers: githubHeaders(accessToken) });
  const payload = await readGithubJson(response);
  if (!response.ok || !Array.isArray(payload)) {
    const reason = payload?.message || `HTTP ${response.status}`;
    return { ok: false, error: `GitHub would not list the available repositories: ${reason}` };
  }
  return {
    ok: true,
    repositories: payload.map((repository) => ({
      full_name: repository.full_name,
      name: repository.name,
      owner: repository.owner?.login || String(repository.full_name || '').split('/')[0],
      private: repository.private === true,
      default_branch: repository.default_branch || 'main',
      html_url: repository.html_url || `https://github.com/${repository.full_name}`,
      updated_at: repository.updated_at || '',
    })),
  };
}

/**
 * The `github_config` value the hub writes to `system_settings`.
 *
 * `previous` is the configuration already stored, so reconnecting keeps the repository and branch the
 * administrator picked — unless the new authorisation can no longer see that repository, in which
 * case falling back to the first entry beats leaving a commit pointed at a repository with no access.
 */
export function buildGithubIntegrationConfig({ account, repositories, token, previous = {} }) {
  const names = repositories.map((repository) => repository.full_name);
  const repository = names.includes(previous.repository) ? previous.repository : (repositories[0]?.full_name || '');
  const isSameRepository = Boolean(repository) && repository === previous.repository;
  return {
    connected: true,
    provider: 'github',
    // Carried over, not rebuilt: the browser writes this object back as the whole row, so leaving the
    // OAuth app out would erase the credentials the connection was just made with.
    client_id: String(previous.client_id || ''),
    client_secret: String(previous.client_secret || ''),
    access_token: token.accessToken,
    token_type: token.tokenType,
    scope: token.scope,
    username: account.login,
    name: account.name,
    avatar_url: account.avatar_url,
    profile_url: account.profile_url,
    repository,
    branch: (isSameRepository && previous.branch)
      || repositories.find((entry) => entry.full_name === repository)?.default_branch
      || 'main',
    repositories,
    connected_at: new Date().toISOString(),
  };
}

/**
 * The popup URL, with its `state` already signed, or the reason it cannot be built — so the settings
 * screen never assembles an authorization URL itself and cannot get the redirect or the state wrong.
 *
 * `config` is the stored `github_config` row: the client id and secret come from the site's own saved
 * OAuth app, and the secret doubles as the key that signs `state`.
 */
export async function describeGithubStart({ config = {}, origin }) {
  const credentials = githubCredentials(config);
  if (!credentials.configured) {
    return {
      authorizeUrl: null,
      error: 'This site has no GitHub OAuth app yet. Paste the Client ID and Client Secret from GitHub into the GitHub card above, press Save GitHub credentials, and then connect.',
    };
  }
  const state = await createGithubState(credentials.clientSecret);
  const authorizeUrl = buildGithubAuthorizeUrl({
    clientId: credentials.clientId,
    redirectUri: `${origin}${GITHUB_CALLBACK_PATH}`,
    state,
  });
  return { authorizeUrl, error: '' };
}

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * The page GitHub's redirect lands on.
 *
 * It is the only page in the application that talks to `window.opener`, and it does nothing else: hand
 * the result over, say so, close. The visible words describe the same outcome as the message actually
 * posted, so the two cannot disagree — and the JSON is embedded with `<` escaped, so a repository name
 * could never close the `script` element early.
 */
export function renderGithubCallbackDocument({ origin, type, payload, title, message }) {
  const handoff = JSON.stringify({ source: GITHUB_MESSAGE_SOURCE, type, payload }).replace(/</g, '\\u003c');
  const settingsPath = JSON.stringify(GITHUB_SETTINGS_PATH);
  const resultKey = JSON.stringify(GITHUB_RESULT_KEY);
  const target = JSON.stringify(origin);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; display: grid; min-height: 100vh; place-items: center; background: #f8fafc;
    color: #0f172a; font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { width: min(30rem, calc(100vw - 3rem)); border: 1px solid #e2e8f0; border-radius: 10px;
    padding: 28px; background: #fff; box-shadow: 0 1px 3px rgb(15 23 42 / 8%); }
  h1 { margin: 0 0 10px; font-size: 1.2rem; }
  p { margin: 0 0 14px; color: #475569; font-size: 0.92rem; }
  button { border: 1px solid #cbd5e1; border-radius: 6px; padding: 9px 16px; color: #334155;
    background: #fff; cursor: pointer; font: inherit; font-weight: 600; }
  button:hover { border-color: #4f46e5; color: #4f46e5; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  <button type="button" id="rwp-close">Close this window</button>
</main>
<script>
(function () {
  var handoff = ${handoff};
  var delivered = false;
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(handoff, ${target});
      delivered = true;
    }
  } catch (error) {
    delivered = false;
  }
  if (delivered) {
    window.setTimeout(function () { window.close(); }, 1200);
    return;
  }
  // No window to answer to: this tab navigated here itself, which is where a blocked popup leads.
  // Hand the result to the settings screen through sessionStorage instead — a token in a query string
  // would end up in the browser's history and in every referrer this page sends.
  try { window.sessionStorage.setItem(${resultKey}, JSON.stringify(handoff)); } catch (error) { /* private mode */ }
  window.setTimeout(function () { window.location.replace(${settingsPath}); }, 1200);
})();
</script>
</body>
</html>`;
}

/** A callback page that failed, with the reason on it. */
export function renderGithubFailure({ origin, error }) {
  return renderGithubCallbackDocument({
    origin,
    type: 'GITHUB_ERROR',
    payload: { ok: false, error },
    title: 'GitHub was not connected',
    message: error,
  });
}

/**
 * The whole of `GET /api/auth/github/callback`, for both engines.
 *
 * It returns `{ status, html }` and HTML in every case, failures included: the request is a top-level
 * navigation, so a JSON body would be a dead end for the administrator watching the window.
 * `GET /api/integrations/status` is answered by `describeIntegrations` in
 * `server/integrationConfig.mjs`; nothing else is handled here, so an unknown `/api/auth/github/...`
 * path is still a 404 rather than a silent success.
 */
export async function completeGithubOAuth({ query, headers = {}, config = {} }) {
  const origin = requestOrigin(headers);
  const params = query instanceof URLSearchParams ? query : new URLSearchParams(query || {});
  const credentials = githubCredentials(config);

  // The administrator pressed Cancel on GitHub's consent screen.
  const refusal = params.get('error');
  if (refusal) {
    const description = params.get('error_description') || refusal;
    return { status: 200, html: renderGithubFailure({ origin, error: `GitHub reported: ${description}` }) };
  }

  if (!credentials.configured) {
    return {
      status: 501,
      html: renderGithubFailure({
        origin,
        error: 'This site has no GitHub OAuth app saved, so there is nothing to finish. Open Settings → Integrations, paste the Client ID and Client Secret from GitHub into the GitHub card, press Save GitHub credentials, and connect again.',
      }),
    };
  }

  const code = params.get('code');
  if (!code) {
    return {
      status: 400,
      html: renderGithubFailure({
        origin,
        error: 'This address is only reached from GitHub, as the redirect of a Connect GitHub attempt. Open Settings, then Integrations, and press Connect GitHub.',
      }),
    };
  }

  // The signed state is the only reason a `code` arriving here is believed: it proves this server
  // started the trip now being finished, and that it started it within the last ten minutes.
  if (!(await verifyGithubState(params.get('state'), credentials.clientSecret))) {
    return {
      status: 400,
      html: renderGithubFailure({
        origin,
        error: 'The state parameter in this callback is missing, expired, or was not signed by this server. Press Connect GitHub again to start a fresh attempt.',
      }),
    };
  }

  const redirectUri = `${origin}${GITHUB_CALLBACK_PATH}`;
  const exchange = await exchangeGithubCode({
    code, clientId: credentials.clientId, clientSecret: credentials.clientSecret, redirectUri,
  });
  if (!exchange.ok) return { status: 502, html: renderGithubFailure({ origin, error: exchange.error }) };

  const account = await fetchGithubAccount(exchange.accessToken);
  if (!account.ok) return { status: 502, html: renderGithubFailure({ origin, error: account.error }) };

  const repositories = await fetchGithubRepositories(exchange.accessToken);
  if (!repositories.ok) return { status: 502, html: renderGithubFailure({ origin, error: repositories.error }) };

  // The token and the repository list are handed to the browser, which is the only client here that
  // may write `system_settings`; a popup that closes before the write leaves "not connected" on the
  // card and a token that was never stored, which is the safe way round. The stored row is passed as
  // `previous` so the OAuth app saved under Settings → Integrations survives the write.
  const integration = buildGithubIntegrationConfig({
    account: account.account,
    repositories: repositories.repositories,
    token: exchange,
    previous: config,
  });

  return {
    status: 200,
    html: renderGithubCallbackDocument({
      origin,
      type: 'GITHUB_CONNECTED',
      payload: { ok: true, config: integration },
      title: 'GitHub connected',
      message: `Authorised as @${account.account.login}, with ${repositories.repositories.length} repositories to choose from. The settings screen is saving this now, and this window closes by itself.`,
    }),
  };
}
