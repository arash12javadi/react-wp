/**
 * Types for `server/githubOAuth.mjs`.
 *
 * The implementation is plain ESM so `server.mjs` and the bundled Hono app can both run the identical
 * handshake (see the header of the implementation for why). `src/server/**` is type-checked, so this
 * declaration is what gives the Hono routes real types without a second copy of the logic — and
 * without turning on `allowJs` for the whole project.
 *
 * The shared shapes are imported from `src/lib/integrations.ts`, which the settings screen uses too, so
 * a field cannot be renamed on one side of the handshake alone.
 */
import type {
  GithubIntegrationConfig,
  GithubRepository,
} from '../src/lib/integrations';

/** Headers, lowercased: only `host`, `x-forwarded-host` and `x-forwarded-proto` are read. */
export type GithubRequestHeaders = Record<string, string | undefined>;

/** The stored `github_config` row, as these functions read it. */
export type GithubStoredConfig = Partial<GithubIntegrationConfig> & Record<string, unknown>;

export const GITHUB_CALLBACK_PATH: string;
export const GITHUB_SETTINGS_PATH: string;
export const GITHUB_RESULT_KEY: string;
export const GITHUB_CONFIG_KEY: string;
export const GITHUB_SCOPES: string[];
export const GITHUB_MESSAGE_SOURCE: string;

export function githubCredentials(config?: GithubStoredConfig): {
  clientId: string;
  clientSecret: string;
  configured: boolean;
};

export function createGithubState(secret: string): Promise<string>;
export function verifyGithubState(state: unknown, secret: string): Promise<boolean>;

export function buildGithubAuthorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string;

export function requestOrigin(headers?: GithubRequestHeaders, siteUrl?: string): string;

export function exchangeGithubCode(options: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<
  | { ok: true; accessToken: string; tokenType: string; scope: string }
  | { ok: false; error: string }
>;

export function buildGithubIntegrationConfig(options: {
  account: { login: string; name: string; avatar_url: string; profile_url: string };
  repositories: GithubRepository[];
  token: { accessToken: string; tokenType: string; scope: string };
  previous?: GithubStoredConfig;
}): GithubIntegrationConfig;

export function describeGithubStart(options: {
  config?: GithubStoredConfig;
  origin: string;
}): Promise<{ authorizeUrl: string | null; error: string }>;

export function renderGithubCallbackDocument(options: {
  origin: string;
  type: 'GITHUB_CONNECTED' | 'GITHUB_ERROR';
  payload: unknown;
  title: string;
  message: string;
}): string;

export function renderGithubFailure(options: { origin: string; error: string }): string;

/**
 * The whole of `GET /api/auth/github/callback`: it always answers with a page, never with JSON, because
 * the request is a browser navigation. `status` is still set, so a `curl` can tell the cases apart.
 *
 * `config` is the stored `github_config` row — the OAuth app it names is what signs the state and what
 * the code is exchanged with.
 */
export function completeGithubOAuth(options: {
  query?: URLSearchParams | Record<string, string>;
  headers?: GithubRequestHeaders;
  config?: GithubStoredConfig;
}): Promise<{ status: number; html: string }>;
