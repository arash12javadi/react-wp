/**
 * Types for `server/integrationConfig.mjs`.
 *
 * The implementation is plain ESM because `server.mjs`, the bundled Hono app and the `api/*`
 * functions all run it (see the header of the implementation for why). `src/server/**` is
 * type-checked, so this declaration is what gives the Hono routes real types without a second copy of
 * the logic — and without turning on `allowJs` for the whole project.
 *
 * The shapes are imported from `src/lib/integrations.ts`, which the settings screen uses too, so a
 * field cannot be renamed on one side of the wire alone.
 */
import type {
  AiConfig,
  AiProvider,
  EmailConfig,
  EmailProvider,
  IntegrationStatus,
  MediaStorageConfig,
  MediaStorageProvider,
} from '../src/lib/integrations';

export type IntegrationConfigRow = Record<string, unknown>;

/** Which credential row held a value, or nothing at all. */
export type IntegrationRows = Record<string, unknown>;

export const AI_CONFIG_KEY: string;
export const MEDIA_STORAGE_CONFIG_KEY: string;
export const EMAIL_CONFIG_KEY: string;
export const GITHUB_CONFIG_KEY: string;
export const INTEGRATION_CONFIG_KEYS: string[];

export const AI_PROVIDERS: AiProvider[];
export const MEDIA_STORAGE_PROVIDERS: MediaStorageProvider[];
export const EMAIL_PROVIDERS: EmailProvider[];

export function emptyAiConfig(): AiConfig;
export function aiConfigFrom(value: unknown): AiConfig;
export function emptyMediaStorageConfig(): MediaStorageConfig;
export function mediaStorageConfigFrom(value: unknown): MediaStorageConfig;
export function emptyEmailConfig(): EmailConfig;
export function emailConfigFrom(value: unknown): EmailConfig;

export function githubTokenFrom(value: unknown): string;
export function githubStatusFrom(value: unknown): {
  configured: boolean;
  tokenConfigured: boolean;
  scopes: string[];
  username: string;
  repository: string;
};
export function isGithubConnectedConfig(value: unknown): boolean;
export function mediaProviderStatus(config: MediaStorageConfig): {
  cloudinaryConfigured: boolean;
  imagekitConfigured: boolean;
  s3Configured: boolean;
};
export function mediaCredentialsFrom(config: MediaStorageConfig): {
  provider: string;
  cloudinary: { cloudName: string; apiKey: string; apiSecret: string; uploadPreset: string };
  imagekit: { urlEndpoint: string; publicKey: string; privateKey: string };
  s3: {
    accessKeyId: string; secretAccessKey: string; bucket: string; region: string;
    endpoint: string; publicBaseUrl: string; forcePathStyle: boolean;
  };
};
export function isEmailConfigured(config: EmailConfig): boolean;

export function describeIntegrations(options: {
  github?: {
    configured?: boolean;
    tokenConfigured?: boolean;
    scopes?: string[];
    username?: string;
    repository?: string;
  };
  ai?: AiConfig;
  media?: MediaStorageConfig;
  email?: EmailConfig;
  credentials?: { readable?: boolean; source?: string; error?: string };
  storage?: string;
}): IntegrationStatus;

export function describeDeleteSupport(media: MediaStorageConfig): {
  cloudinary: boolean;
  imagekit: boolean;
};

export function testAiConnection(config: AiConfig): Promise<{ ok: boolean; message?: string; error?: string }>;
export function sendTestEmail(
  config: EmailConfig,
  options: { to: string; siteTitle?: string },
): Promise<{ ok: boolean; message?: string; error?: string }>;
