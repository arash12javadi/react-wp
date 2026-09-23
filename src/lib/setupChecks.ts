import { describeDbError, getSupabaseClient } from './db';
import { fetchProfile, fetchProfileDetails, profileDetailsMigration } from './profiles';
import { hasCapability, type Capability, type UserRole } from './roles';
import { rwp, type RwpSetupLevel, type RwpSetupNotice } from './rwp';
import { defaultSettings, loadSettings } from './settings';
import { appSettingsMigration } from './appSettings';
import { currentI18nSettings, i18nMigration } from './i18n';
import { themeMigration } from './theme';
import { capabilityGrantsMigration } from './capabilityGrants';
import { translationsMigration } from './translations';
import { engagementMigration } from './engagement';
import { securityMigration } from './security';

/**
 * The Dashboard's setup checklist: what is still missing for this site to work fully, with
 * the steps to fix it. Core checks live here; plugins add theirs with admin.registerSetupCheck.
 */

export interface SetupNotice extends RwpSetupNotice {
  source: string;
}

export const levelOrder: Record<RwpSetupLevel, number> = { required: 0, recommended: 1, optional: 2 };

const missingTable = (message: string) => /schema cache|does not exist|PGRST205|42P01/i.test(message);
/** A table that exists without a column a later migration adds. PostgREST reports 42703. */
const missingColumn = (message: string) => /42703|column .* does not exist|Could not find the '.*' column|schema cache/i.test(message);

const can = (role: UserRole, capability: Capability) => hasCapability(role, capability);

async function adminNotices(): Promise<RwpSetupNotice[]> {
  const notices: RwpSetupNotice[] = [];
  const supabase = getSupabaseClient();
  const [settings, mediaConfig, menuRow, quotaProbe, detailsProbe, themeProbe, localeProbe, grantsProbe, translationsProbe, engagementProbe] = await Promise.all([
    loadSettings(),
    fetch('/api/media-config').then((response) => (response.ok ? response.json() as Promise<{ cloudinary: boolean; imagekit: boolean }> : null)).catch(() => null),
    supabase.from('options').select('option_name').eq('option_name', 'menu_links').maybeSingle(),
    supabase.from('rwp_quota_overrides').select('email', { count: 'exact', head: true }),
    supabase.from('profile_details').select('id', { count: 'exact', head: true }),
    supabase.from('theme_settings').select('id', { count: 'exact', head: true }),
    // A missing column, not a missing table: PostgREST answers 42703 / "column … does not exist".
    supabase.from('pages').select('locale', { count: 'exact', head: true }),
    supabase.from('rwp_role_capabilities').select('role', { count: 'exact', head: true }),
    supabase.from('rwp_translations').select('id', { count: 'exact', head: true }),
    supabase.from('bookmarks').select('id', { count: 'exact', head: true }),
  ]);

  // Probed through the RPC, not the table. rwp_security_secrets has RLS on, no policy and no
  // grants, so PostgREST does not expose it at all and a select against it looks "missing" even
  // where it exists. The function is the thing that is actually granted, so "no such function" is
  // the honest signal that the migration has not run.
  const securityProbe = await supabase.rpc('rwp_security_secrets_status');
  if (securityProbe.error && /PGRST202|Could not find the function/i.test(describeDbError(securityProbe.error))) {
    notices.push({
      id: 'migration-20261010',
      level: 'recommended',
      title: 'Run the security database migration',
      description: 'Settings → Security saves nothing until it has run: the rate limits, anti-bot settings, page cache and robots.txt all fall back to their defaults, and the CAPTCHA secret has nowhere to be stored.',
      steps: [
        'Open Supabase → SQL Editor → New query.',
        `Paste the whole of ${securityMigration} and click Run. It is safe to run again.`,
        'Reload this page, then open Settings → Security.',
      ],
      action: { label: 'Open Supabase', href: 'https://supabase.com/dashboard/projects' },
    });
  }

  if (engagementProbe.error && missingTable(describeDbError(engagementProbe.error))) {
    notices.push({
      id: 'migration-20261004',
      level: 'recommended',
      title: 'Run the engagement database migration',
      description: 'Like, Save and Follow buttons, view counts, saved collections, the Following feed and Dashboard → Analytics stay hidden until it has run.',
      steps: [
        'Open Supabase → SQL Editor → New query.',
        `Paste the whole of ${engagementMigration} and click Run. It is safe to run again.`,
        'With the shop active, run supabase/migrations/20261005_shop_engagement.sql next (or re-activate the shop on npm start).',
        'Reload this page.',
      ],
      action: { label: 'Open Supabase', href: 'https://supabase.com/dashboard/projects' },
    });
  }

  if (translationsProbe.error && missingTable(describeDbError(translationsProbe.error))) {
    notices.push({
      id: 'migration-20261003',
      level: currentI18nSettings().supported_languages.length > 1 ? 'required' : 'recommended',
      title: 'Run the translations database migration',
      description: 'Settings → Translations cannot save until it has run. The site keeps using the bundled strings meanwhile.',
      steps: [
        'Open Supabase → SQL Editor → New query.',
        `Paste the whole of ${translationsMigration} and click Run. It is safe to run again.`,
        'Reload this page.',
      ],
      action: { label: 'Open Supabase', href: 'https://supabase.com/dashboard/projects' },
    });
  }

  if (grantsProbe.error && missingTable(describeDbError(grantsProbe.error))) {
    notices.push({
      id: 'migration-20261001',
      level: 'required',
      title: 'Run the account pages and capabilities database migration',
      description: 'Until it has run, Settings → Roles cannot add capabilities, and the default Log In, Register, Profile and Dashboard pages (and, on a new site, the Home page and Sample Post) are not created.',
      steps: [
        'Open Supabase → SQL Editor → New query.',
        `Paste the whole of ${capabilityGrantsMigration} and click Run. It is safe to run again.`,
        'Reload this page. The default pages are created on that reload.',
      ],
      action: { label: 'Open Supabase', href: 'https://supabase.com/dashboard/projects' },
    });
  }

  if (quotaProbe.error && missingTable(describeDbError(quotaProbe.error))) {
    notices.push({
      id: 'migration-20260920',
      level: 'required',
      title: 'Run the App Settings database migration',
      description: 'Upload limits and disk quotas under Settings are not enforced until it has run.',
      steps: [
        'Open Supabase → SQL Editor → New query.',
        `Paste the whole of ${appSettingsMigration} and click Run. It is safe to run again.`,
        'Reload this page.',
      ],
      action: { label: 'Open Supabase', href: 'https://supabase.com/dashboard/projects' },
    });
  }
  if (detailsProbe.error && missingTable(describeDbError(detailsProbe.error))) {
    notices.push({
      id: 'migration-20260921',
      level: 'required',
      title: 'Run the profile details database migration',
      description: 'The optional "More about you" section of Profile cannot save until it has run.',
      steps: [
        'Open Supabase → SQL Editor → New query.',
        `Paste the whole of ${profileDetailsMigration} and click Run. It is safe to run again.`,
        'Reload this page.',
      ],
      action: { label: 'Open Supabase', href: 'https://supabase.com/dashboard/projects' },
    });
  }

  if (themeProbe.error && missingTable(describeDbError(themeProbe.error))) {
    notices.push({
      id: 'migration-20260922',
      level: 'required',
      title: 'Run the Theme Editor database migration',
      description: 'Appearance → Theme Editor cannot save until it has run. The site keeps its default layout meanwhile.',
      steps: [
        'Open Supabase → SQL Editor → New query.',
        `Paste the whole of ${themeMigration} and click Run. It is safe to run again.`,
        'Reload this page.',
      ],
      action: { label: 'Open Supabase', href: 'https://supabase.com/dashboard/projects' },
    });
  }

  // Only worth raising once the site actually offers more than one language: a single-language
  // site loses nothing by not having run it.
  if (localeProbe.error && missingColumn(describeDbError(localeProbe.error)) && currentI18nSettings().supported_languages.length > 1) {
    notices.push({
      id: 'migration-20260929',
      level: 'required',
      title: 'Run the multilingual database migration',
      description: 'The language switcher and translated text already work, but pages cannot hold a separate Page Builder layout per language until it has run, so every language shows the same layout.',
      steps: [
        'Open Supabase → SQL Editor → New query.',
        `Paste the whole of ${i18nMigration} and click Run. It is safe to run again.`,
        'Reload this page.',
      ],
      action: { label: 'Open Supabase', href: 'https://supabase.com/dashboard/projects' },
    });
  }

  if (!settings.site_title.trim() || settings.site_title === defaultSettings.site_title) {
    notices.push({
      id: 'site-title',
      level: 'recommended',
      title: 'Give your site a name',
      description: `The site is still called "${settings.site_title || 'nothing'}". The title appears in the header, browser tabs, search results and link previews.`,
      steps: ['Open Settings → Site.', 'Change Site title (and the tagline under it), then Save settings.'],
      action: { label: 'Open Settings → Site', section: 'settings', subsection: 'site' },
    });
  } else if (!settings.site_tagline.trim() || settings.site_tagline === defaultSettings.site_tagline) {
    notices.push({
      id: 'site-tagline',
      level: 'optional',
      title: 'Write a tagline',
      description: 'The tagline shows under the site title and is the description search engines use for the home page.',
      action: { label: 'Open Settings → Site', section: 'settings', subsection: 'site' },
    });
  }

  if (!settings.site_logo || !settings.site_icon) {
    notices.push({
      id: 'site-branding',
      level: 'optional',
      title: `Add a ${[!settings.site_logo && 'logo', !settings.site_icon && 'site icon'].filter(Boolean).join(' and ')}`,
      description: 'A logo can replace or sit beside the site title in the header. The site icon is the browser tab favicon and the fallback image for link previews.',
      steps: [
        'Upload the images under Media → Library (or paste an image URL).',
        'Open Settings → Site → Header logo and Site icon, choose them, and pick what the header shows.',
      ],
      action: { label: 'Open Settings → Site', section: 'settings', subsection: 'site' },
    });
  }

  const cloudinary = Boolean(settings.cloudinary_cloud_name && settings.cloudinary_upload_preset);
  const imagekit = Boolean(settings.imagekit_public_key && settings.imagekit_url_endpoint);
  if (!cloudinary && !imagekit) {
    notices.push({
      id: 'media-provider',
      level: 'required',
      title: 'Connect Cloudinary or ImageKit to upload files',
      description: 'Files are stored at an image host, not in Supabase. Until one is connected, images can only be added by URL.',
      steps: [
        'Cloudinary (free tier, no server secret needed to upload): sign up, copy the Cloud name from the dashboard.',
        'In Cloudinary → Settings → Upload → Upload presets → Add upload preset, set Signing Mode to Unsigned and save.',
        'Open Media → Upload providers, enter the cloud name and preset name, and save.',
        'Or ImageKit: enter the public key and URL endpoint there, and put IMAGEKIT_PRIVATE_KEY in .env.local.',
      ],
      action: { label: 'Open Media → Upload providers', section: 'media', subsection: 'upload-settings' },
    });
  }
  if (cloudinary && mediaConfig && !mediaConfig.cloudinary) {
    notices.push({
      id: 'cloudinary-delete-keys',
      level: 'recommended',
      title: 'Let the server delete Cloudinary files',
      description: 'Deleting media now removes only the library entry; the file stays in your Cloudinary account and uses its storage.',
      steps: [
        'In Cloudinary → Settings → API Keys, copy the API key and API secret.',
        'Add CLOUDINARY_API_KEY=… and CLOUDINARY_API_SECRET=… to .env.local (never to an admin screen: those settings are public).',
        'Restart the server with npm start.',
      ],
      action: { label: 'Open Cloudinary API keys', href: 'https://console.cloudinary.com/settings/api-keys' },
    });
  }
  if (imagekit && mediaConfig && !mediaConfig.imagekit) {
    notices.push({
      id: 'imagekit-private-key',
      level: 'required',
      title: 'ImageKit is set up but IMAGEKIT_PRIVATE_KEY is missing',
      description: 'ImageKit signs every upload and delete on the server, so ImageKit uploads fail without it.',
      steps: [
        'In ImageKit → Developer options, copy the private key.',
        'Add IMAGEKIT_PRIVATE_KEY=… to .env.local and restart the server with npm start.',
      ],
      action: { label: 'Open ImageKit developer options', href: 'https://imagekit.io/dashboard/developer/api-keys' },
    });
  }
  if ((cloudinary || imagekit) && !mediaConfig) {
    notices.push({
      id: 'media-server',
      level: 'optional',
      title: 'Could not read the server’s media settings',
      description: '/api/media-config did not answer, so this checklist cannot tell whether deletes at Cloudinary or ImageKit will work. This is expected with npm run dev when npm start is not also running.',
    });
  }

  if (!menuRow.error && !menuRow.data) {
    notices.push({
      id: 'menu',
      level: 'optional',
      title: 'Build your navigation menu',
      description: 'The header still shows the sample links (Home, Sample Page, Admin Dashboard).',
      action: { label: 'Open Menus', section: 'menus', subsection: 'menus' },
    });
  }

  if (settings.auth_google_enabled || settings.auth_facebook_enabled) {
    notices.push({
      id: `social-login-${[settings.auth_google_enabled && 'google', settings.auth_facebook_enabled && 'facebook'].filter(Boolean).join('-')}`,
      level: 'optional',
      title: 'Confirm social sign-in is configured in Supabase',
      description: 'The Google/Facebook buttons are switched on here, but the sign-in itself only works once the provider is enabled in Supabase. This cannot be checked from the site, so hide this once you have tested it.',
      steps: [
        'Supabase → Authentication → Providers: enable the provider and paste its client ID and secret.',
        'Supabase → Authentication → URL Configuration: add https://your-domain/login (and http://localhost:3000/login) to Redirect URLs.',
        'Sign out and try the button on /login.',
      ],
      action: { label: 'Open Settings → Accounts', section: 'settings', subsection: 'accounts' },
    });
  }
  return notices;
}

async function contentNotices(role: UserRole): Promise<RwpSetupNotice[]> {
  const notices: RwpSetupNotice[] = [];
  const supabase = getSupabaseClient();
  const [published, pending] = await Promise.all([
    supabase.from('pages').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    can(role, 'moderate_comments')
      ? supabase.from('comments').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      : Promise.resolve(null),
  ]);
  if (!published.error && !published.count) {
    notices.push({
      id: 'first-content',
      level: 'recommended',
      title: 'Publish your first post or page',
      description: 'Visitors see the built-in "Hello World" placeholder until something is published.',
      action: { label: 'Write a post', section: 'content', subsection: 'new-post' },
    });
  }
  if (pending && !pending.error && pending.count) {
    notices.push({
      // The count is in the id, so hiding "3 waiting" does not also hide the next new comment.
      id: `comments-pending-${pending.count}`,
      level: 'recommended',
      title: `${pending.count} comment${pending.count === 1 ? ' is' : 's are'} waiting for approval`,
      description: 'Held comments are invisible to visitors until approved.',
      action: { label: 'Open Comments', section: 'comments' },
    });
  }
  return notices;
}

async function profileNotices(userId: string): Promise<RwpSetupNotice[]> {
  const [profile, details] = await Promise.all([
    fetchProfile(userId).catch(() => null),
    fetchProfileDetails(userId).catch(() => null),
  ]);
  const notices: RwpSetupNotice[] = [];
  const missing = [
    !profile?.display_name?.trim() && 'display name',
    !profile?.avatar_url && 'avatar',
    !profile?.bio?.trim() && 'bio',
  ].filter(Boolean) as string[];
  if (missing.length) {
    notices.push({
      id: `profile-${missing.join('-').replace(/\s+/g, '_')}`,
      level: missing.includes('display name') ? 'recommended' : 'optional',
      title: 'Complete your profile',
      description: `Add your ${missing.join(', ').replace(/, ([^,]*)$/, ' and $1')}. ${missing.includes('display name') ? 'Without a display name, your comments are signed with the first part of your email address.' : 'They appear next to your comments and posts.'}`,
      action: { label: 'Open Profile', section: 'profile' },
    });
  }
  if (details && !details.first_name && !details.last_name && !details.job_title && !details.website && !details.location) {
    notices.push({
      id: 'profile-details',
      level: 'optional',
      title: 'Tell us a bit more about you',
      description: 'Name, job, website, location, time zone and social links. All optional, and visible only to you and user managers.',
      action: { label: 'Open Profile', section: 'profile' },
    });
  }
  return notices;
}

/** Runs every check the role may see. A failing check becomes a notice rather than hiding the rest. */
export async function runSetupChecks(role: UserRole, userId: string): Promise<SetupNotice[]> {
  const jobs: Array<{ source: string; run: () => Promise<RwpSetupNotice[]> }> = [
    { source: 'profile', run: () => profileNotices(userId) },
  ];
  if (can(role, 'edit_posts')) jobs.push({ source: 'content', run: () => contentNotices(role) });
  if (can(role, 'manage_options')) jobs.push({ source: 'site', run: adminNotices });
  rwp.getSetupChecks()
    .filter((check) => !check.capability || can(role, check.capability as Capability))
    .forEach((check) => jobs.push({ source: check.id, run: check.run }));

  const results = await Promise.all(jobs.map(async ({ source, run }) => {
    try {
      return (await run()).map((notice) => ({ ...notice, source }));
    } catch (checkError) {
      return [{
        id: `check-failed-${source}`,
        source,
        level: 'optional' as const,
        title: `The "${source}" setup check could not run`,
        description: checkError instanceof Error ? checkError.message : describeDbError(checkError),
      }];
    }
  }));
  return results.flat().sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);
}

const dismissedKey = (userId: string) => `rwp_dismissed_setup:${userId}`;

/** Hidden notices are a per-person, per-browser convenience, so localStorage is enough. */
export const readDismissed = (userId: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(dismissedKey(userId)) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

export const writeDismissed = (userId: string, ids: string[]) => {
  try {
    localStorage.setItem(dismissedKey(userId), JSON.stringify([...new Set(ids)]));
  } catch {
    // Private windows can refuse storage; the notice just comes back next time.
  }
};
