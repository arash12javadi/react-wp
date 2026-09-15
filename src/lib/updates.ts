import { version as installedAppVersion } from '../../package.json';
import { describeDbError, getSupabaseClient } from './db';
import { rwp } from './rwp';

/**
 * Dashboard → Updates. React-WP is a built bundle plus a Node server, so the browser cannot
 * replace its own code. What runs here is the *checking*: a JSON feed lists the latest app and
 * plugin versions, the result is stored for every administrator, and the check can repeat on a
 * schedule. Installing an update stays a deliberate step on the host (git pull / new ZIP, then
 * npm start), with the feed naming any migrations the update needs.
 */

export { installedAppVersion };

export const updateSettingsOption = 'rwp_update_settings';
export const updateStatusOption = 'rwp_update_status';

export const autoCheckIntervals = {
  off: { label: 'Never (check by hand)', ms: 0 },
  admin: { label: 'Every time an administrator opens the admin', ms: 1 },
  daily: { label: 'Once a day', ms: 24 * 60 * 60 * 1000 },
  weekly: { label: 'Once a week', ms: 7 * 24 * 60 * 60 * 1000 },
  monthly: { label: 'Once a month', ms: 30 * 24 * 60 * 60 * 1000 },
} as const;

export type AutoCheck = keyof typeof autoCheckIntervals;

export const defaultFeedUrl = 'https://raw.githubusercontent.com/arash12javadi/react-wp/main/updates.json';

export interface UpdateSettings {
  auto_check: AutoCheck;
  feed_url: string;
  /** Show the Updates count in the sidebar badge. */
  notify: boolean;
}

export const defaultUpdateSettings: UpdateSettings = { auto_check: 'weekly', feed_url: defaultFeedUrl, notify: true };

export interface FeedRelease {
  version: string;
  released?: string;
  notes?: string[];
  /** Repository paths of migrations to run in the Supabase SQL Editor after updating. */
  migrations?: string[];
  download_url?: string;
  changelog_url?: string;
}

export interface UpdateFeed {
  format: 'rwp-update-feed';
  version: 1;
  app: FeedRelease;
  plugins?: Record<string, FeedRelease>;
}

export interface UpdateStatus {
  checked_at: string;
  feed_url: string;
  error: string;
  feed: UpdateFeed | null;
}

export interface AvailableUpdate {
  id: string;
  name: string;
  kind: 'app' | 'plugin';
  installed: string;
  release: FeedRelease;
}

/** Compares dotted versions numerically, so 1.10.0 is newer than 1.9.0. Pre-release tags sort lower. */
export const compareVersions = (a: string, b: string): number => {
  const parse = (value: string) => {
    const [core, pre = ''] = value.trim().replace(/^v/i, '').split('-', 2);
    return { parts: core.split('.').map((part) => Number.parseInt(part, 10) || 0), pre };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.parts.length, right.parts.length); index += 1) {
    const difference = (left.parts[index] || 0) - (right.parts[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre < right.pre ? -1 : 1;
};

const readJsonOption = async <T>(name: string): Promise<T | null> => {
  const { data, error } = await getSupabaseClient().from('options').select('option_value').eq('option_name', name).maybeSingle();
  if (error) throw new Error(describeDbError(error));
  if (!data?.option_value) return null;
  try {
    return JSON.parse(data.option_value) as T;
  } catch {
    return null;
  }
};

const writeJsonOption = async (name: string, value: unknown) => {
  const { data, error } = await getSupabaseClient()
    .from('options').upsert({ option_name: name, option_value: JSON.stringify(value) }).select('option_name');
  if (error) throw new Error(describeDbError(error));
  // Row level security rejects an options write by returning no rows rather than an error.
  if (!data?.length) throw new Error('The database saved nothing: only administrators (manage_options) can change update settings.');
};

export const loadUpdateSettings = async (): Promise<UpdateSettings> => {
  const stored = await readJsonOption<Partial<UpdateSettings>>(updateSettingsOption);
  return {
    auto_check: stored?.auto_check && stored.auto_check in autoCheckIntervals ? stored.auto_check : defaultUpdateSettings.auto_check,
    feed_url: typeof stored?.feed_url === 'string' && stored.feed_url.trim() ? stored.feed_url.trim() : defaultUpdateSettings.feed_url,
    notify: typeof stored?.notify === 'boolean' ? stored.notify : defaultUpdateSettings.notify,
  };
};

export const saveUpdateSettings = async (settings: UpdateSettings) => {
  if (!/^https:\/\/\S+$/i.test(settings.feed_url.trim())) {
    throw new Error('The update feed URL must start with https://.');
  }
  await writeJsonOption(updateSettingsOption, { ...settings, feed_url: settings.feed_url.trim() });
};

export const loadUpdateStatus = () => readJsonOption<UpdateStatus>(updateStatusOption);

const isRelease = (value: unknown): value is FeedRelease =>
  Boolean(value && typeof value === 'object' && typeof (value as FeedRelease).version === 'string');

const validateFeed = (value: unknown): UpdateFeed => {
  const feed = value as Partial<UpdateFeed> | null;
  if (!feed || feed.format !== 'rwp-update-feed') {
    throw new Error('The URL answered, but not with a React-WP update feed (expected "format": "rwp-update-feed").');
  }
  if (feed.version !== 1) throw new Error(`The update feed uses format version ${String(feed.version)}; this site understands version 1. Update by hand once to get a newer checker.`);
  if (!isRelease(feed.app)) throw new Error('The update feed has no "app" entry with a "version".');
  const plugins = Object.fromEntries(Object.entries(feed.plugins || {}).filter(([, release]) => isRelease(release)));
  return { format: 'rwp-update-feed', version: 1, app: feed.app, plugins };
};

/** Fetches the feed and stores the result (including a failure) for every administrator. */
export const checkForUpdates = async (feedUrl: string): Promise<UpdateStatus> => {
  let feed: UpdateFeed | null = null;
  let error = '';
  try {
    let response: Response;
    try {
      response = await fetch(feedUrl, { cache: 'no-store' });
    } catch {
      throw new Error(`Could not reach ${feedUrl}. Check the address and your connection; the server hosting it must also allow cross-origin requests (GitHub raw files do).`);
    }
    if (response.status === 404) {
      throw new Error(`The update feed returned 404 at ${feedUrl}. If the GitHub repository is private, raw.githubusercontent.com will not serve it without a token: host updates.json at a public https address and set that URL below.`);
    }
    if (!response.ok) throw new Error(`The update feed returned HTTP ${response.status} at ${feedUrl}.`);
    const body = await response.json().catch(() => {
      throw new Error(`${feedUrl} did not return valid JSON.`);
    });
    feed = validateFeed(body);
  } catch (checkError) {
    error = checkError instanceof Error ? checkError.message : 'The update check failed.';
  }
  const status: UpdateStatus = { checked_at: new Date().toISOString(), feed_url: feedUrl, error, feed };
  await writeJsonOption(updateStatusOption, status);
  return status;
};

/** Compared against the running code each time, so an old stored result never claims an update that is already installed. */
export const availableUpdates = (status: UpdateStatus | null): AvailableUpdate[] => {
  if (!status?.feed) return [];
  const updates: AvailableUpdate[] = [];
  if (compareVersions(status.feed.app.version, installedAppVersion) > 0) {
    updates.push({ id: 'react-wp', name: 'React-WP', kind: 'app', installed: installedAppVersion, release: status.feed.app });
  }
  rwp.getPlugins().forEach((plugin) => {
    const release = status.feed?.plugins?.[plugin.id];
    if (release && compareVersions(release.version, plugin.version) > 0) {
      updates.push({ id: plugin.id, name: plugin.name, kind: 'plugin', installed: plugin.version, release });
    }
  });
  return updates;
};

/** Runs the scheduled check when it is due. Called once when an administrator opens the admin. */
export const runScheduledUpdateCheck = async (): Promise<{ settings: UpdateSettings; status: UpdateStatus | null }> => {
  const settings = await loadUpdateSettings();
  let status = await loadUpdateStatus();
  const interval = autoCheckIntervals[settings.auto_check].ms;
  const last = status?.checked_at ? Date.parse(status.checked_at) : 0;
  if (interval > 0 && (!last || Date.now() - last >= interval)) {
    status = await checkForUpdates(settings.feed_url);
  }
  return { settings, status };
};
