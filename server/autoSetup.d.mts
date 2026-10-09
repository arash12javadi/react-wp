/**
 * Types for `server/autoSetup.mjs` — boot-time site setup for both engines: the classic `server.mjs`,
 * and the universal Hono app (`src/server/config.ts`, `src/server/routes/plugins.ts`,
 * `src/server/adapters/node.ts`).
 *
 * The implementation is plain ESM so the two engines run the identical rule; this declaration is what
 * lets the type-checked Hono modules call it. The config shape is `RuntimeConfig`'s, but a structural
 * subset is declared here rather than imported from `src/lib/runtime`, because a Vercel function bundles
 * this module on its own — the same reason `supabase/schema.sql` is inlined into that bundle.
 */

/** The tag every line this module logs carries. */
export const AUTO_SETUP_LOG: string;

/** The environment this process can see: real variables, completed by `.env.local`/`.env`. */
export function autoSetupEnv(): Record<string, string | undefined>;

/** The config the environment describes, from the same variable names as the browser's copy. */
export interface AutoSetupConfig {
  installed: boolean;
  dbType: 'supabase' | 'postgres' | 'mysql' | 'sqlite' | 'libsql';
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  databaseUrl?: string;
  sqliteFile?: string;
  dbHost?: string;
  dbName?: string;
  dbUser?: string;
  jwtSecret?: string;
  storage?: 'local' | 's3';
}

export function envDerivedConfig(env?: Record<string, string | undefined>): AutoSetupConfig;

/**
 * True when enough configuration exists to attempt a database connection — the twin of `isConfigured`
 * in `src/lib/runtime.ts`, and this install's definition of "installed".
 */
export function configIsConfigured(config: Partial<AutoSetupConfig> | null | undefined): boolean;

/** The on-disk config, with the environment filling whatever it does not carry. */
export function mergeSiteConfig(
  fileConfig: Partial<AutoSetupConfig> | null | undefined,
  envConfig: Partial<AutoSetupConfig> | null | undefined,
): AutoSetupConfig;

/** How a log line names the site it is about, without ever naming a password. */
export function describeSiteTarget(config: Partial<AutoSetupConfig> | null | undefined): string;

/** The site's config for a request path: cheap, side-effect free, safe per request. */
export function resolveSiteConfig(env?: Record<string, string | undefined> | null): Promise<AutoSetupConfig>;

/** What the direct-SQL repair of `options.installed` reports; `skipped` means no credentials were given. */
export interface InstalledSeedResult {
  status: 'seeded' | 'failed' | 'skipped';
  reason?: string;
}

/** The report `ensureSiteInstalled` resolves with — never a rejection. */
export interface AutoSetupReport {
  installed: boolean;
  configured: boolean;
  /** True when the config file did not already say `installed: true`. */
  repaired: boolean;
  /** The site the report is about, as `describeSiteTarget` names it. */
  target: string;
  seeded: InstalledSeedResult | { status: 'not-requested' };
  wrote: { ok: boolean; reason?: string } | null;
  error?: string;
}

/**
 * Verifies the site on boot and repairs `options.installed` through `seed` and/or
 * `data/react-wp-config.json`, once per process. Never throws; `force: true` runs it again.
 */
export function ensureSiteInstalled(options?: {
  seed?: ((config: AutoSetupConfig) => Promise<InstalledSeedResult | void>) | null;
  env?: Record<string, string | undefined> | null;
  log?: { info?: (message: string) => void; warn?: (message: string) => void; log?: (message: string) => void };
  force?: boolean;
}): Promise<AutoSetupReport>;

/** The healed config, for callers that want the answer rather than the report. */
export function ensureSiteInstalledConfig(options?: Parameters<typeof ensureSiteInstalled>[0]): Promise<AutoSetupConfig>;
