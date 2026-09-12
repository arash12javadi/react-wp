const stripHtml = (html: string): string => {
  const element = document.createElement('div');
  element.innerHTML = html;
  return (element.textContent || '').replace(/\s+/g, ' ').trim();
};

export const defaultExcerptLength = 55;

/** Plain-text excerpt of at most `words` words. Slicing raw HTML instead would cut mid-tag. */
export const makeExcerpt = (html: string, words: number = defaultExcerptLength): string => {
  const text = stripHtml(html);
  if (!text) return '';
  const parts = text.split(' ');
  return parts.length <= words ? text : `${parts.slice(0, words).join(' ')}…`;
};

export const resolveExcerpt = (
  page: { excerpt?: string | null; content?: string | null },
  words: number = defaultExcerptLength,
): string => page.excerpt?.trim() || makeExcerpt(page.content || '', words);
