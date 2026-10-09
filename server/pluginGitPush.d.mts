/**
 * Types for `server/pluginGitPush.mjs` — committing plugin files to GitHub from a read-only host.
 *
 * The implementation is plain ESM because `server.mjs` (self-hosted) and the bundled Hono app (Vercel,
 * every other read-only host) both run it, and re-implementing "commit these files in one commit" once
 * per engine is how the two drift apart. `src/server/**` is type-checked, so these declarations are
 * what gives the upload route real types without turning on `allowJs` for the whole project — the same
 * arrangement as `integrationConfig.d.mts` and `integrationSettings.d.mts`.
 *
 * `pluginInstaller.mjs` is deliberately not imported: it has no declarations of its own (the classic
 * route is JavaScript end to end), so the failures these functions raise are typed structurally
 * instead — `{ message: string; status: number }`, an `InstallError`. Callers read `error.status` and
 * answer with it, which is why the status is worth declaring rather than documenting.
 */

/** The repository to publish to, as `githubTargetFrom` derives it from the stored `github_config` row. */
export interface GithubCommitTarget {
  /** The GitHub personal access token from the row. Never logged, never echoed back to a browser. */
  token: string;
  owner: string;
  repo: string;
  /** `owner/repo`, exactly as the row names it — for messages, not for URL building. */
  repository: string;
  branch: string;
}

/** One blob on the branch: its object id, and the file mode the new tree entry must keep. */
export interface GithubTreeEntry {
  sha: string;
  mode: string;
}

/** The branch as it is *now*: what to commit against, and everything a commit may add to or delete. */
export interface GithubBranchBase {
  commitSha: string;
  treeSha: string;
  /** Every blob path on the branch. Truncated listings are refused, never guessed at. */
  paths: Map<string, GithubTreeEntry>;
}

/** The commit that was made, and what it contained. */
export interface GithubCommitResult {
  sha: string;
  /** GitHub's web page for the commit, so the administrator can look at what was committed. */
  url: string;
  /** `owner/repo@branch`. */
  repository: string;
  /** Files written (including the shared files an install has to touch). */
  files: number;
  /** Paths deleted because a previous version of the plugin left them behind. */
  deletions: number;
  /** Deletions GitHub refused; they are still on the branch, and the caller reports them. */
  deletionsSkipped: string[];
}

/**
 * The repository to publish to, taken from the stored `github_config` row.
 *
 * Throws an `InstallError` (status 501, with the sentence naming the screen to fix) when the row has no
 * token, no valid repository or no valid branch: the stored credential is the one thing a host without
 * a writable disk cannot work around, so every one of those cases is answered rather than retried.
 */
export function githubTargetFrom(value: unknown): GithubCommitTarget;

/** The branch's current commit, tree and blob paths. */
export function readBranch(target: GithubCommitTarget): Promise<GithubBranchBase>;

/** The current text of one file on the branch, or `null` when the branch has no such file. */
export function readTextFile(target: GithubCommitTarget, path: string): Promise<string | null>;

/**
 * Writes `files` and deletes `deletions` in one commit on `target.branch`.
 *
 * The text of a file travels inside the tree call itself, so only a file that is not text, an empty one,
 * or one past the module's inline limit is uploaded as a blob first — one call at a time, a second
 * apart, which is what keeps an install out of GitHub's secondary rate limit.
 *
 * `base` must be the `readBranch` result the paths were computed from — GitHub builds the new tree from
 * it, and the ref update is the only call that publishes anything. `allowPaths` names the few shared
 * files an install has to write (`server/plugins.mjs`); everything else must be inside
 * `plugins/<folder>/`.
 */
export function commitFiles(
  target: GithubCommitTarget,
  options: {
    message: string;
    files: Array<{ path: string; content: Uint8Array }>;
    base: GithubBranchBase;
    deletions?: string[];
    allowPaths?: string[];
  },
): Promise<GithubCommitResult>;
