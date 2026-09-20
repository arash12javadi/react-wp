import {
  addFilter, addSlotContent, registerPluginTranslations, useTranslation, LanguageSwitcher,
} from '../../src/lib/plugin-api';

/**
 * A worked example of the hook and translation APIs. Everything a plugin can do with layout
 * zones, filters, priorities and languages is shown once here, in the order a plugin would
 * normally use it. Delete the call in index.tsx to switch it all off.
 *
 * Three things to know before reading on:
 *  - every register call returns a function that removes it again, and a plugin must return
 *    them from register() or its hooks keep running after deactivation;
 *  - `priority` works like WordPress's: lower runs first, 10 is the default;
 *  - a slot contribution that throws is caught and dropped, not allowed to take the page down.
 */

// 1. Translations ---------------------------------------------------------------------------
// Keys are namespaced with the plugin id so two plugins cannot collide. A locale the plugin
// does not ship falls back to English, and a key it does not ship falls back to the string
// passed to t() at the call site.

const translations = {
  en: {
    'sample.announcement': 'Free delivery on orders over {amount}.',
    'sample.sidebarTitle': 'From the sample plugin',
    'sample.commentRules': 'Be kind. Comments are moderated.',
  },
  fa: {
    'sample.announcement': 'ارسال رایگان برای سفارش‌های بالای {amount}.',
    'sample.sidebarTitle': 'از افزونهٔ نمونه',
    'sample.commentRules': 'مؤدب باشید. دیدگاه‌ها بررسی می‌شوند.',
  },
  ar: {
    'sample.announcement': 'توصيل مجاني للطلبات فوق {amount}.',
    'sample.sidebarTitle': 'من الإضافة النموذجية',
    'sample.commentRules': 'كن لطيفًا. التعليقات تخضع للمراجعة.',
  },
};

// 2. Components that read the active language ------------------------------------------------

/**
 * `useTranslation()` re-renders this on every language change, so the bar swaps language and
 * side without a reload. Nothing here mentions left or right: the bar inherits `dir` from
 * <html>, and the layout below uses logical properties.
 */
function AnnouncementBar() {
  const { t, isRtl, formatNumber } = useTranslation();
  return (
    <div
      className="rwp-sample-announcement"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingBlock: 8,
        paddingInline: 20,
        background: '#0f172a',
        color: '#fff',
        fontSize: '.85rem',
        // An RTL language reads the other way; the text follows on its own.
        textAlign: 'start',
      }}
    >
      <span>{t('sample.announcement', 'Free delivery on orders over {amount}.', { amount: formatNumber(50, { style: 'currency', currency: 'USD' }) })}</span>
      {/* A plugin can place its own switcher; `force` ignores the header setting. */}
      <LanguageSwitcher variant="inline" force showFlags />
      <span hidden>{isRtl ? 'rtl' : 'ltr'}</span>
    </div>
  );
}

function SampleSidebarWidget() {
  const { t } = useTranslation();
  return (
    <div className="rwp-sample-widget">
      <h2>{t('sample.sidebarTitle', 'From the sample plugin')}</h2>
      <p>Rendered through the <code>sidebar_widgets</code> slot.</p>
    </div>
  );
}

function CommentRules() {
  const { t } = useTranslation();
  return <p className="rwp-sample-comment-rules">{t('sample.commentRules', 'Be kind. Comments are moderated.')}</p>;
}

// 3. Registration -----------------------------------------------------------------------------

export function registerHookExamples(): () => void {
  const cleanups = [
    registerPluginTranslations('rwp-sample-plugin', translations),

    // --- Public layout zones -------------------------------------------------------------
    // <HookSlot name="before_header" /> in src/components/PublicLayout.tsx renders this.
    // Priority 5 puts the bar above anything registered at the default 10.
    addSlotContent('before_header', 'sample-announcement', () => <AnnouncementBar />, 5),

    // The slot passes its args through; this one gets { layout } from PublicLayout.
    addSlotContent('after_footer', 'sample-footer-note', (args) => (
      <p style={{ padding: 12, textAlign: 'center', fontSize: '.8rem', opacity: .7 }}>
        Sample plugin, rendered after the footer of a “{String(args.layout || 'boxed')}” page.
      </p>
    )),

    addSlotContent('sidebar_widgets', 'sample-widget', () => <SampleSidebarWidget />),

    // { pageId, commentsOpen, signedIn } come from CommentSection.
    addSlotContent('comment_form_before', 'sample-rules', (args) => (args.commentsOpen ? <CommentRules /> : null)),

    // --- Admin ------------------------------------------------------------------------------
    addSlotContent('admin_before_content', 'sample-admin-note', (args) => (
      args.section === 'dashboard'
        ? <div style={{ padding: 10, borderRadius: 8, background: '#eef2ff' }}>The sample plugin is active.</div>
        : null
    )),

    // --- Value filters ------------------------------------------------------------------------
    // Filters MUST return the value. One that returns undefined is logged and ignored rather
    // than blanking the page out.
    addFilter<string>('the_content', (html) => html.replace(/\{\{year\}\}/g, String(new Date().getFullYear()))),

    // Overrides one core string without shipping a dictionary for it. The extra arguments are
    // the key and the active locale.
    addFilter<string>('i18n_translate_key', (value, key, locale) => (
      key === 'header.login' && locale === 'en' ? 'Sign in' : value
    )),

    // --- Page builder --------------------------------------------------------------------------
    // Hides a widget from the panel for this site. Returning the array unchanged is a no-op.
    addFilter<Array<{ type: string }>>('builder_widgets', (widgets) => widgets.filter((widget) => widget.type !== 'code')),

    // A plugin tab in the builder sidebar: the button here, the panel body in the other slot.
    addSlotContent('builder_sidebar_tabs', 'sample-tab', (args) => (
      <button type="button" onClick={() => (args.setPanel as (id: string) => void)('sample-plugin')}>
        Sample
      </button>
    )),
    addSlotContent('builder_sidebar_panel', 'sample-panel', (args) => (
      args.panel === 'sample-plugin' ? <div style={{ padding: 16 }}>The sample plugin&rsquo;s builder panel.</div> : null
    )),
  ];

  return () => cleanups.forEach((cleanup) => cleanup());
}
