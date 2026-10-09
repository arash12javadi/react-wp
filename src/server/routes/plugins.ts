/**
 * Plugins → Upload Plugin, on every host that runs the universal engine.
 *
 * Two installers, and the host chooses. `server/pluginInstaller.mjs` writes `plugins/<id>/`, which is the
 * classic path and the right one wherever that folder survives the request. A serverless function's
 * filesystem is read-only (`EROFS`), and a folder only becomes part of the site after a build anyway, so
 * there the work does not disappear, it moves: `server/pluginGitInstaller.mjs` applies the same checks
 * with the same code and then commits the plugin to the repository the deployment is built from, so an
 * upload arrives with the next build instead of failing on a disk that will never be writable. The
 * commit, and the credential it uses, are `server/pluginGitPush.mjs`; the choice itself is
 * `src/server/pluginHostMode.ts`, asked before the body is read.
 *
 * The order below is deliberate. Identity, capability and "is this site installed" are settled first; the
 * GitHub connection is then required of the hosts that need it and of no others; the ZIP is read last, so
 * a 25 MB body is never buffered for a caller who may not upload one, and "connect GitHub first" is a
 * JSON status the dialog can show rather than a sentence buried in a stream. Everything after that point
 * streams NDJSON — one `{ type: 'step' }` per step, carrying the mode it belongs to, then
 * `{ type: 'result' }` or `{ type: 'error' }` — because HTTP has no second status code to give once the
 * answer has started.
 */
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ensureSiteInstalled, getRuntimeConfig } from '../config';
import { detectPluginHostMode, type PluginHostMode } from '../pluginHostMode';
import { createServerDbAdapter } from '../../lib/db/index';
import { createServerAuthAdapter } from '../../lib/auth/index';
import { hasCapability, type Capability, type UserRole } from '../../lib/roles';
import type { RuntimeConfig } from '../../lib/runtime';
import { GITHUB_CONFIG_KEY } from '../../../server/githubOAuth.mjs';
import { readIntegrationRows } from '../../../server/integrationSettings.mjs';
import { githubTargetFrom, type GithubCommitTarget } from '../../../server/pluginGitPush.mjs';
import {
  installPlugin,
  MAX_ZIP_BYTES,
  type PluginInstallSource,
  type PluginInstallStep,
} from '../../../server/pluginInstaller.mjs';
import { installPluginFromGit, type PluginInstallOptionStore } from '../../../server/pluginGitInstaller.mjs';

export const pluginsRouter = new Hono();

/** A refusal that carries the status code to answer with, for the phase before the stream starts. */
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The status a shared module asked for (`InstallError` sets one), when it asked for one. */
const statusOf = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? status : undefined;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error || 'The plugin could not be installed.');

/** `process.env` where there is one, and nothing where there is not (Workers, Deno, Bun). */
const serverEnvironment = (): Record<string, string | undefined> =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * Refuses anyone without `activate_plugins` (or `manage_options`).
 *
 * The same pair the classic route demands and the README documents: this is the button on the Plugins
 * screen, which a role holding either capability can already see. The upload spends the site's GitHub
 * credential, but cannot change where it points: choosing the repository stays a `manage_options`
 * action on Settings → Integrations, where the connection is configured.
 */
async function requirePluginManager(token: string, config: RuntimeConfig): Promise<void> {
  if (!token) throw new HttpError(401, 'Sign in to install a plugin.');
  const db = await createServerDbAdapter(config);
  try {
    const auth = await createServerAuthAdapter(config, db);
    const user = await auth.authenticate(token);
    const role = user?.role as UserRole | undefined;
    if (!role) throw new HttpError(401, 'Your session is not valid. Sign in again.');
    if (!hasCapability(role, 'activate_plugins' as Capability)
      && !hasCapability(role, 'manage_options' as Capability)) {
      throw new HttpError(403, 'Your role cannot install plugins: it does not have the activate_plugins capability.');
    }
  } finally {
    await db.close().catch(() => undefined);
  }
}

/**
 * The repository to publish to, read from the stored `github_config` row.
 *
 * The row is read through `readIntegrationRows` — the same module, with the same options, that serves
 * the Integrations hub — so "which credential source does this deployment have" is answered in one
 * place: the engine's own adapter off Supabase, a direct connection or the service key on it. A row
 * that cannot be read is reported as exactly that: advising the administrator to connect GitHub again
 * would be advice about a connection that already exists.
 */
async function githubTarget(config: RuntimeConfig): Promise<GithubCommitTarget> {
  const rows = await readIntegrationRows([GITHUB_CONFIG_KEY], {
    // Supabase is deliberately left without an injected reader: its adapter speaks the publishable key,
    // which RLS does not let near `system_settings`, so the shared module opens a direct connection
    // rather than reporting a connection that is stored but unreadable.
    readSetting: config.dbType !== 'supabase'
      ? async (key: string) => {
        // One adapter per read, closed again — the hub's reader does the same: this is not a per-request
        // path, and a handle held open is a handle to leak.
        const db = await createServerDbAdapter(config);
        try {
          return await db.getSystemSetting(key);
        } finally {
          await db.close().catch(() => undefined);
        }
      }
      : undefined,
    databaseUrl: config.databaseUrl,
    dbType: config.dbType,
    supabaseUrl: config.supabaseUrl,
    supabaseKey: config.supabasePublishableKey,
    env: serverEnvironment(),
  });
  if (!rows.readable) {
    throw new HttpError(501, `The stored GitHub connection could not be read, so this plugin cannot be committed to the repository this site is built from. ${rows.error}`.trim());
  }
  return githubTargetFrom(rows.settings[GITHUB_CONFIG_KEY]);
}

/**
 * The `options` accessor `installPluginFromGit` uses to pin `rwp_active_plugins`.
 *
 * An adapter per call, for the reason above: the install takes seconds — GitHub round-trips, then the
 * deploy hook — and a connection held open across it is one a serverless function is billed for.
 */
function settingsStore(config: RuntimeConfig): PluginInstallOptionStore {
  return {
    async getOption(name: string) {
      const db = await createServerDbAdapter(config);
      try {
        return await db.getOption(name);
      } finally {
        await db.close().catch(() => undefined);
      }
    },
    async setOption(name: string, value: unknown) {
      const db = await createServerDbAdapter(config);
      try {
        return await db.setOption(name, value);
      } finally {
        await db.close().catch(() => undefined);
      }
    },
  };
}

/**
 * Where this upload goes — the disk, or the repository — and, for the repository, the connection that
 * getting there needs. Built before the body is read, so a decision that cannot be made (no GitHub
 * connection on a host that has no disk) is a status the dialog can act on.
 */
type InstallPlan =
  | { mode: 'local' }
  | { mode: 'github'; target: GithubCommitTarget };

/**
 * Settles the destination, asking the one authority on it: `detectPluginHostMode`, which tests whether
 * `plugins/` and `.rwp-tmp/` can be written to and whether a serverless platform is underfoot.
 *
 * A host that can write its own disk needs no credential at all — an upload is a folder, as it is under
 * `npm start`. A host that cannot is answered by `githubTarget`: the stored GitHub connection, or the
 * `501` that says to connect one, because committing is the only way in that such a host has.
 */
async function installPlan(config: RuntimeConfig): Promise<InstallPlan> {
  if (await detectPluginHostMode() === 'github') {
    return { mode: 'github', target: await githubTarget(config) };
  }
  return { mode: 'local' };
}

/** The raw ZIP bytes, in whichever of the two shapes a client may have sent them. */
async function readZipBytes(c: Context): Promise<Buffer> {
  const contentType = (c.req.header('content-type') || '').toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody();
    const file = body.file;
    if (file instanceof File) return Buffer.from(await file.arrayBuffer());
    // A part sent as text — `curl -F file=@plugin.zip` after a client re-encoded it — arrives as a data
    // URI, which is how the classic route read it too.
    const dataUrl = typeof file === 'string' ? /^data:[^,]*;base64,([\s\S]*)$/.exec(file) : null;
    if (dataUrl) return Buffer.from(dataUrl[1], 'base64');
    return Buffer.alloc(0);
  }
  return Buffer.from(await c.req.raw.arrayBuffer());
}

/**
 * What to install: the ZIP the dialog posted, or the `https://` URL it asked us to fetch.
 *
 * The size is checked before the bytes are unpacked so an oversized body is refused as a size problem
 * rather than as a broken archive, and the URL is restricted to `https://` — the classic route's rule,
 * kept, because a plaintext download of executable code is worth refusing twice.
 */
async function readSource(c: Context): Promise<PluginInstallSource> {
  const contentType = (c.req.header('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const body = (await c.req.json().catch(() => ({}))) as { url?: unknown };
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) throw new HttpError(400, 'A .zip plugin package, or a URL to one, is required.');
    if (!/^https:\/\//i.test(url)) throw new HttpError(400, 'A plugin URL must start with https://.');
    return { url };
  }
  const zip = await readZipBytes(c);
  if (zip.length === 0) throw new HttpError(400, 'A .zip plugin package is required.');
  if (zip.length > MAX_ZIP_BYTES) throw new HttpError(413, 'The plugin ZIP is larger than the 25 MB limit.');
  return { zip };
}

/**
 * `POST /api/admin/plugins/upload` — the whole of what the dialog calls.
 *
 * Two phases, and the split is the point: everything that can be refused with a status happens first
 * and answers JSON, carrying the status that says what to do about it. The install then answers NDJSON,
 * because by then the response has begun — and the steps keep arriving while a folder is written or a
 * commit is made, so the dialog shows where the upload is rather than a spinner and a guess.
 *
 * Where the plugin goes is settled once, in `installPlan`, and travels on every event and in the result:
 * the dialog labels its steps with it, so "installing" reads as one thing on a host that writes
 * `plugins/<id>/` and another on a host that commits.
 */
async function upload(c: Context): Promise<Response> {
  let config: RuntimeConfig;
  let plan: InstallPlan;
  let source: PluginInstallSource;
  let mode: PluginHostMode | undefined;
  try {
    const token = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
    config = await getRuntimeConfig();
    // The auto-heal, *before* the refusal: a site that is configured but was never marked installed has
    // its `options.installed` row and `data/react-wp-config.json` written here, instead of the caller
    // being told to go and run SQL. This is the same repair `server.mjs` applies on boot, and it is what
    // makes this route work on the hosts that never run `server.mjs` (Vercel, and `npm run start:hono`).
    if (!config.installed) config = await ensureSiteInstalled();
    if (!config.installed) {
      throw new HttpError(409, 'This site is not installed yet, so plugins cannot be installed.');
    }
    await requirePluginManager(token, config);
    plan = await installPlan(config);
    mode = plan.mode;
    source = await readSource(c);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : statusOf(error) ?? 500;
    // `mode`, once the host question is answered, says which path refused: a host with no disk and no
    // GitHub connection is a different problem from a ZIP this installer will not accept.
    return c.json({ error: messageOf(error), ...(mode ? { mode } : {}) }, status as ContentfulStatusCode);
  }

  const optionStore = settingsStore(config);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
      const onStep = (step: PluginInstallStep) => send({ type: 'step', step, mode: plan.mode });
      try {
        const result = plan.mode === 'github'
          ? await installPluginFromGit({ source, target: plan.target, optionStore, onStep })
          : await installPlugin(source, null, onStep, { optionStore });
        send({ type: 'result', result: { ...result, mode: plan.mode } });
      } catch (error) {
        // The response is already a 200 with bytes in flight; the installer's own status travels in the
        // event, and `src/components/PluginUploadModal.tsx` is what turns it back into a message.
        send({ type: 'error', error: messageOf(error), status: statusOf(error) ?? 500 });
      } finally {
        controller.close();
      }
    },
  });

  return c.newResponse(stream, 200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    // A proxy that buffers answers would hold every step back until the last one, which is the single
    // thing the progress list must not do.
    'X-Accel-Buffering': 'no',
  });
}

pluginsRouter.post('/upload', upload);

/** The name this route had before the dialog existed; kept so an existing `curl` keeps working. */
pluginsRouter.post('/upload-zip', upload);
