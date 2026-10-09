/**
 * Committing plugin files to GitHub from a host whose filesystem is read-only.
 *
 * `server/pluginInstaller.mjs` installs a plugin by writing `plugins/<id>/` to disk, which a
 * serverless deployment cannot do: its filesystem is read-only (`EROFS`). What such a host *can* do
 * is commit the same files to the repository it is built from and let the platform redeploy — which
 * is why the credential here is the stored `github_config` row (Settings → Integrations → GitHub,
 * written by `githubOAuth.mjs`) and never an environment variable: a site's credentials belong to
 * the site, not to whichever host happens to run it this month.
 *
 * The Git Data API is used rather than the Contents API because every file — the plugin folder, the
 * removal of files a previous version left behind, and the edit to `server/plugins.mjs` that
 * registers a plugin's server routes — becomes ONE commit on ONE branch. A half-installed plugin can
 * therefore never be built, and a failure that happens before the last call leaves the branch exactly
 * as it was (blobs, trees and commits are unreachable objects until a ref points at them).
 */
import { InstallError } from './pluginInstaller.mjs';

const API = 'https://api.github.com';
/** Pinned, as the REST documentation asks: only a versioned response is a tested one. */
const API_VERSION = '2022-11-28';
const TIMEOUT_MS = 30_000;
/** Blobs go up a few at a time: enough to hide the round-trip latency, gentle on the rate limit. */
const BLOB_CONCURRENCY = 6;
/** GitHub reads a recursive tree up to 100,000 entries / 7 MB, and reports `truncated` beyond it. */
const MAX_TREE_ENTRIES = 100_000;

const asString = (value) => (typeof value === 'string' ? value.trim() : '');
const repositoryPattern = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
/** Git's own ref rules: no spaces, no `~^:?*[\`, no `..`, no leading slash. */
const branchPattern = /^(?!\/)(?!.*\.\.)[^\s~^:?*[\]\\]{1,255}$/;

/**
 * The repository to publish to, taken from the stored `github_config` row.
 *
 * `repository` is what the GitHub card records (`owner/repo`); `owner` and `repo` are accepted as
 * well, so a row written by hand in the SQL editor works too. Each failure is a 501 that names the
 * screen to fix, because connecting GitHub is the one thing a read-only host cannot work around.
 */
export function githubTargetFrom(value) {
  const row = value && typeof value === 'object' ? value : {};
  const token = asString(row.access_token);
  const repository = asString(row.repository)
    || [asString(row.owner), asString(row.repo)].filter(Boolean).join('/');
  const branch = asString(row.branch) || 'main';
  if (!token) {
    throw new InstallError('This site has no GitHub connection, so the plugin could not be committed to the repository it is built from. Connect GitHub on Settings → Integrations → GitHub, then upload it again.', 501);
  }
  if (!repositoryPattern.test(repository)) {
    throw new InstallError('The GitHub connection has no repository to publish to. Choose one on Settings → Integrations → GitHub, then upload the plugin again.', 501);
  }
  if (!branchPattern.test(branch)) {
    throw new InstallError(`The GitHub connection names "${branch}" as its branch, which Git does not accept as a branch name. Fix it on Settings → Integrations → GitHub.`, 501);
  }
  const [owner, repo] = repository.split('/');
  return { token, owner, repo, repository, branch };
}

/**
 * One GitHub REST call, with the failure sentences an administrator can act on.
 *
 * GitHub's status is passed through to `InstallError`, so the upload route answers with the same
 * status GitHub answered a moment earlier: 401 (reconnect), 403 (missing scope, or the rate limit),
 * 404 (no such repository or branch), 422 (GitHub refused the object we sent — its message says why).
 */
async function request(target, method, path, body) {
  const where = `${target.owner}/${target.repo}`;
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${target.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        'Content-Type': 'application/json',
        'User-Agent': 'react-wp-plugin-upload',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new InstallError(`GitHub could not be reached (${error?.name === 'TimeoutError' ? 'no response within 30 seconds' : error?.message || 'network error'}). Nothing was committed; try again.`, 502);
  }
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (response.ok) return payload;
  const detail = asString(payload?.message) || text.slice(0, 200).trim() || `HTTP ${response.status}`;
  if (response.status === 401) {
    throw new InstallError(`GitHub refused the stored token (HTTP 401: ${detail}). Reconnect GitHub on Settings → Integrations → GitHub, then upload the plugin again.`, 501);
  }
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const at = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : 'an unknown time';
    throw new InstallError(`GitHub's API rate limit for this token is exhausted until ${at}. Wait for it to reset, then upload the plugin again.`, 502);
  }
  if (response.status === 403) {
    throw new InstallError(`GitHub refused the change to ${where} (HTTP 403: ${detail}). The GitHub connection needs the "repo" scope, and the connected account needs write access to that repository.`, 403);
  }
  if (response.status === 404) {
    throw new InstallError(`GitHub could not find ${where} on branch "${target.branch}" (HTTP 404: ${detail}). Check the repository and branch on Settings → Integrations → GitHub — a private repository the connected account cannot see answers the same way.`, 501);
  }
  if (response.status === 409 || response.status === 422) {
    throw new InstallError(`GitHub refused the change to ${where} (HTTP ${response.status}: ${detail}).`, 502);
  }
  throw new InstallError(`GitHub answered HTTP ${response.status} for ${where}: ${detail}`, 502);
}

/** Base64 for blob uploads; `Buffer` where there is one, a small loop where there is not. */
function encodeBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : undefined;
    const c = index + 2 < bytes.length ? bytes[index + 2] : undefined;
    out += alphabet[a >> 2];
    out += alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : alphabet[c & 63];
  }
  return out;
}

/** Base64 back to bytes, for the files this module has to read before it can rewrite them. */
function decodeBase64(text) {
  const clean = text.replace(/\s/g, '');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(clean, 'base64'));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = [];
  for (let index = 0; index < clean.length; index += 4) {
    const chunk = [0, 1, 2, 3].map((offset) => alphabet.indexOf(clean[index + offset] ?? '='));
    bytes.push((chunk[0] << 2) | (chunk[1] >> 4));
    if (chunk[2] >= 0) bytes.push(((chunk[1] & 15) << 4) | (chunk[2] >> 2));
    if (chunk[3] >= 0) bytes.push(((chunk[2] & 3) << 6) | chunk[3]);
  }
  return new Uint8Array(bytes);
}

/** A tree entry's mode as a string: GitHub answers with a string, and a hand-built entry uses one. */
const modeOf = (entry) => (entry?.mode === '100755' ? '100755' : '100644');

/**
 * What the branch looks like right now: its head commit, its tree, and every path in it.
 *
 * The whole tree is read before anything is written because two decisions depend on it: which files
 * a previous version of the plugin left behind (they are deleted in the same commit), and whether
 * this upload replaces a folder that is already there. A `truncated` tree cannot be trusted for
 * either, so it is refused rather than guessed at.
 */
export async function readBranch(target) {
  const branch = await request(target, 'GET', `/repos/${target.owner}/${target.repo}/branches/${encodeURIComponent(target.branch)}`);
  const commitSha = asString(branch?.commit?.sha);
  const treeSha = asString(branch?.commit?.commit?.tree?.sha);
  if (!commitSha || !treeSha) {
    throw new InstallError(`GitHub returned no commit for branch "${target.branch}" of ${target.owner}/${target.repo}, so there is nothing to commit against.`, 502);
  }
  const tree = await request(target, 'GET', `/repos/${target.owner}/${target.repo}/git/trees/${treeSha}?recursive=1`);
  const entries = Array.isArray(tree?.tree) ? tree.tree : [];
  if (tree?.truncated === true || entries.length > MAX_TREE_ENTRIES) {
    throw new InstallError(`The repository ${target.owner}/${target.repo} has more files than GitHub will list in one response, so a plugin cannot be installed into it safely from here. Install plugins from a checkout of the repository instead.`, 501);
  }
  const paths = new Map();
  for (const entry of entries) {
    const path = asString(entry?.path);
    if (path && entry?.type === 'blob') paths.set(path, { sha: asString(entry.sha), mode: modeOf(entry) });
  }
  return { commitSha, treeSha, paths };
}

/** The current text of one file on the branch, or `null` when the branch has no such file. */
export async function readTextFile(target, path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  let payload;
  try {
    payload = await request(target, 'GET', `/repos/${target.owner}/${target.repo}/contents/${encoded}?ref=${encodeURIComponent(target.branch)}`);
  } catch (error) {
    if (error instanceof InstallError && error.status === 501 && /\b404\b/.test(error.message)) return null;
    throw error;
  }
  if (!payload?.content) return null;
  return new TextDecoder().decode(decodeBase64(payload.content));
}

/**
 * Every path this module is willing to write, so no caller can commit outside the plugin root.
 *
 * `plugins/<folder>/<file>` is the build contract (`plugins/README.md`: Vite discovers plugin entry
 * points one level below `plugins/`); `allowPaths` covers the few shared files an install has to
 * touch, named explicitly by the caller. Anything else — an absolute path, a `..` segment, a stray
 * file at the repository root — is refused before a byte reaches GitHub.
 */
function assertWritable(path, allowPaths) {
  if (typeof path !== 'string' || !path) throw new InstallError('A plugin file had no path.', 502);
  if (!allowPaths.includes(path) && !/^plugins\/[^/]+\/.+$/.test(path)) {
    throw new InstallError(`Refusing to commit "${path}": a plugin upload may only write inside plugins/<folder>/${allowPaths.length ? `, plus ${allowPaths.join(' and ')}` : ''}.`, 500);
  }
  if (path.startsWith('/') || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new InstallError(`Refusing to commit "${path}": it does not name a file inside the repository.`, 500);
  }
}

/**
 * Commit every file at once, deleting what a previous version left behind.
 *
 * Order matters, and is the reason this is one function: blobs are written first (they are inert),
 * then the tree that names them, then the commit that points at the tree, and only the last call —
 * moving the branch — publishes any of it. GitHub builds the new tree from `base_tree` plus these
 * entries, and the entries carry full paths (`plugins/acme-shop/index.tsx`): GitHub creates the
 * intermediate trees itself, which is what lets a first install be a single commit.
 */
export async function commitFiles(target, options) {
  const { message, files, base, deletions = [], allowPaths = [] } = options;
  for (const file of files) assertWritable(file.path, allowPaths);
  for (const path of deletions) assertWritable(path, allowPaths);
  const where = `${target.owner}/${target.repo}@${target.branch}`;

  const shas = await mapWithConcurrency(files, BLOB_CONCURRENCY, async (file) => {
    const blob = await request(target, 'POST', `/repos/${target.owner}/${target.repo}/git/blobs`, {
      content: encodeBase64(file.content),
      encoding: 'base64',
    });
    const sha = asString(blob?.sha);
    if (!sha) throw new InstallError(`GitHub stored ${file.path} but returned no object id for it. Nothing was committed.`, 502);
    return sha;
  });

  const written = files.map((file, index) => ({
    path: file.path,
    mode: base.paths.get(file.path)?.mode ?? '100644',
    type: 'blob',
    sha: shas[index],
  }));
  const removed = deletions.map((path) => ({ path, mode: base.paths.get(path)?.mode ?? '100644', type: 'blob', sha: null }));

  let treeSha;
  let deletionsSkipped = [];
  try {
    treeSha = await createTree(target, base.treeSha, [...written, ...removed]);
  } catch (error) {
    // A GitHub that refuses `sha: null` still installs the plugin correctly; it only leaves the
    // previous version's extra files behind, which the caller reports as a warning.
    if (!removed.length || !(error instanceof InstallError) || error.status !== 502 || !/422/.test(error.message)) throw error;
    deletionsSkipped = deletions;
    treeSha = await createTree(target, base.treeSha, written);
  }

  const commit = await request(target, 'POST', `/repos/${target.owner}/${target.repo}/git/commits`, {
    message,
    tree: treeSha,
    parents: [base.commitSha],
  });
  const sha = asString(commit?.sha);
  if (!sha) throw new InstallError('GitHub created the commit but returned no id for it. The branch was not moved; try again.', 502);

  await request(target, 'PATCH', `/repos/${target.owner}/${target.repo}/git/refs/heads/${encodeURIComponent(target.branch)}`, {
    sha,
    force: false,
  });

  return {
    sha,
    url: asString(commit?.html_url) || `https://github.com/${target.owner}/${target.repo}/commit/${sha}`,
    repository: where,
    files: written.length,
    deletions: removed.length - deletionsSkipped.length,
    deletionsSkipped,
  };
}

/** `POST /git/trees`, with the refusal GitHub deserves when a tree cannot be built. */
async function createTree(target, baseTree, entries) {
  const payload = await request(target, 'POST', `/repos/${target.owner}/${target.repo}/git/trees`, {
    base_tree: baseTree,
    tree: entries,
  });
  const sha = asString(payload?.sha);
  if (!sha) throw new InstallError('GitHub built the file tree but returned no id for it. Nothing was committed.', 502);
  return sha;
}

/**
 * `Promise.all` with a ceiling: a plugin with two hundred files must not open two hundred
 * connections, and the results have to come back in the order they were asked for.
 */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let index = next; index < items.length; index += 1) {
      results[index] = await worker(items[index], index);
      next = index + 1;
    }
  });
  await Promise.all(runners);
  return results;
}
