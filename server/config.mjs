import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dataDirectory = path.resolve(process.env.REACT_WP_DATA_DIR || 'data');
const configPath = path.join(dataDirectory, 'react-wp-config.json');

export async function readConfig() {
  try {
    return JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeConfig(config) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryPath = `${configPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, configPath);
}

export function publicConfig(config) {
  if (!config) return null;
  return {
    installed: config.installed === true,
    supabaseUrl: config.supabaseUrl,
    supabasePublishableKey: config.supabasePublishableKey,
  };
}

