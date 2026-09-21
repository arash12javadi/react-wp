import { lazy, Suspense, type ReactNode } from 'react';
import { addFilter } from '../../src/core/hooks';
import { addSlotContent } from '../../src/core/HookSlot';
import { tryGetSupabaseClient, describeDbError } from '../../src/lib/db';
import { currentI18nSettings, localeDefinition } from '../../src/lib/i18n';
import { defineRwpPlugin, type RwpAdminPageProps } from '../../src/lib/plugin-api';
import { translationsMigration } from '../../src/lib/translations';
import type { Page } from '../../src/lib/types';
import manifest from './manifest.json';
import stylesheet from './styles.css?inline';
import { BilingualField, PoText } from './components/BilingualText';
import ContinueReading, { markPostRead } from './components/ContinueReading';
import FloatingControls, { HeaderSwitch } from './components/FloatingControls';
import LanguageSwitch from './components/LanguageSwitch';
import PoCategoriesGrid, { type PoCategoriesGridProps } from './components/PoCategoriesGrid';
import SiteSettingsPanel from './components/SiteSettingsPanel';
import { contentTable, expandPageContent, markPageContent, startContentSync } from './lib/content';
import { setCollecting, startPageTranslator } from './lib/pageTranslator';
import { registerBundledPhrases } from './lib/phrases';
import { getPoSettings, subscribePoSettings } from './lib/settings';
import { startRuntime } from './lib/state';
import { registerStrings } from './lib/strings';
import { getCanTranslate, startViewer, subscribeViewer } from './lib/viewer';

/**
 * Persian Origins — bilingual content for React-WP, after the WordPress plugin of the same name.
 *
 * What it adds on top of core's languages:
 *   - a translation of each page and post (title, excerpt, body) in po_content_translations;
 *   - every language of a string in the DOM, with body classes (po-lang-*, po-dir-*, po-theme-*,
 *     po-font-*) deciding which one shows, so switching needs no request and no re-render;
 *   - a light/dark theme, a font per language (files in assets/fonts, discovered at build time)
 *     and a text size control, remembered in cookies and, when signed in, in the account;
 *   - the shortcodes [language_switch], [site_settings], [po_categories], [continue_reading] and
 *     [po_text].
 *
 * The language itself is core's locale: the switch calls setLocale(), so dir, lang, t(), the
 * header switcher and the Page Builder's per-language layouts all move together.
 */

const AdminScreen = lazy(() => import('./admin/AdminScreen'));

function AdminPage(props: RwpAdminPageProps) {
  return (
    <Suspense fallback={<div style={{ padding: 40, font: '500 15px system-ui', color: '#475569' }} role="status">Loading…</div>}>
      <AdminScreen {...props} />
    </Suspense>
  );
}

// Shortcode attributes ---------------------------------------------------------------------------------

const yes = (value: string | undefined, fallback: boolean) =>
  (value === undefined || value === '' ? fallback : /^(1|yes|true|on)$/i.test(value.trim()));
const list = (value: string | undefined) => (value || '').split(',').map((item) => item.trim()).filter(Boolean);
const whole = (value: string | undefined) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

/** Visibility rules for a language pair other than en/fa, which styles.css already covers. */
const pairRules = () => {
  const [first, second] = getPoSettings().languages;
  const safe = (code: string) => code.replace(/[^a-z0-9-]/g, '');
  return [first, second].map((code) => `body.po-lang-${safe(code)} .po-text:not(.po-text--${safe(code)}) { display: none; }`).join('\n');
};

function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const base = document.createElement('style');
  base.dataset.persianOrigins = 'styles';
  base.textContent = stylesheet;
  const pair = document.createElement('style');
  pair.dataset.persianOrigins = 'pair';
  pair.textContent = pairRules();
  document.head.append(base, pair);
  const unsubscribe = subscribePoSettings(() => { pair.textContent = pairRules(); });
  return () => {
    unsubscribe();
    base.remove();
    pair.remove();
  };
}

/** The Dashboard checklist: what still stops the plugin from working fully. */
async function setupNotices() {
  const notices = [];
  const supabase = tryGetSupabaseClient();
  const pair = getPoSettings().languages;
  const missing = pair.filter((code) => !currentI18nSettings().supported_languages.includes(code));
  if (missing.length) {
    notices.push({
      id: `po-languages-${missing.join('-')}`,
      level: 'required' as const,
      title: `Offer ${missing.map((code) => localeDefinition(code).name).join(' and ')} on the site`,
      description: 'Persian Origins switches between two languages the site must offer. Until then a visitor who switches is put back on the default language at the next page load.',
      steps: ['Open Settings → Languages.', `Tick ${missing.map((code) => localeDefinition(code).name).join(' and ')} and save.`],
      action: { label: 'Open Settings → Languages', section: 'settings', subsection: 'languages' },
    });
  }
  if (supabase) {
    const coreProbe = await supabase.from('rwp_translations').select('id', { count: 'exact', head: true });
    if (coreProbe.error && /schema cache|does not exist|PGRST205|42P01/i.test(describeDbError(coreProbe.error))) {
      notices.push({
        id: 'po-core-translations',
        level: 'required' as const,
        title: 'Run the translations migration for Site text',
        description: 'Menus, header, footer, widgets and category names are translated through core\'s translations table. Until it exists only the built-in interface text is translated, and nothing can be saved.',
        steps: [
          'Open Supabase → SQL Editor → New query.',
          `Paste the whole of ${translationsMigration} and click Run. It is safe to run again.`,
          'Reload this page.',
        ],
        action: { label: 'Open Supabase', href: 'https://supabase.com/dashboard/projects' },
      });
    }
    const probe = await supabase.from(contentTable).select('id', { count: 'exact', head: true });
    if (probe.error && /schema cache|does not exist|PGRST205|42P01/i.test(describeDbError(probe.error))) {
      notices.push({
        id: 'po-schema',
        level: 'required' as const,
        title: 'Install the Persian Origins database tables',
        description: 'Translations of pages, category images and saved display preferences need them. Activating the plugin under Plugins installs them when the site runs on npm start.',
        steps: [
          'Plugins → deactivate and activate Persian Origins again (npm start only), or',
          'open Supabase → SQL Editor, paste plugins/persian-origins/schema.sql and run it. It is safe to run again.',
        ],
        action: { label: 'Open Plugins', section: 'plugins' },
      });
    }
  }
  return notices;
}

export const persianOriginsCleanup = defineRwpPlugin(manifest, ({ admin, shortcodes, header, content, filters }) => {
  const cleanups: Array<() => void> = [
    registerStrings(),
    injectStyles(),
    startRuntime(),
    startContentSync(),
    // Site text: bundled Farsi first, then the translator that applies it to the rendered page.
    registerBundledPhrases(),
    startViewer(),
    subscribeViewer(() => setCollecting(getCanTranslate())),
    startPageTranslator(),

    // Last, so string filters from other plugins run on the plain title first. Returns a component
    // (the title in every language); core renders these filters' results as JSX children.
    filters.add<ReactNode>('rwp_post_title', (title, page) =>
      ((page as Page | undefined)?.id ? <BilingualField page={page as Page} field="title" text={String(title)} /> : title), 100),
    filters.add<ReactNode>('rwp_post_excerpt', (excerpt, page) =>
      ((page as Page | undefined)?.id && excerpt ? <BilingualField page={page as Page} field="excerpt" text={String(excerpt)} /> : excerpt), 100),
    filters.add<string>('rwp_page_content', (html, page) => {
      const viewed = page as Page | undefined;
      if (!viewed?.id) return html;
      // Recorded for [continue_reading]. Deferred: this filter runs while React renders.
      queueMicrotask(() => markPostRead(viewed));
      return markPageContent(html, viewed);
    }, 100),
    // First, so the marker is still at the start of the HTML and other content filters see
    // every language.
    addFilter<string>('the_content', (html) => expandPageContent(html), 1),

    shortcodes.register({
      name: 'language_switch',
      description: 'A switch between the two Persian Origins languages. Switches the whole site: text, direction and fonts.',
      example: '[language_switch mode="inline"]',
      attributes: [
        { name: 'mode', description: 'inline (default) or floating (fixed to the left edge).' },
        { name: 'class', description: 'Classes for the .po-switch-wrap element.' },
        { name: 'link_class', description: 'Classes for the button.' },
        { name: 'outer_class', description: 'Classes for the outer wrapper.' },
        { name: 'flags', description: 'yes to show flags instead of EN / فا.' },
      ],
      render: (attributes) => (
        <LanguageSwitch mode={attributes.mode === 'floating' ? 'floating' : 'inline'} className={attributes.class}
          linkClass={attributes.link_class} outerClass={attributes.outer_class} flags={yes(attributes.flags, false)} />
      ),
    }),
    shortcodes.register({
      name: 'site_settings',
      description: 'Theme (light/dark), a font per language and text size controls.',
      example: '[site_settings mode="panel"]',
      attributes: [
        { name: 'mode', description: 'full (default, embedded here) or panel (a button in the corner).' },
        { name: 'class', description: 'Extra classes.' },
      ],
      render: (attributes) => <SiteSettingsPanel mode={attributes.mode === 'panel' ? 'panel' : 'full'} className={attributes.class} />,
    }),
    shortcodes.register({
      name: 'po_categories',
      description: 'A grid of categories with their names and descriptions in the active language, and an image.',
      example: '[po_categories columns="3" hide_empty="true"]',
      attributes: [
        { name: 'columns', description: '1 to 6 (default 3). Fewer on small screens.' },
        { name: 'include / exclude', description: 'Comma-separated slugs or ids.' },
        { name: 'hide_empty', description: 'true to skip categories without published posts.' },
        { name: 'number', description: 'Show at most this many.' },
        { name: 'orderby / order', description: 'name, count, slug, id or order (Persian Origins → Categories); ASC or DESC.' },
        { name: 'show_description / show_count / image', description: 'yes or no (defaults: yes, no, yes).' },
      ],
      render: (attributes) => {
        const orderby = attributes.orderby as PoCategoriesGridProps['orderby'];
        return (
          <PoCategoriesGrid
            taxonomy={attributes.taxonomy || 'category'}
            columns={whole(attributes.columns) || 3}
            include={list(attributes.include)}
            exclude={list(attributes.exclude)}
            hideEmpty={yes(attributes.hide_empty, false)}
            number={whole(attributes.number)}
            orderby={['name', 'count', 'slug', 'id', 'order'].includes(orderby || '') ? orderby : 'name'}
            order={attributes.order?.toUpperCase() === 'DESC' ? 'DESC' : attributes.order ? 'ASC' : undefined}
            showDescription={yes(attributes.show_description, true)}
            showCount={yes(attributes.show_count, false)}
            showImage={yes(attributes.image, true)}
            className={attributes.class}
          />
        );
      },
    }),
    shortcodes.register({
      name: 'continue_reading',
      description: 'A button to the first post in a category this visitor has not read yet (oldest first).',
      example: '[continue_reading category="news"]',
      attributes: [
        { name: 'category', description: 'The category slug or id (required).' },
        { name: 'label', description: 'Fixed button text instead of "Continue reading: …".' },
        { name: 'class', description: 'Extra classes.' },
      ],
      render: (attributes) => <ContinueReading category={attributes.category || ''} label={attributes.label} className={attributes.class} />,
    }),
    shortcodes.register({
      name: 'po_text',
      description: 'A short text in each language; the active one shows.',
      example: '[po_text en="Welcome" fa="خوش آمدید"]',
      attributes: [{ name: 'en, fa, …', description: 'The text in each language. A missing one shows the first given.' }],
      render: (attributes) => {
        const { tag, ...values } = attributes;
        return <PoText values={values} tag={tag === 'div' ? 'div' : 'span'} />;
      },
    }),

    addSlotContent('after_footer', 'persian-origins-floating', () => <FloatingControls />),
    header.register({ id: 'persian-origins-switch', component: HeaderSwitch }),

    content.registerAction({
      id: 'persian-origins-translate',
      label: 'Translate',
      href: (page) => `/admin?section=persian-origins&tab=content&page=${page.id}`,
      show: (page) => !(page as Page & { is_site_template?: boolean }).is_site_template,
    }),

    admin.registerPage({
      id: 'persian-origins',
      label: 'Persian Origins',
      icon: '🌗',
      capability: 'edit_posts',
      component: AdminPage,
      submenu: [
        { id: 'content', label: 'Pages & posts', icon: '📝' },
        // Phrases are core translation keys, which only manage_options may write.
        { id: 'site-text', label: 'Site text', icon: '🔤', capability: 'manage_options' },
        // Category names are core translation keys, which only manage_options may write.
        { id: 'categories', label: 'Categories', icon: '🏷️', capability: 'manage_options' },
        { id: 'appearance', label: 'Appearance', icon: '🎨', capability: 'manage_options' },
      ],
    }),
    admin.registerSetupCheck({ id: 'persian-origins', capability: 'manage_options', run: setupNotices }),
  ];
  return () => cleanups.forEach((cleanup) => cleanup());
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    persianOriginsCleanup();
  });
}
