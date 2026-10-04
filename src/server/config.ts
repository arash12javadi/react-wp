/**
 * Server-side configuration.
 *
 * Reads `process.env` (and, on a persistent Node host, `data/react-wp-config.json`) into the same
 * `RuntimeConfig` the client and drivers share. Secrets (database password, JWT secret) never leave
 * the server — the public config injected into `index.html` only ever carries `dbType`, `installed`
 * and the publishable Supabase keys.
 */
import { runtimeConfigFromEnv, type RuntimeConfig } from '../lib/runtime';

export function resolveServerConfig(): RuntimeConfig {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return runtimeConfigFromEnv(proc?.env ?? {});
}

interface NodeFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  writeFile(path: string, data: string): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
}

async function nodeModules(): Promise<{ fs: NodeFs; path: { resolve(...parts: string[]): string; join(...parts: string[]): string } }> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  return { fs: fs as unknown as NodeFs, path };
}

const dataDir = (): string =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.REACT_WP_DATA_DIR || 'data';

const configPath = async (): Promise<string> => {
  const { path } = await nodeModules();
  return path.resolve(dataDir(), 'react-wp-config.json');
};

/** Reads `data/react-wp-config.json`, or null when absent. Returns null off Node (serverless). */
export async function readConfigFile(): Promise<Partial<RuntimeConfig> | null> {
  try {
    const { fs } = await nodeModules();
    const raw = await fs.readFile(await configPath(), 'utf8');
    return JSON.parse(raw) as Partial<RuntimeConfig>;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') return null;
    // Non-Node runtimes (edge/serverless) cannot read the filesystem.
    if (code === 'ERR_UNSUPPORTED_ESM_URL_SCHEME' || /Dynamic require|node:fs/.test(String(error))) return null;
    return null;
  }
}

/** Writes the config file atomically (persistent Node hosts only). */
export async function writeConfigFile(config: Partial<RuntimeConfig>): Promise<void> {
  const { fs, path } = await nodeModules();
  const target = path.resolve(dataDir(), 'react-wp-config.json');
  await fs.mkdir(path.resolve(dataDir()), { recursive: true });
  const temp = `${target}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`);
  await fs.rename(temp, target);
}

/** Merges the env-derived config with the on-disk file; the file wins and `installed` is sticky. */
function mergeRuntimeConfig(base: RuntimeConfig, file: Partial<RuntimeConfig> | null): RuntimeConfig {
  const merged: RuntimeConfig = { ...base, ...(file ?? {}) };
  merged.installed = file?.installed === true || base.installed === true;
  return merged;
}

let cachedRuntimeConfig: RuntimeConfig | null = null;

/**
 * The server's resolved runtime config, cached in memory for the life of the process. On a persistent
 * Node host it folds in `data/react-wp-config.json` — the file the Setup Wizard writes in Step 5 — so
 * every API handler shares one config and the disk is not read again on each request.
 */
export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (!cachedRuntimeConfig) {
    cachedRuntimeConfig = mergeRuntimeConfig(resolveServerConfig(), await readConfigFile());
  }
  return cachedRuntimeConfig;
}

/**
 * Re-reads `data/react-wp-config.json` into memory. Call this right after the Setup Wizard provisions
 * a site so the running process serves the new backend immediately, with no server restart.
 */
export async function reloadRuntimeConfig(): Promise<RuntimeConfig> {
  cachedRuntimeConfig = null;
  return getRuntimeConfig();
}

/** The non-secret subset safe to inject into the client bundle. */
export function publicConfig(config: Partial<RuntimeConfig>): Partial<RuntimeConfig> {
  return {
    installed: config.installed === true,
    dbType: config.dbType ?? 'supabase',
    storage: config.storage ?? 'local',
    supabaseUrl: config.supabaseUrl,
    supabasePublishableKey: config.supabasePublishableKey,
  };
}
