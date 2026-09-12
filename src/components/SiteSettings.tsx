import { useState } from 'react';
import SiteSettingsPanel from './settings/SiteSettingsPanel';
import AccountsPanel from './settings/AccountsPanel';
import styles from './SiteSettings.module.css';

type SettingsTab = 'site' | 'accounts';

const tabs: Array<[SettingsTab, string, string]> = [
  ['site', 'Site', 'Configure the basic information shown across your site.'],
  ['accounts', 'Accounts', 'Control who can register, what they become, and how they sign in.'],
];

export default function SiteSettings({ onSiteTitleChange }: { onSiteTitleChange?: (title: string) => void }) {
  const [tab, setTab] = useState<SettingsTab>('site');
  const active = tabs.find(([id]) => id === tab) || tabs[0];

  return (
    <section className={styles.container} aria-labelledby="settings-heading">
      <div className={styles.pageIntro}>
        <h2 id="settings-heading">Settings</h2>
        <p>{active[2]}</p>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Settings sections">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? styles.tabActive : styles.tab}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'site' && <SiteSettingsPanel onSiteTitleChange={onSiteTitleChange} />}
      {tab === 'accounts' && <AccountsPanel />}
    </section>
  );
}
