import { makeExcerpt } from './excerpt';
import type { Page } from './types';

export const seoTitleLimit = 60;
export const metaDescriptionLimit = 155;

export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  noindex: boolean;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  ogType: string;
  twitterCard: string;
}

interface MetaSource {
  siteTitle: string;
  siteTagline?: string;
  siteIcon?: string;
  origin: string;
}

/**
 * Single source of truth for a page's meta tags. The server injects these into the HTML and
 * the client re-applies them on navigation; sharing one builder keeps the two from drifting.
 */
export const buildMeta = (page: Partial<Page> | null, source: MetaSource): PageMeta => {
  const title = page?.seo_title?.trim()
    || (page?.title ? `${page.title} — ${source.siteTitle}` : source.siteTitle);
  const description = page?.meta_description?.trim()
    || page?.excerpt?.trim()
    || (page?.content ? makeExcerpt(page.content, 30) : source.siteTagline || '');
  const canonical = page?.canonical_url?.trim()
    || (page?.slug ? `${source.origin.replace(/\/$/, '')}/${page.slug}` : source.origin);

  return {
    title,
    description,
    canonical,
    noindex: Boolean(page?.noindex),
    ogTitle: page?.og_title?.trim() || title,
    ogDescription: page?.og_description?.trim() || description,
    ogImage: page?.og_image?.trim() || source.siteIcon || '',
    ogType: page?.is_post ? 'article' : 'website',
    twitterCard: page?.twitter_card || 'summary_large_image',
  };
};

const stripTags = (html: string) => {
  const element = document.createElement('div');
  element.innerHTML = html;
  return (element.textContent || '').toLowerCase();
};

export type CheckStatus = 'good' | 'warn' | 'bad';

export interface SeoCheck {
  id: string;
  label: string;
  status: CheckStatus;
}

/** Yoast-style checklist. Advisory only — these are heuristics, not ranking guarantees. */
export const analyzeSeo = (page: {
  title: string;
  slug: string;
  content: string;
  seo_title: string;
  meta_description: string;
  focus_keyword: string;
}): SeoCheck[] => {
  const keyword = page.focus_keyword.trim().toLowerCase();
  const bodyText = stripTags(page.content);
  const words = bodyText.trim() ? bodyText.trim().split(/\s+/).length : 0;
  const seoTitle = (page.seo_title || page.title).toLowerCase();
  const firstParagraph = bodyText.slice(0, 400);
  const checks: SeoCheck[] = [];

  const titleLength = (page.seo_title || page.title).length;
  checks.push({
    id: 'title-length',
    label: titleLength === 0
      ? 'No SEO title set'
      : titleLength > seoTitleLimit
        ? `SEO title is ${titleLength} characters — over ${seoTitleLimit}, so Google will truncate it`
        : `SEO title length is ${titleLength} characters`,
    status: titleLength === 0 ? 'bad' : titleLength > seoTitleLimit ? 'warn' : 'good',
  });

  const descriptionLength = page.meta_description.length;
  checks.push({
    id: 'description-length',
    label: descriptionLength === 0
      ? 'No meta description — search engines will invent one from the page text'
      : descriptionLength > metaDescriptionLimit
        ? `Meta description is ${descriptionLength} characters — over ${metaDescriptionLimit}`
        : `Meta description length is ${descriptionLength} characters`,
    status: descriptionLength === 0 ? 'bad' : descriptionLength > metaDescriptionLimit ? 'warn' : 'good',
  });

  checks.push({
    id: 'content-length',
    label: `Content is ${words} words${words < 300 ? ' — aim for at least 300' : ''}`,
    status: words >= 300 ? 'good' : words >= 150 ? 'warn' : 'bad',
  });

  if (!keyword) {
    checks.push({ id: 'keyword', label: 'No focus keyword set', status: 'warn' });
  } else {
    checks.push({
      id: 'keyword-title',
      label: seoTitle.includes(keyword) ? 'Focus keyword appears in the SEO title' : 'Focus keyword is missing from the SEO title',
      status: seoTitle.includes(keyword) ? 'good' : 'bad',
    });
    checks.push({
      id: 'keyword-slug',
      label: page.slug.toLowerCase().includes(keyword.replace(/\s+/g, '-'))
        ? 'Focus keyword appears in the slug' : 'Focus keyword is missing from the slug',
      status: page.slug.toLowerCase().includes(keyword.replace(/\s+/g, '-')) ? 'good' : 'warn',
    });
    checks.push({
      id: 'keyword-description',
      label: page.meta_description.toLowerCase().includes(keyword)
        ? 'Focus keyword appears in the meta description' : 'Focus keyword is missing from the meta description',
      status: page.meta_description.toLowerCase().includes(keyword) ? 'good' : 'warn',
    });
    checks.push({
      id: 'keyword-intro',
      label: firstParagraph.includes(keyword)
        ? 'Focus keyword appears early in the content' : 'Focus keyword does not appear in the opening text',
      status: firstParagraph.includes(keyword) ? 'good' : 'warn',
    });
  }

  const hasImage = /<img\b/i.test(page.content);
  const imagesWithoutAlt = (page.content.match(/<img\b(?![^>]*\balt=)[^>]*>/gi) || []).length;
  checks.push({
    id: 'images',
    label: !hasImage
      ? 'No images in the content'
      : imagesWithoutAlt > 0
        ? `${imagesWithoutAlt} image${imagesWithoutAlt === 1 ? '' : 's'} missing alt text`
        : 'All images have alt text',
    status: !hasImage ? 'warn' : imagesWithoutAlt > 0 ? 'bad' : 'good',
  });

  const links = (page.content.match(/<a\b[^>]*href=/gi) || []).length;
  checks.push({
    id: 'links',
    label: links > 0 ? `Content contains ${links} link${links === 1 ? '' : 's'}` : 'Content has no links',
    status: links > 0 ? 'good' : 'warn',
  });

  return checks;
};

export const seoScore = (checks: SeoCheck[]): number => {
  if (checks.length === 0) return 0;
  const points = checks.reduce((total, check) => total + (check.status === 'good' ? 1 : check.status === 'warn' ? 0.5 : 0), 0);
  return Math.round((points / checks.length) * 100);
};

/** Keeps the document head in sync during client-side navigation. */
export const applyMeta = (meta: PageMeta) => {
  document.title = meta.title;

  const setTag = (selector: string, create: () => HTMLElement, content: string) => {
    let element = document.head.querySelector<HTMLElement>(selector);
    if (!content) {
      element?.remove();
      return;
    }
    if (!element) {
      element = create();
      document.head.appendChild(element);
    }
    if (element instanceof HTMLLinkElement) element.href = content;
    else element.setAttribute('content', content);
  };

  const meta_ = (name: string, attribute: 'name' | 'property' = 'name') => () => {
    const element = document.createElement('meta');
    element.setAttribute(attribute, name);
    return element;
  };

  setTag('meta[name="description"]', meta_('description'), meta.description);
  setTag('meta[name="robots"]', meta_('robots'), meta.noindex ? 'noindex, nofollow' : '');
  setTag('meta[property="og:title"]', meta_('og:title', 'property'), meta.ogTitle);
  setTag('meta[property="og:description"]', meta_('og:description', 'property'), meta.ogDescription);
  setTag('meta[property="og:image"]', meta_('og:image', 'property'), meta.ogImage);
  setTag('meta[property="og:type"]', meta_('og:type', 'property'), meta.ogType);
  setTag('meta[property="og:url"]', meta_('og:url', 'property'), meta.canonical);
  setTag('meta[name="twitter:card"]', meta_('twitter:card'), meta.twitterCard);
  setTag('link[rel="canonical"]', () => {
    const element = document.createElement('link');
    element.rel = 'canonical';
    return element;
  }, meta.canonical);
};
