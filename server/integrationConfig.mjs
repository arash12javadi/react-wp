/**
 * The Integrations hub's server vocabulary — what is stored, what is safe to report, and how a key
 * is proven to work.
 *
 * Every credential this site uses lives in `system_settings`, written from
 * `/admin?section=settings&tab=integrations` by the signed-in administrator. Nothing here reads
 * `process.env`: there is no `GEMINI_API_KEY`, `SMTP_PASS`, `CLOUDINARY_API_SECRET`,
 * `IMAGEKIT_PRIVATE_KEY` or `GITHUB_TOKEN` in this repository's runtime any more. That is
 * what makes a site portable — a host needs its database and its signing secret and nothing else —
 * and it is why credentials can be rotated from the admin without a restart.
 *
 * This file is plain ESM because three callers share it: `server.mjs`, the bundled Hono app
 * (`src/server/integrations.ts`) and the file-system functions under `api/`. A second copy of
 * "which field is the private key" is exactly the kind of duplication that ends with one of them
 * being wrong. `server/integrationConfig.d.mts` gives the TypeScript callers real types without
 * turning on `allowJs`; the browser-facing mirror of these keys and shapes lives in
 * `src/lib/integrations.ts` — keep the pairs in step.
 */

/** `system_settings` rows. In step with `aiConfigKey` and friends in src/lib/integrations.ts. */
export const AI_CONFIG_KEY = 'ai_config';
export const MEDIA_STORAGE_CONFIG_KEY = 'media_storage_config';
export const EMAIL_CONFIG_KEY = 'email_config';
/** In step with `githubConfigKey` in src/lib/integrations.ts and `GITHUB_CONFIG_KEY`. */
export const GITHUB_CONFIG_KEY = 'github_config';

/** Every row the hub owns, in one list so a reader cannot forget one. */
export const INTEGRATION_CONFIG_KEYS = [
  GITHUB_CONFIG_KEY, AI_CONFIG_KEY, MEDIA_STORAGE_CONFIG_KEY, EMAIL_CONFIG_KEY,
];

// -- Normalising ---------------------------------------------------------------------------------
//
// These rows are read by the server and echoed (presence only) by `GET /api/integrations/status`, so
// nothing is trusted to be the shape it was written as: a value edited in the SQL editor, written by
// an older build, or posted by a hostile client must not be able to name a provider that does not
// exist or smuggle a field into a response.

const asString = (value) => (typeof value === 'string' ? value : '');
const asObject = (value) => (value && typeof value === 'object' ? value : {});
const oneOf = (value, allowed, fallback) =>
  allowed.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : fallback;

export const AI_PROVIDERS = ['gemini', 'openai'];
export const MEDIA_STORAGE_PROVIDERS = ['supabase', 'cloudinary', 'imagekit', 's3'];
export const EMAIL_PROVIDERS = ['resend', 'sendgrid', 'smtp'];

export const emptyAiConfig = () => ({ provider: 'gemini', api_key: '', model: '' });

export const aiConfigFrom = (value) => {
  const row = asObject(value);
  return {
    provider: oneOf(row.provider, AI_PROVIDERS, 'gemini'),
    api_key: asString(row.api_key) || asString(row.apiKey),
    model: asString(row.model),
  };
};

export const emptyMediaStorageConfig = () => ({
  provider: 'supabase',
  cloudinary: { cloud_name: '', api_key: '', api_secret: '', upload_preset: '' },
  imagekit: { url_endpoint: '', public_key: '', private_key: '' },
  s3: {
    access_key_id: '', secret_access_key: '', bucket: '', region: '',
    endpoint: '', public_base_url: '', force_path_style: false,
  },
});

export const mediaStorageConfigFrom = (value) => {
  const row = asObject(value);
  const cloudinary = asObject(row.cloudinary);
  const imagekit = asObject(row.imagekit);
  const s3 = asObject(row.s3);
  return {
    provider: oneOf(row.provider, MEDIA_STORAGE_PROVIDERS, 'supabase'),
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

export const emptyEmailConfig = () => ({
  provider: 'resend',
  api_key: '',
  from_email: '',
  from_name: '',
  smtp: { host: '', port: 587, username: '', password: '', secure: false },
});

export const emailConfigFrom = (value) => {
  const row = asObject(value);
  const smtp = asObject(row.smtp);
  const port = Number(smtp.port);
  return {
    provider: oneOf(row.provider, EMAIL_PROVIDERS, 'resend'),
    api_key: asString(row.api_key) || asString(row.apiKey),
    from_email: asString(row.from_email),
    from_name: asString(row.from_name),
    smtp: {
      host: asString(smtp.host),
      port: Number.isFinite(port) && port > 0 && port <= 65535 ? Math.floor(port) : 587,
      username: asString(smtp.username),
      password: asString(smtp.password),
      secure: smtp.secure === true,
    },
  };
};

/**
 * The credential half of `github_config`: the personal access token a commit is made with.
 *
 * The GitHub card validates the token against GitHub in the browser (`src/lib/integrations.ts`) and
 * stores the row; the server only ever *reads* it back (`server/pluginGitPush.mjs`). So this function
 * is the single definition of where the token lives. `access_token` is accepted as a fallback: that is
 * the field the OAuth-era card wrote, so a site that connected through the old flow keeps pushing until
 * an administrator pastes a token.
 */
export const githubTokenFrom = (value) => {
  const row = asObject(value);
  return asString(row.token) || asString(row.pat) || asString(row.access_token);
};

/**
 * The GitHub card's own view of the row: presence only, never the token itself.
 *
 * `configured` is what a commit needs — a token and the account it belongs to. `scopes` is whatever
 * GitHub reported for it, which is empty for fine-grained tokens: those carry per-repository
 * permissions rather than classic scopes, and an empty list is not a warning.
 */
export const githubStatusFrom = (value) => {
  const row = asObject(value);
  const token = githubTokenFrom(row);
  const scopes = Array.isArray(row.scopes)
    ? row.scopes.map(asString).filter(Boolean)
    : asString(row.scope).split(/[\s,]+/).filter(Boolean);
  const username = asString(row.username);
  return {
    configured: Boolean(token && username),
    tokenConfigured: Boolean(token),
    scopes,
    username,
    repository: asString(row.repository),
  };
};

/**
 * Whether the whole row is complete enough to push to. The variables are named as the card labels
 * them (they are admin-facing words, not environment variables any more).
 */
export const isGithubConnectedConfig = (value) => {
  const row = asObject(value);
  return Boolean(githubTokenFrom(row) && asString(row.username));
};

/** Every provider's completeness, so a card can say what is still missing rather than "unconfigured". */
export const mediaProviderStatus = (config) => ({
  cloudinaryConfigured: Boolean(config.cloudinary.cloud_name && config.cloudinary.upload_preset),
  imagekitConfigured: Boolean(config.imagekit.public_key && config.imagekit.private_key),
  s3Configured: Boolean(config.s3.bucket && config.s3.access_key_id && config.s3.secret_access_key),
});

/** The credentials the media routes actually use, or an explanation of what is missing. */
export const mediaCredentialsFrom = (config) => ({
  provider: config.provider,
  cloudinary: {
    cloudName: config.cloudinary.cloud_name,
    apiKey: config.cloudinary.api_key,
    apiSecret: config.cloudinary.api_secret,
    uploadPreset: config.cloudinary.upload_preset,
  },
  imagekit: {
    urlEndpoint: config.imagekit.url_endpoint,
    publicKey: config.imagekit.public_key,
    privateKey: config.imagekit.private_key,
  },
  s3: {
    accessKeyId: config.s3.access_key_id,
    secretAccessKey: config.s3.secret_access_key,
    bucket: config.s3.bucket,
    region: config.s3.region,
    endpoint: config.s3.endpoint,
    publicBaseUrl: config.s3.public_base_url,
    forcePathStyle: config.s3.force_path_style,
  },
});

/** True when the email card could send a message with this configuration. */
export const isEmailConfigured = (config) => {
  const hasSender = Boolean(config.from_email);
  if (config.provider === 'smtp') {
    return hasSender && Boolean(config.smtp.host && config.smtp.username && config.smtp.password);
  }
  return hasSender && Boolean(config.api_key);
};

// -- What the hub is allowed to know -------------------------------------------------------------

/**
 * The body of `GET /api/integrations/status`.
 *
 * Presence only: not one credential value is in the answer, which is what makes it safe to ask for
 * before the screen knows anything. `credentials.readable` is the exception that proves the rule —
 * under Supabase the server cannot read the rows at all with only the publishable key, and saying so
 * is far more useful than reporting every card as unconfigured.
 */
export const describeIntegrations = ({
  github = {}, ai = {}, media = {}, email = {}, credentials = {}, storage = 'local',
}) => ({
  github: {
    configured: Boolean(github.configured),
    tokenConfigured: Boolean(github.tokenConfigured),
    scopes: github.scopes || [],
    username: github.username || '',
    repository: github.repository || '',
  },
  ai: {
    configured: Boolean(ai.api_key),
    provider: ai.provider || 'gemini',
    model: ai.model || '',
  },
  media: {
    storage: storage === 's3' ? 's3' : 'local',
    provider: media.provider || 'supabase',
    ...mediaProviderStatus(media),
  },
  email: {
    configured: isEmailConfigured(email),
    provider: email.provider || 'resend',
  },
  credentials: {
    readable: credentials.readable === true,
    source: credentials.source || 'unavailable',
    error: credentials.error || '',
  },
});

/** What `/api/media-config` answers: whether a delete can reach the provider's own copy. */
export const describeDeleteSupport = (media) => ({
  cloudinary: Boolean(media.cloudinary.api_key && media.cloudinary.api_secret),
  imagekit: Boolean(media.imagekit.private_key),
});

// -- Proving a credential works ------------------------------------------------------------------
//
// Both probes exist for the same reason: a saved key that is wrong is worse than no key at all,
// because it fails much later — in a form notification nobody receives, or in a chat reply that never
// arrives. Each one makes one cheap authenticated call and repeats the provider's own words back.

/** One request, with a timeout, whose failures are sentences rather than stacks. */
const probe = async (url, options = {}, timeoutMs = 15000) => {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, { ...options, signal: controller?.signal });
    const text = await response.text().catch(() => '');
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      // Providers answer HTML for some failures; `text` is then the best explanation available.
    }
    return { ok: response.ok, status: response.status, payload, text };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: null,
      text: controller?.signal.aborted
        ? `The provider did not answer within ${Math.round(timeoutMs / 1000)} seconds.`
        : (error instanceof Error ? error.message : 'unknown network error'),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** The first readable sentence in whatever a provider returned. */
const firstMessage = (result, fallback) => {
  const candidates = [
    result.payload?.error?.message, result.payload?.error, result.payload?.message,
    result.payload?.errors?.[0]?.message,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  if (result.status === 0) return result.text;
  return result.text?.trim().slice(0, 300) || fallback;
};

const providerName = (provider) => (provider === 'openai' ? 'OpenAI' : 'Google Gemini');

/** `POST /api/integrations/ai/test` — proves the key works, and that the chosen model exists. */
export const testAiConnection = async (config) => {
  if (!config.api_key) {
    return { ok: false, error: `No ${providerName(config.provider)} API key is stored yet. Save one, then test it.` };
  }

  if (config.provider === 'openai') {
    const result = await probe('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${config.api_key}` },
    });
    if (!result.ok) {
      return { ok: false, error: `${providerName(config.provider)} rejected the key: ${firstMessage(result, `HTTP ${result.status}`)}` };
    }
    const models = Array.isArray(result.payload?.data)
      ? result.payload.data.map((entry) => String(entry?.id || '')).filter(Boolean)
      : [];
    if (config.model && models.length && !models.includes(config.model)) {
      return {
        ok: false,
        error: `The key works, but this account cannot use the model "${config.model}". Available: ${models.slice(0, 12).join(', ')}${models.length > 12 ? '…' : ''}.`,
      };
    }
    return {
      ok: true,
      message: `OpenAI accepted the key${config.model ? ` and lists ${config.model}` : `; it can see ${models.length} models`}.`,
    };
  }

  const result = await probe(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(config.api_key)}`);
  if (!result.ok) {
    return { ok: false, error: `${providerName(config.provider)} rejected the key: ${firstMessage(result, `HTTP ${result.status}`)}` };
  }
  const models = Array.isArray(result.payload?.models)
    ? result.payload.models.map((entry) => String(entry?.name || '').replace(/^models\//, '')).filter(Boolean)
    : [];
  if (config.model && models.length && !models.includes(config.model)) {
    return {
      ok: false,
      error: `The key works, but it cannot use "${config.model}". Available: ${models.slice(0, 8).join(', ')}${models.length > 8 ? '…' : ''}.`,
    };
  }
  return {
    ok: true,
    message: `Google accepted the key${config.model ? ` and lists ${config.model}` : `; it can see ${models.length} models`}.`,
  };
};

/**
 * `POST /api/integrations/email/test` — sends one message through the saved configuration.
 *
 * The message body names the site, so the administrator who receives it later can tell which one it
 * came from and that it was a test rather than a lost notification.
 */
export const sendTestEmail = async (config, { to, siteTitle = 'this site' }) => {
  const recipient = String(to || '').trim();
  const from = config.from_email
    ? (config.from_name ? `${config.from_name} <${config.from_email}>` : config.from_email)
    : '';
  if (!config.from_email) {
    return { ok: false, error: 'Set the From address first: a receiving server refuses mail with no sender.' };
  }
  if (!isEmailConfigured(config)) {
    return {
      ok: false,
      error: config.provider === 'smtp'
        ? 'This SMTP configuration is incomplete: a host, a username and a password are all required.'
        : `Save a ${config.provider === 'resend' ? 'Resend' : 'SendGrid'} API key first.`,
    };
  }
  if (!recipient.includes('@')) {
    return { ok: false, error: 'Enter the address the test message should be sent to.' };
  }

  const subject = `${siteTitle}: test email`;
  const text = [
    `This is a test message from ${siteTitle}.`,
    '',
    `It was sent through ${config.provider === 'smtp' ? 'your SMTP server' : config.provider === 'resend' ? 'Resend' : 'SendGrid'} from the Integrations screen in the admin.`,
    'If you are reading it, outgoing mail works.',
  ].join('\n');

  if (config.provider === 'resend') {
    const result = await probe('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [recipient], subject, text }),
    });
    if (!result.ok) return { ok: false, error: `Resend refused the message: ${firstMessage(result, `HTTP ${result.status}`)}` };
    return { ok: true, message: `Resend accepted the message for ${recipient} (id ${result.payload?.id || 'unknown'}).` };
  }

  if (config.provider === 'sendgrid') {
    const result = await probe('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: recipient }] }],
        from: config.from_name
          ? { email: config.from_email, name: config.from_name }
          : { email: config.from_email },
        subject,
        content: [{ type: 'text/plain', value: text }],
      }),
    });
    if (!result.ok) return { ok: false, error: `SendGrid refused the message: ${firstMessage(result, `HTTP ${result.status}`)}` };
    return { ok: true, message: `SendGrid accepted the message for ${recipient}.` };
  }

  // SMTP. nodemailer is a dependency of this project, but it needs a Node runtime and a real socket,
  // so it is imported here rather than at the top of the file: an edge or worker deployment has to be
  // able to answer with this sentence instead of failing to load the whole module.
  let nodemailer;
  try {
    nodemailer = await import('nodemailer');
  } catch (error) {
    return {
      ok: false,
      error: `This host cannot send SMTP mail (${error instanceof Error ? error.message : 'nodemailer is unavailable'}). Use Resend or SendGrid here, or run the Node server.`,
    };
  }
  try {
    const transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.username, pass: config.smtp.password },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
    });
    const info = await transport.sendMail({ from, to: recipient, subject, text });
    return {
      ok: true,
      message: `The SMTP server accepted the message for ${recipient} (${info?.response || info?.messageId || 'accepted'}).`,
    };
  } catch (error) {
    return {
      ok: false,
      error: `The SMTP server refused the message: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
};
