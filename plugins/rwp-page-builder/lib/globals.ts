import { useEffect, useState } from 'react';
import { describeDbError, getSupabaseClient } from '../../../src/lib/db';
import { cssValue } from './sanitize';
import type { BuilderDocument, GlobalStyles } from './types';
import { walkNodes } from './tree';

export const GLOBAL_STYLES_OPTION = 'builder_global_styles';

export const defaultGlobalStyles: GlobalStyles = {
  colors: { primary: '#4f46e5', secondary: '#0f172a', text: '#334155', accent: '#f59e0b' },
  fonts: { primary: 'system-ui', headings: 'system-ui' },
  loadGoogleFonts: true,
};

export const globalColorLabels: Record<keyof GlobalStyles['colors'], string> = {
  primary: 'Primary', secondary: 'Secondary', text: 'Text', accent: 'Accent',
};

/** Fonts offered in pickers. System stacks never load anything from Google. */
export const fontChoices: Array<{ value: string; label: string; google: boolean }> = [
  { value: 'system-ui', label: 'System UI', google: false },
  { value: 'Georgia', label: 'Georgia (serif)', google: false },
  { value: 'Inter', label: 'Inter', google: true },
  { value: 'Roboto', label: 'Roboto', google: true },
  { value: 'Open Sans', label: 'Open Sans', google: true },
  { value: 'Lato', label: 'Lato', google: true },
  { value: 'Montserrat', label: 'Montserrat', google: true },
  { value: 'Poppins', label: 'Poppins', google: true },
  { value: 'Nunito', label: 'Nunito', google: true },
  { value: 'Raleway', label: 'Raleway', google: true },
  { value: 'Work Sans', label: 'Work Sans', google: true },
  { value: 'DM Sans', label: 'DM Sans', google: true },
  { value: 'Playfair Display', label: 'Playfair Display', google: true },
  { value: 'Merriweather', label: 'Merriweather', google: true },
  { value: 'Lora', label: 'Lora', google: true },
  { value: 'Oswald', label: 'Oswald', google: true },
  { value: 'Space Grotesk', label: 'Space Grotesk', google: true },
  { value: 'Vazirmatn', label: 'Vazirmatn', google: true },
];

const fontStack = (family: string) => {
  const clean = cssValue(family).replace(/["']/g, '');
  if (!clean || clean === 'system-ui') return "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  if (clean === 'Georgia') return 'Georgia, "Times New Roman", serif';
  return `"${clean}", system-ui, sans-serif`;
};

function normalise(value: unknown): GlobalStyles {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<GlobalStyles>;
  return {
    colors: { ...defaultGlobalStyles.colors, ...(input.colors || {}) },
    fonts: { ...defaultGlobalStyles.fonts, ...(input.fonts || {}) },
    loadGoogleFonts: input.loadGoogleFonts ?? defaultGlobalStyles.loadGoogleFonts,
  };
}

let cache: GlobalStyles | null = null;
let pending: Promise<GlobalStyles> | null = null;
const listeners = new Set<(styles: GlobalStyles) => void>();

export function loadGlobalStyles(force = false): Promise<GlobalStyles> {
  if (cache && !force) return Promise.resolve(cache);
  if (pending && !force) return pending;
  pending = Promise.resolve(getSupabaseClient()
    .from('options').select('option_value').eq('option_name', GLOBAL_STYLES_OPTION).maybeSingle())
    .then(({ data }) => {
      let parsed: unknown = null;
      try {
        parsed = data?.option_value ? JSON.parse(data.option_value) : null;
      } catch {
        parsed = null;
      }
      cache = normalise(parsed);
      listeners.forEach((listener) => listener(cache!));
      return cache;
    })
    .catch(() => {
      cache = cache || defaultGlobalStyles;
      return cache;
    })
    .finally(() => { pending = null; });
  return pending;
}

export async function saveGlobalStyles(styles: GlobalStyles): Promise<void> {
  const { data, error } = await getSupabaseClient()
    .from('options')
    .upsert({ option_name: GLOBAL_STYLES_OPTION, option_value: JSON.stringify(styles) })
    .select('option_name');
  if (error) {
    throw new Error(/row-level security/i.test(describeDbError(error))
      ? 'Only administrators can change global colours and fonts (it needs the manage_options capability).'
      : describeDbError(error));
  }
  // An update blocked by row level security returns no error and no rows.
  if (!data?.length) throw new Error('Global styles were not saved: your role cannot edit site options (manage_options).');
  cache = normalise(styles);
  listeners.forEach((listener) => listener(cache!));
}

export function useGlobalStyles(): GlobalStyles {
  const [styles, setStyles] = useState<GlobalStyles>(cache || defaultGlobalStyles);
  useEffect(() => {
    listeners.add(setStyles);
    void loadGlobalStyles();
    return () => { listeners.delete(setStyles); };
  }, []);
  return styles;
}

/** Only the custom properties, for places outside a layout that preview global colours (the editor sidebar). */
export function globalVars(styles: GlobalStyles, scope: string): string {
  const { colors, fonts } = styles;
  return `${scope}{--rwpb-primary:${cssValue(colors.primary)};--rwpb-secondary:${cssValue(colors.secondary)};`
    + `--rwpb-text:${cssValue(colors.text)};--rwpb-accent:${cssValue(colors.accent)};`
    + `--rwpb-font-primary:${fontStack(fonts.primary)};--rwpb-font-headings:${fontStack(fonts.headings)}}`;
}

export function globalCss(styles: GlobalStyles, scope = '.rwpb-root'): string {
  return `${globalVars(styles, scope)}${scope}{font-family:var(--rwpb-font-primary);color:var(--rwpb-text)}`
    + `${scope} :is(h1,h2,h3,h4,h5,h6){font-family:var(--rwpb-font-headings)}`;
}

/** Every Google font a document and the global styles need. */
export function googleFontFamilies(styles: GlobalStyles, doc: BuilderDocument | null): string[] {
  if (!styles.loadGoogleFonts) return [];
  const google = new Set(fontChoices.filter((font) => font.google).map((font) => font.value));
  const families = new Set<string>();
  [styles.fonts.primary, styles.fonts.headings].forEach((family) => google.has(family) && families.add(family));
  if (doc) {
    walkNodes(doc.content, (node) => {
      Object.values(node.style || {}).forEach((bag) => {
        Object.values(bag || {}).forEach((value) => {
          const family = (value as { family?: string } | null)?.family;
          if (family && google.has(family)) families.add(family);
        });
      });
    });
  }
  return [...families].sort();
}

export function useGoogleFonts(families: string[]) {
  const key = families.join('|');
  useEffect(() => {
    if (!key) return;
    const href = `https://fonts.googleapis.com/css2?${key.split('|')
      .map((family) => `family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@300;400;500;600;700;800`)
      .join('&')}&display=swap`;
    if (document.querySelector(`link[data-rwpb-fonts="${CSS.escape(href)}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.rwpbFonts = href;
    document.head.appendChild(link);
  }, [key]);
}
