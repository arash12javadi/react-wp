import { useState } from 'react';
import MenuManager from './MenuManager';
import WidgetAreas from './WidgetAreas';
import styles from './SiteSettings.module.css';

type Tab = 'menus' | 'widgets';

const tabs: Array<[Tab, string, string]> = [
  ['menus', 'Menus', 'Create and arrange the links shown on your public website.'],
  ['widgets', 'Sidebar & Widgets', 'Choose what appears in your sidebar and footer.'],
];

export default function MenusScreen() {
  const [tab, setTab] = useState<Tab>('menus');
  const active = tabs.find(([id]) => id === tab) || tabs[0];

  return (
    <section className={styles.container} aria-labelledby="menus-screen-heading">
      <div className={styles.pageIntro}>
        <h2 id="menus-screen-heading">Menus &amp; Widgets</h2>
        <p>{active[2]}</p>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Menu sections">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            className={tab === id ? styles.tabActive : styles.tab} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'menus' ? <MenuManager /> : <WidgetAreas />}
    </section>
  );
}
