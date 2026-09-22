import SiteSettingsPanel from './settings/SiteSettingsPanel';
import AccountsPanel from './settings/AccountsPanel';
import RolesPanel from './settings/RolesPanel';
import TranslationsPanel from './settings/TranslationsPanel';
import BackupPanel from './settings/BackupPanel';
import ResetSitePanel from './settings/ResetSitePanel';
import AppSettings, { isAppSettingsTab } from './AppSettings';
import type { SiteBranding } from '../lib/settings';
import styles from './SiteSettings.module.css';

const descriptions: Record<string, [string, string]> = {
  site: ['Site', 'The site title, tagline, logo, icon, front page, and the profile and dashboard pages for signed-in people.'],
  accounts: ['Accounts', 'Who can register and what they become, the sign-in pages, where signing in and out leads, and the admin toolbar.'],
  general: ['General', 'What the public site shows, whose media each role sees, excerpts, and menu profile links.'],
  uploads: ['Uploads', 'File size and image dimension rules, and how much storage each role or person may use.'],
  seo: ['SEO', 'Meta keywords in the page editor, and tracking scripts such as Google Tag Manager.'],
  engagement: ['Engagement', 'Like, Save and Follow buttons, view counts, and where the site shows them.'],
  languages: ['Languages', 'The languages this site offers, the defaults for visitors and for the admin, and the public language switcher.'],
  translations: ['Translations', 'Reword any interface string, translate it into the languages this site offers, and import or export them for a translator.'],
  roles: ['Roles', 'Add capabilities to a role, or to one person on top of their role.'],
  backup: ['Backup', 'Download the whole site as one file, or restore a backup onto this site.'],
  advanced: ['Advanced', 'Destructive operations. Everything on this screen is permanent.'],
};

/** Settings, with its sections chosen from the admin sidebar's submenu. */
export default function SiteSettings({ tab, onBrandingChange }: { tab: string; onBrandingChange?: (branding: SiteBranding) => void }) {
  const [heading, description] = descriptions[tab] || descriptions.site;

  return (
    <section className={styles.container} aria-labelledby="settings-heading">
      <div className={styles.pageIntro}>
        <h2 id="settings-heading">{heading}</h2>
        <p>{description}</p>
      </div>

      {tab === 'accounts' ? <AccountsPanel />
        : tab === 'roles' ? <RolesPanel />
        : tab === 'translations' ? <TranslationsPanel />
        : tab === 'backup' ? <BackupPanel />
          : tab === 'advanced' ? <ResetSitePanel />
            // One AppSettings instance for its sections, so unsaved changes survive switching between them.
            : isAppSettingsTab(tab) ? <AppSettings tab={tab} />
              : <SiteSettingsPanel onBrandingChange={onBrandingChange} />}
    </section>
  );
}
