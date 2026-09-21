import type { RwpAdminPageProps } from '../../../src/lib/plugin-api';
import AppearanceTab from './AppearanceTab';
import CategoriesTab from './CategoriesTab';
import ContentTab from './ContentTab';
import SiteTextTab from './SiteTextTab';
import styles from './admin.module.css';

const intros: Record<string, [string, string]> = {
  'site-text': ['Site text', 'Every text on the public site — menus, header, footer, sidebar, buttons, forms, messages — by its original wording. Translate it once and it changes everywhere it appears.'],
  content: ['Translate pages and posts', 'A title, excerpt and body per language. Visitors switching language see them instantly; anything left empty shows the original.'],
  categories: ['Translate categories', 'Names and descriptions per language, and an image for the [po_categories] grid.'],
  appearance: ['Appearance', 'The language pair, the floating controls and the defaults for the theme and fonts.'],
};

/** Persian Origins in the admin. The sidebar's submenu picks the tab. */
export default function AdminScreen({ subsection, navigate }: RwpAdminPageProps) {
  const tab = intros[subsection] ? subsection : 'content';
  const [heading, description] = intros[tab];
  return (
    <section className={styles.screen} aria-labelledby="po-admin-heading">
      <div className={styles.intro}>
        <h2 id="po-admin-heading">{heading}</h2>
        <p>{description}</p>
      </div>
      {tab === 'site-text' && <SiteTextTab navigate={navigate} />}
      {tab === 'content' && <ContentTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'appearance' && <AppearanceTab navigate={navigate} />}
    </section>
  );
}
