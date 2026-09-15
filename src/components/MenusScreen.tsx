import MenuManager from './MenuManager';
import WidgetAreas from './WidgetAreas';
import styles from './SiteSettings.module.css';

/** Menus → Menus or Sidebar & Widgets, chosen from the admin sidebar's submenu. */
export default function MenusScreen({ tab }: { tab: string }) {
  const widgets = tab === 'widgets';

  return (
    <section className={styles.container} aria-labelledby="menus-screen-heading">
      <div className={styles.pageIntro}>
        <h2 id="menus-screen-heading">{widgets ? 'Sidebar & Widgets' : 'Menus'}</h2>
        <p>{widgets ? 'Choose what appears in your sidebar and footer.' : 'Create and arrange the links shown on your public website.'}</p>
      </div>

      {widgets ? <WidgetAreas /> : <MenuManager />}
    </section>
  );
}
