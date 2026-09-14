/**
 * DOMParser documents are inert. Assigning to innerHTML on a createElement('div') is not:
 * the browser starts loading <img> elements immediately, so <img src=x onerror=...> in post
 * content would run script while an excerpt was being generated.
 */
const stripHtml = (html: string): string => {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return (parsed.body.textContent || '').replace(/\s+/g, ' ').trim();
};

export const defaultExcerptLength = 55;

export type ExcerptUnit = 'words' | 'characters';

/**
 * Plain-text excerpt of at most `length` words or characters. Slicing raw HTML instead would
 * cut mid-tag. A character excerpt backs off to the last whole word when there is one.
 */
export const makeExcerpt = (html: string, length: number = defaultExcerptLength, unit: ExcerptUnit = 'words'): string => {
  const text = stripHtml(html);
  if (!text) return '';
  if (unit === 'characters') {
    if (text.length <= length) return text;
    const cut = text.slice(0, length);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
  }
  const parts = text.split(' ');
  return parts.length <= length ? text : `${parts.slice(0, length).join(' ')}…`;
};

export const resolveExcerpt = (
  page: { excerpt?: string | null; content?: string | null },
  length: number = defaultExcerptLength,
  unit: ExcerptUnit = 'words',
): string => page.excerpt?.trim() || makeExcerpt(page.content || '', length, unit);
