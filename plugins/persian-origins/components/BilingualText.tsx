import { useEffect, useSyncExternalStore } from 'react';
import { directionOf } from '../../../src/lib/i18n';
import type { Page } from '../../../src/lib/types';
import { baseLocaleOf, getContentVersion, requestTranslations, subscribeContent, variantsOf, type TranslationFields } from '../lib/content';
import { useBilingual } from '../BilingualContext';

/**
 * A page's title or excerpt in every language at once, for the rwp_post_title and
 * rwp_post_excerpt filters. Returned as a component, not a string, because the feed does not
 * select this plugin's table: the component asks for the translation itself (batched with the
 * other posts on screen) and fills in when it arrives.
 *
 *   <span class="po-bi"><span class="po-text po-text--en po-text--base" lang="en">…</span>
 *                       <span class="po-text po-text--fa" lang="fa" dir="rtl">…</span></span>
 *
 * The body class decides which one shows (styles.css). Nothing extra is rendered for a page
 * with no translation of this field: it stays the plain string it was.
 */
export function BilingualField({ page, field, text }: { page: Page; field: keyof TranslationFields; text: string }) {
  useSyncExternalStore(subscribeContent, getContentVersion, getContentVersion);
  // Also re-renders when the pair of languages changes in the settings.
  useBilingual();
  useEffect(() => { requestTranslations(page.id); }, [page.id]);

  const { hasAny, variants } = variantsOf(page, field, text);
  if (!hasAny) return <>{text}</>;
  const base = baseLocaleOf(page);
  return (
    <span className="po-bi">
      {variants.map(({ code, text: value, isBase, isFallback }) => {
        const language = isFallback ? base : code;
        return (
          <span key={code} className={`po-text po-text--${code}${isBase ? ' po-text--base' : ''}`} lang={language} dir={directionOf(language)}>
            {value}
          </span>
        );
      })}
    </span>
  );
}

/**
 * [po_text en="Hello" fa="سلام"] — any short bilingual string inside page content or a Page
 * Builder Shortcode widget. A language without its attribute shows the first one given.
 */
export function PoText({ values, tag = 'span' }: { values: Record<string, string>; tag?: 'span' | 'div' }) {
  const { languages } = useBilingual();
  const Tag = tag;
  const codes = [...new Set([...languages, ...Object.keys(values)])].filter((code) => /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(code));
  const first = codes.find((code) => values[code]) || '';
  if (!first) return null;
  return (
    <Tag className="po-bi">
      {codes.map((code) => {
        const own = values[code];
        const language = own ? code : first;
        return (
          <Tag key={code} className={`po-text po-text--${code}${code === first ? ' po-text--base' : ''}`} lang={language} dir={directionOf(language)}>
            {own || values[first]}
          </Tag>
        );
      })}
    </Tag>
  );
}
