/**
 * Layout data is written by any user with edit_posts, so every value that reaches a URL
 * attribute or a stylesheet is treated as untrusted.
 */

const allowedScheme = /^(https?:|mailto:|tel:)/i;

/** Links: http(s), mailto, tel, or a relative path/anchor. javascript: and data: become "#". */
export function safeUrl(value: unknown): string {
  const url = String(value ?? '').trim();
  if (!url) return '';
  if (url.startsWith('/') || url.startsWith('#') || url.startsWith('?')) return url;
  if (allowedScheme.test(url)) return url;
  // No scheme at all ("about-us", "page.html") is a relative link.
  const colon = url.indexOf(':');
  const slash = url.search(/[/?#]/);
  if (colon === -1 || (slash !== -1 && slash < colon)) return url;
  return '#';
}

/** Image and video sources. Same rules as links, minus mailto/tel. */
export function safeMediaUrl(value: unknown): string {
  const url = safeUrl(value);
  return /^(mailto|tel):/i.test(url) || url === '#' ? '' : url;
}

/**
 * A single CSS value. Strips characters that could end the declaration or rule, so a colour
 * field cannot smuggle in extra rules. (Custom CSS is a separate, deliberately raw field.)
 */
export function cssValue(value: unknown): string {
  return String(value ?? '').replace(/[;{}<>\\]/g, '').trim();
}

/** For url("...") in background-image. */
export const cssUrl = (value: unknown): string => {
  const url = safeMediaUrl(value);
  return url ? `url("${url.replace(/["\\\n\r]/g, (char) => encodeURIComponent(char))}")` : '';
};

/** Class names and ids typed into the Advanced tab. */
export const cssIdent = (value: unknown): string => String(value ?? '').replace(/[^\w\- ]/g, '').trim();

/** Custom CSS is raw by design, but must not be able to close the <style> element. */
export const safeCustomCss = (value: unknown): string => String(value ?? '').replace(/<\/?style/gi, '');
