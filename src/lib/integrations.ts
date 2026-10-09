/**
 * The Integrations hub's shared vocabulary (Settings → Integrations).
 *
 * Everything here is deliberately free of imports: this file is read by the settings screen and by the
 * server route that answers `/api/integrations/status`, and it holds the contract between the two — the
 * shape of the `github_config` row, the presence-only status that route reports, and the two GitHub
 * calls the GitHub card makes itself while validating a personal access token — so a rename cannot
 * half-happen.
 */

/**
 * The GitHub scope this project needs: `repo` is what pushing a plugin or theme back to a repository
 * takes, private repositories included.
 *
 * Nothing grants it here: the token is minted on GitHub's own "new token" page, which this list
 * pre-ticks, and pasted into the card. It is also the sentence the card shows, so it says what the
 * token is for rather than how it is obtained.
 */
export const githubScopes = ['repo'] as const;

/** GitHub's classic-token page, pre-ticked with `githubScopes` and named after this project. */
export const githubTokenPageUrl =
  `https://github.com/settings/tokens/new?description=${encodeURIComponent('react-wp')}&scopes=${githubScopes.join(',')}`;

/** GitHub's fine-grained token page, for an account that prefers per-repository permissions. */
export const githubFineGrainedTokenPageUrl = 'https://github.com/settings/personal-access-tokens/new';

/** The REST API the card validates a token against, with the version `server/pluginGitPush.mjs` pins. */
export const githubApiBase = 'https://api.github.com';
export const githubApiVersion = '2022-11-28';

/** The `system_settings` row the GitHub card reads and writes. In step with `GITHUB_CONFIG_KEY`. */
export const githubConfigKey = 'github_config';

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
 * `system_settings.github_config` — the token an administrator pasted, the account it belongs to, and
 * the repository this site publishes to.
 *
 * `token` is a GitHub credential, so no screen renders the value: the field is here because the browser
 * is the only client that may write this row (the server's publishable-key connection is refused by
 * RLS), not because it is meant to be displayed. Everything else in the row is what GitHub answered
 * when the card validated the token, kept so the card can render itself without asking again.
 */
export interface GithubIntegrationConfig {
  connected: boolean;
  provider: string;
  /**
   * The personal access token. A classic token carries the `repo` scope; a fine-grained one carries
   * Contents: Read and write on the repository below. It is written here, read by the server
   * (`server/pluginGitPush.mjs`) and never echoed back to a browser.
   */
  token: string;
  token_type: string;
  /** What GitHub reported in `x-oauth-scopes`. Empty for fine-grained tokens, which is not a fault. */
  scopes: string[];
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
 * What the status route says about GitHub: presence, and the target this site publishes to.
 *
 * `configured` is a token *and* the account it belongs to, which is what a commit needs. The token
 * itself is never reported — `tokenConfigured` is the whole of what a browser is told about it.
 */
export interface GithubEnvironmentStatus {
  configured: boolean;
  tokenConfigured: boolean;
  scopes: string[];
  username: string;
  repository: string;
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

/** A GitHub account, as `GET /user` describes it. Only the fields the card renders. */
export interface GithubAccount {
  login: string;
  name: string;
  avatar_url: string;
  html_url: string;
}

/** What validating a token answers: the account it belongs to, and everything that came with it. */
export interface GithubConnection {
  account: GithubAccount;
  /** GitHub's `x-oauth-scopes` header; empty for a fine-grained token, which is not a fault. */
  scopes: string[];
  /** The repositories the token may push to, most recently pushed first. */
  repositories: GithubRepository[];
}

/** A disconnected configuration, with the same keys a saved one has — so the card never reads undefined. */
export const emptyGithubConfig = (): GithubIntegrationConfig => ({
  connected: false,
  provider: 'github',
  token: '',
  token_type: '',
  scopes: [],
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
    // `owner` is a string in a stored row and an object in GitHub's own payload (`/user/repos`), so
    // both shapes are read here rather than in each caller.
    owner: asString(row.owner) || asString((row.owner as { login?: unknown } | null)?.login) || fullName.split('/')[0],
    private: row.private === true,
    default_branch: asString(row.default_branch) || 'main',
    html_url: asString(row.html_url) || `https://github.com/${fullName}`,
    updated_at: asString(row.updated_at),
  };
};

/**
 * Turns whatever is in `system_settings.github_config` into a full configuration. Every field is
 * defaulted, because the value arrives from a browser that may be running a slightly older build:
 * `access_token`/`scope` are the OAuth-era names, read so a site that connected through the old
 * handshake keeps showing — and keeps pushing with — the token it already had.
 */
export const githubConfigFrom = (value: unknown): GithubIntegrationConfig => {
  const base = emptyGithubConfig();
  if (!value || typeof value !== 'object') return base;
  const row = value as Record<string, unknown>;
  const repositories = Array.isArray(row.repositories)
    ? row.repositories.map(asRepository).filter((entry): entry is GithubRepository => entry !== null)
    : [];
  const username = asString(row.username);
  const token = asString(row.token) || asString(row.pat) || asString(row.access_token);
  return {
    ...base,
    connected: Boolean(token && username),
    provider: asString(row.provider) || 'github',
    token,
    token_type: asString(row.token_type),
    scopes: Array.isArray(row.scopes)
      ? row.scopes.map(asString).filter(Boolean)
      : asString(row.scope).split(/[\s,]+/).filter(Boolean),
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
  config.connected && Boolean(config.token) && Boolean(config.username);

// -- GitHub: validating a personal access token ---------------------------------------------------

/**
 * One GitHub REST call, made by the browser that holds the token.
 *
 * `api.github.com` answers `Access-Control-Allow-Origin: *`, so this needs no route on this project's
 * server and the token travels nowhere but to GitHub itself. The response's headers matter as much as
 * its body — `x-oauth-scopes` is where a classic token's scopes are reported — so both are returned.
 * GitHub's own error sentence is preferred over the HTTP status, because it names the problem.
 */
const githubRequest = async (
  path: string,
  token: string,
): Promise<{ data: unknown; scopes: string[] }> => {
  let response: Response;
  try {
    response = await fetch(`${githubApiBase}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': githubApiVersion,
      },
    });
  } catch {
    throw new Error('GitHub could not be reached from this browser. Check the connection, then try again.');
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = asString((data as { message?: unknown } | null)?.message) || `HTTP ${response.status}`;
    if (response.status === 401) {
      throw new Error(`GitHub rejected that token (${detail}). Check that it was copied whole, and that it has not expired.`);
    }
    throw new Error(`GitHub answered "${detail}" (HTTP ${response.status}).`);
  }
  return {
    data,
    // Reported for classic tokens, absent for fine-grained ones: an empty list is normal, not a fault.
    scopes: String(response.headers.get('x-oauth-scopes') || '')
      .split(/[\s,]+/)
      .filter(Boolean),
  };
};

/**
 * The repositories the token may push to, most recently pushed first — the list the card's picker
 * shows, and the only question the card asks GitHub about the token.
 *
 * One page of the maximum size, not a walk: `/user/repos` orders by most recent push, so the repository
 * an administrator wants is at the top, and a picker of a hundred names is already more than anyone
 * scrolls.
 */
const githubRepositories = async (token: string): Promise<GithubRepository[]> => {
  const { data } = await githubRequest(
    '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
    token,
  );
  if (!Array.isArray(data)) return [];
  return data.map(asRepository).filter((entry): entry is GithubRepository => entry !== null);
};

/**
 * Proves a pasted token against GitHub and gathers what the card needs to render: the account it
 * belongs to, its scopes, and the repositories it can see.
 *
 * Throws with a sentence worth showing the administrator — the card puts it in its error slot
 * unedited — and nothing is stored until this resolves.
 */
export const validateGithubToken = async (token: string): Promise<GithubConnection> => {
  const trimmed = String(token || '').trim();
  if (!trimmed) throw new Error('Paste a personal access token first.');
  const { data, scopes } = await githubRequest('/user', trimmed);
  const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const login = asString(row.login);
  if (!login) {
    throw new Error('GitHub answered without an account name, so that token cannot be used here. Create a new one and paste it again.');
  }
  return {
    account: {
      login,
      name: asString(row.name),
      avatar_url: asString(row.avatar_url),
      html_url: asString(row.html_url) || `https://github.com/${login}`,
    },
    scopes,
    repositories: await githubRepositories(trimmed),
  };
};

/**
 * The `github_config` row a validated token deserves.
 *
 * `previous` is the row already stored: its repository and branch are carried over when the new token
 * can still see that repository, so renewing a token costs nothing. A token for another account cannot
 * see it, and the target is then cleared rather than left pointing at a repository this token cannot
 * push to.
 */
export const githubConfigFor = (
  connection: GithubConnection,
  options: { token: string; previous?: GithubIntegrationConfig; now?: Date },
): GithubIntegrationConfig => {
  const { token, previous, now = new Date() } = options;
  const wanted = asString(previous?.repository);
  const repository = connection.repositories.some((entry) => entry.full_name === wanted) ? wanted : '';
  const branch = repository
    ? asString(previous?.branch) ||
      connection.repositories.find((entry) => entry.full_name === repository)?.default_branch ||
      'main'
    : '';
  return {
    ...emptyGithubConfig(),
    connected: true,
    token: String(token || '').trim(),
    token_type: 'bearer',
    scopes: connection.scopes,
    username: connection.account.login,
    name: connection.account.name,
    avatar_url: connection.account.avatar_url,
    profile_url: connection.account.html_url,
    repository,
    branch,
    repositories: connection.repositories,
    connected_at: now.toISOString(),
  };
};

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

