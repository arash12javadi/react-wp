/**
 * In-memory ZIP plugin installer for read-only serverless/edge deployments.
 *
 * A serverless filesystem is read-only (`EROFS`), so the classic self-hosted installer
 * (`server/pluginInstaller.mjs`) cannot write `plugins/<id>/`. This route instead:
 *
 *   1. Accepts an uploaded `.zip` plugin package in memory (multipart `file` or raw body).
 *   2. Unzips it in memory with `fflate` (no temp files).
 *   3. Reads the GitHub token, repository and Vercel deploy hook from the `options` table.
 *   4. Commits the unzipped files into `src/plugins/<plugin-name>/` on the remote repository
 *      using the GitHub Git Data API (the fetch-based equivalent of `@octokit/rest`).
 *   5. Triggers the Vercel deploy hook to rebuild and redeploy.
 */
import { Hono, type Context } from 'hono';
import { unzipSync } from 'fflate';
import { getRuntimeConfig } from '../config';
import { createServerDbAdapter } from '../../lib/db/index';
import { createServerAuthAdapter } from '../../lib/auth/index';
import { hasCapability, type Capability, type UserRole } from '../../lib/roles';

export const pluginsRouter = new Hono();

const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const pluginIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ignoredEntries = [/^__MACOSX\//, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/];

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

interface GithubRepo {
  owner: string;
  repo: string;
  branch?: string;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A pure-JS base64 encoder (no Buffer, no call-stack limits on large files). */
function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64[b0 >> 2];
    out += BASE64[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? '=' : BASE64[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : BASE64[b2 & 63];
  }
  return out;
}

/** Rejects anyone without the `activate_plugins` (or `manage_options`) capability. */
async function requirePluginManager(token: string): Promise<void> {
  if (!token) throw new HttpError(401, 'Sign in required.');
  const config = await getRuntimeConfig();
  const db = await createServerDbAdapter(config);
  try {
    const auth = await createServerAuthAdapter(config, db);
    const user = await auth.authenticate(token);
    const role = user?.role;
    const allowed = role && (hasCapability(role as UserRole, 'activate_plugins' as Capability) || hasCapability(role as UserRole, 'manage_options' as Capability));
    if (!allowed) throw new HttpError(403, 'This action requires the activate_plugins capability.');
  } finally {
    await db.close().catch(() => undefined);
  }
}

/** A thin `fetch` wrapper over the GitHub REST API. */
async function github(token: string, repo: GithubRepo, path: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new HttpError(502, `GitHub API ${method} ${path} failed (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }
  return (await response.json()) as Record<string, unknown>;
}


/** Commits `files` into the repository in a single atomic commit. */
async function commitToGithub(token: string, repo: GithubRepo, message: string, files: Array<{ path: string; content: Uint8Array }>): Promise<void> {
  let branch = repo.branch || 'main';

  let baseSha: string;
  try {
    const ref = await github(token, repo, `/repos/${repo.owner}/${repo.repo}/git/ref/heads/${branch}`, 'GET');
    baseSha = String((ref.object as { sha?: string })?.sha ?? '');
  } catch {
    const info = await github(token, repo, `/repos/${repo.owner}/${repo.repo}`, 'GET');
    branch = String(info.default_branch || 'main');
    const ref = await github(token, repo, `/repos/${repo.owner}/${repo.repo}/git/ref/heads/${branch}`, 'GET');
    baseSha = String((ref.object as { sha?: string })?.sha ?? '');
  }
  if (!baseSha) throw new HttpError(502, 'Could not determine the repository base commit.');

  const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const file of files) {
    const blob = await github(token, repo, `/repos/${repo.owner}/${repo.repo}/git/blobs`, 'POST', {
      content: bytesToBase64(file.content),
      encoding: 'base64',
    });
    treeItems.push({ path: file.path, mode: '100644', type: 'blob', sha: String(blob.sha ?? '') });
  }
  const tree = await github(token, repo, `/repos/${repo.owner}/${repo.repo}/git/trees`, 'POST', {
    base_tree: baseSha,
    tree: treeItems,
  });

  const commit = await github(token, repo, `/repos/${repo.owner}/${repo.repo}/git/commits`, 'POST', {
    message,
    tree: String(tree.sha ?? ''),
    parents: [baseSha],
  });
  await github(token, repo, `/repos/${repo.owner}/${repo.repo}/git/refs/heads/${branch}`, 'PATCH', {
    sha: String(commit.sha ?? ''),
    force: false,
  });
}

async function triggerDeployHook(hookUrl: string): Promise<{ configured: true; triggered: boolean; status?: number; error?: string }> {
  try {
    const response = await fetch(hookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return { configured: true, triggered: response.ok, status: response.status };
  } catch (error) {
    return { configured: true, triggered: false, error: error instanceof Error ? error.message : String(error) };
  }
}


pluginsRouter.post('/upload-zip', async (c: Context) => {
  try {
    const token = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
    await requirePluginManager(token);

    const config = await getRuntimeConfig();
    if (!config.installed) throw new HttpError(409, 'This site is not installed yet.');

    let bytes: Uint8Array | null = null;
    const contentType = c.req.header('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const body = await c.req.parseBody();
      const file = body.file;
      if (file instanceof File) {
        bytes = new Uint8Array(await file.arrayBuffer());
      } else if (typeof file === 'string' && file) {
        const match = /^data:.*?;base64,([\s\S]*)$/.exec(file);
        if (match) bytes = Uint8Array.from(atob(match[1]), (ch) => ch.charCodeAt(0));
      }
    } else {
      bytes = new Uint8Array(await c.req.raw.arrayBuffer());
    }
    if (!bytes || bytes.length === 0) throw new HttpError(400, 'A .zip plugin package is required.');
    if (bytes.length > MAX_ZIP_BYTES) throw new HttpError(413, 'The plugin ZIP exceeds the 25 MB limit.');

    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes);
    } catch {
      throw new HttpError(400, 'The uploaded file is not a valid ZIP archive.');
    }

    const manifestPath = Object.keys(entries).find((p) => p.split('/').pop() === 'manifest.json');
    if (!manifestPath) throw new HttpError(400, 'No manifest.json was found in the ZIP.');
    const base = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);

    let manifest: { id?: string; name?: string; version?: string };
    try {
      manifest = JSON.parse(new TextDecoder().decode(entries[manifestPath]));
    } catch {
      throw new HttpError(400, 'manifest.json is not valid JSON.');
    }
    const pluginId = typeof manifest.id === 'string' ? manifest.id : '';
    if (!pluginId || !pluginIdPattern.test(pluginId)) throw new HttpError(400, 'manifest.json must declare a valid lowercase-hyphenated id.');
    if (!entries[`${base}index.tsx`]) throw new HttpError(400, `index.tsx is missing next to manifest.json (expected at ${base}index.tsx).`);

    const db = await createServerDbAdapter(config);
    const githubToken = await db.getOption<string>('github_api_token');
    const repoRaw = await db.getOption<GithubRepo>('github_repo');
    const deployHook = await db.getOption<string>('vercel_deploy_hook');
    await db.close().catch(() => undefined);

    if (!githubToken) throw new HttpError(501, 'A GitHub token is not configured. Set the github_api_token option (Settings → Plugins).');
    const repo: GithubRepo = { owner: repoRaw?.owner ?? '', repo: repoRaw?.repo ?? '', branch: repoRaw?.branch };
    if (!repo.owner || !repo.repo) throw new HttpError(501, 'GitHub repository info is not configured. Set the github_repo option ({ owner, repo, branch }).');

    const files = Object.keys(entries)
      .filter((p) => p.startsWith(base))
      .filter((p) => !p.endsWith('/'))
      .filter((p) => !ignoredEntries.some((re) => re.test(p)))
      .map((p) => ({ path: `src/plugins/${pluginId}/${p.slice(base.length)}`, content: entries[p] }))
      .filter((f) => f.path.split('/').pop() !== '');

    await commitToGithub(githubToken, repo, `Install plugin ${pluginId}`, files);

    const deploy = deployHook ? await triggerDeployHook(deployHook) : { configured: false, triggered: false };

    return c.json({
      success: true,
      plugin: { id: pluginId, name: manifest.name ?? pluginId, version: manifest.version ?? '1.0.0', folder: pluginId },
      files: files.length,
      deploy,
    });
  } catch (error) {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status as 400);
    const message = error instanceof Error ? error.message : 'Plugin upload failed.';
    return c.json({ error: message }, 500);
  }
});


