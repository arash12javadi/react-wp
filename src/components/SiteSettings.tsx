import SiteSettingsPanel from './settings/SiteSettingsPanel';
import AccountsPanel from './settings/AccountsPanel';
import BackupPanel from './settings/BackupPanel';
import AppSettings, { isAppSettingsTab } from './AppSettings';
import type { SiteBranding } from '../lib/settings';
import styles from './SiteSettings.module.css';

const descriptions: Record<string, [string, string]> = {
  site: ['Site', 'The site title, tagline, logo, icon and front page.'],
  accounts: ['Accounts', 'Control who can register, what they become, and how they sign in.'],
  general: ['General', 'What the public site shows, whose media each role sees, excerpts, and menu profile links.'],
  uploads: ['Uploads', 'File size and image dimension rules, and how much storage each role or person may use.'],
  seo: ['SEO', 'Meta keywords in the page editor, and tracking scripts such as Google Tag Manager.'],
  languages: ['Languages', 'The languages this site offers, the defaults for visitors and for the admin, and the public language switcher.'],
  roles: ['Roles', 'Extra capabilities for Subscribers and Contributors.'],
  backup: ['Backup', 'Download the whole site as one file, or restore a backup onto this site.'],
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
        : tab === 'backup' ? <BackupPanel />
          // One AppSettings instance for its four sections, so unsaved changes survive switching between them.
          : isAppSettingsTab(tab) ? <AppSettings tab={tab} />
            : <SiteSettingsPanel onBrandingChange={onBrandingChange} />}
    </section>
  );
}
