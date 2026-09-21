/**
 * Per-language fonts.
 *
 * Discovery happens at build time: Vite expands the glob below into the list of font files in
 * assets/fonts/<language>/, with a hashed URL for each. A browser cannot list a folder, so this is
 * the SPA equivalent of the WordPress plugin scanning its directory — drop files in, rebuild.
 *
 *   assets/fonts/fa/vazirmatn/Vazirmatn-Bold.woff2     one folder per family (the folder is the slug)
 *   assets/fonts/fa/Sahel-Bold.woff2                   or loose files, grouped by the name before the style
 *
 * Weight and style come from the file name (Thin … Black, Italic/Oblique, or a number such as 700);
 * a variable font ("VariableFont", "[wght]", "-VF") gets the range 100–900. Each face is
 * declared with font-display: swap, so text shows at once in the fallback font.
 *
 * Declaring a face downloads nothing: the browser fetches a file only once text uses that
 * family and weight. So every discovered face is declared up front.
 */

const files = import.meta.glob('./assets/fonts/*/**/*.{woff2,woff,ttf,otf}', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

export interface FontFace {
  url: string;
  format: 'woff2' | 'woff' | 'truetype' | 'opentype';
  /** '400', or '100 900' for a variable font. */
  weight: string;
  style: 'normal' | 'italic';
}

export interface FontChoice {
  slug: string;
  label: string;
  /** The complete font-family value to apply. */
  stack: string;
  /** Local files from assets/fonts, or a hosted stylesheet. */
  source: 'default' | 'local' | 'google';
  faces?: FontFace[];
  cssUrl?: string;
}

const weights: Array<[RegExp, number]> = [
  [/(extra|ultra)[-_ ]?light/i, 200],
  [/(extra|ultra)[-_ ]?bold/i, 800],
  [/(semi|demi)[-_ ]?bold/i, 600],
  [/thin|hairline/i, 100],
  [/light/i, 300],
  [/medium/i, 500],
  [/bold/i, 700],
  [/black|heavy/i, 900],
  [/regular|normal|book|roman/i, 400],
];

const styleWords = /(extra|ultra|semi|demi)?[-_ ]?(thin|hairline|light|regular|normal|book|roman|medium|bold|black|heavy)|italic|oblique|variable[-_ ]?font|\[[^\]]*\]|\bvf\b|\b[1-9]00\b/gi;

export const parseWeight = (name: string): string => {
  if (/variable|\[wght|(^|[-_ ])vf($|[-_ ])/i.test(name)) return '100 900';
  const numeric = name.match(/(?:^|[-_ ])([1-9]00)(?:$|[-_ ])/);
  if (numeric) return numeric[1];
  const found = weights.find(([pattern]) => pattern.test(name));
  return String(found ? found[1] : 400);
};

export const parseStyle = (name: string): 'normal' | 'italic' => (/italic|oblique/i.test(name) ? 'italic' : 'normal');

const formatOf = (file: string): FontFace['format'] => {
  const extension = file.split('.').pop()?.toLowerCase();
  return extension === 'woff2' ? 'woff2' : extension === 'woff' ? 'woff' : extension === 'otf' ? 'opentype' : 'truetype';
};

const formatRank: Record<FontFace['format'], number> = { woff2: 0, woff: 1, opentype: 2, truetype: 3 };

export const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'font';

/** 'noto_naskh-arabic' -> 'Noto Naskh Arabic'. */
export const labelFrom = (value: string) => value.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

/** The family name written into @font-face. Prefixed, so a font installed on the visitor's computer never answers instead. */
const faceFamily = (language: string, slug: string) => `PO ${language} ${slug}`;

const fallbacks: Record<string, string> = {
  fa: "Tahoma, 'Segoe UI', sans-serif",
  ar: "Tahoma, 'Segoe UI', sans-serif",
  en: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};
const fallbackFor = (language: string) => fallbacks[language] || fallbacks.en;

/** Groups the discovered files into families per language. Exported for tests. */
export function discoverFonts(paths: Record<string, string>): Record<string, FontChoice[]> {
  const families = new Map<string, { language: string; slug: string; label: string; faces: FontFace[] }>();
  Object.entries(paths).forEach(([path, url]) => {
    const match = path.match(/assets\/fonts\/([a-z]{2,3}(?:-[a-z0-9]{2,8})?)\/(.+)$/i);
    if (!match) return;
    const language = match[1].toLowerCase();
    const parts = match[2].split('/');
    const file = parts[parts.length - 1];
    const base = file.replace(/\.[^.]+$/, '');
    // A folder names the family; a loose file is named by what is left once the style words go.
    const family = parts.length > 1 ? parts[0] : base.replace(styleWords, '').replace(/[-_ ]+$/g, '') || base;
    const slug = slugify(family);
    const id = `${language}/${slug}`;
    const entry = families.get(id) || { language, slug, label: labelFrom(family), faces: [] };
    entry.faces.push({ url, format: formatOf(file), weight: parseWeight(base), style: parseStyle(base) });
    families.set(id, entry);
  });

  const result: Record<string, FontChoice[]> = {};
  families.forEach(({ language, slug, label, faces }) => {
    (result[language] ||= []).push({
      slug,
      label,
      source: 'local',
      stack: `'${faceFamily(language, slug)}', ${fallbackFor(language)}`,
      faces: faces.sort((a, b) => formatRank[a.format] - formatRank[b.format]),
    });
  });
  Object.values(result).forEach((list) => list.sort((a, b) => a.label.localeCompare(b.label)));
  return result;
}

/** One @font-face per weight and style, with every format of it as a fallback list, best first. */
export function fontFaceCss(catalog: Record<string, FontChoice[]>): string {
  const rules: string[] = [];
  Object.entries(catalog).forEach(([language, choices]) => {
    choices.filter((choice) => choice.source === 'local').forEach((choice) => {
      const groups = new Map<string, FontFace[]>();
      choice.faces!.forEach((face) => {
        const key = `${face.weight}|${face.style}`;
        groups.set(key, [...(groups.get(key) || []), face]);
      });
      groups.forEach((faces) => {
        const src = faces.map((face) => `url('${face.url}') format('${face.format}')`).join(', ');
        rules.push(`@font-face { font-family: '${faceFamily(language, choice.slug)}'; src: ${src}; font-weight: ${faces[0].weight}; font-style: ${faces[0].style}; font-display: swap; }`);
      });
    });
  });
  return rules.join('\n');
}

/**
 * Hosted fonts offered even with an empty fonts folder, so the selector is useful out of the box.
 * Google Fonts is the host core already loads its locale fonts from.
 */
const hosted: Record<string, Array<{ label: string; family: string; query: string }>> = {
  fa: [
    { label: 'Vazirmatn', family: 'Vazirmatn', query: 'Vazirmatn:wght@300;400;500;700' },
    { label: 'Noto Naskh Arabic', family: 'Noto Naskh Arabic', query: 'Noto+Naskh+Arabic:wght@400;500;700' },
    { label: 'Noto Sans Arabic', family: 'Noto Sans Arabic', query: 'Noto+Sans+Arabic:wght@300;400;500;700' },
    { label: 'Lalezar (display)', family: 'Lalezar', query: 'Lalezar' },
  ],
  en: [
    { label: 'Inter', family: 'Inter', query: 'Inter:wght@300;400;500;700' },
    { label: 'Roboto', family: 'Roboto', query: 'Roboto:wght@300;400;500;700' },
    { label: 'Lora (serif)', family: 'Lora', query: 'Lora:wght@400;500;700' },
    { label: 'Merriweather (serif)', family: 'Merriweather', query: 'Merriweather:wght@300;400;700' },
  ],
};

const discovered = discoverFonts(files);

/** Every font a language can use: the site's own first, then local files, then hosted ones. */
export function fontCatalog(language: string): FontChoice[] {
  const local = discovered[language] || [];
  const taken = new Set(local.map((choice) => choice.slug));
  const remote = (hosted[language] || [])
    .map((font): FontChoice => ({
      slug: slugify(font.family),
      label: font.label,
      source: 'google',
      stack: `'${font.family}', ${fallbackFor(language)}`,
      cssUrl: `https://fonts.googleapis.com/css2?family=${font.query}&display=swap`,
    }))
    .filter((choice) => !taken.has(choice.slug));
  return [{ slug: 'default', label: 'Site default', source: 'default', stack: '' }, ...local, ...remote];
}

export const findFont = (language: string, slug: string | undefined): FontChoice =>
  fontCatalog(language).find((choice) => choice.slug === slug) || fontCatalog(language)[0];

export const localFontCount = () => Object.values(discovered).reduce((sum, list) => sum + (list?.length || 0), 0);
export const discoveredFonts = () => discovered;

/** Adds the @font-face rules once. Returns a function that removes them (plugin deactivation). */
export function injectFontFaces(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const css = fontFaceCss(discovered);
  if (!css) return () => undefined;
  const style = document.createElement('style');
  style.dataset.poFonts = '';
  style.textContent = css;
  document.head.appendChild(style);
  return () => style.remove();
}

const loadedSheets = new Set<string>();

/** Loads a hosted font's stylesheet the first time it is chosen. */
export function ensureFontLoaded(choice: FontChoice) {
  if (choice.source !== 'google' || !choice.cssUrl || loadedSheets.has(choice.cssUrl) || typeof document === 'undefined') return;
  loadedSheets.add(choice.cssUrl);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = choice.cssUrl;
  link.dataset.poFont = choice.slug;
  // A blocked font must not break anything: the stack ends in system fonts.
  link.addEventListener('error', () => console.warn(`The ${choice.label} font could not be loaded; the fallback font is used.`));
  document.head.appendChild(link);
}
