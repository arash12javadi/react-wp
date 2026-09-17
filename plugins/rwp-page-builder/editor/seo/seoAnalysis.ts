import { walkNodes } from '../../lib/tree';
import type { BuilderDocument, BuilderNode, BuilderPage, Device } from '../../lib/types';
import type { SeoFields } from '../../../../src/components/SeoPanel';
import { keywordResearchTasks, outreachTasks, progress, readChecklist } from './seoChecklists';
import type { ClickDepth, Loadable } from './siteSignals';

/**
 * SEO audit of the page as the builder canvas renders it. Everything here is measured from the
 * real widget output (the DOM) plus the layout JSON and the page's SEO fields.
 *
 * Some items on a professional SEO checklist cannot be measured from inside an editor (search
 * intent against live results, backlink profiles, domain authority, real dwell time). Those are
 * reported as "manual" with what to check, and are left out of the score rather than guessed.
 */

export type SeoStatus = 'pass' | 'warning' | 'fail' | 'manual' | 'na';
export type SeoCategory = 'critical' | 'high' | 'medium';
export type FindingStatus = 'pass' | 'warning' | 'fail' | 'info';

export interface SeoFinding {
  status: FindingStatus;
  text: string;
}

export interface SeoCheck {
  id: string;
  category: SeoCategory;
  title: string;
  status: SeoStatus;
  summary: string;
  findings: SeoFinding[];
  /** Things to verify outside the editor. */
  manual?: string[];
  /** False for task checklists: shown with progress, left out of the score. */
  scored?: boolean;
}

export interface SchemaObject {
  type: string;
  source: string;
  problems: string[];
}

export interface SeoStats {
  words: number;
  readingMinutes: number;
  keywordCount: number;
  density: number;
  headings: number;
  internalLinks: number;
  externalLinks: number;
  images: number;
}

export interface SeoReport {
  checks: SeoCheck[];
  score: number;
  rating: 'good' | 'needs-work' | 'poor';
  counts: Record<SeoStatus, number>;
  stats: SeoStats;
  /** Image URLs on the page, for the file size lookup against the media library. */
  imageUrls: string[];
  /** JSON-LD found in the canvas or produced by widgets on the live page. */
  schemas: SchemaObject[];
  device: Device;
  analyzedAt: number;
}

export interface AnalyzeInput {
  root: HTMLElement;
  doc: BuilderDocument;
  seo: SeoFields;
  page: BuilderPage;
  title: string;
  device: Device;
  /** Bytes per image URL from the media library; null when the URL is not in the library. */
  mediaSizes: Map<string, number | null>;
  /** Site-wide lookups (click depth, duplicate descriptions); loaded asynchronously. */
  signals?: {
    clickDepth: Loadable<ClickDepth>;
    duplicateDescriptions: Loadable<string[]>;
  };
  now?: number;
}

export const categoryLabels: Record<SeoCategory, string> = {
  critical: 'Critical SEO essentials',
  high: 'High priority',
  medium: 'Medium priority enhancements',
};

const categoryWeight: Record<SeoCategory, number> = { critical: 3, high: 2, medium: 1 };

export const TITLE_RANGE = [50, 60] as const;
export const DESCRIPTION_RANGE = [120, 160] as const;
export const SLUG_MAX = 75;
export const MAX_CLICK_DEPTH = 3;
const IMAGE_BYTES_LIMIT = 100 * 1024;
const MIN_TAP = 48;
const MIN_FONT = 16;

// DOM reading ----------------------------------------------------------------------------------------

const CHROME = '[data-rwpb-chrome]';
const inChrome = (element: Element) => Boolean(element.closest(CHROME));

const visible = (element: Element) => {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none';
};

const all = <T extends Element>(root: HTMLElement, selector: string) =>
  Array.from(root.querySelectorAll<T>(selector)).filter((element) => !inChrome(element));

/** Page text with block boundaries kept, without editor UI, scripts or styles. */
function pageText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`${CHROME}, script, style, noscript, template, svg`).forEach((element) => element.remove());
  const parts: string[] = [];
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue?.trim();
    if (value) parts.push(value);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-phrase matches, so "seo" does not count inside "seoul". */
const keywordPattern = (keyword: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${keyword.split(/\s+/).map(escapeRegExp).join('\\s+')}(?![\\p{L}\\p{N}])`, 'giu');

const countKeyword = (text: string, keyword: string) => (keyword ? (text.match(keywordPattern(keyword)) || []).length : 0);
const hasKeyword = (text: string, keyword: string) => Boolean(keyword) && countKeyword(text, keyword) > 0;

interface LinkInfo { element: HTMLAnchorElement; href: string; text: string; kind: 'internal' | 'external' | 'anchor' | 'other' | 'empty' }

function readLinks(root: HTMLElement): LinkInfo[] {
  const origin = window.location.origin;
  return all<HTMLAnchorElement>(root, 'a').map((element) => {
    const href = (element.getAttribute('href') || '').trim();
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim()
      || element.getAttribute('aria-label')?.trim()
      || element.querySelector('img')?.getAttribute('alt')?.trim()
      || '';
    let kind: LinkInfo['kind'] = 'other';
    if (!href || href === '#') kind = 'empty';
    else if (href.startsWith('#')) kind = 'anchor';
    else if (/^(mailto|tel|sms|javascript):/i.test(href)) kind = 'other';
    else if (!href.startsWith('//') && (href.startsWith('/') || !/^[a-z][a-z0-9+.-]*:/i.test(href))) kind = 'internal';
    else {
      // Malformed URLs are not counted as links rather than failing the whole audit.
      try { kind = new URL(href.startsWith('//') ? `https:${href}` : href).origin === origin ? 'internal' : 'external'; } catch { kind = 'other'; }
    }
    return { element, href, text, kind };
  });
}

const parseColor = (value: string): [number, number, number, number] | null => {
  const match = value.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/i);
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
  return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
};

const luminance = ([r, g, b]: [number, number, number, number]) => {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** WCAG contrast of an element's text against the first solid background behind it; null when unknowable. */
function textContrast(element: HTMLElement, root: HTMLElement): number | null {
  const foreground = parseColor(getComputedStyle(element).color);
  if (!foreground) return null;
  let background: [number, number, number, number] = [255, 255, 255, 1];
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.backgroundImage && style.backgroundImage !== 'none') return null;
    const color = parseColor(style.backgroundColor);
    if (color && color[3] >= 0.5) { background = color; break; }
    if (current === root) break;
  }
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

// Structured data -----------------------------------------------------------------------------------

const RICH_TYPES = ['Article', 'BlogPosting', 'NewsArticle', 'Product', 'FAQPage', 'Review', 'BreadcrumbList'];

const typesOf = (node: Record<string, unknown>): string[] => {
  const raw = node['@type'];
  return (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === 'string');
};

const filled = (value: unknown) => (typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined && !(Array.isArray(value) && !value.length));

/** Google's required properties for the rich result types this checklist targets. */
function schemaProblems(type: string, node: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const need = (key: string, label = key) => { if (!filled(node[key])) problems.push(`missing "${label}"`); };
  if (['Article', 'BlogPosting', 'NewsArticle'].includes(type)) {
    need('headline');
    if (typeof node.headline === 'string' && node.headline.length > 110) problems.push('"headline" is over 110 characters');
    need('author');
    need('datePublished');
    if (!filled(node.image)) problems.push('no "image" (recommended)');
  } else if (type === 'Product') {
    need('name');
    if (!filled(node.offers) && !filled(node.review) && !filled(node.aggregateRating)) problems.push('needs "offers", "review" or "aggregateRating"');
  } else if (type === 'FAQPage') {
    const questions = Array.isArray(node.mainEntity) ? node.mainEntity as Array<Record<string, unknown>> : [];
    if (!questions.length) problems.push('"mainEntity" has no questions');
    const incomplete = questions.filter((question) => !filled(question?.name) || !filled((question?.acceptedAnswer as Record<string, unknown> | undefined)?.text)).length;
    if (incomplete) problems.push(`${incomplete} question(s) without a name or answer text`);
  } else if (type === 'Review') {
    need('itemReviewed');
    need('author');
    if (!filled((node.reviewRating as Record<string, unknown> | undefined)?.ratingValue)) problems.push('missing "reviewRating.ratingValue"');
  } else if (type === 'BreadcrumbList') {
    if (!Array.isArray(node.itemListElement) || !node.itemListElement.length) problems.push('"itemListElement" is empty');
  }
  return problems;
}

/**
 * JSON-LD in the canvas (Custom HTML widgets render theirs there) plus what widgets output only on
 * the live page (FAQ schema on accordions, breadcrumb schema), rebuilt from their settings.
 */
function collectSchemas(root: HTMLElement, nodes: BuilderNode[]): SchemaObject[] {
  const found: SchemaObject[] = [];
  const addNode = (node: unknown, source: string) => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record['@graph'])) (record['@graph'] as unknown[]).forEach((item) => addNode(item, source));
    typesOf(record).forEach((type) => found.push({ type, source, problems: schemaProblems(type, record) }));
  };
  all<HTMLScriptElement>(root, 'script[type="application/ld+json"]').forEach((script) => {
    try {
      const parsed = JSON.parse(script.textContent || '');
      (Array.isArray(parsed) ? parsed : [parsed]).forEach((item) => addNode(item, 'Custom HTML'));
    } catch (error) {
      found.push({ type: 'Invalid JSON-LD', source: 'Custom HTML', problems: [`not valid JSON (${error instanceof Error ? error.message : 'parse error'})`] });
    }
  });
  nodes.forEach((node) => {
    if (node.kind !== 'widget') return;
    if (node.type === 'accordion' && node.settings.faqSchema) {
      const items = (Array.isArray(node.settings.items) ? node.settings.items : []) as Array<Record<string, unknown>>;
      addNode({
        '@type': 'FAQPage',
        mainEntity: items.map((item) => ({ '@type': 'Question', name: item.title, acceptedAnswer: { '@type': 'Answer', text: item.content } })),
      }, 'Accordion (FAQ schema)');
    }
    if (node.type === 'breadcrumbs' && node.settings.schema !== false) {
      addNode({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1 }] }, 'Breadcrumbs widget');
    }
  });
  return found;
}

// Checks ---------------------------------------------------------------------------------------------

const statusFromFindings = (findings: SeoFinding[], passWhenEmpty: SeoStatus = 'pass'): SeoStatus => {
  const measured = findings.filter((finding) => finding.status !== 'info');
  if (!measured.length) return passWhenEmpty;
  if (measured.some((finding) => finding.status === 'fail')) return 'fail';
  if (measured.some((finding) => finding.status === 'warning')) return 'warning';
  return 'pass';
};

const pass = (text: string): SeoFinding => ({ status: 'pass', text });
const warn = (text: string): SeoFinding => ({ status: 'warning', text });
const fail = (text: string): SeoFinding => ({ status: 'fail', text });
const info = (text: string): SeoFinding => ({ status: 'info', text });

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const genericAnchors = /^(click here|here|read more|more|learn more|this|link|this link|go|continue|details|see more|view more|page|website|click)$/i;
const actionVerbs = /\b(download|get started|get|start|buy|shop|order|sign up|subscribe|join|book|try|request|contact|call|register|claim|reserve|donate|apply|upgrade|discover|explore|save)\b/i;
const genericFileName = /^(img|image|dsc|dscn|dcim|photo|pic|pxl|screenshot|screen shot|untitled|capture|wp|whatsapp image)[\s_-]*\d/i;

const interactiveTypes = new Set([
  'accordion', 'tabs', 'toggle', 'form', 'video', 'video-playlist', 'slideshow', 'carousel', 'image-carousel', 'media-carousel',
  'hotspot', 'countdown', 'flip-box', 'google-maps', 'testimonial-carousel', 'table-of-contents', 'lottie', 'soundcloud',
  'facebook-embed', 'reviews', 'basic-gallery', 'gallery', 'portfolio',
]);

const powerWords = /\b(ultimate|essential|proven|complete|easy|simple|best|free|new|secret|secrets|powerful|quick|step-by-step|guide|amazing|exclusive|instant|effortless|expert|definitive|top|surprising|remarkable)\b/i;
const urgencyWords = /\b(now|today|don'?t miss|limited|last chance|hurry|before|fast|never|mistakes|why|how|what|stop|avoid|finally|revealed)\b/i;
const actionPhrases = /\b(learn more|learn how|start today|download now|get started|discover|find out|see why|try (it )?(free|now|today)|shop now|sign up|see how|book (now|today|a)|contact us|join|claim|explore|read on|get (yours|your|the))\b/i;
const readerWords = /\b(you|your|you'll|you're)\b/i;

export function analyzeSeoPage({ root, doc, seo, page, title, device, mediaSizes, signals, now = Date.now() }: AnalyzeInput): SeoReport {
  const keyword = seo.focus_keyword.trim().replace(/\s+/g, ' ').toLowerCase();
  const text = pageText(root);
  const lowerText = text.toLowerCase();
  const words = wordsOf(text);
  const wordCount = words.length;
  const firstHundred = words.slice(0, 100).join(' ');
  const keywordCount = countKeyword(lowerText, keyword);
  const density = wordCount && keyword ? (keywordCount / wordCount) * 100 : 0;

  const nodes: BuilderNode[] = [];
  walkNodes(doc.content, (node) => { if (!node.hidden) nodes.push(node); });
  const widgetsOfType = (...types: string[]) => nodes.filter((node) => node.kind === 'widget' && types.includes(node.type));
  const firstSectionIds = new Set<string>();
  if (doc.content[0]) walkNodes([doc.content[0]], (node) => firstSectionIds.add(node.id));

  const headings = all<HTMLHeadingElement>(root, 'h1, h2, h3, h4, h5, h6')
    .map((element) => ({ level: Number(element.tagName[1]), text: (element.textContent || '').replace(/\s+/g, ' ').trim() }))
    .filter((heading) => heading.text);
  const h1s = headings.filter((heading) => heading.level === 1);
  const subheadings = headings.filter((heading) => heading.level === 2 || heading.level === 3);

  const links = readLinks(root);
  const internal = links.filter((link) => link.kind === 'internal');
  const external = links.filter((link) => link.kind === 'external');

  const images = all<HTMLImageElement>(root, 'img').map((element) => ({
    element,
    src: element.currentSrc || element.getAttribute('src') || '',
    alt: element.getAttribute('alt'),
    decorative: element.getAttribute('role') === 'presentation' || Boolean(element.closest('[aria-hidden="true"]')),
  })).filter((image) => image.src);
  const contentImages = images.filter((image) => !image.decorative);

  const seoTitle = seo.seo_title.trim() || title.trim();
  const description = seo.meta_description.trim();
  const origin = window.location.origin;
  const ownUrl = `${origin}/${page.slug}`;
  const checks: SeoCheck[] = [];
  const needKeyword = 'Set a focus keyword above to run this check.';

  const checklist = readChecklist(doc.settings as Record<string, unknown>);
  const schemas = collectSchemas(root, nodes);

  // A. Critical ----------------------------------------------------------------------------------

  {
    const findings: SeoFinding[] = [];
    if (!keyword) findings.push(fail(needKeyword));
    else {
      const wordTotal = keyword.split(' ').length;
      findings.push(wordTotal >= 3
        ? pass(`“${keyword}” is a long-tail keyword (${wordTotal} words): specific, with more targeted visitors.`)
        : warn(`“${keyword}” is a short head term (${plural(wordTotal, 'word')}). These are highly competitive; target a longer, more specific phrase or add long-tail variations.`));
      const places = [
        ['title tag', hasKeyword(seoTitle.toLowerCase(), keyword)],
        ['meta description', hasKeyword(description.toLowerCase(), keyword)],
        ['URL', (page.slug || '').toLowerCase().includes(keyword.replace(/\s+/g, '-'))],
      ] as Array<[string, boolean]>;
      const missing = places.filter(([, present]) => !present).map(([label]) => label);
      findings.push(missing.length === 0 ? pass('Placed in the title tag, meta description and URL.') : (missing.length === 3 ? fail : warn)(`Not in the ${missing.join(', ')}.`));
      // Variations: headings or text using the keyword's words without repeating the exact phrase.
      const significant = keyword.split(' ').filter((word) => word.length > 3);
      const variations = significant.length > 1
        ? headings.filter((heading) => !hasKeyword(heading.text.toLowerCase(), keyword) && significant.filter((word) => heading.text.toLowerCase().includes(word)).length >= 1).length
        : 0;
      if (significant.length > 1) findings.push(variations ? pass(`${plural(variations, 'heading')} use variations of the keyword rather than repeating it exactly.`) : warn('No headings use variations or synonyms of the keyword. Related terms increase topical relevance.'));
      const done = progress(keywordResearchTasks, checklist);
      findings.push(info(`Research checklist: ${done} of ${keywordResearchTasks.length} done.`));
    }
    checks.push({ id: 'keywords', category: 'critical', title: 'Keywords', status: statusFromFindings(findings), summary: keyword ? `“${keyword}”` : 'No focus keyword yet.', findings });
  }

  {
    const findings: SeoFinding[] = [];
    const length = seoTitle.length;
    if (!seo.seo_title.trim()) findings.push(info(`No SEO title set; the page title is used.`));
    findings.push(length >= TITLE_RANGE[0] && length <= TITLE_RANGE[1]
      ? pass(`${length} characters (optimal ${TITLE_RANGE[0]}–${TITLE_RANGE[1]}).`)
      : (length === 0 || length < 30 || length > 70 ? fail : warn)(`${length} characters; keep title tags between ${TITLE_RANGE[0]} and ${TITLE_RANGE[1]}${length > TITLE_RANGE[1] ? ', or search results cut it off' : ''}.`));
    if (!keyword) findings.push(fail(needKeyword));
    else {
      const match = keywordPattern(keyword).exec(seoTitle.toLowerCase());
      if (!match) findings.push(fail('The focus keyword is not in the title.'));
      else if (match.index <= 10) findings.push(pass('The focus keyword is at the start of the title.'));
      else findings.push(warn(`The focus keyword starts at character ${match.index + 1}; move it to the beginning.`));
    }
    const boosters = [
      /\d/.test(seoTitle) ? 'a number' : '',
      /[[(].+[\])]/.test(seoTitle) ? 'brackets' : '',
      powerWords.test(seoTitle) ? `a power word (“${seoTitle.match(powerWords)?.[0]}”)` : '',
    ].filter(Boolean);
    findings.push(boosters.length ? pass(`CTR boosters: ${boosters.join(', ')}.`) : warn('No CTR boosters. Add a number or list size ("7 Ways…"), brackets ("[Step-by-Step Guide]") or a power word ("Essential", "Proven").'));
    findings.push(urgencyWords.test(seoTitle)
      ? pass(`Creates curiosity or urgency (“${seoTitle.match(urgencyWords)?.[0]}”).`)
      : warn('Nothing creates curiosity or urgency ("Don’t Miss Out", "Why…", "Mistakes to Avoid").'));
    checks.push({ id: 'title-tag', category: 'critical', title: 'SEO title tag', status: statusFromFindings(findings), summary: `“${seoTitle.slice(0, 60)}${seoTitle.length > 60 ? '…' : ''}”`, findings });
  }

  {
    const findings: SeoFinding[] = [];
    const length = description.length;
    if (!length) findings.push(fail('No meta description; search engines will pick text from the page.'));
    else {
      findings.push(length >= DESCRIPTION_RANGE[0] && length <= DESCRIPTION_RANGE[1]
        ? pass(`${length} characters (optimal ${DESCRIPTION_RANGE[0]}–${DESCRIPTION_RANGE[1]}).`)
        : (length < 70 || length > 200 ? fail : warn)(`${length} characters; aim for ${DESCRIPTION_RANGE[0]}–${DESCRIPTION_RANGE[1]}.`));
      if (!keyword) findings.push(fail(needKeyword));
      else {
        const count = countKeyword(description.toLowerCase(), keyword);
        findings.push(count === 1 ? pass('The primary keyword appears exactly once.')
          : count === 0 ? fail('The primary keyword is missing.')
            : warn(`The primary keyword appears ${count} times; use it exactly once.`));
      }
      findings.push(actionPhrases.test(description)
        ? pass(`Includes a call to action (“${description.match(actionPhrases)?.[0]}”).`)
        : warn('No call to action such as "Learn More", "Start Today" or "Download Now".'));
      findings.push(readerWords.test(description)
        ? pass('Speaks to the reader’s benefit ("you/your").')
        : warn('Does not address the reader. Highlight the benefit or solution for them.'));
      const duplicates = signals?.duplicateDescriptions;
      if (!duplicates || duplicates.state === 'loading') findings.push(info('Checking other pages for the same description…'));
      else if (duplicates.state === 'error') findings.push(info(duplicates.message));
      else findings.push(duplicates.value.length
        ? fail(`Also used by ${duplicates.value.map((name) => `“${name}”`).join(', ')}. Each page needs a unique description.`)
        : pass('Unique: no other page uses this description.'));
    }
    checks.push({ id: 'meta-description', category: 'critical', title: 'Meta description', status: statusFromFindings(findings), summary: length ? `${length} characters.` : 'Not set.', findings });
  }

  {
    const findings: SeoFinding[] = [];
    if (!keyword) findings.push(fail(needKeyword));
    else {
      findings.push(hasKeyword(seoTitle.toLowerCase(), keyword) ? pass('The SEO title targets the keyword.') : fail('The SEO title does not contain the keyword, so the page does not signal what it answers.'));
      findings.push(h1s.some((heading) => hasKeyword(heading.text.toLowerCase(), keyword)) ? pass('The main heading (H1) matches the keyword.') : warn('The H1 does not contain the keyword.'));
      findings.push(hasKeyword(description.toLowerCase(), keyword) ? pass('The meta description repeats the keyword, which search results bold.') : warn('The meta description does not contain the keyword.'));
      const question = /^(how|what|why|when|where|which|who|can|does|is|are|best|vs)\b/i.test(keyword);
      if (question) findings.push(subheadings.some((heading) => /\?$/.test(heading.text)) || h1s.some((heading) => /\?$/.test(heading.text))
        ? pass('The keyword is a question, and the page has question-style headings that answer it.')
        : warn('The keyword is a question, but no heading asks it. Informational searches reward a direct answer under a matching heading.'));
      if (/\b(buy|price|cheap|deal|discount|order|shop|coupon)\b/i.test(keyword)) findings.push(widgetsOfType('button', 'cta', 'price-table', 'shop-add-to-cart', 'paypal-button', 'stripe-button').length
        ? pass('The keyword has buying intent, and the page offers a way to act on it.')
        : warn('The keyword has buying intent, but the page has no button, price table or checkout action.'));
    }
    checks.push({
      id: 'search-intent', category: 'critical', title: 'Search intent match',
      status: statusFromFindings(findings),
      summary: keyword ? 'Relevance signals between the keyword and the page.' : 'No focus keyword yet.',
      findings,
      manual: ['Search the keyword in a private window and compare the top results: are they guides, product pages, lists or tools? Match that format.', 'Compare competitor headline structure (H1/H2 wording and order) with yours.'],
    });
  }

  {
    const findings: SeoFinding[] = [];
    if (!keyword) findings.push(fail(needKeyword));
    else {
      findings.push(hasKeyword(seoTitle.toLowerCase(), keyword) ? pass('Keyword in the page title.') : fail('Keyword missing from the page title.'));
      findings.push(hasKeyword(description.toLowerCase(), keyword) ? pass('Keyword in the meta description.') : warn('Keyword missing from the meta description.'));
      findings.push(headings.some((heading) => heading.level <= 2 && hasKeyword(heading.text.toLowerCase(), keyword)) ? pass('Keyword in an H1 or H2.') : warn('Keyword not in any H1 or H2.'));
      findings.push(hasKeyword(firstHundred, keyword) ? pass('Keyword appears in the first 100 words.') : warn('Keyword does not appear in the first 100 words.'));
    }
    const ctas = links.filter((link) => link.kind !== 'empty' && actionVerbs.test(link.text)).length + all<HTMLButtonElement>(root, 'button').filter((button) => actionVerbs.test(button.textContent || '')).length;
    findings.push(ctas ? pass(`${plural(ctas, 'clear call to action')} found.`) : warn('No clear call to action (a button or link such as "Get started", "Contact us" or "Download").'));
    const days = Math.floor((now - new Date(page.updated_at).getTime()) / 86_400_000);
    findings.push(days <= 180 ? pass(`Last saved ${days === 0 ? 'today' : `${plural(days, 'day')} ago`}.`) : warn(`Last saved ${plural(days, 'day')} ago. Review facts, dates and examples.`));
    checks.push({ id: 'content-optimization', category: 'critical', title: 'Content optimization', status: statusFromFindings(findings), summary: 'Keyword placement, calls to action and freshness.', findings });
  }

  {
    const findings: SeoFinding[] = [];
    if (h1s.length === 1) findings.push(pass('Exactly one H1.'));
    else if (h1s.length === 0) findings.push(fail(doc.settings.showTitle ? 'No H1 found.' : 'No H1. Turn on "Show the page title" in Page settings, or set a Heading widget to H1.'));
    else findings.push(fail(`${h1s.length} H1 headings (${h1s.map((heading) => `“${heading.text.slice(0, 40)}”`).join(', ')}). Keep one; make the others H2.`));
    if (keyword && h1s.length) findings.push(h1s.some((heading) => hasKeyword(heading.text.toLowerCase(), keyword)) ? pass('The H1 contains the focus keyword.') : fail('The H1 does not contain the focus keyword.'));
    const skips: string[] = [];
    headings.reduce((previous, heading) => {
      if (previous && heading.level > previous + 1) skips.push(`H${previous} → H${heading.level} (“${heading.text.slice(0, 40)}”)`);
      return heading.level;
    }, 0);
    if (headings.length && headings[0].level !== 1 && h1s.length) skips.unshift(`The first heading is H${headings[0].level}, before the H1.`);
    findings.push(skips.length ? warn(`Heading levels skip: ${skips.slice(0, 3).join('; ')}${skips.length > 3 ? '…' : ''}`) : pass('Heading levels run in order without skipping.'));
    if (keyword && headings.length >= 3) {
      const withKeyword = headings.filter((heading) => hasKeyword(heading.text.toLowerCase(), keyword)).length;
      const share = withKeyword / headings.length;
      findings.push(share > 0.5 ? warn(`The keyword is in ${withKeyword} of ${headings.length} headings. That reads as keyword stuffing; use variations.`) : pass(`Keyword used in ${withKeyword} of ${headings.length} headings.`));
    }
    checks.push({ id: 'headings', category: 'critical', title: 'Heading tags (H1–H3)', status: statusFromFindings(findings), summary: `${plural(headings.length, 'heading')} on the page.`, findings });
  }

  {
    const findings: SeoFinding[] = [];
    if (device !== 'mobile') findings.push(info('Measured at the current preview width. Switch the preview to Mobile for mobile sizes.'));
    const targets = all<HTMLElement>(root, 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"]').filter(visible);
    const small = targets.filter((element) => {
      // Links inside running text are exempt, as in Lighthouse: they cannot be 48px tall.
      if (element.tagName === 'A') {
        const block = element.parentElement?.closest('p, li, td, blockquote, figcaption, dd');
        if (block && (block.textContent || '').trim().length > (element.textContent || '').trim().length + 10) return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width < MIN_TAP || rect.height < MIN_TAP;
    });
    if (!targets.length) findings.push(info('No buttons or links to measure.'));
    else findings.push(small.length === 0
      ? pass(`All ${plural(targets.length, 'tap target')} are at least ${MIN_TAP}×${MIN_TAP}px.`)
      : (small.length / targets.length > 0.3 ? fail : warn)(`${small.length} of ${targets.length} tap targets are smaller than ${MIN_TAP}×${MIN_TAP}px (e.g. ${small.slice(0, 3).map((element) => `“${(element.textContent || element.getAttribute('aria-label') || element.tagName).trim().slice(0, 24)}”`).join(', ')}).`));

    const textElements = all<HTMLElement>(root, 'p, li, td, th, blockquote, figcaption, label, dd, dt, span, a')
      .filter((element) => Array.from(element.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && child.nodeValue?.trim()))
      .slice(0, 800);
    const tiny = textElements.filter((element) => parseFloat(getComputedStyle(element).fontSize) < MIN_FONT);
    if (textElements.length) {
      const smallest = tiny.reduce((min, element) => Math.min(min, parseFloat(getComputedStyle(element).fontSize)), Infinity);
      findings.push(tiny.length === 0 ? pass(`All body text is at least ${MIN_FONT}px.`)
        : (smallest < 12 ? fail : warn)(`${tiny.length} of ${textElements.length} text elements are below ${MIN_FONT}px (smallest ${Math.round(smallest)}px).`));
    }

    const lazyCandidates = contentImages.slice(1);
    const eager = lazyCandidates.filter((image) => image.element.getAttribute('loading') !== 'lazy');
    if (contentImages.length > 1) findings.push(eager.length === 0 ? pass('Images below the first one load lazily.') : warn(`${eager.length} of ${lazyCandidates.length} images after the first do not use loading="lazy".`));

    const fields = all<HTMLInputElement>(root, 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), select, textarea');
    if (fields.length) {
      const unlabeled = fields.filter((field) => !(field.labels?.length || field.getAttribute('aria-label') || field.getAttribute('aria-labelledby') || field.closest('label')));
      const smallFields = fields.filter((field) => parseFloat(getComputedStyle(field).fontSize) < MIN_FONT);
      const emailTyped = fields.filter((field) => /mail/i.test(`${field.getAttribute('name') || ''} ${field.getAttribute('placeholder') || ''}`) && field.getAttribute('type') !== 'email');
      findings.push(unlabeled.length ? fail(`${plural(unlabeled.length, 'form field')} without a label.`) : pass('Every form field has a label.'));
      findings.push(smallFields.length ? warn(`${plural(smallFields.length, 'form field')} below ${MIN_FONT}px, which makes iPhones zoom in on focus.`) : pass(`Form fields use ${MIN_FONT}px text or larger.`));
      if (emailTyped.length) findings.push(warn(`${plural(emailTyped.length, 'email field')} not using type="email", so phones do not show the email keyboard.`));
    }
    checks.push({ id: 'mobile', category: 'critical', title: 'Mobile optimization & usability', status: statusFromFindings(findings), summary: `Tap targets, font sizes, lazy images and forms (${device} preview).`, findings });
  }

  {
    const findings: SeoFinding[] = [];
    findings.push(seo.noindex ? fail('"Ask search engines not to index this page" is on, so it will not appear in search results.') : pass('The page can be indexed.'));
    const canonical = seo.canonical_url.trim();
    findings.push(!canonical || canonical.replace(/\/$/, '') === ownUrl ? pass('Canonical URL points to this page.') : warn(`Canonical URL points to ${canonical}, so search engines credit that address instead.`));
    if (page.status !== 'published') findings.push(info('The page is a draft; search engines cannot see it until it is published.'));
    checks.push({ id: 'indexing', category: 'critical', title: 'Indexing & canonical', status: statusFromFindings(findings), summary: 'Whether search engines may show this page, and at which address.', findings });
  }

  // B. High ---------------------------------------------------------------------------------------

  {
    const findings: SeoFinding[] = [];
    const target = Math.max(1, Math.floor(wordCount / 150));
    const ideal = Math.max(1, Math.ceil(wordCount / 100));
    findings.push(internal.length >= target
      ? pass(`${plural(internal.length, 'internal link')} for ${wordCount} words (target ${target}–${ideal}).`)
      : (internal.length === 0 ? fail : warn)(`${plural(internal.length, 'internal link')} for ${wordCount} words; aim for ${target}–${ideal} (one per 100–150 words).`));
    const generic = internal.concat(external).filter((link) => genericAnchors.test(link.text));
    findings.push(generic.length ? warn(`${plural(generic.length, 'link')} with generic anchor text (${[...new Set(generic.map((link) => `“${link.text}”`))].slice(0, 3).join(', ')}). Describe the destination instead.`) : pass('No generic anchor text such as "click here".'));
    const noText = internal.concat(external).filter((link) => !link.text);
    if (noText.length) findings.push(warn(`${plural(noText.length, 'link')} with no text or label.`));
    const byTarget = new Map<string, number>();
    internal.forEach((link) => byTarget.set(link.href.replace(/#.*$/, ''), (byTarget.get(link.href.replace(/#.*$/, '')) || 0) + 1));
    const duplicates = [...byTarget.entries()].filter(([, count]) => count > 1);
    findings.push(duplicates.length ? warn(`Repeated link targets: ${duplicates.slice(0, 3).map(([href, count]) => `${href} ×${count}`).join(', ')}. Only the first anchor text is usually counted.`) : pass('No internal link target is repeated.'));
    const dead = links.filter((link) => link.kind === 'empty');
    findings.push(dead.length ? warn(`${plural(dead.length, 'link or button')} with no destination (empty or "#" link).`) : pass('Every link has a destination.'));
    checks.push({
      id: 'internal-links', category: 'high', title: 'Internal linking', status: statusFromFindings(findings),
      summary: `${plural(internal.length, 'internal link')}.`, findings,
      manual: ['Make sure other pages link to this one; a page nothing links to (an orphan) is hard for search engines to find.'],
    });
  }

  {
    const findings: SeoFinding[] = [];
    if (!external.length) findings.push(info('No outbound links. Citing a reputable source can support factual content.'));
    else {
      const sameTab = external.filter((link) => link.element.getAttribute('target') !== '_blank');
      const unsafe = external.filter((link) => link.element.getAttribute('target') === '_blank' && !/\bnoopener\b|\bnoreferrer\b/i.test(link.element.getAttribute('rel') || ''));
      findings.push(sameTab.length ? warn(`${plural(sameTab.length, 'external link')} open in the same tab.`) : pass('External links open in a new tab.'));
      findings.push(unsafe.length ? warn(`${plural(unsafe.length, 'external link')} opening a new tab without rel="noopener".`) : pass('New-tab links use rel="noopener".'));
      const insecure = external.filter((link) => /^http:\/\//i.test(link.href));
      if (insecure.length) findings.push(warn(`${plural(insecure.length, 'external link')} use http:// instead of https://.`));
      const domains = [...new Set(external.map((link) => { try { return new URL(link.href, origin).hostname; } catch { return ''; } }).filter(Boolean))];
      findings.push(info(`Linking out to: ${domains.slice(0, 5).join(', ')}${domains.length > 5 ? '…' : ''}`));
    }
    checks.push({
      id: 'external-links', category: 'high', title: 'External linking & backlinks', status: statusFromFindings(findings, 'pass'),
      summary: `${plural(external.length, 'outbound link')}.`, findings,
      manual: [
        'Check that outbound links go to authoritative, relevant sites (a tool such as Ahrefs, Semrush or Moz shows domain authority).',
        'Backlink anchor text (from other sites to this page) is only visible in Google Search Console or a backlink tool. A natural mix is roughly 50% branded, 30% descriptive, 20% exact-match.',
      ],
    });
  }

  {
    const findings: SeoFinding[] = [];
    if (!contentImages.length) findings.push(wordCount >= 300 ? warn('No images. Visuals break up text and can rank in image search.') : info('No images on the page.'));
    else {
      const missingAlt = contentImages.filter((image) => !image.alt?.trim());
      const coverage = Math.round(((contentImages.length - missingAlt.length) / contentImages.length) * 100);
      findings.push(missingAlt.length ? fail(`ALT text coverage ${coverage}%: ${plural(missingAlt.length, 'image')} without ALT text.`) : pass('ALT text coverage 100%.'));
      const known = contentImages.map((image) => ({ image, bytes: mediaSizes.get(image.src) })).filter((entry) => typeof entry.bytes === 'number') as Array<{ image: typeof contentImages[number]; bytes: number }>;
      const heavy = known.filter((entry) => entry.bytes > IMAGE_BYTES_LIMIT);
      const unknown = contentImages.length - known.length;
      if (known.length) findings.push(heavy.length ? warn(`${plural(heavy.length, 'image')} over 100 KB (largest ${Math.round(Math.max(...heavy.map((entry) => entry.bytes)) / 1024)} KB). Compress them or serve a smaller size.`) : pass(`${plural(known.length, 'library image')} under 100 KB.`));
      if (unknown) findings.push(info(`${plural(unknown, 'image')} not found in the media library, so their file size is unknown.`));
      const badNames = contentImages.filter((image) => {
        const name = decodeURIComponent(image.src.split('?')[0].split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '');
        return genericFileName.test(name) || /^[\d_-]+$/.test(name) || /^[a-f0-9]{16,}$/i.test(name);
      });
      findings.push(badNames.length ? warn(`${plural(badNames.length, 'image')} with non-descriptive file names (e.g. ${badNames[0].src.split('/').pop()?.split('?')[0]}). Rename to describe the picture before uploading.`) : pass('Image file names are descriptive.'));
      const needed = Math.max(1, Math.floor(wordCount / 500));
      if (wordCount >= 500) findings.push(contentImages.length >= needed ? pass(`${plural(contentImages.length, 'image')} for ${wordCount} words (at least ${needed}).`) : warn(`${plural(contentImages.length, 'image')} for ${wordCount} words; aim for at least one per 500 words (${needed}).`));
    }
    checks.push({ id: 'images', category: 'high', title: 'Image optimization', status: statusFromFindings(findings, 'pass'), summary: `${plural(contentImages.length, 'image')}.`, findings });
  }

  {
    const findings: SeoFinding[] = [];
    if (!keyword) findings.push(fail(needKeyword));
    else if (!wordCount) findings.push(fail('The page has no text to measure.'));
    else {
      const rounded = Math.round(density * 100) / 100;
      const detail = `“${keyword}” appears ${plural(keywordCount, 'time')} in ${wordCount} words: ${rounded}%.`;
      if (density >= 1 && density <= 2) findings.push(pass(`${detail} Within the 1.0–2.0% target.`));
      else if (density === 0) findings.push(fail(`${detail} Use the keyword in the body text.`));
      else if (density < 1) findings.push(warn(`${detail} Below the 1.0% target.`));
      else findings.push((density > 3 ? fail : warn)(`${detail} Above 2.0%, which can read as keyword stuffing.`));
    }
    checks.push({ id: 'keyword-density', category: 'high', title: 'Keyword density', status: statusFromFindings(findings), summary: keyword ? `${Math.round(density * 100) / 100}% (target 1.0–2.0%).` : 'No focus keyword yet.', findings });
  }

  {
    const findings: SeoFinding[] = [];
    const slug = page.slug || '';
    const path = `/${slug}`;
    findings.push(path.length < SLUG_MAX ? pass(`${path.length} characters (under ${SLUG_MAX}).`) : fail(`${path.length} characters; keep URLs under ${SLUG_MAX} characters.`));
    if (!keyword) findings.push(fail(needKeyword));
    else findings.push(slug.toLowerCase().includes(keyword.replace(/\s+/g, '-')) ? pass('Contains the target keyword.') : fail(`Missing the primary keyword; e.g. /${keyword.replace(/\s+/g, '-')}.`));
    findings.push(/_/.test(slug) ? fail('Uses underscores. Search engines read hyphens (-) as word separators, not underscores (_).') : pass('Uses hyphens, not underscores.'));
    const special = slug.replace(/[a-z0-9/_-]/gi, '');
    findings.push(special || /[?&=%#]/.test(slug) ? fail(`Contains special characters or parameters (${[...new Set(special.split(''))].join(' ') || '?&=%#'}).`) : pass('No special characters or parameters.'));
    if (/\d/.test(slug)) findings.push(warn('Contains numbers. Dates and counts in a URL go stale; leave them out unless they are part of the name.'));
    if (/[A-Z]/.test(slug)) findings.push(warn('Has capital letters; URLs are case-sensitive, so lowercase avoids duplicates.'));
    const nesting = slug.split('/').filter(Boolean).length;
    if (nesting > MAX_CLICK_DEPTH) findings.push(fail(`The path is nested ${nesting} levels deep.`));
    const depth = signals?.clickDepth;
    if (!depth || depth.state === 'loading') findings.push(info('Measuring clicks from the home page…'));
    else if (depth.state === 'error') findings.push(info(depth.message));
    else if (depth.value.depth === null) findings.push(page.status === 'published'
      ? fail('No published page, menu, header or footer links here, so visitors and crawlers cannot reach it by clicking (an orphan page).')
      : warn('Nothing links here yet. Once published, link it from a menu or a page close to the home page.'));
    else findings.push(depth.value.depth <= MAX_CLICK_DEPTH
      ? pass(`${plural(depth.value.depth, 'click')} from the home page (${depth.value.path.join(' → ')}).`)
      : fail(`${depth.value.depth} clicks from the home page (${depth.value.path.join(' → ')}); important pages should be ${MAX_CLICK_DEPTH} or fewer.`));
    findings.push(info('The slug is edited under Pages & Posts → Edit.'));
    checks.push({ id: 'url-slug', category: 'high', title: 'URL slug', status: statusFromFindings(findings), summary: path, findings });
  }

  {
    const findings: SeoFinding[] = [];
    if (!schemas.length) findings.push(fail('No structured data. Schema markup makes the page eligible for rich results (stars, FAQs, breadcrumbs, article details).'));
    schemas.forEach((schema) => {
      const rich = RICH_TYPES.includes(schema.type);
      if (schema.problems.length) findings.push((schema.type === 'Invalid JSON-LD' ? fail : warn)(`${schema.type} from ${schema.source}: ${schema.problems.join('; ')}.`));
      else findings.push(rich ? pass(`${schema.type} from ${schema.source} has the required properties.`) : info(`${schema.type} from ${schema.source}.`));
    });
    const types = new Set(schemas.map((schema) => schema.type));
    const hasArticle = ['Article', 'BlogPosting', 'NewsArticle'].some((type) => types.has(type));
    if (page.is_post && !hasArticle) findings.push(warn('This is a post but has no Article schema. Use “Copy Article schema” below and paste it into a Custom HTML widget.'));
    const questionAccordions = nodes.filter((node) => node.kind === 'widget' && node.type === 'accordion' && !node.settings.faqSchema
      && (Array.isArray(node.settings.items) ? node.settings.items as Array<Record<string, unknown>> : []).some((item) => /\?\s*$/.test(String(item.title || ''))));
    if (questionAccordions.length && !types.has('FAQPage')) findings.push(warn('An accordion contains questions but its FAQ schema is off. Turn on "FAQ schema (structured data)" in the widget.'));
    const productWidgets = nodes.some((node) => node.kind === 'widget' && node.type.startsWith('shop-product'));
    if (productWidgets && !types.has('Product')) findings.push(warn('Shows product widgets but has no Product schema.'));
    if (nodes.some((node) => node.kind === 'widget' && ['reviews', 'testimonial', 'testimonial-carousel', 'star-rating'].includes(node.type)) && !types.has('Review') && !types.has('Product')) {
      findings.push(info('Has review or rating widgets. Review schema only earns stars when it reviews a specific product, service or work.'));
    }
    findings.push(info(page.status === 'published' ? 'Validate the live page with Google’s Rich Results Test (link below).' : 'Publish, then validate with Google’s Rich Results Test; drafts are not public, so paste the code into the test instead.'));
    checks.push({
      id: 'structured-data', category: 'high', title: 'Structured data (Schema)', status: statusFromFindings(findings),
      summary: schemas.length ? [...types].join(', ') : 'No JSON-LD found.', findings,
    });
  }

  // C. Medium -------------------------------------------------------------------------------------

  {
    const findings: SeoFinding[] = [];
    const rootTop = root.getBoundingClientRect().top;
    const buttons = all<HTMLElement>(root, '.rwpb-button, .rwpb-cta a, .rwpb-cta button, a[role="button"], button:not([type="submit"])').filter(visible);
    const actionButtons = buttons.filter((element) => actionVerbs.test(element.textContent || ''));
    findings.push(actionButtons.length ? pass(`Action wording on ${plural(actionButtons.length, 'button')} (e.g. “${(actionButtons[0].textContent || '').trim().slice(0, 30)}”).`) : warn('No button uses a strong action verb such as "Download", "Get started" or "Book".'));
    const fold = device === 'mobile' ? 700 : 900;
    const aboveFold = buttons.filter((element) => element.getBoundingClientRect().top - rootTop < fold);
    findings.push(aboveFold.length ? pass('A call-to-action button is visible near the top of the page.') : warn('No call-to-action button in the first screen of the page.'));
    const lowContrast = buttons.map((element) => ({ element, ratio: textContrast(element, root) })).filter((entry) => entry.ratio !== null && entry.ratio < 4.5);
    if (buttons.length) findings.push(lowContrast.length ? warn(`${plural(lowContrast.length, 'button')} with low text contrast (${Math.round((lowContrast[0].ratio || 0) * 10) / 10}:1; aim for 4.5:1).`) : pass('Button text contrast is readable.'));
    checks.push({
      id: 'ctr', category: 'medium', title: 'CTR optimization', status: statusFromFindings(findings), summary: 'Calls to action and how they stand out.', findings,
      manual: ['Search result click-through rate is reported in Google Search Console → Performance.'],
    });
  }

  {
    const findings: SeoFinding[] = [];
    const interactive = nodes.filter((node) => node.kind === 'widget' && interactiveTypes.has(node.type));
    const faqs = widgetsOfType('accordion', 'toggle').filter((node) => /faq|question/i.test(`${node.label || ''} ${JSON.stringify(node.settings)}`) || /\?/.test(JSON.stringify(node.settings)));
    const media = widgetsOfType('video', 'video-playlist', 'soundcloud', 'lottie');
    findings.push(interactive.length ? pass(`${plural(interactive.length, 'interactive element')}: ${[...new Set(interactive.map((node) => node.type))].slice(0, 5).join(', ')}.`) : warn('No interactive elements (accordion, tabs, form, gallery, video…).'));
    findings.push(faqs.length ? pass('Has an FAQ-style accordion.') : warn('No FAQ section. Answering common questions keeps visitors reading and can win "People also ask".'));
    findings.push(media.length ? pass(`Has ${plural(media.length, 'video or audio element')}.`) : info('No video or audio.'));
    const minutes = wordCount / 200;
    findings.push(minutes >= 2 || media.length ? pass(`About ${Math.max(1, Math.round(minutes))} min of reading${media.length ? ' plus media' : ''}, enough for a 2-minute visit.`) : warn(`About ${Math.max(1, Math.round(minutes))} min of reading; less than the 2 minutes that signals an engaged visit.`));
    checks.push({
      id: 'engagement', category: 'medium', title: 'Bounce rate & user retention', status: statusFromFindings(findings), summary: 'Content that keeps visitors on the page.', findings,
      manual: ['Real dwell time and bounce rate come from analytics (e.g. Google Analytics → Engagement).', 'The builder has no poll widget; a Form widget can collect quick votes.'],
    });
  }

  {
    const findings: SeoFinding[] = [];
    findings.push(seo.og_title.trim() ? pass('Social title set.') : warn('No social title; the SEO title is shared instead.'));
    findings.push(seo.og_description.trim() ? pass('Social description set.') : warn('No social description; the meta description is shared instead.'));
    findings.push(seo.og_image.trim() ? pass('Social image set.') : fail('No social image; links shared on social media show the site icon or nothing.'));
    checks.push({ id: 'social', category: 'medium', title: 'Social sharing (Open Graph)', status: statusFromFindings(findings), summary: 'How links to this page look when shared.', findings });
  }

  {
    const crumbs = widgetsOfType('breadcrumbs');
    const findings: SeoFinding[] = [];
    if (!crumbs.length) findings.push(page.is_post ? warn('No Breadcrumbs widget. Posts benefit from a trail back to their category.') : info('No Breadcrumbs widget. Useful on pages that sit below another page or category.'));
    else {
      findings.push(pass('A Breadcrumbs widget links back through the site.'));
      findings.push(crumbs.some((node) => node.settings.schema !== false) ? pass('BreadcrumbList structured data (JSON-LD) is enabled.') : warn('Breadcrumb structured data is off; turn on "BreadcrumbList structured data" in the widget.'));
      findings.push(crumbs.some((node) => firstSectionIds.has(node.id)) ? pass('The breadcrumb trail is at the top of the page.') : warn('The breadcrumb trail is not in the first section.'));
    }
    checks.push({ id: 'breadcrumbs', category: 'medium', title: 'Breadcrumbs navigation', status: crumbs.length || page.is_post ? statusFromFindings(findings) : 'na', summary: crumbs.length ? 'Breadcrumbs present.' : 'No breadcrumbs.', findings });
  }

  {
    const paginated = nodes.filter((node) => node.kind === 'widget' && ['numbers', 'prev-next'].includes(String(node.settings.pagination || '')));
    const findings: SeoFinding[] = [];
    if (paginated.length) {
      const canonical = seo.canonical_url.trim();
      findings.push(!canonical || canonical.replace(/\/$/, '') === ownUrl ? pass('The canonical URL is self-referential.') : warn('The canonical URL points elsewhere, which hides the paginated pages from search.'));
      findings.push(warn('Paginated post lists here update in the page without changing the URL, so later pages have no address, rel="prev"/"next" tags or "Page 2" titles. Make sure every post is also reachable from category archives or the sitemap.'));
    }
    checks.push({ id: 'pagination', category: 'medium', title: 'Pagination controls', status: paginated.length ? statusFromFindings(findings) : 'na', summary: paginated.length ? `${plural(paginated.length, 'paginated widget')}.` : 'No paginated widgets on this page.', findings });
  }

  {
    const videos = widgetsOfType('video', 'video-playlist');
    const findings: SeoFinding[] = [];
    videos.filter((node) => node.type === 'video').forEach((node, index) => {
      const label = videos.length > 1 ? `Video ${index + 1}: ` : '';
      findings.push(node.settings.poster ? pass(`${label}custom thumbnail set.`) : warn(`${label}no custom thumbnail (poster image).`));
      findings.push(node.settings.overlay !== false && !node.settings.autoplay ? pass(`${label}loads only when played (lazy).`) : warn(`${label}loads the player immediately; turn on the click-to-play overlay.`));
      findings.push(firstSectionIds.has(node.id) ? pass(`${label}placed above the fold.`) : info(`${label}not in the first section.`));
    });
    if (videos.length) {
      const posterImages = all<HTMLImageElement>(root, '.rwpb-video img');
      if (posterImages.length) findings.push(posterImages.every((image) => image.getAttribute('alt')?.trim()) ? pass('Video thumbnails have ALT text.') : warn('A video thumbnail has no ALT text.'));
      findings.push(/transcript/i.test(text) ? pass('A transcript is on the page.') : warn('No transcript found. A transcript makes the video content searchable.'));
      findings.push(info('Video structured data (VideoObject) is not generated by the builder; add it with an HTML widget if video results matter.'));
    }
    checks.push({ id: 'video', category: 'medium', title: 'Video SEO', status: videos.length ? statusFromFindings(findings) : 'na', summary: videos.length ? `${plural(videos.length, 'video widget')}.` : 'No video widgets on this page.', findings });
  }

  {
    const findings: SeoFinding[] = [];
    const article = page.is_post;
    const [low, high] = article ? [1500, 2000] : [300, 500];
    const kind = article ? 'article' : 'landing page';
    if (wordCount >= low && wordCount <= high) findings.push(pass(`${wordCount} words, within the ${low}–${high} target for an ${kind}.`));
    else if (wordCount < low) findings.push((wordCount < low / 2 ? fail : warn)(`${wordCount} words; an ${kind} usually needs ${low}–${high}.`));
    else findings.push((article ? info : warn)(`${wordCount} words, above the ${low}–${high} target for an ${kind}.${article ? ' Long is fine when every section earns its place.' : ' Landing pages convert better when they are concise.'}`));
    if (wordCount >= 300) {
      const perSubheading = subheadings.length ? Math.round(wordCount / (subheadings.length + 1)) : wordCount;
      findings.push(perSubheading <= 300 ? pass(`A subheading every ~${perSubheading} words.`) : warn(`About ${perSubheading} words per subheading; add an H2 or H3 every 150–300 words.`));
    }
    checks.push({ id: 'content-length', category: 'medium', title: 'Optimal content length', status: statusFromFindings(findings), summary: `${wordCount} words (${kind}).`, findings });
  }

  {
    const findings: SeoFinding[] = [];
    const days = Math.floor((now - new Date(page.updated_at).getTime()) / 86_400_000);
    findings.push(days <= 30 ? pass(`Updated ${days === 0 ? 'today' : `${plural(days, 'day')} ago`}.`) : days <= 180 ? warn(`Last updated ${plural(days, 'day')} ago. Schedule a monthly review.`) : fail(`Last updated ${plural(days, 'day')} ago. Review and refresh it.`));
    const yearMentions = [...new Set(text.match(/\b20\d{2}\b/g) || [])].map(Number);
    const currentYear = new Date(now).getFullYear();
    const stale = yearMentions.filter((year) => year < currentYear - 1);
    if (stale.length) findings.push(info(`Mentions ${stale.slice(0, 3).join(', ')}; check those references are still current.`));
    checks.push({
      id: 'freshness', category: 'medium', title: 'Content updates & freshness', status: statusFromFindings(findings),
      summary: `Last updated ${new Date(page.updated_at).toLocaleDateString()}.`, findings,
      manual: [`Check the ${plural(links.filter((link) => link.kind === 'internal' || link.kind === 'external').length, 'link')} on this page for broken destinations once a month.`],
    });
  }

  {
    const done = progress(outreachTasks, checklist);
    checks.push({
      id: 'build-backlink', category: 'medium', title: 'Build backlinks for this page', scored: false,
      status: done === outreachTasks.length ? 'pass' : 'manual',
      summary: `Outreach & promotion: ${done} of ${outreachTasks.length} done.`,
      findings: [info('Off-page work happens outside the site, so it is tracked here as a checklist and not scored.')],
    });
  }

  // Score --------------------------------------------------------------------------------------------

  const counts: Record<SeoStatus, number> = { pass: 0, warning: 0, fail: 0, manual: 0, na: 0 };
  let earned = 0;
  let possible = 0;
  checks.forEach((check) => {
    counts[check.status] += 1;
    if (check.scored !== false && (check.status === 'pass' || check.status === 'warning' || check.status === 'fail')) {
      const weight = categoryWeight[check.category];
      possible += weight;
      earned += weight * (check.status === 'pass' ? 1 : check.status === 'warning' ? 0.5 : 0);
    }
  });
  const score = possible ? Math.round((earned / possible) * 100) : 0;

  return {
    checks,
    score,
    rating: score >= 80 ? 'good' : score >= 50 ? 'needs-work' : 'poor',
    counts,
    stats: {
      words: wordCount,
      readingMinutes: Math.max(1, Math.round(wordCount / 200)),
      keywordCount,
      density: Math.round(density * 100) / 100,
      headings: headings.length,
      internalLinks: internal.length,
      externalLinks: external.length,
      images: contentImages.length,
    },
    imageUrls: [...new Set(contentImages.map((image) => image.src))],
    schemas,
    device,
    analyzedAt: now,
  };
}
