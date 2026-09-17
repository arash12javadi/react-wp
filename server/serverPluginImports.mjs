/**
 * Adds and removes plugin server imports in server/plugins.mjs.
 *
 * Only the lines between the rwp:server-plugin-imports markers are touched, and only when every
 * line there is a plain import('../plugins/<folder>/server.mjs'), — anything else means the
 * region was edited by hand, and guessing could break the server, so the edit is refused.
 * The new file is syntax-checked with `node --check` before it replaces the old one.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const registryPath = path.resolve('server/plugins.mjs');
const startMarker = '// rwp:server-plugin-imports:start';
const endMarker = '// rwp:server-plugin-imports:end';
const folderPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const importLine = /^(\s*)import\('\.\.\/plugins\/([a-z0-9][a-z0-9-]{0,63})\/server\.mjs'\),\s*$/;

// Serialises edits: two installs finishing together must not overwrite each other's line.
let queue = Promise.resolve();
const serialised = (task) => {
  const result = queue.then(task, task);
  queue = result.catch(() => {});
  return result;
};

function parseRegistry(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => (line.trim() === startMarker ? [index] : []));
  const ends = lines.flatMap((line, index) => (line.trim() === endMarker ? [index] : []));
  if (starts.length !== 1 || ends.length !== 1 || starts[0] > ends[0]) {
    throw new Error(`server/plugins.mjs must contain exactly one "${startMarker}" line followed by one "${endMarker}" line; found ${starts.length} start and ${ends.length} end marker(s). Restore them around the plugin import list.`);
  }
  const [start] = starts;
  const [end] = ends;
  const folders = [];
  let indent = lines[start].match(/^\s*/)[0];
  for (let index = start + 1; index < end; index += 1) {
    if (!lines[index].trim()) continue;
    const match = importLine.exec(lines[index]);
    if (!match) {
      throw new Error(`server/plugins.mjs line ${index + 1} is not a plugin import ("${lines[index].trim()}"). Only lines like import('../plugins/<folder>/server.mjs'), may sit between the rwp:server-plugin-imports markers.`);
    }
    indent = match[1];
    folders.push(match[2]);
  }
  return { newline, lines, start, end, folders, indent };
}

async function writeChecked(source) {
  // Same directory, so the rename is atomic and relative paths mean the same thing.
  const temporary = path.join(path.dirname(registryPath), `.plugins.${randomUUID()}.mjs`);
  await writeFile(temporary, source, 'utf8');
  try {
    await run(process.execPath, ['--check', temporary]);
  } catch (error) {
    await rm(temporary, { force: true });
    throw new Error(`The edited server/plugins.mjs failed a syntax check, so it was not saved: ${String(error?.stderr || error?.message || error).trim()}`);
  }
  try {
    await rename(temporary, registryPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export const readServerPluginImports = async () => parseRegistry(await readFile(registryPath, 'utf8')).folders;

/** Adds import('../plugins/<folder>/server.mjs'). Returns { changed: false } when it is already there. */
export const addServerPluginImport = (folder) => serialised(async () => {
  if (!folderPattern.test(folder)) throw new Error(`Invalid plugin folder name ${JSON.stringify(folder)}.`);
  const source = await readFile(registryPath, 'utf8');
  const registry = parseRegistry(source);
  if (registry.folders.includes(folder)) return { changed: false };
  const lines = [...registry.lines];
  lines.splice(registry.end, 0, `${registry.indent}import('../plugins/${folder}/server.mjs'),`);
  await writeChecked(lines.join(registry.newline));
  return { changed: true };
});

/** Removes the import for <folder>. Returns { changed: false } when there was none. */
export const removeServerPluginImport = (folder) => serialised(async () => {
  if (!folderPattern.test(folder)) throw new Error(`Invalid plugin folder name ${JSON.stringify(folder)}.`);
  const source = await readFile(registryPath, 'utf8');
  const registry = parseRegistry(source);
  if (!registry.folders.includes(folder)) return { changed: false };
  const lines = registry.lines.filter((line, index) => {
    if (index <= registry.start || index >= registry.end) return true;
    return importLine.exec(line)?.[2] !== folder;
  });
  await writeChecked(lines.join(registry.newline));
  return { changed: true };
});
