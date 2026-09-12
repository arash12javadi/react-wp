import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Vite loads .env.local for the client build, but plain `node server.mjs` does not, so
 * server-only secrets put there are silently invisible. This closes that gap without
 * pulling in a dependency. Real environment variables always win.
 */
function loadEnvFiles(files = ['.env.local', '.env']) {
  for (const file of files) {
    let contents;
    try {
      contents = readFileSync(path.resolve(file), 'utf8');
    } catch {
      continue;
    }
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const key = match[1];
      if (process.env[key] !== undefined) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

// Runs on import. server.mjs imports this module first so the values are in place before
// any other module reads process.env at its top level.
loadEnvFiles();
