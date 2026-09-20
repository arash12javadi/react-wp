/**
 * The page builder document, stored as JSON in pages.builder_data.
 *
 *   BuilderDocument
 *     └─ content: SectionNode[]
 *          └─ children: ColumnNode[]
 *               └─ children: (WidgetNode | SectionNode)[]   ← an inner section nests one level
 *
 * Every node has the same four bags, so tree operations, the navigator and the CSS
 * generator treat all kinds alike:
 *  - settings: content values (text, links, query options). Not responsive.
 *  - style:    per-device style values. Desktop is the base; tablet and mobile hold only the
 *              values that differ, and cascade desktop → tablet → mobile like Elementor.
 *  - advanced: CSS id/classes, custom CSS, motion, visibility.
 */

export type Device = 'desktop' | 'tablet' | 'mobile';
export const devices: Device[] = ['desktop', 'tablet', 'mobile'];

export type NodeKind = 'section' | 'column' | 'widget';

export type StyleBag = Record<string, unknown>;

export interface ResponsiveStyle {
  desktop: StyleBag;
  tablet?: StyleBag;
  mobile?: StyleBag;
}

export type EntranceAnimation = '' | 'fadeIn' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'zoomIn';

export interface AdvancedSettings {
  cssId?: string;
  cssClasses?: string;
  /** "selector" is replaced with this element's own class. */
  customCss?: string;
  animation?: EntranceAnimation;
  animationDuration?: number;
  animationDelay?: number;
  sticky?: boolean;
  stickyOffset?: number;
  hideOn?: Partial<Record<Device, boolean>>;
}

export interface BaseNode {
  id: string;
  kind: NodeKind;
  /** 'section', 'column', or a widget type such as 'heading'. */
  type: string;
  /** Navigator name. Falls back to the widget label. */
  label?: string;
  /** Hidden everywhere (navigator eye toggle). */
  hidden?: boolean;
  settings: Record<string, unknown>;
  style: ResponsiveStyle;
  advanced: AdvancedSettings;
}

export interface WidgetNode extends BaseNode {
  kind: 'widget';
}

export interface ColumnNode extends BaseNode {
  kind: 'column';
  type: 'column';
  children: Array<WidgetNode | SectionNode>;
}

export interface SectionNode extends BaseNode {
  kind: 'section';
  type: 'section';
  children: ColumnNode[];
}

export type BuilderNode = SectionNode | ColumnNode | WidgetNode;
export type ParentNode = SectionNode | ColumnNode;

export interface DocumentSettings {
  /** Show the page title above the layout. Off by default, as on a landing page. */
  showTitle?: boolean;
  showComments?: boolean;
  background?: string;
  customCss?: string;
  /** Ticked manual SEO tasks from the SEO tab (see editor/seo/seoChecklists.ts). Booleans only: this JSON is public. */
  seoChecklist?: Record<string, boolean>;
}

export interface BuilderDocument {
  version: 1;
  settings: DocumentSettings;
  content: SectionNode[];
}

export interface GlobalStyles {
  colors: { primary: string; secondary: string; text: string; accent: string };
  fonts: { primary: string; headings: string };
  /** Load the chosen families from Google Fonts. Off means use locally installed fonts only. */
  loadGoogleFonts: boolean;
}

export interface BuilderPage {
  id: number;
  title: string;
  slug: string;
  status: string;
  excerpt: string;
  content: string;
  is_post: boolean;
  layout: string;
  author_id?: string | null;
  category_id?: string | null;
  og_image?: string | null;
  created_at: string;
  updated_at: string;
  builder_data: BuilderDocument | null;
  is_builder_enabled: boolean;
  /** Set by 20260925_site_templates.sql; absent before it runs. */
  is_site_template?: boolean;
  template_type?: string | null;
  /**
   * The language this row is written in. Set by 20260929_i18n_hooks.sql, which defaults it to the
   * site language; absent (undefined) before that migration runs, which every reader must treat
   * as "the site default", not as a missing page.
   */
  locale?: string | null;
  /** Rows sharing this id are translations of each other, one per locale. */
  translation_group_id?: string | null;
  /**
   * Layouts for the other languages, keyed by locale code. builder_data stays the layout for the
   * page's own locale, so nothing that already reads it has to change.
   */
  builder_data_i18n?: Record<string, BuilderDocument> | null;
}

/** A page's layouts by locale: its own from builder_data, the rest from builder_data_i18n. */
export type LocaleDocuments = Record<string, BuilderDocument>;

export type TemplateType = 'page' | 'section';

export interface BuilderTemplate {
  id: string;
  title: string;
  type: TemplateType;
  builder_data: { content: SectionNode[] };
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormField {
  id: string;
  type: 'text' | 'email' | 'textarea' | 'select' | 'checkbox';
  label: string;
  placeholder?: string;
  required?: boolean;
  /** Choices for select, and for a checkbox group. A checkbox without options is a single tick box. */
  options?: string[];
  width?: '100' | '50';
}

export const emptyDocument = (): BuilderDocument => ({ version: 1, settings: {}, content: [] });
