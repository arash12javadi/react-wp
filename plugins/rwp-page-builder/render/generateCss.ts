import { getWidget } from '../lib/registry';
import { safeCustomCss } from '../lib/sanitize';
import {
  background, border, boxSides, color, effectiveBag, isSet, length, serializeRules, shadow, size,
  type Background, type Border, type Box, type CssRules, type Shadow, type SizeValue,
} from '../lib/style';
import { walkNodes } from '../lib/tree';
import type { BuilderDocument, BuilderNode, ColumnNode, Device, ParentNode, SectionNode, StyleBag, WidgetNode } from '../lib/types';

/** Elementor's breakpoints: tablet ≤ 1024px, mobile ≤ 767px. */
export const breakpoints = { tablet: 1024, mobile: 767 };

const merge = (target: CssRules, source: CssRules) => {
  Object.entries(source).forEach(([suffix, declarations]) => {
    target[suffix] = { ...(target[suffix] || {}), ...declarations };
  });
  return target;
};

const alignItems: Record<string, string> = { top: 'flex-start', middle: 'center', bottom: 'flex-end', stretch: 'stretch' };
const justify: Record<string, string> = { top: 'flex-start', middle: 'center', bottom: 'flex-end', 'space-between': 'space-between' };

function commonRules(node: BuilderNode, bag: StyleBag, device: Device, editing: boolean): CssRules {
  const bg = bag.background as Background | undefined;
  const rules: CssRules = {
    '': {
      ...boxSides('margin', bag.margin as Box | undefined),
      ...boxSides('padding', bag.padding as Box | undefined),
      ...background(bg),
      ...border(bag.border as Border | undefined),
      'box-shadow': shadow(bag.boxShadow as Shadow | undefined),
      'z-index': isSet(bag.zIndex) ? Number(bag.zIndex) : undefined,
    },
  };
  if (bg?.overlayColor) {
    rules[' > .rwpb-overlay'] = {
      'background-color': color(bg.overlayColor),
      opacity: isSet(bg.overlayOpacity) ? Number(bg.overlayOpacity) : 0.5,
    };
  }
  const { advanced = {} } = node;
  if (advanced.sticky) {
    rules[''] = { ...rules[''], position: 'sticky', top: `${Number(advanced.stickyOffset) || 0}px`, 'z-index': isSet(bag.zIndex) ? Number(bag.zIndex) : 20 };
  }
  if (advanced.hideOn?.[device]) {
    // In the editor, hidden elements stay selectable but faded, as in Elementor.
    rules[''] = editing ? { ...rules[''], opacity: 0.35, filter: 'grayscale(1)' } : { ...rules[''], display: 'none' };
  } else if (!editing && advanced.hideOn && Object.values(advanced.hideOn).some(Boolean)) {
    // Explicit, so "hidden on desktop" does not carry into the tablet media query.
    rules[''] = { ...rules[''], display: node.kind === 'widget' ? 'block' : 'flex' };
  }
  return rules;
}

const stacksAt = (section: SectionNode, device: Device) => {
  const stackOn = String(section.settings.stackOn || 'mobile');
  if (device === 'mobile') return stackOn !== 'none';
  if (device === 'tablet') return stackOn === 'tablet';
  return false;
};

function sectionRules(section: SectionNode, bag: StyleBag, device: Device): CssRules {
  const boxed = section.settings.layout !== 'full';
  const heightMode = String(bag.heightMode || 'auto');
  return {
    '': {
      'min-height': heightMode === 'screen' ? '100vh' : heightMode === 'min' ? size(bag.minHeight as SizeValue | undefined) : undefined,
      'justify-content': justify[String(bag.contentPosition || '')],
    },
    ' > .rwpb-container': {
      'max-width': boxed ? length(bag.contentWidth ?? 1140, 'px') : 'none',
      gap: length(bag.gap ?? 20, 'px'),
      'align-items': alignItems[String(bag.verticalAlign || 'stretch')],
      'flex-wrap': stacksAt(section, device) ? 'wrap' : 'nowrap',
      'flex-direction': stacksAt(section, device) && section.settings.reverseStack ? 'column-reverse' : undefined,
    },
  };
}

function columnWidth(column: ColumnNode, section: SectionNode, device: Device): number {
  if (stacksAt(section, device)) {
    // Stacked columns start from full width; only widths set for a stacked device apply.
    const order: Device[] = String(section.settings.stackOn) === 'tablet' ? ['tablet', 'mobile'] : ['mobile'];
    let width: unknown;
    for (const item of order) {
      const own = column.style[item]?.width;
      if (isSet(own)) width = own;
      if (item === device) break;
    }
    return isSet(width) ? Number(width) : 100;
  }
  const width = effectiveBag(column.style, device).width;
  return isSet(width) ? Number(width) : 100 / Math.max(1, section.children.length);
}

function columnRules(column: ColumnNode, section: SectionNode, bag: StyleBag, device: Device): CssRules {
  const width = Math.max(1, Math.min(100, columnWidth(column, section, device)));
  const gap = Number(effectiveBag(section.style, device).gap ?? 20);
  // Widths add to 100%; each column gives up its share of the gaps so the row fits exactly.
  const calc = gap && width < 100 ? `calc(${width}% - ${Math.round(gap * (100 - width)) / 100}px)` : `${width}%`;
  return {
    '': { width: calc },
    ' > .rwpb-column-inner': {
      'justify-content': justify[String(bag.verticalAlign || '')],
      gap: length(bag.widgetGap ?? 16, 'px'),
    },
  };
}

function nodeRules(node: BuilderNode, parent: ParentNode | null, device: Device, editing: boolean): CssRules {
  const bag = effectiveBag(node.style, device);
  const rules = commonRules(node, bag, device, editing);
  if (node.kind === 'section') merge(rules, sectionRules(node, bag, device));
  else if (node.kind === 'column' && parent?.kind === 'section') merge(rules, columnRules(node, parent, bag, device));
  else if (node.kind === 'widget') {
    const definition = getWidget(node.type);
    if (definition?.css) merge(rules, definition.css(bag, node as WidgetNode, device));
  }
  return rules;
}

/**
 * Declarations that changed since the larger device, so media queries carry only overrides.
 * A declaration that disappears (e.g. min-height when the height mode goes back to auto) is
 * reset with "unset", or the larger device's value would leak through.
 */
function diffRules(current: CssRules, previous: CssRules): CssRules {
  const result: CssRules = {};
  const suffixes = new Set([...Object.keys(previous), ...Object.keys(current)]);
  suffixes.forEach((suffix) => {
    const now = current[suffix] || {};
    const before = previous[suffix] || {};
    const changed: Record<string, string | number> = {};
    new Set([...Object.keys(before), ...Object.keys(now)]).forEach((property) => {
      const value = now[property];
      const old = before[property];
      if (isSet(value)) {
        if (String(value) !== String(old ?? '')) changed[property] = value as string | number;
      } else if (isSet(old)) {
        changed[property] = 'unset';
      }
    });
    if (Object.keys(changed).length) result[suffix] = changed;
  });
  return result;
}

export interface CssOptions {
  /** Render one device without media queries (the editor canvas). Omit for the public site. */
  device?: Device;
  scope?: string;
}

export function generateCss(doc: BuilderDocument, { device, scope = '.rwpb-root' }: CssOptions = {}): string {
  const out = { desktop: [] as string[], tablet: [] as string[], mobile: [] as string[], custom: [] as string[] };
  const editing = Boolean(device);

  walkNodes(doc.content, (node, parent) => {
    const selector = `${scope} .rwpb-n-${node.id}`;
    if (device) {
      out.desktop.push(serializeRules(selector, nodeRules(node, parent, device, true)));
    } else {
      const desktop = nodeRules(node, parent, 'desktop', editing);
      const tablet = nodeRules(node, parent, 'tablet', editing);
      const mobile = nodeRules(node, parent, 'mobile', editing);
      out.desktop.push(serializeRules(selector, desktop));
      out.tablet.push(serializeRules(selector, diffRules(tablet, desktop)));
      out.mobile.push(serializeRules(selector, diffRules(mobile, tablet)));
    }
    if (node.advanced?.customCss) {
      out.custom.push(safeCustomCss(node.advanced.customCss).replace(/\bselector\b/g, selector));
    }
  });

  const documentRules = serializeRules(scope, { '': { background: doc.settings.background ? color(doc.settings.background) : undefined } });
  const documentCss = doc.settings.customCss ? safeCustomCss(doc.settings.customCss).replace(/\bselector\b/g, scope) : '';
  const tablet = out.tablet.join('');
  const mobile = out.mobile.join('');
  return [
    documentRules,
    out.desktop.join(''),
    tablet && `@media (max-width:${breakpoints.tablet}px){${tablet}}`,
    mobile && `@media (max-width:${breakpoints.mobile}px){${mobile}}`,
    out.custom.join('\n'),
    documentCss,
  ].filter(Boolean).join('\n');
}
