import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { rwp } from '../lib/rwp';

export const sanitizeHtml = (html: string) => {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script, style, iframe, object, embed').forEach((element) => element.remove());
  template.content.querySelectorAll<HTMLElement>('*').forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'src') && value.startsWith('javascript:'))) {
        element.removeAttribute(attribute.name);
      }
    });
  });
  return template;
};

const parseAttributes = (raw: string): Record<string, string> => {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw))) attributes[match[1]] = match[2];
  return attributes;
};

/**
 * Replaces shortcodes with empty host spans and returns the components to portal into them.
 *
 * The substitution happens on the parsed DOM rather than the HTML string. Splitting the
 * string at each shortcode would cut through open tags whenever one appeared mid-paragraph
 * and hand React unbalanced fragments; editing text nodes in place keeps the markup valid.
 */
const buildMarkup = (html: string): { markup: string; nodes: ReactNode[] } => {
  const template = sanitizeHtml(html);
  const registered = rwp.getShortcodes();
  const nodes: ReactNode[] = [];
  if (registered.length === 0) return { markup: template.innerHTML, nodes };

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);

  texts.forEach((textNode) => {
    const value = textNode.nodeValue || '';
    if (!value.includes('[')) return;

    const pattern = /\[([a-zA-Z0-9_-]+)([^\]]*)\]/g;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let matched = false;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(value))) {
      const shortcode = registered.find((item) => item.name === match![1]);
      if (!shortcode) continue;
      matched = true;
      if (match.index > cursor) fragment.appendChild(document.createTextNode(value.slice(cursor, match.index)));
      const host = document.createElement('span');
      host.setAttribute('data-rwp-sc', String(nodes.length));
      nodes.push(shortcode.render(parseAttributes(match[2])));
      fragment.appendChild(host);
      cursor = match.index + match[0].length;
    }

    if (!matched) return;
    if (cursor < value.length) fragment.appendChild(document.createTextNode(value.slice(cursor)));
    textNode.replaceWith(fragment);
  });

  return { markup: template.innerHTML, nodes };
};

export default function ContentRenderer({ html, className }: { html: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { markup, nodes } = useMemo(() => buildMarkup(html), [html]);
  const [hosts, setHosts] = useState<HTMLElement[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    setHosts(Array.from(containerRef.current.querySelectorAll<HTMLElement>('[data-rwp-sc]')));
  }, [markup]);

  return (
    <div className={className}>
      <div ref={containerRef} dangerouslySetInnerHTML={{ __html: markup }} />
      {hosts.map((host) => {
        const index = Number(host.dataset.rwpSc);
        return nodes[index] === undefined ? null : createPortal(nodes[index], host, String(index));
      })}
    </div>
  );
}
