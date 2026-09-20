import { useMemo, useRef, type KeyboardEvent } from 'react';
import type { CodeIssue } from '../../lib/themeValidation';
import styles from './ThemeEditor.module.css';

export type CodeLanguage = 'html' | 'css' | 'json' | 'javascript';

/**
 * A plain <textarea> over a syntax-highlighted copy of the same text. The textarea keeps native
 * editing, undo, IME and screen reader support; the highlighted layer only paints behind it, so
 * both must share exactly the same font, padding and no wrapping.
 *
 * Tab inserts two spaces. Press Escape first to move focus out with Tab instead, so keyboard
 * users are never trapped in the editor.
 */

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const span = (kind: string, value: string) => `<span class="${styles[`tok_${kind}`] || ''}">${escapeHtml(value)}</span>`;

const highlightAttributes = (source: string) =>
  source.replace(/([^\s=]+)(\s*=\s*)?("[^"]*"|'[^']*'|[^\s"'>]+)?/g, (_match, name: string, equals = '', value = '') =>
    `${span('attr', name)}${escapeHtml(equals)}${value ? span('string', value) : ''}`);

const highlightHtml = (source: string) =>
  source.replace(/(<!--[\s\S]*?(?:-->|$))|(<\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)(\/?>)?|([^<]+|<)/g,
    (_match, comment?: string, open?: string, name?: string, attributes?: string, close?: string, textPart?: string) => {
      if (comment) return span('comment', comment);
      if (name) return `${span('punct', open || '')}${span('tag', name)}${highlightAttributes(attributes || '')}${span('punct', close || '')}`;
      return escapeHtml(textPart || '');
    });

const highlightCss = (source: string) => {
  let depth = 0;
  return source.replace(/(\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)|(@[\w-]+)|(#[0-9a-fA-F]{3,8}\b)|(-?\d*\.?\d+(?:px|r?em|%|vh|vw|s|ms|deg|fr)?\b)|([{}])|([\w-]+)(?=\s*:(?!:))|[\w-]+|[^/"'@#\d{}\w-]+|[\s\S]/g,
    (match, comment?: string, string?: string, atRule?: string, hex?: string, number?: string, brace?: string, property?: string) => {
      if (comment) return span('comment', comment);
      if (string) return span('string', string);
      if (atRule) return span('keyword', atRule);
      if (brace) {
        depth = Math.max(0, depth + (brace === '{' ? 1 : -1));
        return span('punct', brace);
      }
      if (property && depth > 0) return span('attr', property);
      if (hex || number) return span('number', match);
      // Outside a block, words are selectors.
      return depth === 0 && /\S/.test(match) ? span('tag', match) : escapeHtml(match);
    });
};

const highlightJson = (source: string) =>
  source.replace(/("(?:[^"\\\n]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|[^"\d\w-]+|[\s\S]/g,
    (match, string?: string, colon?: string, keyword?: string, number?: string) => {
      if (string) return colon ? `${span('attr', string)}${escapeHtml(colon)}` : span('string', string);
      if (keyword) return span('keyword', keyword);
      if (number) return span('number', number);
      return escapeHtml(match);
    });

// Enough of ES2022 to read code by, not a parser: keywords, the three kinds of string, comments,
// numbers and the name after function/class/const. Added for the Code Snippets screen.
const jsKeywords = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'delete', 'do', 'else',
  'export', 'extends', 'false', 'finally', 'for', 'from', 'function', 'if', 'import', 'in', 'instanceof', 'let',
  'new', 'null', 'of', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined',
  'var', 'void', 'while', 'yield',
]);

const highlightJs = (source: string) =>
  source.replace(
    /(\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|\b(\d[\w.]*)\b|\b([A-Za-z_$][\w$]*)\b|[\s\S]/g,
    (match, comment?: string, string?: string, number?: string, word?: string) => {
      if (comment) return span('comment', comment);
      if (string) return span('string', string);
      if (number) return span('number', number);
      if (word) return jsKeywords.has(word) ? span('keyword', word) : escapeHtml(word);
      return /[{}()[\];,.]/.test(match) ? span('punct', match) : escapeHtml(match);
    },
  );

const highlighters: Record<CodeLanguage, (source: string) => string> = {
  html: highlightHtml, css: highlightCss, json: highlightJson, javascript: highlightJs,
};

interface CodeEditorProps {
  id: string;
  label: string;
  language: CodeLanguage;
  value: string;
  onChange: (value: string) => void;
  help?: string;
  placeholder?: string;
  /** Lines with an error or warning get a marker in the gutter. */
  issues?: CodeIssue[];
  minRows?: number;
}

export default function CodeEditor({ id, label, language, value, onChange, help, placeholder, issues = [], minRows = 12 }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const layerRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const escapePressed = useRef(false);

  // A trailing newline needs a character after it or the layer ends one line short of the textarea.
  const highlighted = useMemo(() => `${highlighters[language](value)}\n `, [language, value]);
  const lineCount = Math.max(minRows, value.split('\n').length);
  const markers = useMemo(() => {
    const map = new Map<number, CodeIssue['level']>();
    issues.forEach((issue) => {
      if (issue.line && map.get(issue.line) !== 'error') map.set(issue.line, issue.level);
    });
    return map;
  }, [issues]);

  const syncScroll = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (layerRef.current) {
      layerRef.current.scrollTop = textarea.scrollTop;
      layerRef.current.scrollLeft = textarea.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      escapePressed.current = true;
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !escapePressed.current) {
      event.preventDefault();
      const textarea = event.currentTarget;
      const { selectionStart, selectionEnd } = textarea;
      const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
      onChange(next);
      requestAnimationFrame(() => {
        textarea.selectionStart = selectionStart + 2;
        textarea.selectionEnd = selectionStart + 2;
      });
    }
    escapePressed.current = false;
  };

  return (
    <div className={styles.codeField}>
      <label htmlFor={id} className={styles.codeLabel}>{label}</label>
      {help && <p id={`${id}-help`} className={styles.help}>{help}</p>}
      <div className={styles.codeShell} style={{ height: `${Math.min(lineCount, 28) * 1.55 + 1.6}em` }}>
        <div ref={gutterRef} className={styles.codeGutter} aria-hidden="true">
          {Array.from({ length: Math.max(lineCount, value.split('\n').length) }, (_, index) => {
            const level = markers.get(index + 1);
            return <div key={index} className={level === 'error' ? styles.gutterError : level === 'warning' ? styles.gutterWarning : undefined}>{index + 1}</div>;
          })}
        </div>
        <div className={styles.codeArea}>
          <pre ref={layerRef} className={styles.codeLayer} aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlighted }} />
          <textarea
            ref={textareaRef}
            id={id}
            className={styles.codeInput}
            value={value}
            placeholder={placeholder}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            wrap="off"
            aria-describedby={help ? `${id}-help ${id}-keys` : `${id}-keys`}
            onChange={(event) => onChange(event.target.value)}
            onScroll={syncScroll}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
      <p id={`${id}-keys`} className={styles.help}>Tab indents. Press Esc, then Tab, to leave the editor.</p>
    </div>
  );
}
