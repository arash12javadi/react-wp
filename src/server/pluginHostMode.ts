/**
 * Where an uploaded plugin goes: this host's own disk, or the repository it is built from.
 *
 * `server/pluginInstaller.mjs` installs a plugin by writing `plugins/<id>/`; `server/pluginGitInstaller.mjs`
 * commits it to the repository the deployment is built from (`server/pluginGitPush.mjs` is the credential
 * and the API calls). Which of the two applies is a property of the host, not a setting: a Vercel function
 * has no filesystem an install can survive on, a server that runs this project has one. `POST
 * /api/admin/plugins/upload` asks this module before it reads the body — so the GitHub connection is
 * required of the hosts that need it, and of no others.
 *
 * The answer is established by writing, not by asking: a probe file is created and removed in the two
 * directories an install writes to — `plugins/` and the staging folder `.rwp-tmp/`, resolved from the
 * project root exactly as `server/pluginInstaller.mjs` resolves them. A host where those writes fail is a
 * host where `plugins/<id>/` could not have been created either, whatever the platform says about itself.
 */

/** Which installer an upload is handed to. */
export type PluginHostMode = 'local' | 'github';

/**
 * Environment variables a serverless platform sets; a server that runs `npm start` or `npm run dev` sets
 * none of them.
 *
 * `NODE_ENV` is deliberately not one of them, whichever way it points: it describes how the code was
 * built, not what the host can do. A Vercel deployment runs with `production` and a local `vite` server
 * with `development`, so reading it would send a developer's machine to the repository and a serverless
 * function to a disk it does not have.
 */
const serverlessMarkers = [
  'VERCEL',
  'NOW_BUILDER',
  'AWS_LAMBDA_FUNCTION_NAME',
  'NETLIFY',
  'CF_PAGES',
  'DENO_DEPLOYMENT_ID',
];

/** The directories `server/pluginInstaller.mjs` writes to, both below the project root. */
const installDirectories = ['plugins', '.rwp-tmp'];

/** `process.env` where there is one, and nothing where there is not (Workers, Deno, Bun). */
const serverEnvironment = (): Record<string, string | undefined> =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * Whether an upload can be installed to a disk this host owns.
 *
 * Anything unexpected answers `github`: an edge runtime has no `node:fs` to probe at all, and a
 * serverless deployment can still be given a plugin — through its repository. Guessing is what this
 * avoids: the alternative to an answer here is an `EROFS` from the middle of an install, after the ZIP
 * has been read.
 */
export async function detectPluginHostMode(options: {
  env?: Record<string, string | undefined>;
  /** Where `plugins/` and `.rwp-tmp/` live: the project root, as the installer resolves it. */
  projectRoot?: string;
} = {}): Promise<PluginHostMode> {
  const env = options.env ?? serverEnvironment();
  if (serverlessMarkers.some((name) => env[name])) return 'github';
  try {
    const [{ mkdir, rm, writeFile }, { join, resolve }] = await Promise.all([
      import('node:fs/promises'),
      import('node:path'),
    ]);
    const probe = `.rwp-write-probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    for (const name of installDirectories) {
      const directory = resolve(options.projectRoot ?? '.', name);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, probe), '');
      await rm(join(directory, probe), { force: true });
    }
    return 'local';
  } catch {
    return 'github';
  }
}
