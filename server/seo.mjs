/**
 * Renders real meta tags into the HTML response. Facebook, X, LinkedIn, WhatsApp and Slack
 * never execute JavaScript, so tags set by React alone would leave link previews blank.
 */

import { sanitizeTrackingHtml } from '../src/lib/scriptSanitizer.js';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const stripTags = (html) => String(html ?? '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const truncate = (text, words) => {
  const parts = stripTags(text).split(' ').filter(Boolean);
  return parts.length <= words ? parts.join(' ') : `${parts.slice(0, words).join(' ')}…`;
};

const get = async (baseUrl, key, path) => {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) return null;
  return response.json();
};

const optionsMap = async (baseUrl, key) => {
  const rows = await get(baseUrl, key, 'options?select=option_name,option_value&option_name=in.(site_title,site_tagline,site_description,site_icon,home_page_id,rwp_app_settings)');
  return (rows || []).reduce((result, row) => {
    result[row.option_name] = row.option_value;
    return result;
  }, {});
};

const readAppSettings = (value) => {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * The admin and the page builder get no SEO tags or tracking scripts, but they still need the
 * site title: without it the tab shows index.html's placeholder until the app replaces it.
 */
export async function renderEditorInjections(config) {
  const empty = { head: '', bodyStart: '' };
  if (!config?.supabaseUrl || !config?.supabasePublishableKey) return empty;
  try {
    const rows = await get(config.supabaseUrl, config.supabasePublishableKey, 'options?select=option_value&option_name=eq.site_title');
    const title = rows?.[0]?.option_value;
    return title ? { head: `<title>${escapeHtml(title)}</title>`, bodyStart: '' } : empty;
  } catch {
    return empty;
  }
}

/**
 * Everything written into the HTML response for a public path: SEO tags for <head>, and the
 * tracking snippets from App Settings → SEO. Scripts are written here rather than by React so
 * tag managers load before the app, and the <meta name="rwp-scripts"> marker tells the browser
 * not to inject them a second time. Any failure degrades to an unadorned page, never a 500.
 *
 * The Theme Editor's CSS, <head> code and footer scripts go in `headEnd` (just before </head>,
 * so the CSS comes after the app's stylesheet and wins at equal specificity) and `bodyEnd`.
 * <meta name="rwp-theme"> tells applyThemeDocument not to inject the scripts again.
 */
export async function renderDocumentInjections(pathname, origin, config) {
  const empty = { head: '', bodyStart: '', headEnd: '', bodyEnd: '' };
  if (!config?.supabaseUrl || !config?.supabasePublishableKey) return empty;
  try {
    const [options, theme] = await Promise.all([
      optionsMap(config.supabaseUrl, config.supabasePublishableKey),
      readTheme(config.supabaseUrl, config.supabasePublishableKey),
    ]);
    const app = readAppSettings(options.rwp_app_settings);
    const seoTags = await renderSeoTags(pathname, origin, config, options, app);
    const headScripts = sanitizeTrackingHtml(app.seo?.header_script || '').html;
    const bodyScripts = sanitizeTrackingHtml(app.seo?.body_script || '').html;
    return {
      head: [seoTags, '<meta name="rwp-scripts" content="server">', headScripts].filter(Boolean).join('\n    '),
      bodyStart: bodyScripts,
      ...renderTheme(theme),
    };
  } catch {
    return empty;
  }
}

// null when the migration has not run or the request failed; the browser then injects nothing
// itself either, because there is nothing saved to inject.
const readTheme = async (baseUrl, key) => {
  try {
    const rows = await get(baseUrl, key, 'theme_settings?select=custom_header_code,custom_footer_code,custom_css,custom_comments_css&limit=1');
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch {
    return null;
  }
};

/** Mirrors themeStylesheet and applyThemeDocument in the app. */
const renderTheme = (theme) => {
  if (!theme) return { headEnd: '', bodyEnd: '' };
  const css = [theme.custom_css, theme.custom_comments_css].filter((part) => String(part || '').trim()).join('\n\n');
  // "</style" would end the element early and turn the rest of the CSS into page markup.
  const style = css ? `<style id="rwp-theme-css">${css.replace(/<\/(style)/gi, '<\\/$1')}</style>` : '';
  return {
    headEnd: ['<meta name="rwp-theme" content="server">', style, sanitizeTrackingHtml(theme.custom_header_code || '').html].filter(Boolean).join('\n    '),
    bodyEnd: sanitizeTrackingHtml(theme.custom_footer_code || '').html,
  };
};

/**
 * Builds the SEO block for a request path. Returns an empty string on any failure so a
 * slow or unreachable database degrades to an unadorned page rather than a 500.
 */
async function renderSeoTags(pathname, origin, config, options, app) {
  const { supabaseUrl: baseUrl, supabasePublishableKey: key } = config;

  try {
    const siteTitle = options.site_title || 'React-WP';
    const tagline = options.site_tagline || options.site_description || '';

    const slug = pathname.replace(/^\/+|\/+$/g, '').replace(/^(posts|pages)\//, '');
    let page = null;
    if (slug) {
      const rows = await get(baseUrl, key, `pages?slug=eq.${encodeURIComponent(slug)}&status=eq.published&limit=1`);
      page = rows?.[0] || null;
    } else if (options.home_page_id) {
      const rows = await get(baseUrl, key, `pages?id=eq.${encodeURIComponent(options.home_page_id)}&status=eq.published&limit=1`);
      page = rows?.[0] || null;
    }

    const cleanOrigin = origin.replace(/\/$/, '');
    const title = page?.seo_title?.trim()
      || (page?.title ? `${page.title} — ${siteTitle}` : siteTitle);
    const description = page?.meta_description?.trim()
      || page?.excerpt?.trim()
      || (page?.content ? truncate(page.content, 30) : tagline);
    const canonical = page?.canonical_url?.trim()
      || (slug ? `${cleanOrigin}/${slug}` : cleanOrigin);
    const image = page?.og_image?.trim() || options.site_icon || '';
    const keywords = app.seo?.meta_keywords_enabled === true ? page?.meta_keywords?.trim() || '' : '';

    const tags = [
      `<title>${escapeHtml(title)}</title>`,
      description && `<meta name="description" content="${escapeHtml(description)}">`,
      keywords && `<meta name="keywords" content="${escapeHtml(keywords)}">`,
      page?.noindex && '<meta name="robots" content="noindex, nofollow">',
      `<link rel="canonical" href="${escapeHtml(canonical)}">`,
      `<meta property="og:site_name" content="${escapeHtml(siteTitle)}">`,
      `<meta property="og:title" content="${escapeHtml(page?.og_title?.trim() || title)}">`,
      description && `<meta property="og:description" content="${escapeHtml(page?.og_description?.trim() || description)}">`,
      `<meta property="og:type" content="${page?.is_post ? 'article' : 'website'}">`,
      `<meta property="og:url" content="${escapeHtml(canonical)}">`,
      image && `<meta property="og:image" content="${escapeHtml(image)}">`,
      `<meta name="twitter:card" content="${escapeHtml(page?.twitter_card || 'summary_large_image')}">`,
      image && `<meta name="twitter:image" content="${escapeHtml(image)}">`,
    ].filter(Boolean);

    return tags.join('\n    ');
  } catch {
    return '';
  }
}
