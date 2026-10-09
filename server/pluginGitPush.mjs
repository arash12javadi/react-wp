/**
 * Committing plugin files to GitHub from a host whose filesystem is read-only.
 *
 * `server/pluginInstaller.mjs` installs a plugin by writing `plugins/<id>/` to disk, which a
 * serverless deployment cannot do: its filesystem is read-only (`EROFS`). What such a host *can* do
 * is commit the same files to the repository it is built from and let the platform redeploy — which
 * is why the credential here is the stored `github_config` row (Settings → Integrations → GitHub,
 * written by the GitHub card from the personal access token an administrator pastes into it) and never
 * an environment variable: a site's credentials belong to the site, not to whichever host happens to
 * run it this month.
 *
 * The Git Data API is used rather than the Contents API because every file — the plugin folder, the
 * removal of files a previous version left behind, and the edit to `server/plugins.mjs` that
 * registers a plugin's server routes — becomes ONE commit on ONE branch. A half-installed plugin can
 * therefore never be built, and a failure that happens before the last call leaves the branch exactly
 * as it was (blobs, trees and commits are unreachable objects until a ref points at them).
 *
 * The writes that make the commit are counted against GitHub's secondary rate limit — the one that
 * answers a burst of content-generating requests with HTTP 403 — so an upload no longer makes one write
 * per file: the text of a file travels inside the tree call itself, and the writes that remain are made
 * serially, a second apart. See `commitFiles`.
 */
import { InstallError } from './pluginInstaller.mjs';
import { githubTokenFrom } from './integrationConfig.mjs';

const API = 'https://api.github.com';
/** Pinned, as the REST documentation asks: only a versioned response is a tested one. */
const API_VERSION = '2022-11-28';
const TIMEOUT_MS = 30_000;
/** GitHub reads a recursive tree up to 100,000 entries / 7 MB, and reports `truncated` beyond it. */
const MAX_TREE_ENTRIES = 100_000;
/**
 * The pause GitHub asks for between two writes, from "Best practices for using the REST API": requests
 * are made serially rather than concurrently, and "if you are making a large number of `POST`, `PATCH`,
 * `PUT`, or `DELETE` requests, wait at least one second between each request" — because a burst of
 * writes is what its secondary rate limit answers with HTTP 403, whatever the token allows. An upload
 * is not a large number of writes any more (see `commitFiles`), so this costs a couple of seconds.
 */
const WRITE_INTERVAL_MS = 1_000;
/**
 * How long a `retry-after` may be slept through inside one upload. GitHub asks for a minute by default
 * and a host running a request will not sit still for that long, so anything longer is reported to the
 * administrator as a pause to take rather than waited out.
 */
const MAX_PAUSE_MS = 15_000;
/** Attempts one call gets when GitHub answers a secondary rate limit instead of doing the work. */
const RATE_LIMIT_ATTEMPTS = 3;
/** The methods GitHub counts as content-generating requests, and therefore spaces out. */
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
/**
 * How much text may travel inside the tree call. GitHub writes those blobs out itself when an entry
 * carries `content` instead of `sha` ("Create a tree"), so a plugin of source files needs one write
 * call rather than one per file. Past this much the file is uploaded as a blob instead, which keeps the
 * tree request a sensible size — the largest file a plugin may hold is far below this, and the whole
 * point is that a normal plugin never reaches it.
 */
const INLINE_LIMIT = 8 * 1024 * 1024;

/** When the last write finished, so the next one can be spaced away from it. */
let lastWriteAt = 0;

/** `setTimeout` as a promise: the one way to wait that every runtime this module runs on has. */
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Wait out the gap between two writes.
 *
 * The gap is measured from the end of the previous write, so a slow call does not collect a pause on
 * top of the time it already took. Reads are never paced: nothing about a `GET` counts against the
 * content-creation limits, and `readBranch` runs before any write.
 */
async function spaceWrites(method) {
  if (!WRITE_METHODS.has(method)) return;
  const wait = lastWriteAt + WRITE_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
}

/** Remember when the write that just finished finished, for the next `spaceWrites`. */
function wroteAt(method) {
  if (WRITE_METHODS.has(method)) lastWriteAt = Date.now();
}

const asString = (value) => (typeof value === 'string' ? value.trim() : '');
const repositoryPattern = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
/** Git's own ref rules: no spaces, no `~^:?*[\`, no `..`, no leading slash. */
const branchPattern = /^(?!\/)(?!.*\.\.)[^\s~^:?*[\]\\]{1,255}$/;

/**
 * The repository to publish to, taken from the stored `github_config` row.
 *
 * `repository` is what the GitHub card records (`owner/repo`); `owner` and `repo` are accepted as
 * well, so a row written by hand in the SQL editor works too. The token is read through
 * `githubTokenFrom`, the one definition of where it lives (`integrationConfig.mjs`), which also
 * understands the `access_token` an OAuth-era row left behind. Each failure is a 501 that names the
 * screen to fix, because connecting GitHub is the one thing a read-only host cannot work around.
 */
export function githubTargetFrom(value) {
  const row = value && typeof value === 'object' ? value : {};
  const token = githubTokenFrom(row);
  const repository = asString(row.repository)
    || [asString(row.owner), asString(row.repo)].filter(Boolean).join('/');
  const branch = asString(row.branch) || 'main';
  if (!token) {
    throw new InstallError('This site has no GitHub personal access token, so the plugin could not be committed to the repository it is built from. Add one on Settings → Integrations → GitHub, then upload it again.', 501);
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
 * status GitHub answered a moment earlier: 401 (the token was rejected), 403 (missing scope, the
 * primary rate limit, or a secondary one), 404 (no such repository or branch), 422 (GitHub refused
 * the object we sent — its message says why).
 *
 * The three rate limits are answered separately because the fix differs: the primary limit resets at
 * a timestamp GitHub states, a secondary limit asks for a pause in `retry-after`, and a plain 403 on
 * a write is a scope or permission problem in the stored token. A personal access token — what this
 * site stores now, rather than an OAuth app's token — has a far higher ceiling than the OAuth flow
 * had, but its ceiling is not infinite, so a pause is honoured up to `MAX_PAUSE_MS` and reported past
 * that — a host running an upload would kill a 60-second sleep before GitHub had answered it.
 *
 * A call GitHub refuses with a secondary rate limit is sent again, as its documentation asks: after
 * `retry-after` when there is one, backing off further on each attempt, and given up on after
 * `RATE_LIMIT_ATTEMPTS`. Every write is also spaced from the one before it (`spaceWrites`), which is
 * the part that keeps an upload out of that state at all.
 */
async function request(target, method, path, body, attempt = 1) {
  // The pause GitHub asks for between writes lives here rather than at each call site: this is the one
  // function every call goes through, so no write can be made to forget it.
  await spaceWrites(method);
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
  } finally {
    wroteAt(method);
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
    throw new InstallError(`GitHub refused the stored token (HTTP 401: ${detail}). Add a new personal access token on Settings → Integrations → GitHub, then upload the plugin again.`, 501);
  }
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const at = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : 'an unknown time';
    throw new InstallError(`GitHub's API rate limit for this token is exhausted until ${at}. Wait for it to reset, then upload the plugin again.`, 502);
  }
  if (response.status === 429 || (response.status === 403 && /rate limit|abuse/i.test(detail))) {
    // A refusal means GitHub did not do the work, so the same call may be sent again — and GitHub asks
    // for exactly that: honour `retry-after`, wait at least a minute when there is none, then back off
    // further on each attempt. The minute is deliberately not slept through, because the host running
    // this upload would kill the request long before it ended, so a pause that long is reported as the
    // sentence below. Whether it is ever reached is now a question of the second `spaceWrites` puts
    // between two writes, not of the token's ceiling: this is the burst-of-writes 403, not an exhausted
    // quota.
    const retryAfter = Number(response.headers.get('retry-after'));
    const asked = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000;
    if (attempt < RATE_LIMIT_ATTEMPTS && asked * attempt <= MAX_PAUSE_MS) {
      await sleep(asked * attempt);
      return request(target, method, path, body, attempt + 1);
    }
    const pause = Number.isFinite(retryAfter) && retryAfter > 0
      ? ` GitHub asks for a pause of ${retryAfter} second${retryAfter === 1 ? '' : 's'} before the next call.`
      : '';
    throw new InstallError(`GitHub is rate-limiting this site's API calls (HTTP ${response.status}: ${detail}).${pause} Upload the plugin again once it has calmed down; the token raises this ceiling but does not remove it.`, 502);
  }
  if (response.status === 403) {
    throw new InstallError(`GitHub refused the change to ${where} (HTTP 403: ${detail}). The stored personal access token needs the "repo" scope (or, as a fine-grained token, Contents: Read and write on this repository), and the account it belongs to needs write access to it.`, 403);
  }
  if (response.status === 404) {
    throw new InstallError(`GitHub could not find ${where} on branch "${target.branch}" (HTTP 404: ${detail}). Check the repository and branch on Settings → Integrations → GitHub — a private repository the token cannot see answers the same way.`, 501);
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
 * The text of a file that may travel inside the tree call, or `null` when it has to be a blob.
 *
 * A tree entry carries either `sha` or `content`, and GitHub writes the content out as the blob — but
 * `content` is a JSON string, so only text can go that way and the test is the strictest one there is:
 * the bytes have to be UTF-8 and survive the round trip unchanged. `fatal` refuses anything that is not
 * valid UTF-8 (an image, a font, a ZIP inside the ZIP), and `ignoreBOM` keeps a byte order mark in the
 * text instead of quietly dropping it, which is what a file that has one needs. An empty file goes up
 * as a blob: an empty string is not something to hand an API that asks for "either this, or `tree.sha`".
 */
function inlineText(bytes) {
  if (bytes.byteLength === 0) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return text.includes('\u0000') ? null : text;
  } catch {
    return null;
  }
}

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
 * The text of a file is not uploaded as a blob at all: it goes into the tree call itself, so a plugin of
 * source files is three writes (a tree, a commit, a ref update) instead of one per file. Only a file
 * that is not text, an empty one, or one past `INLINE_LIMIT` is uploaded as a blob first, one call at a
 * time, spaced by `request`.
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

  const writes = files.map((file) => ({
    path: file.path,
    mode: base.paths.get(file.path)?.mode ?? '100644',
    content: file.content,
  }));

  // A file's text rides along in the tree call itself — GitHub writes those blobs out for us — so a
  // plugin of source files costs three writes (a tree, a commit, a ref update) instead of one per file.
  // Only what GitHub cannot be given as text that way becomes a blob of its own: an image, a font, a ZIP
  // inside the ZIP, an empty file, or a file past `INLINE_LIMIT`. Those go up one call at a time, spaced
  // by `request`, which is the serial pacing GitHub asks of writes. One call per file, fired together,
  // was a burst of content-generating requests, and a burst is what the secondary rate limit answers
  // with HTTP 403 — which is what this shape exists to stop happening.
  let inlined = [];
  let inlinedWrites = [];
  const blobbed = [];
  let inlineBytes = 0;
  for (const write of writes) {
    const text = inlineText(write.content);
    if (text === null || inlineBytes + write.content.byteLength > INLINE_LIMIT) {
      blobbed.push(write);
      continue;
    }
    inlineBytes += write.content.byteLength;
    inlinedWrites.push(write);
    inlined.push({ path: write.path, mode: write.mode, type: 'blob', content: text });
  }

  let staged = await uploadBlobs(target, blobbed);
  const removed = deletions.map((path) => ({ path, mode: base.paths.get(path)?.mode ?? '100644', type: 'blob', sha: null }));

  let treeSha;
  let removals = removed;
  let droppedDeletions = false;
  for (;;) {
    try {
      treeSha = await createTree(target, base.treeSha, [...inlined, ...staged, ...removals]);
      break;
    } catch (error) {
      // Two refusals a tree can be answered with, and each leaves a set of entries that still installs
      // the plugin. Dropping a deletion GitHub will not take (`sha: null`) comes first, because it costs
      // one call where the alternative — a blob for every text file in the plugin, a second apart —
      // costs one per file; the previous version's extra files then stay on the branch, which the
      // caller reports as a warning once this commit is known to have been made without them.
      if (!(error instanceof InstallError) || error.status !== 502 || !/422/.test(error.message)) throw error;
      if (removals.length) {
        removals = [];
        droppedDeletions = true;
        continue;
      }
      if (inlined.length) {
        staged = [...staged, ...await uploadBlobs(target, inlinedWrites)];
        inlined = [];
        inlinedWrites = [];
        continue;
      }
      throw error;
    }
  }
  const deletionsSkipped = droppedDeletions ? deletions : [];

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
    files: writes.length,
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
 * One `POST /git/blobs` per file, one file at a time.
 *
 * GitHub asks for serial writes rather than a burst — "make requests serially instead of concurrently"
 * — so this is a plain loop and not a `Promise.all`, and `request` is what puts the second between one
 * call and the next. Nothing here is published: a blob is an unreachable object until a tree names it
 * and a commit points at that tree, which is why a file can be uploaded twice (the fallback in
 * `commitFiles`) without leaving anything behind.
 */
async function uploadBlobs(target, writes) {
  const entries = [];
  for (const write of writes) {
    const blob = await request(target, 'POST', `/repos/${target.owner}/${target.repo}/git/blobs`, {
      content: encodeBase64(write.content),
      encoding: 'base64',
    });
    const sha = asString(blob?.sha);
    if (!sha) throw new InstallError(`GitHub stored ${write.path} but returned no object id for it. Nothing was committed.`, 502);
    entries.push({ path: write.path, mode: write.mode, type: 'blob', sha });
  }
  return entries;
}
