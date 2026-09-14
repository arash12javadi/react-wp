/**
 * Allowlist for the tracking snippets under App Settings → SEO (Google Tag Manager, analytics,
 * pixels). Shared by server/seo.mjs, which writes them into the HTML response, and the browser,
 * which injects them where no server does (Vite dev, Vercel). Plain JS so Node can import it.
 *
 * This cannot make a script safe: running arbitrary JavaScript is the point of the field, and
 * only administrators (manage_options) can save it. What it guarantees is that a pasted snippet
 * can only add <script>, <noscript> (with <iframe>/<img> inside), <link> and <meta> elements,
 * with external URLs over https, so it cannot close </head>, inject page markup, or add event
 * handler attributes. Everything else is dropped and reported in `removed`.
 */

const urlAttributes = new Set(['src', 'href']);

const allowedAttributes = {
  script: ['src', 'async', 'defer', 'type', 'id', 'crossorigin', 'integrity', 'referrerpolicy', 'nonce', 'charset'],
  link: ['rel', 'href', 'as', 'crossorigin', 'type', 'sizes', 'media'],
  meta: ['name', 'content', 'property'],
  iframe: ['src', 'width', 'height', 'style', 'title', 'loading', 'referrerpolicy'],
  img: ['src', 'width', 'height', 'style', 'alt', 'loading', 'referrerpolicy'],
};

const allowedScriptTypes = new Set(['', 'text/javascript', 'application/javascript', 'module', 'application/ld+json']);

// One attribute: name, then optionally = and a double-quoted, single-quoted or bare value.
const attributePattern = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const attributesSource = `((?:\\s+[^\\s"'>/=]+(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>\`]+))?)*)\\s*/?>`;
const openTag = (name) => new RegExp(`^<${name}\\b${attributesSource}`, 'i');

const scriptOpen = openTag('script');
const noscriptOpen = openTag('noscript');
const voidOpen = openTag('(link|meta|img)');
const iframeOpen = openTag('iframe');

const escapeAttribute = (value) => value
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const snippet = (text) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 70 ? `${clean.slice(0, 70)}…` : clean;
};

const decodeEntities = (value) => value
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

const serializeAttributes = (tag, source, removed) => {
  const allowed = allowedAttributes[tag] || [];
  const parts = [];
  for (const match of source.matchAll(attributePattern)) {
    const name = match[1].toLowerCase();
    const raw = match[2] ?? match[3] ?? match[4];
    const value = raw === undefined ? undefined : decodeEntities(raw);
    if (!allowed.includes(name) && !(tag === 'script' && /^data-[\w-]+$/.test(name))) {
      removed.push(`the ${name} attribute on <${tag}>`);
      continue;
    }
    if (urlAttributes.has(name) && !/^(https:)?\/\//i.test((value || '').trim())) {
      removed.push(`<${tag} ${name}="${snippet(value || '')}"> (only https:// URLs are allowed)`);
      return null;
    }
    if (tag === 'script' && name === 'type' && !allowedScriptTypes.has((value || '').trim().toLowerCase())) {
      removed.push(`<script type="${snippet(value || '')}"> (unsupported script type)`);
      return null;
    }
    parts.push(value === undefined ? name : `${name}="${escapeAttribute(value)}"`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
};

/** Only <iframe> and <img> may appear inside <noscript> — that is what GTM and pixel fallbacks use. */
const sanitizeNoscriptBody = (body, removed) => {
  let rest = body;
  let output = '';
  while (rest.length) {
    const trimmed = rest.replace(/^\s+/, '');
    if (!trimmed) break;
    rest = trimmed;
    const iframe = rest.match(iframeOpen);
    if (iframe) {
      rest = rest.slice(iframe[0].length).replace(/^\s*<\/iframe\s*>/i, '');
      const attributes = serializeAttributes('iframe', iframe[1], removed);
      if (attributes !== null) output += `<iframe${attributes}></iframe>`;
      continue;
    }
    const img = rest.match(/^<img\b((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/i);
    if (img) {
      rest = rest.slice(img[0].length);
      const attributes = serializeAttributes('img', img[1], removed);
      if (attributes !== null) output += `<img${attributes}>`;
      continue;
    }
    const next = rest.indexOf('<', 1);
    const dropped = next === -1 ? rest : rest.slice(0, next);
    removed.push(`"${snippet(dropped)}" inside <noscript>`);
    rest = next === -1 ? '' : rest.slice(next);
  }
  return output;
};

/**
 * @param {string} input
 * @returns {{ html: string, removed: string[] }}
 */
export function sanitizeTrackingHtml(input) {
  const removed = [];
  let rest = String(input ?? '');
  const output = [];

  while (rest.length) {
    const trimmed = rest.replace(/^\s+/, '');
    if (!trimmed) break;
    rest = trimmed;

    if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->');
      rest = end === -1 ? '' : rest.slice(end + 3);
      continue;
    }

    const script = rest.match(scriptOpen);
    if (script) {
      const afterOpen = rest.slice(script[0].length);
      const close = afterOpen.search(/<\/script\s*>/i);
      if (close === -1) {
        removed.push('a <script> with no closing </script> tag');
        break;
      }
      const body = afterOpen.slice(0, close);
      rest = afterOpen.slice(close).replace(/^<\/script\s*>/i, '');
      // Both change how the HTML parser finds the end of the script, which could let the rest of
      // the page be swallowed into it.
      if (/<!--|<script/i.test(body)) {
        removed.push('a <script> whose code contains "<!--" or "<script" (escape them as "<\\!--" and "<\\script")');
        continue;
      }
      const attributes = serializeAttributes('script', script[1], removed);
      if (attributes !== null) output.push(`<script${attributes}>${body}</script>`);
      continue;
    }

    const noscript = rest.match(noscriptOpen);
    if (noscript) {
      const afterOpen = rest.slice(noscript[0].length);
      const close = afterOpen.search(/<\/noscript\s*>/i);
      if (close === -1) {
        removed.push('a <noscript> with no closing </noscript> tag');
        break;
      }
      const body = sanitizeNoscriptBody(afterOpen.slice(0, close), removed);
      rest = afterOpen.slice(close).replace(/^<\/noscript\s*>/i, '');
      if (body) output.push(`<noscript>${body}</noscript>`);
      continue;
    }

    const voidTag = rest.match(voidOpen);
    if (voidTag && voidTag[1].toLowerCase() !== 'img') {
      const tag = voidTag[1].toLowerCase();
      rest = rest.slice(voidTag[0].length);
      const attributes = serializeAttributes(tag, voidTag[2], removed);
      if (attributes !== null) output.push(`<${tag}${attributes}>`);
      continue;
    }

    const next = rest.indexOf('<', 1);
    const dropped = next === -1 ? rest : rest.slice(0, next);
    removed.push(`"${snippet(dropped)}"`);
    rest = next === -1 ? '' : rest.slice(next);
  }

  return { html: output.join('\n'), removed };
}
