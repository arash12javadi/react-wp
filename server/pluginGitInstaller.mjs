/**
 * Plugins → Upload Plugin on a host that cannot write to its own filesystem.
 *
 * A serverless deployment has no writable disk: `server/pluginInstaller.mjs` fails there with
 * `EROFS` when it creates `plugins/<id>/`, and a plugin folder only becomes part of the site after a
 * build anyway. So the steps are the same ones the admin already sees in the upload dialog — and the
 * ZIP is checked by the very same functions — but the file work happens on the repository instead:
 * one commit adds `plugins/<id>/`, removes what a previous version left behind, and registers the
 * plugin's `server.mjs` in `server/plugins.mjs`, and then the platform is asked to rebuild from that
 * commit (`triggerDeployHook`, i.e. `VERCEL_DEPLOY_HOOK_URL`).
 *
 * Everything the classic installer reports is still reported: the SQL files to run, the npm packages
 * the build would miss, the `rwp_active_plugins` pinning that keeps a new plugin inactive, and the
 * deploy hook's answer. The result is the same shape `src/components/PluginUploadModal.tsx` renders
 * for the classic path, so both hosts show the same screen.
 *
 * The credential is the stored `github_config` row (Settings → Integrations → GitHub) — see
 * `pluginGitPush.mjs`, which owns the API calls and refuses to write outside `plugins/<folder>/`.
 */
import {
  InstallError,
  downloadZip,
  inspectDependencies,
  pinActivePluginsWithStore,
  readManifest,
  sqlFiles,
  triggerDeployHook,
  unpack,
} from './pluginInstaller.mjs';
import { commitFiles, readBranch, readTextFile } from './pluginGitPush.mjs';
import { addServerPluginImportToSource } from './serverPluginImports.mjs';

/** Where a plugin's server routes are registered, as `plugins/README.md` documents. */
const REGISTRY_PATH = 'server/plugins.mjs';
const PLUGINS_ROOT = 'plugins';
const encoder = new TextEncoder();

let installing = false;

/** The plugin ids the repository already carries: `plugins/<id>/manifest.json` and nothing else. */
function pluginFolderIds(paths) {
  const ids = [];
  for (const path of paths) {
    const match = /^plugins\/([a-z0-9][a-z0-9-]{0,63})\/manifest\.json$/.exec(path);
    if (match) ids.push(match[1]);
  }
  return [...new Set(ids)].sort();
}

// The rwp_active_plugins guard — a new plugin must arrive inactive — is `pinActivePluginsWithStore` in
// pluginInstaller.mjs: the disk path needs the identical guard, so it lives with the installer both
// paths share instead of in two copies that could drift.

/**
 * Installs one plugin by committing it to the repository the deployment is built from.
 *
 * `source` is `{ zip }` (uploaded) or `{ url }` (fetched), exactly as the classic installer takes it,
 * because the dialog offers both. `target` is `githubTargetFrom(row)` on the stored `github_config`
 * row. `onStep` receives the step ids `PluginUploadModal` renders, in the order it expects them;
 * `optionStore` is the engine's database adapter, used only to pin `rwp_active_plugins`. The return
 * value is the shape that dialog renders.
 */
export async function installPluginFromGit({ source, target, optionStore, onStep = () => {} }) {
  if (installing) throw new InstallError('Another plugin is being installed right now. Wait for it to finish, then try again.', 409);
  installing = true;
  try {
    let zip = source?.zip;
    if (!zip) {
      onStep('downloading');
      zip = await downloadZip(String(source?.url || ''));
    }

    onStep('extracting');
    const entries = unpack(zip);

    onStep('validating');
    if (!entries.has('manifest.json')) throw new InstallError('No manifest.json was found in the ZIP.');
    const manifest = readManifest(entries);
    if (!entries.has('index.tsx')) {
      throw new InstallError(`index.tsx is missing next to manifest.json. The build loads plugins from plugins/${manifest.id}/index.tsx.`);
    }
    const sql = sqlFiles(entries);
    const dependencies = await inspectDependencies(entries);
    const hasServer = entries.has('server.mjs');

    onStep('installing');
    const base = await readBranch(target);
    const folder = `${PLUGINS_ROOT}/${manifest.id}`;
    const previous = [...base.paths.keys()].filter((path) => path.startsWith(`${folder}/`));
    const files = [...entries].map(([name, bytes]) => ({ path: `${folder}/${name}`, content: bytes }));

    let registryChanged = false;
    if (hasServer) {
      const current = await readTextFile(target, REGISTRY_PATH);
      if (current === null) {
        throw new InstallError(`This plugin ships a server.mjs, but ${REGISTRY_PATH} was not found on branch "${target.branch}" of ${target.owner}/${target.repo}. Restore it, then upload the plugin again.`, 500);
      }
      let edit;
      try {
        edit = addServerPluginImportToSource(current, manifest.id);
      } catch (error) {
        throw new InstallError(`The plugin has a server.mjs, but its import could not be added to ${REGISTRY_PATH}, so nothing was committed: ${error?.message || error}`, 500);
      }
      registryChanged = edit.changed;
      if (edit.changed) files.push({ path: REGISTRY_PATH, content: encoder.encode(edit.source) });
    }

    const commit = await commitFiles(target, {
      message: `${previous.length ? 'Update' : 'Install'} plugin ${manifest.id} ${manifest.version} (uploaded from the admin)`,
      files,
      base,
      deletions: previous.filter((path) => !files.some((file) => file.path === path)),
      allowPaths: [REGISTRY_PATH],
    });

    const serverRoutes = { detected: hasServer, registered: hasServer && registryChanged };
    if (hasServer) onStep('registering-routes');

    const warnings = [
      `${commit.repository} now has this plugin in one commit (${commit.sha.slice(0, 7)}): it becomes part of the site — and can be activated under Plugins — once that commit is built and deployed.`,
    ];
    if (previous.length) {
      warnings.push(`plugins/${manifest.id}/ already existed on this branch; its ${previous.length} file(s) were replaced by this upload.`);
    }
    if (commit.deletions) warnings.push(`${commit.deletions} file(s) an earlier version left in plugins/${manifest.id}/ were deleted in the same commit.`);
    if (commit.deletionsSkipped.length) {
      warnings.push(`GitHub did not accept the deletion of ${commit.deletionsSkipped.length} file(s) (${commit.deletionsSkipped.slice(0, 3).join(', ')}${commit.deletionsSkipped.length > 3 ? ', …' : ''}). They are still in plugins/${manifest.id}/ and may end up in the build; delete them on GitHub.`);
    }

    const pinWarning = await pinActivePluginsWithStore(optionStore, pluginFolderIds(base.paths.keys()));
    if (pinWarning) warnings.push(pinWarning);

    onStep('triggering-rebuild');
    const deploy = await triggerDeployHook();
    if (!deploy.configured) {
      warnings.push('No rebuild was triggered: this deployment has no VERCEL_DEPLOY_HOOK_URL. The plugin is in the repository already, so building or redeploying from there installs it. Create a deploy hook (Vercel → the project → Settings → Git → Deploy Hooks) and set VERCEL_DEPLOY_HOOK_URL to have uploads redeploy themselves.');
    }

    return {
      plugin: { id: manifest.id, name: manifest.name, version: manifest.version, folder: manifest.id },
      files: entries.size,
      serverRoutes,
      sql,
      dependencies,
      deploy,
      restart: {
        required: false,
        reason: `Nothing on this host has to be restarted: it is built from ${target.owner}/${target.repo}, and that platform redeploys when it builds the commit this upload just made.`,
      },
      warnings,
      commit: { sha: commit.sha, url: commit.url, repository: commit.repository, branch: target.branch, deletions: commit.deletions },
    };
  } finally {
    installing = false;
  }
}
