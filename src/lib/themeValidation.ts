import { sanitizeTrackingHtml } from './scriptSanitizer.js';
import { normalizeArea, themeAreaLabels, type ThemeAreaId } from './theme';

/**
 * "Validate code" in the Theme Editor, also run before every save. Errors block the save;
 * warnings describe what the sanitisers will remove or what the browser will ignore.
 *
 * These are checks for mistakes, not security: the HTML is sanitised again when rendered, and
 * only administrators can save theme code at all.
 */

export interface CodeIssue {
  level: 'error' | 'warning';
  message: string;
  line?: number;
}

const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// The HTML parser closes these by itself, so leaving them open is valid but often unintended.
const optionalClose = new Set(['p', 'li', 'dt', 'dd', 'option', 'optgroup', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'caption', 'rp', 'rt']);
const rawTextElements = new Set(['script', 'style', 'textarea', 'title']);

const lineAt = (source: string, index: number) => source.slice(0, index).split('\n').length;

/** Unclosed, stray and mismatched tags, unterminated comments and tags missing their ">". */
export const checkHtmlStructure = (source: string): CodeIssue[] => {
  const issues: CodeIssue[] = [];
  const stack: Array<{ name: string; line: number }> = [];
  const tagPattern = /<!--|<\/?([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<\/?[a-zA-Z]/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(source))) {
    const line = lineAt(source, match.index);
    if (match[0] === '<!--') {
      const end = source.indexOf('-->', match.index + 4);
      if (end === -1) {
        issues.push({ level: 'error', line, message: 'An HTML comment "<!--" is never closed with "-->"; everything after it is hidden.' });
        break;
      }
      tagPattern.lastIndex = end + 3;
      continue;
    }
    if (!match[1]) {
      issues.push({ level: 'error', line, message: `A tag starting "${source.slice(match.index, match.index + 20).split('\n')[0]}" is never closed with ">".` });
      continue;
    }
    const name = match[1].toLowerCase();
    const closing = match[0].startsWith('</');
    const selfClosing = match[3] === '/';

    if (closing) {
      if (voidElements.has(name)) {
        issues.push({ level: 'warning', line, message: `</${name}> is not needed: <${name}> never has a closing tag.` });
        continue;
      }
      const openIndex = stack.map((entry) => entry.name).lastIndexOf(name);
      if (openIndex === -1) {
        issues.push({ level: 'error', line, message: `</${name}> closes a tag that was never opened.` });
        continue;
      }
      stack.splice(openIndex + 1).forEach((unclosed) => {
        issues.push(optionalClose.has(unclosed.name)
          ? { level: 'warning', line: unclosed.line, message: `<${unclosed.name}> is not closed before </${name}>; the browser closes it automatically.` }
          : { level: 'error', line: unclosed.line, message: `<${unclosed.name}> is not closed before </${name}> on line ${line}.` });
      });
      stack.pop();
      continue;
    }

    if (voidElements.has(name) || selfClosing) continue;
    if (rawTextElements.has(name)) {
      const closePattern = new RegExp(`</${name}\\s*>`, 'ig');
      closePattern.lastIndex = tagPattern.lastIndex;
      const close = closePattern.exec(source);
      if (!close) {
        issues.push({ level: 'error', line, message: `<${name}> is never closed with </${name}>; the rest of the page would be swallowed into it.` });
        break;
      }
      tagPattern.lastIndex = close.index + close[0].length;
      continue;
    }
    stack.push({ name, line });
  }

  stack.forEach((unclosed) => {
    issues.push(optionalClose.has(unclosed.name)
      ? { level: 'warning', line: unclosed.line, message: `<${unclosed.name}> is never closed; the browser closes it automatically.` }
      : { level: 'error', line: unclosed.line, message: `<${unclosed.name}> is never closed.` });
  });
  return issues;
};

/** Page markup (header, footer, sidebar HTML and Custom HTML blocks). Mirrors sanitizeHtml in ContentRenderer. */
export const validateMarkup = (source: string): CodeIssue[] => {
  if (!source.trim()) return [];
  const issues = checkHtmlStructure(source);
  const template = document.createElement('template');
  template.innerHTML = source;
  const removedTags = new Map<string, number>();
  template.content.querySelectorAll('script, style, iframe, object, embed').forEach((element) => {
    const tag = element.tagName.toLowerCase();
    removedTags.set(tag, (removedTags.get(tag) || 0) + 1);
  });
  removedTags.forEach((count, tag) => {
    const where = tag === 'script' ? ' Put scripts in the <head> code or Footer scripts instead.' : tag === 'style' ? ' Put CSS in Custom CSS instead.' : '';
    issues.push({ level: 'warning', message: `${count} <${tag}> element${count === 1 ? '' : 's'} will be removed when the page renders.${where}` });
  });
  template.content.querySelectorAll('*').forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) {
        issues.push({ level: 'warning', message: `The ${name} attribute on <${element.tagName.toLowerCase()}> will be removed: event handlers are not allowed in markup.` });
      } else if ((name === 'href' || name === 'src') && attribute.value.trim().toLowerCase().startsWith('javascript:')) {
        issues.push({ level: 'warning', message: `The javascript: link in ${name} on <${element.tagName.toLowerCase()}> will be removed.` });
      }
    });
  });
  return issues;
};

/** <head> code and footer scripts: the same allowlist as Settings → SEO tracking scripts. */
export const validateScripts = (source: string): CodeIssue[] => {
  if (!source.trim()) return [];
  const { removed } = sanitizeTrackingHtml(source);
  return removed.map((item: string) => ({
    // A missing closing tag makes the sanitiser stop, dropping everything after it.
    level: /no closing/.test(item) ? 'error' : 'warning',
    message: /no closing/.test(item) ? `${item}; everything after it is dropped.` : `Will be removed when saved: ${item}.`,
  }));
};

/** Braces, comments and strings, plus rules this browser's CSS parser drops. */
export const validateCss = (source: string): CodeIssue[] => {
  if (!source.trim()) return [];
  const issues: CodeIssue[] = [];
  const open: number[] = [];
  // Rules the CSSOM should end up with: top-level blocks, plus the brace-less statements it keeps.
  let topLevelRules = 0;
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end === -1) {
        issues.push({ level: 'error', line: lineAt(source, index), message: 'A comment "/*" is never closed with "*/"; the rest of the stylesheet is ignored.' });
        break;
      }
      index = end + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      let end = index + 1;
      while (end < source.length && source[end] !== char && source[end] !== '\n') end += source[end] === '\\' ? 2 : 1;
      if (source[end] !== char) {
        issues.push({ level: 'error', line: lineAt(source, index), message: `A string starting with ${char} is not closed on the same line.` });
      }
      index = end + 1;
      continue;
    }
    if (char === '{') {
      if (open.length === 0) topLevelRules += 1;
      open.push(index);
    } else if (char === '}') {
      if (open.length === 0) issues.push({ level: 'error', line: lineAt(source, index), message: 'A "}" has no matching "{".' });
      else open.pop();
    } else if (char === ';' && open.length === 0) {
      // @import is dropped by replaceSync and @charset never becomes a rule, so neither is counted.
      const statement = source.slice(0, index).split(/[;{}]/).pop() || '';
      if (/^\s*@(namespace|layer)\b/i.test(statement.replace(/\/\*[\s\S]*?\*\//g, ''))) topLevelRules += 1;
    }
    index += 1;
  }
  open.forEach((position) => {
    issues.push({ level: 'error', line: lineAt(source, position), message: 'A "{" is never closed with "}"; every rule after it is ignored.' });
  });
  if (/<\/style/i.test(source)) {
    issues.push({ level: 'warning', message: '"</style" cannot appear in CSS on a page; it is escaped when the page is written.' });
  }

  // Only meaningful when the braces balance; otherwise the counts are off for a known reason.
  if (!issues.some((issue) => issue.level === 'error') && typeof CSSStyleSheet !== 'undefined') {
    try {
      const sheet = new CSSStyleSheet();
      // replaceSync ignores @import, which is why those are left out of the count above.
      sheet.replaceSync(source);
      const parsed = Array.from(sheet.cssRules).filter((rule) => !(rule instanceof CSSImportRule)).length;
      if (parsed < topLevelRules) {
        const dropped = topLevelRules - parsed;
        issues.push({ level: 'warning', message: `This browser could not parse ${dropped} rule${dropped === 1 ? '' : 's'} and will ignore ${dropped === 1 ? 'it' : 'them'}. Check the selectors: one invalid selector in a list drops the whole rule.` });
      }
    } catch {
      // Constructable stylesheets unsupported: the structural checks above still ran.
    }
  }
  return issues;
};

/** Layout JSON for one area from Code mode. Returns the normalised layout when it parses. */
export const validateLayoutJson = (area: ThemeAreaId, text: string): { issues: CodeIssue[]; layout: ReturnType<typeof normalizeArea> | null } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const position = Number(/position (\d+)/.exec(message)?.[1]);
    const lineMatch = /line (\d+)/.exec(message);
    const line = lineMatch ? Number(lineMatch[1]) : Number.isFinite(position) ? lineAt(text, position) : undefined;
    return { issues: [{ level: 'error', line, message: `The ${themeAreaLabels[area]} layout is not valid JSON: ${message}` }], layout: null };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { issues: [{ level: 'error', message: `The ${themeAreaLabels[area]} layout must be a JSON object with "containers" and "options".` }], layout: null };
  }
  const problems: string[] = [];
  const layout = normalizeArea(area, parsed, problems);
  return { issues: problems.map((message) => ({ level: 'warning' as const, message })), layout };
};

export const hasErrors = (issues: CodeIssue[]) => issues.some((issue) => issue.level === 'error');
