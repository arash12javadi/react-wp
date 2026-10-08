/**
 * The Integrations hub's shared vocabulary (Settings → Integrations).
 *
 * Everything here is deliberately free of imports: this file is read by the settings screen and by the
 * server route that answers `/api/integrations/status`, and it holds the contract between the three
 * parties of the OAuth handshake — the callback window that posts the result, the message it posts,
 * and the screen that listens for it — so a rename cannot half-happen.
 *
 * A few values are mirrored rather than imported, because the plain-ESM server module cannot be typed
 * from here: each one says where its twin lives in `server/githubOAuth.mjs`. Keep the pairs in step.
 */

/**
 * The GitHub scopes the hub asks for: `repo` to push a plugin or theme back to a repository (which
 * covers private repositories too), and `read:user` for the account name and avatar the card shows.
 *
 * Keep in step with `GITHUB_SCOPES` in `server/githubOAuth.mjs`.
 */
export const githubScopes = ['repo', 'read:user'] as const;

/** Where GitHub sends the browser back to. Keep in step with `GITHUB_CALLBACK_PATH`. */
export const githubCallbackPath = '/api/auth/github/callback';

/** The `system_settings` row the GitHub card reads and writes. In step with `GITHUB_CONFIG_KEY`. */
export const githubConfigKey = 'github_config';

/** Where a result waits when the OAuth window could not be opened. In step with `GITHUB_RESULT_KEY`. */
export const githubOAuthResultKey = 'rwp-github-oauth-result';

/** How the callback window identifies its messages. In step with `GITHUB_MESSAGE_SOURCE`. */
export const githubMessageSource = 'rwp-github-oauth';

/** The popup size: GitHub's consent screen needs the room, and the flow is a side trip. */
export const githubPopupWidth = 600;
export const githubPopupHeight = 700;

/** One repository the token can push to, as the callback window passes it over. */
export interface GithubRepository {
  full_name: string;
  name: string;
  owner: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  updated_at: string;
}

/**
 * `system_settings.github_config` — the result of a successful handshake.
 *
 * `access_token` is a GitHub credential, so no screen renders the value: the field is here because the
 * browser is the only client that may write this row (the server's publishable-key connection is
 * refused by RLS), not because it is meant to be displayed.
 */
export interface GithubIntegrationConfig {
  connected: boolean;
  provider: string;
  /**
   * The OAuth app saved from the hub's GitHub card. They live in this row rather than in the server
   * environment, so a site can be pointed at a different OAuth app without editing a file and
   * restarting. The secret is only ever written here and read by the server.
   */
  client_id: string;
  client_secret: string;
  access_token: string;
  token_type: string;
  scope: string;
  username: string;
  name: string;
  avatar_url: string;
  profile_url: string;
  repository: string;
  branch: string;
  repositories: GithubRepository[];
  connected_at: string;
}

/**
 * Whether this site holds a GitHub OAuth app, which is what the popup needs to exist at all.
 *
 * The pair is stored in `system_settings.github_config` (saved from the hub's own form), so `clientId`
 * is echoed back — a client id is public, it travels in the authorize URL — while the secret is only
 * ever reported as present or missing.
 */
export interface GithubEnvironmentStatus {
  configured: boolean;
  clientId: string;
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  scopes: string[];
}

/** Which provider the AI card is set to. Presence only: never a key. */
export interface AiIntegrationStatus {
  configured: boolean;
  provider: string;
  model: string;
}

/** What the media card is set to, and whether each provider's own fields are complete. */
export interface MediaIntegrationStatus {
  /** The storage driver the runtime resolved: `local` or `s3`. */
  storage: string;
  /** The provider chosen in the hub: `supabase`, `cloudinary`, `imagekit` or `s3`. */
  provider: string;
  cloudinaryConfigured: boolean;
  imagekitConfigured: boolean;
  s3Configured: boolean;
}

/** Which provider the email card is set to, and whether it could send anything today. */
export interface EmailIntegrationStatus {
  configured: boolean;
  provider: string;
}

/**
 * Whether the *server* could read the credential rows at all.
 *
 * Under Supabase they are RLS-protected, so a server holding only the publishable key reads nothing;
 * `readable: false` is what lets the hub say so rather than claiming every card is unconfigured.
 */
export interface IntegrationCredentialsStatus {
  readable: boolean;
  source: 'adapter' | 'database' | 'rest' | 'unavailable';
  error: string;
}

/** The body of `GET /api/integrations/status`. */
export interface IntegrationStatus {
  origin: string;
  redirectUri: string;
  github: GithubEnvironmentStatus;
  ai: AiIntegrationStatus;
  media: MediaIntegrationStatus;
  email: EmailIntegrationStatus;
  credentials: IntegrationCredentialsStatus;
}

/** The `system_settings` row the AI card owns. In step with `AI_CONFIG_KEY`, `server/integrationConfig.mjs`. */
export const aiConfigKey = 'ai_config';

/** The `system_settings` row the media card owns. In step with `MEDIA_STORAGE_CONFIG_KEY`. */
export const mediaStorageConfigKey = 'media_storage_config';

/** The `system_settings` row the email card owns. In step with `EMAIL_CONFIG_KEY`. */
export const emailConfigKey = 'email_config';

/** The message the callback window posts, for a success or for a failure. */
export interface GithubOAuthMessage {
  source: typeof githubMessageSource;
  type: 'GITHUB_CONNECTED' | 'GITHUB_ERROR';
  payload: { ok?: boolean; config?: unknown; error?: string };
}

/** A disconnected configuration, with the same keys a saved one has — so the card never reads undefined. */
export const emptyGithubConfig = (): GithubIntegrationConfig => ({
  connected: false,
  provider: 'github',
  client_id: '',
  client_secret: '',
  access_token: '',
  token_type: '',
  scope: '',
  username: '',
  name: '',
  avatar_url: '',
  profile_url: '',
  repository: '',
  branch: '',
  repositories: [],
  connected_at: '',
});

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** One stored repository, tolerating a row written by an older build. */
const asRepository = (value: unknown): GithubRepository | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const fullName = asString(row.full_name) || asString(row.name);
  if (!fullName) return null;
  return {
    full_name: fullName,
    name: asString(row.name) || fullName.split('/')[1] || fullName,
    owner: asString(row.owner) || fullName.split('/')[0],
    private: row.private === true,
    default_branch: asString(row.default_branch) || 'main',
    html_url: asString(row.html_url) || `https://github.com/${fullName}`,
    updated_at: asString(row.updated_at),
  };
};

/**
 * Turns whatever is in `system_settings.github_config` — or in the popup's message — into a full
 * configuration. Every field is defaulted, because the value arrives from three places that can each
 * be missing one: an empty row, a row written by a build that stored fewer fields, and a message
 * posted by the callback window.
 */
export const githubConfigFrom = (value: unknown): GithubIntegrationConfig => {
  const base = emptyGithubConfig();
  if (!value || typeof value !== 'object') return base;
  const row = value as Record<string, unknown>;
  const repositories = Array.isArray(row.repositories)
    ? row.repositories.map(asRepository).filter((entry): entry is GithubRepository => entry !== null)
    : [];
  const username = asString(row.username);
  return {
    ...base,
    connected: row.connected === true || Boolean(asString(row.access_token) && username),
    provider: asString(row.provider) || 'github',
    // Tolerated for rows written by hand or by an integration that names them in camelCase.
    client_id: asString(row.client_id) || asString(row.clientId),
    client_secret: asString(row.client_secret) || asString(row.clientSecret),
    access_token: asString(row.access_token),
    token_type: asString(row.token_type),
    scope: asString(row.scope),
    username,
    name: asString(row.name),
    avatar_url: asString(row.avatar_url),
    profile_url: asString(row.profile_url) || (username ? `https://github.com/${username}` : ''),
    repository: asString(row.repository),
    branch: asString(row.branch),
    repositories,
    connected_at: asString(row.connected_at),
  };
};

/** Connected means a token *and* the account it belongs to: either alone is not a usable connection. */
export const isGithubConnected = (config: GithubIntegrationConfig): boolean =>
  config.connected && Boolean(config.access_token) && Boolean(config.username);

/**
 * Whether a GitHub OAuth app has been saved on this site. The pair lives in the same
 * `github_config` row as the connection, because that row is what the server reads to start a
 * handshake and what the card reads to show its state.
 */
export const githubCredentialsConfigured = (config: GithubIntegrationConfig): boolean =>
  Boolean(config.client_id && config.client_secret);

// -- AI ------------------------------------------------------------------------------------------

/** The AI providers the hub offers, in the order they are listed. */
export const aiProviders = ['gemini', 'openai'] as const;
export type AiProvider = (typeof aiProviders)[number];

export const aiProviderLabels: Record<AiProvider, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
};

/**
 * The models offered as suggestions. Both providers retire models on their own schedule, so the
 * field stays a free text input: this list saves typing, it is not a constraint.
 */
export const aiProviderModels: Record<AiProvider, string[]> = {
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
};

/** `system_settings.ai_config`: which provider generation runs on, and with which key. */
export interface AiConfig {
  provider: AiProvider;
  api_key: string;
  model: string;
}

export const emptyAiConfig = (): AiConfig => ({ provider: 'gemini', api_key: '', model: '' });

/** Turns whatever is stored into a full configuration, defaulting every field. */
export const aiConfigFrom = (value: unknown): AiConfig => {
  const base = emptyAiConfig();
  if (!value || typeof value !== 'object') return base;
  const row = value as Record<string, unknown>;
  const provider = asString(row.provider).toLowerCase();
  return {
    ...base,
    provider: (aiProviders as readonly string[]).includes(provider) ? (provider as AiProvider) : base.provider,
    // Tolerated for rows written by hand or by a build that named the field differently.
    api_key: asString(row.api_key) || asString(row.apiKey),
    model: asString(row.model),
  };
};

/** True when generation could run with this configuration. */
export const isAiConfigured = (config: AiConfig): boolean => Boolean(config.api_key);

// -- Media storage -------------------------------------------------------------------------------

/** Where uploaded files are sent. `supabase` means this site's own storage, not a host. */
export const mediaStorageProviders = ['supabase', 'cloudinary', 'imagekit', 's3'] as const;
export type MediaStorageProvider = (typeof mediaStorageProviders)[number];

export const mediaStorageProviderLabels: Record<MediaStorageProvider, string> = {
  supabase: 'Supabase Storage',
  cloudinary: 'Cloudinary',
  imagekit: 'ImageKit',
  s3: 'AWS S3 / S3-Compatible',
};

export interface CloudinaryStorageConfig {
  cloud_name: string;
  api_key: string;
  api_secret: string;
  upload_preset: string;
}

export interface ImagekitStorageConfig {
  url_endpoint: string;
  public_key: string;
  private_key: string;
}

export interface S3StorageConfig {
  access_key_id: string;
  secret_access_key: string;
  bucket: string;
  region: string;
  /** Optional: Cloudflare R2, MinIO and other compatible services need it. */
  endpoint: string;
  public_base_url: string;
  force_path_style: boolean;
}

/** `system_settings.media_storage_config`: the active provider and every provider's own fields. */
export interface MediaStorageConfig {
  provider: MediaStorageProvider;
  cloudinary: CloudinaryStorageConfig;
  imagekit: ImagekitStorageConfig;
  s3: S3StorageConfig;
}

export const emptyMediaStorageConfig = (): MediaStorageConfig => ({
  provider: 'supabase',
  cloudinary: { cloud_name: '', api_key: '', api_secret: '', upload_preset: '' },
  imagekit: { url_endpoint: '', public_key: '', private_key: '' },
  s3: {
    access_key_id: '', secret_access_key: '', bucket: '', region: '',
    endpoint: '', public_base_url: '', force_path_style: false,
  },
});

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * Every provider's block is kept, not only the active one: an administrator who switches to S3 to
 * try it, then switches back, must not have to paste the Cloudinary keys a second time.
 */
export const mediaStorageConfigFrom = (value: unknown): MediaStorageConfig => {
  const base = emptyMediaStorageConfig();
  if (!value || typeof value !== 'object') return base;
  const row = value as Record<string, unknown>;
  const provider = asString(row.provider).toLowerCase();
  const cloudinary = asObject(row.cloudinary);
  const imagekit = asObject(row.imagekit);
  const s3 = asObject(row.s3);
  return {
    provider: (mediaStorageProviders as readonly string[]).includes(provider)
      ? (provider as MediaStorageProvider)
      : base.provider,
    cloudinary: {
      cloud_name: asString(cloudinary.cloud_name),
      api_key: asString(cloudinary.api_key),
      api_secret: asString(cloudinary.api_secret),
      upload_preset: asString(cloudinary.upload_preset),
    },
    imagekit: {
      url_endpoint: asString(imagekit.url_endpoint),
      public_key: asString(imagekit.public_key),
      private_key: asString(imagekit.private_key),
    },
    s3: {
      access_key_id: asString(s3.access_key_id),
      secret_access_key: asString(s3.secret_access_key),
      bucket: asString(s3.bucket),
      region: asString(s3.region),
      endpoint: asString(s3.endpoint),
      public_base_url: asString(s3.public_base_url),
      force_path_style: s3.force_path_style === true,
    },
  };
};

/** True when the active provider has every field it cannot work without. */
export const isMediaStorageConfigured = (config: MediaStorageConfig): boolean => {
  switch (config.provider) {
    case 'cloudinary':
      return Boolean(config.cloudinary.cloud_name && config.cloudinary.upload_preset);
    case 'imagekit':
      return Boolean(config.imagekit.public_key && config.imagekit.private_key);
    case 's3':
      return Boolean(config.s3.bucket && config.s3.access_key_id && config.s3.secret_access_key);
    default:
      // This site's own storage needs no credential of its own.
      return true;
  }
};

// -- Email ---------------------------------------------------------------------------------------

/** How outgoing mail is sent. */
export const emailProviders = ['resend', 'sendgrid', 'smtp'] as const;
export type EmailProvider = (typeof emailProviders)[number];

export const emailProviderLabels: Record<EmailProvider, string> = {
  resend: 'Resend',
  sendgrid: 'SendGrid',
  smtp: 'Custom SMTP',
};

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  /** True for implicit TLS (port 465); false for STARTTLS (587) and plain relays. */
  secure: boolean;
}

/** `system_settings.email_config`: the provider, its key, and the address mail is sent from. */
export interface EmailConfig {
  provider: EmailProvider;
  api_key: string;
  from_email: string;
  from_name: string;
  smtp: SmtpConfig;
}

export const emptyEmailConfig = (): EmailConfig => ({
  provider: 'resend',
  api_key: '',
  from_email: '',
  from_name: '',
  smtp: { host: '', port: 587, username: '', password: '', secure: false },
});

export const emailConfigFrom = (value: unknown): EmailConfig => {
  const base = emptyEmailConfig();
  if (!value || typeof value !== 'object') return base;
  const row = value as Record<string, unknown>;
  const provider = asString(row.provider).toLowerCase();
  const smtp = asObject(row.smtp);
  const port = Number(smtp.port);
  return {
    provider: (emailProviders as readonly string[]).includes(provider)
      ? (provider as EmailProvider)
      : base.provider,
    api_key: asString(row.api_key) || asString(row.apiKey),
    from_email: asString(row.from_email),
    from_name: asString(row.from_name),
    smtp: {
      host: asString(smtp.host),
      port: Number.isFinite(port) && port > 0 && port <= 65535 ? Math.floor(port) : base.smtp.port,
      username: asString(smtp.username),
      password: asString(smtp.password),
      secure: smtp.secure === true,
    },
  };
};

/** True when the active provider has what sending a message needs. */
export const isEmailConfigured = (config: EmailConfig): boolean => {
  const hasSender = Boolean(config.from_email);
  switch (config.provider) {
    case 'smtp':
      return hasSender && Boolean(config.smtp.host && config.smtp.username && config.smtp.password);
    default:
      return hasSender && Boolean(config.api_key);
  }
};

/** The callback URL to register on the GitHub OAuth app, built from the site's own origin. */
export const githubCallbackUrl = (origin: string): string =>
  `${String(origin || '').replace(/\/+$/, '')}${githubCallbackPath}`;

/**
 * `GET /api/integrations/status`. Throws with the server's own sentence when the route is missing — a
 * static host that only serves `index.html` answers HTML here, and `response.json()` would otherwise
 * fail as `Unexpected token '<'`.
 */
export const fetchIntegrationStatus = async (): Promise<IntegrationStatus> => {
  const response = await fetch('/api/integrations/status', { headers: { Accept: 'application/json' } });
  const payload = (await response.json().catch(() => null)) as (Partial<IntegrationStatus> & { error?: string }) | null;
  if (!response.ok || !payload?.github) {
    throw new Error(payload?.error || `The server could not describe its integrations (HTTP ${response.status}).`);
  }
  return payload as IntegrationStatus;
};

/** True only for a message from the callback window, in the shape this build understands. */
export const isGithubOAuthMessage = (value: unknown): value is GithubOAuthMessage => {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<GithubOAuthMessage>;
  if (message.source !== githubMessageSource) return false;
  if (message.type !== 'GITHUB_CONNECTED' && message.type !== 'GITHUB_ERROR') return false;
  return Boolean(message.payload && typeof message.payload === 'object');
};

/**
 * A result left behind by a callback that had no window to post to — the path taken when the popup was
 * blocked and the browser went to GitHub in this tab instead.
 *
 * Reading removes it: a reload must not replay an old token, and a value that cannot be parsed is
 * dropped rather than left behind as a permanent error.
 */
export const takeGithubOAuthResult = (): GithubOAuthMessage | null => {
  try {
    const raw = window.sessionStorage.getItem(githubOAuthResultKey);
    if (!raw) return null;
    window.sessionStorage.removeItem(githubOAuthResultKey);
    const parsed: unknown = JSON.parse(raw);
    return isGithubOAuthMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
