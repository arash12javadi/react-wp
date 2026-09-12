/**
 * Renders real meta tags into the HTML response. Facebook, X, LinkedIn, WhatsApp and Slack
 * never execute JavaScript, so tags set by React alone would leave link previews blank.
 */

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
  const rows = await get(baseUrl, key, 'options?select=option_name,option_value&option_name=in.(site_title,site_tagline,site_description,site_icon,home_page_id)');
  return (rows || []).reduce((result, row) => {
    result[row.option_name] = row.option_value;
    return result;
  }, {});
};

/**
 * Builds the <head> block for a request path. Returns an empty string on any failure so a
 * slow or unreachable database degrades to an unadorned page rather than a 500.
 */
export async function renderSeoTags(pathname, origin, config) {
  if (!config?.supabaseUrl || !config?.supabasePublishableKey) return '';
  const { supabaseUrl: baseUrl, supabasePublishableKey: key } = config;

  try {
    const options = await optionsMap(baseUrl, key);
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

    const tags = [
      `<title>${escapeHtml(title)}</title>`,
      description && `<meta name="description" content="${escapeHtml(description)}">`,
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
