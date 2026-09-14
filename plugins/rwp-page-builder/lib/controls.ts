import type { Control, ControlOption } from './registry';
import type { NodeKind } from './types';

export const opts = (...pairs: Array<[string, string]>): ControlOption[] => pairs.map(([value, label]) => ({ value, label }));

export const headingTags = opts(['h1', 'H1'], ['h2', 'H2'], ['h3', 'H3'], ['h4', 'H4'], ['h5', 'H5'], ['h6', 'H6'], ['div', 'div'], ['p', 'p']);

export const typographyControl = (key = 'typography', label = 'Typography'): Control =>
  ({ key, label, type: 'typography', tab: 'style', responsive: true });

export const colorControl = (key: string, label: string): Control => ({ key, label, type: 'color', tab: 'style' });

export const alignControl = (key = 'align', label = 'Alignment', justify = false): Control => ({
  key, label, type: 'align', tab: 'style', responsive: true,
  options: justify ? opts(['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['justify', 'Justify']) : opts(['left', 'Left'], ['center', 'Center'], ['right', 'Right']),
});

export const linkControl = (key = 'link', label = 'Link'): Control => ({ key, label, type: 'link', dynamic: true, placeholder: 'https://example.com or /page' });

/** Box styling every element gets on its Style tab. */
export const boxControls: Control[] = [
  { key: '_box', label: 'Spacing', type: 'heading', tab: 'style' },
  { key: 'margin', label: 'Margin', type: 'dimensions', tab: 'style', responsive: true, units: ['px', '%', 'em', 'rem'] },
  { key: 'padding', label: 'Padding', type: 'dimensions', tab: 'style', responsive: true, units: ['px', '%', 'em', 'rem'] },
  { key: '_bg', label: 'Background', type: 'heading', tab: 'style' },
  { key: 'background', label: 'Background', type: 'background', tab: 'style', responsive: true },
  { key: '_border', label: 'Border', type: 'heading', tab: 'style' },
  { key: 'border', label: 'Border', type: 'border', tab: 'style', responsive: true },
  { key: 'boxShadow', label: 'Box shadow', type: 'shadow', tab: 'style' },
];

export const advancedControls: Control[] = [
  { key: '_identity', label: 'Identity', type: 'heading', tab: 'advanced' },
  { key: 'cssId', label: 'CSS ID', type: 'text', tab: 'advanced', placeholder: 'contact-form', help: 'For anchor links: #contact-form' },
  { key: 'cssClasses', label: 'CSS classes', type: 'text', tab: 'advanced', placeholder: 'my-class another-class' },
  { key: 'zIndex', label: 'Z-index', type: 'number', tab: 'advanced', store: 'style', responsive: true },
  { key: '_motion', label: 'Motion effects', type: 'heading', tab: 'advanced' },
  {
    key: 'animation', label: 'Entrance animation', type: 'select', tab: 'advanced',
    options: opts(['', 'None'], ['fadeIn', 'Fade in'], ['slideUp', 'Slide up'], ['slideDown', 'Slide down'], ['slideLeft', 'Slide in from right'], ['slideRight', 'Slide in from left'], ['zoomIn', 'Zoom in']),
    help: 'Plays when the element scrolls into view on the live page. Skipped for visitors who prefer reduced motion.',
  },
  { key: 'animationDuration', label: 'Duration (ms)', type: 'slider', tab: 'advanced', min: 100, max: 3000, step: 50 },
  { key: 'animationDelay', label: 'Delay (ms)', type: 'slider', tab: 'advanced', min: 0, max: 3000, step: 50 },
  { key: 'sticky', label: 'Sticky on scroll', type: 'toggle', tab: 'advanced', help: 'Sticks within its parent. A sticky section needs room to scroll past, so it works best as the first section.' },
  { key: 'stickyOffset', label: 'Sticky offset (px)', type: 'number', tab: 'advanced' },
  { key: '_responsive', label: 'Responsive visibility', type: 'heading', tab: 'advanced' },
  { key: 'hideOn.desktop', label: 'Hide on desktop', type: 'toggle', tab: 'advanced' },
  { key: 'hideOn.tablet', label: 'Hide on tablet', type: 'toggle', tab: 'advanced' },
  { key: 'hideOn.mobile', label: 'Hide on mobile', type: 'toggle', tab: 'advanced' },
  { key: '_css', label: 'Custom CSS', type: 'heading', tab: 'advanced' },
  { key: 'customCss', label: 'Custom CSS', type: 'code', language: 'css', tab: 'advanced', help: 'Use "selector" for this element, e.g. selector:hover { opacity: .8 }' },
];

export const sectionControls: Control[] = [
  { key: 'layout', label: 'Content width', type: 'select', options: opts(['boxed', 'Boxed'], ['full', 'Full width']) },
  { key: 'contentWidth', label: 'Boxed width (px)', type: 'slider', tab: 'content', store: 'style', responsive: true, min: 300, max: 1920, step: 10, condition: (settings) => settings.layout !== 'full' },
  { key: 'gap', label: 'Column gap (px)', type: 'slider', store: 'style', responsive: true, min: 0, max: 120 },
  { key: 'heightMode', label: 'Height', type: 'select', store: 'style', responsive: true, options: opts(['auto', 'Default'], ['min', 'Minimum height'], ['screen', 'Fit to screen']) },
  { key: 'minHeight', label: 'Minimum height', type: 'size', store: 'style', responsive: true, units: ['px', 'vh'], condition: (_settings, style) => style.heightMode === 'min' },
  { key: 'verticalAlign', label: 'Column alignment', type: 'select', store: 'style', responsive: true, options: opts(['stretch', 'Stretch'], ['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']) },
  { key: 'contentPosition', label: 'Content position', type: 'select', store: 'style', responsive: true, options: opts(['', 'Default'], ['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']), help: 'Where the columns sit when the section is taller than its content.' },
  { key: 'stackOn', label: 'Stack columns on', type: 'select', options: opts(['mobile', 'Mobile'], ['tablet', 'Tablet and mobile'], ['none', 'Never']) },
  { key: 'reverseStack', label: 'Reverse order when stacked', type: 'toggle' },
  { key: 'htmlTag', label: 'HTML tag', type: 'select', options: opts(['section', 'section'], ['div', 'div'], ['header', 'header'], ['footer', 'footer'], ['main', 'main'], ['article', 'article'], ['aside', 'aside'], ['nav', 'nav']) },
];

export const columnControls: Control[] = [
  { key: 'width', label: 'Width (%)', type: 'slider', store: 'style', responsive: true, min: 5, max: 100, step: 0.5, help: 'Drag the handle between columns on the canvas, or set it here for the current device.' },
  { key: 'verticalAlign', label: 'Vertical position', type: 'select', store: 'style', responsive: true, options: opts(['', 'Default'], ['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom'], ['space-between', 'Space between']) },
  { key: 'widgetGap', label: 'Space between widgets (px)', type: 'slider', store: 'style', responsive: true, min: 0, max: 100 },
];

export const kindLabels: Record<NodeKind, string> = { section: 'Section', column: 'Column', widget: 'Widget' };

/** Where a control's value lives. */
export function controlStore(control: Control): 'settings' | 'style' | 'advanced' {
  if (control.store) return control.store;
  if (control.responsive) return 'style';
  if (control.tab === 'style') return 'style';
  if (control.tab === 'advanced') return 'advanced';
  return 'settings';
}

export function getPath(source: Record<string, unknown> | undefined, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), source);
}

export function setPath<T extends Record<string, unknown>>(source: T | undefined, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const base = { ...(source || {}) } as Record<string, unknown>;
  if (!rest.length) {
    if (value === undefined) delete base[head];
    else base[head] = value;
    return base as T;
  }
  base[head] = setPath((base[head] as Record<string, unknown>) || {}, rest.join('.'), value);
  return base as T;
}
