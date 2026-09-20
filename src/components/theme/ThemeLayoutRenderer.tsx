import {
  Component, createContext, useContext, useEffect, useState,
  type CSSProperties, type ErrorInfo, type FormEvent, type ReactNode,
} from 'react';
import layoutStyles from '../PublicLayout.module.css';
import homeStyles from '../PublicHome.module.css';
import ContentRenderer from '../ContentRenderer';
import LoginButton from '../LoginButton';
import LanguageSwitcher from '../LanguageSwitcher';
import WidgetRenderer from '../WidgetRenderer';
import { getSupabaseClient } from '../../lib/db';
import { injectSnippet, useAppSettings } from '../../lib/appSettings';
import { MenuLabel, resolveMenuLinks, useMenuViewer, type DynamicMenuLink, type ResolvedMenuLink } from '../../lib/dynamicMenu';
import { rwp } from '../../lib/rwp';
import { brandParts, type SiteBranding } from '../../lib/settings';
import {
  areaHasType, cleanUrl, exitThemePreview, fillPlaceholders, getBlockDefinition, isThemePreview, socialNetworks,
  themeStylesheet, useTheme,
  type ThemeAreaId, type ThemeBlock, type ThemeSettings,
} from '../../lib/theme';
import type { Widget, WidgetType } from '../../lib/widgets';
import './theme.css';

/**
 * Renders the Theme Editor's layout on the public site.
 *
 * Every block is wrapped in its own error boundary, so a block that throws (bad saved settings, a
 * plugin header item, a shortcode inside Custom HTML) disappears on its own instead of taking the
 * page down. HTML goes through ContentRenderer, which sanitises it and runs shortcodes.
 *
 * Class names starting rwp- and rwpt- are global and stable on purpose: they are what Custom CSS
 * targets, so never turn them into CSS module classes.
 */

// Shared page data -------------------------------------------------------------------------------

export interface ThemeChrome {
  siteTitle: string;
  branding?: Pick<SiteBranding, 'site_tagline' | 'site_logo' | 'header_display' | 'logo_height'>;
  /** The primary menu (Menus → Menus), before placeholders are resolved. */
  menuLinks: DynamicMenuLink[];
  signedIn: boolean;
  showAuthLinks: boolean;
  canRegister: boolean;
  /** Widget areas from Menus → Sidebar & Widgets; null while loading. */
  widgets: { sidebar: Widget[]; footer: Widget[] } | null;
}

const ThemeChromeContext = createContext<ThemeChrome>({
  siteTitle: '', menuLinks: [], signedIn: false, showAuthLinks: true, canRegister: true, widgets: null,
});

export const ThemeChromeProvider = ThemeChromeContext.Provider;
export const useThemeChrome = () => useContext(ThemeChromeContext);

// Document: CSS and scripts ----------------------------------------------------------------------

let scriptsInjected = false;

/**
 * Writes Custom CSS into <style id="rwp-theme-css"> at the end of <head> (after the app's own
 * stylesheet, so equal-specificity rules win), and injects the <head> code and footer scripts once.
 * On npm start server/seo.mjs already wrote all three and added <meta name="rwp-theme">, so only
 * the CSS is refreshed here. A preview never runs scripts: unsaved code would run on every edit.
 */
export const applyThemeDocument = (theme: ThemeSettings) => {
  const css = themeStylesheet(theme);
  let style = document.getElementById('rwp-theme-css') as HTMLStyleElement | null;
  if (!style && css) {
    style = document.createElement('style');
    style.id = 'rwp-theme-css';
    document.head.appendChild(style);
  }
  // textContent, not innerHTML: "</style>" inside the CSS cannot end the element this way.
  if (style && style.textContent !== css) style.textContent = css;

  // Subscribers visiting /admin see the public home page, but scripts stay off the admin URL.
  const isAdminUrl = window.location.pathname.replace(/\/+$/, '') === '/admin';
  if (isThemePreview() || isAdminUrl || scriptsInjected || document.querySelector('meta[name="rwp-theme"]')) return;
  scriptsInjected = true;
  injectSnippet(theme.custom_header_code, 'head');
  injectSnippet(theme.custom_footer_code, 'body-end');
};

/** Keeps the page's CSS in step with the theme, including live preview updates. */
export function useThemeDocument() {
  const { theme, loaded } = useTheme();
  useEffect(() => {
    if (loaded) applyThemeDocument(theme);
  }, [loaded, theme]);
}

export function ThemePreviewBanner() {
  const { preview } = useTheme();
  if (!preview) return null;
  return (
    <div className="rwpt-preview-banner" role="status">
      <span><strong>Theme preview.</strong> You are seeing unsaved changes from the Theme Editor, and only in this browser. Unsaved &lt;head&gt; code and footer scripts do not run here.</span>
      <button type="button" onClick={exitThemePreview}>Exit preview</button>
    </div>
  );
}

// Error boundary ---------------------------------------------------------------------------------

interface BoundaryProps { label: string; children: ReactNode }

export class ThemeErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Theme block "${this.props.label}" failed to render and was hidden.`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    // Visitors see nothing; the person previewing sees why the block vanished.
    return isThemePreview()
      ? <div className="rwpt-block-error" role="alert">“{this.props.label}” failed to render: {this.state.error.message}</div>
      : null;
  }
}

// Block frame ------------------------------------------------------------------------------------

export function BlockFrame({ block, children, className = '' }: { block: ThemeBlock; children: ReactNode; className?: string }) {
  const { style } = block;
  if (!style.visible) return null;
  const classes = [
    'rwpt-block',
    `rwpt-block-${block.type}`,
    style.align !== 'inherit' ? `rwpt-align-${style.align}` : '',
    style.hide_mobile ? 'rwpt-hide-mobile' : '',
    style.hide_desktop ? 'rwpt-hide-desktop' : '',
    className,
  ].filter(Boolean).join(' ');
  const inline: CSSProperties = {
    padding: style.padding ? `${style.padding}px` : undefined,
    background: style.background || undefined,
    color: style.color || undefined,
  };
  const label = getBlockDefinition(block.type)?.label || block.type;
  return (
    <div className={classes} style={inline} data-rwpt-block={block.id}>
      {/* Keyed on the settings so a preview recovers as soon as the setting is fixed. */}
      <ThemeErrorBoundary key={JSON.stringify(block.settings)} label={label}>{children}</ThemeErrorBoundary>
    </div>
  );
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** The area's HTML from Code mode. */
export const areaCode = (theme: ThemeSettings, area: ThemeAreaId) =>
  area === 'header' ? theme.custom_header_html
    : area === 'footer' ? theme.custom_footer_html
      : area === 'sidebar' ? theme.custom_sidebar_code : '';

/** Code mode HTML goes where its block is; with no block, at the end of the area. */
export function UnplacedAreaCode({ area }: { area: ThemeAreaId }) {
  const { theme } = useTheme();
  const html = areaCode(theme, area);
  if (!html.trim() || areaHasType(theme.layout[area], 'area-code')) return null;
  return (
    <div className="rwpt-block rwpt-block-area-code">
      <ThemeErrorBoundary label={`${area} code`}><ContentRenderer html={html} /></ThemeErrorBoundary>
    </div>
  );
}

// Blocks -----------------------------------------------------------------------------------------

function Brand() {
  const { siteTitle, branding } = useThemeChrome();
  const { logo: showLogo, title: showTitle, tagline: showTagline } = brandParts(branding || {});
  return (
    <a className={`${layoutStyles.brand} rwp-brand`} href="/">
      {showLogo && (
        <img className={layoutStyles.brandLogo} src={branding?.site_logo} alt={showTitle ? '' : siteTitle} style={{ height: branding?.logo_height || 44 }} />
      )}
      {(showTitle || showTagline) && (
        <span className={layoutStyles.brandText}>
          {showTitle && <strong>{siteTitle}</strong>}
          {showTagline && <span>{branding?.site_tagline}</span>}
        </span>
      )}
    </a>
  );
}

/** The primary menu from the page, or a menu row by id. */
function useMenuLinks(menuId: string): ResolvedMenuLink[] {
  const { menuLinks } = useThemeChrome();
  const viewer = useMenuViewer();
  const { settings: appSettings } = useAppSettings();
  const [stored, setStored] = useState<DynamicMenuLink[] | null>(null);

  useEffect(() => {
    if (!menuId) return undefined;
    let mounted = true;
    getSupabaseClient().from('menus').select('items').eq('id', menuId).maybeSingle()
      .then(({ data }) => {
        if (mounted) setStored(Array.isArray(data?.items) ? data.items as DynamicMenuLink[] : []);
      });
    return () => { mounted = false; };
  }, [menuId]);

  return resolveMenuLinks(menuId ? stored || [] : menuLinks, viewer, appSettings.menu.profile_url);
}

function NavItem({ link, onNavigate }: { link: ResolvedMenuLink; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const accessibleName = link.label ? undefined : link.name;

  if (!link.children?.length) {
    return <a href={link.url} onClick={onNavigate} aria-label={accessibleName}><MenuLabel link={link} /></a>;
  }

  return (
    <div
      className={layoutStyles.hasChildren}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      // Focus events bubble, so this also opens when a keyboard user tabs into the submenu.
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <a href={link.url} aria-haspopup="true" aria-expanded={open} onClick={onNavigate} aria-label={accessibleName}>
        <MenuLabel link={link} /> <span aria-hidden="true">▾</span>
      </a>
      <div className={`${layoutStyles.submenu} ${open ? layoutStyles.submenuOpen : ''}`}>
        {link.children.map((child) => (
          <a key={`${child.name}-${child.url}`} href={child.url} onClick={onNavigate} aria-label={child.label ? undefined : child.name}>
            <MenuLabel link={child} />
          </a>
        ))}
      </div>
    </div>
  );
}

function PrimaryMenu({ menuId }: { menuId: string }) {
  const [open, setOpen] = useState(false);
  const links = useMenuLinks(menuId);
  return (
    <>
      <button type="button" className={layoutStyles.menuButton} aria-label="Toggle navigation" aria-expanded={open}
        onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true">☰</span>
      </button>
      <nav className={`${layoutStyles.nav} ${open ? layoutStyles.navOpen : ''} rwp-nav`} aria-label="Primary navigation">
        {links.map((link) => <NavItem key={`${link.name}-${link.url}`} link={link} onNavigate={() => setOpen(false)} />)}
      </nav>
    </>
  );
}

function HeaderActions({ block }: { block: ThemeBlock }) {
  const { signedIn, showAuthLinks, canRegister } = useThemeChrome();
  const [, refresh] = useState(0);
  // Plugins register header items when they activate, which can be after the first render.
  useEffect(() => rwp.subscribe(() => refresh((value) => value + 1)), []);
  const items = block.settings.show_plugin_items ? rwp.getHeaderItems() : [];
  const register = showAuthLinks && block.settings.show_register && !signedIn && canRegister;
  const login = showAuthLinks && block.settings.show_login;
  // Layouts saved before the language switcher existed have no such setting, so it is opt-out,
  // not opt-in: otherwise every site with a saved theme would silently lose the switcher.
  // LanguageSwitcher itself renders nothing for a one-language site or when the setting is off.
  const languages = block.settings.show_language_switcher !== false;
  if (!items.length && !register && !login && !languages) return null;
  return (
    <span className={`${layoutStyles.authLinks} rwp-header-actions`}>
      {languages && <LanguageSwitcher />}
      {items.map(({ id, component: Item }) => <ThemeErrorBoundary key={id} label={`Header item ${id}`}><Item /></ThemeErrorBoundary>)}
      {register && <a href="/register">Register</a>}
      {login && <LoginButton variant="button" />}
    </span>
  );
}

function SearchBar({ block }: { block: ThemeBlock }) {
  const [term, setTerm] = useState(() => new URLSearchParams(window.location.search).get('s') || '');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (term.trim()) window.location.href = `/?s=${encodeURIComponent(term.trim())}`;
  };
  return (
    <form className="rwpt-search" role="search" onSubmit={submit}>
      <label className={homeStyles.srOnly} htmlFor={`search-${block.id}`}>Search posts</label>
      <input id={`search-${block.id}`} type="search" value={term} onChange={(event) => setTerm(event.target.value)}
        placeholder={text(block.settings.placeholder) || 'Search posts…'} />
    </form>
  );
}

function SocialLinks({ block }: { block: ThemeBlock }) {
  const links = socialNetworks
    .map(([key, label]) => ({ key, label, url: cleanUrl(block.settings[key]) }))
    .filter((link) => link.url);
  if (!links.length) return null;
  return (
    <ul className="rwpt-social">
      {links.map((link) => (
        <li key={link.key}><a href={link.url} target="_blank" rel="noopener noreferrer" className={`rwpt-social-${link.key}`}>{link.label}</a></li>
      ))}
    </ul>
  );
}

function MenuLinks({ menuId }: { menuId: string }) {
  const links = useMenuLinks(menuId);
  if (!links.length) return null;
  return (
    <ul className="rwpt-menu-links">
      {links.map((link) => (
        <li key={`${link.name}-${link.url}`}><a href={link.url} aria-label={link.label ? undefined : link.name}><MenuLabel link={link} size={20} /></a></li>
      ))}
    </ul>
  );
}

/** Blocks that are the existing widgets reuse WidgetRenderer, so both render identically. */
const widgetTypeFor: Partial<Record<ThemeBlock['type'], WidgetType>> = {
  'recent-posts': 'recent-posts', categories: 'categories', login: 'login',
};

const asWidget = (block: ThemeBlock, type: WidgetType): Widget => ({
  id: block.id,
  type,
  title: text(block.settings.title),
  settings: {
    count: Number(block.settings.count) || 5,
    showCounts: Boolean(block.settings.show_counts),
    label: text(block.settings.label),
    style: text(block.settings.style) || 'button',
  },
});

/** Sidebar and footer blocks sit in the widget card style; header blocks are bare. */
function Titled({ area, title, children }: { area: ThemeAreaId; title: string; children: ReactNode }) {
  if (area === 'header') return <>{children}</>;
  return (
    <div className={homeStyles.widget}>
      {title && <h2>{title}</h2>}
      {children}
    </div>
  );
}

export interface ChromeBlockProps {
  block: ThemeBlock;
  area: ThemeAreaId;
  /** Lets the sidebar keep its original fallback widgets when none are configured. */
  renderWidgetArea?: (source: 'sidebar' | 'footer') => ReactNode;
}

export function ChromeBlock({ block, area, renderWidgetArea }: ChromeBlockProps) {
  const { theme } = useTheme();
  const chrome = useThemeChrome();
  const settings = block.settings;
  const fill = (value: unknown) => fillPlaceholders(text(value), { site_title: chrome.siteTitle, site_tagline: chrome.branding?.site_tagline });
  const widgetType = widgetTypeFor[block.type];
  if (widgetType) return <WidgetRenderer widget={asWidget(block, widgetType)} />;

  switch (block.type) {
    case 'site-logo': return <Brand />;
    case 'primary-menu': return <PrimaryMenu menuId={text(settings.menu_id)} />;
    case 'header-actions': return <HeaderActions block={block} />;
    case 'search': return <Titled area={area} title={text(settings.title)}><SearchBar block={block} /></Titled>;
    case 'social-icons': return <Titled area={area} title={text(settings.title)}><SocialLinks block={block} /></Titled>;
    case 'menu': return <Titled area={area} title={text(settings.title)}><MenuLinks menuId={text(settings.menu_id)} /></Titled>;
    case 'custom-html': return <Titled area={area} title={text(settings.title)}><ContentRenderer html={text(settings.html)} applyContentFilters={false} /></Titled>;
    case 'text': return <p className="rwpt-text">{fill(settings.text)}</p>;
    case 'copyright': return <span className="rwpt-copyright">{fill(settings.text)}</span>;
    case 'area-code': return <ContentRenderer html={areaCode(theme, area)} applyContentFilters={false} />;
    case 'widget-area': {
      const source = settings.source === 'footer' ? 'footer' : 'sidebar';
      if (renderWidgetArea) return <>{renderWidgetArea(source)}</>;
      const widgets = chrome.widgets?.[source] || [];
      if (!widgets.length) return null;
      return (
        <div className={area === 'footer' ? 'rwpt-widget-grid' : 'rwpt-widget-stack'}>
          {widgets.map((widget) => <WidgetRenderer key={widget.id} widget={widget} />)}
        </div>
      );
    }
    default:
      return null;
  }
}

export function AreaBlocks({ area, blocks, renderWidgetArea }: { area: ThemeAreaId; blocks: ThemeBlock[]; renderWidgetArea?: ChromeBlockProps['renderWidgetArea'] }) {
  return (
    <>
      {blocks.map((block) => (
        <BlockFrame key={block.id} block={block}>
          <ChromeBlock block={block} area={area} renderWidgetArea={renderWidgetArea} />
        </BlockFrame>
      ))}
    </>
  );
}

// Areas ------------------------------------------------------------------------------------------

const widthClass = (layout: string | undefined, base: string, wide: string, full: string) =>
  layout === 'full' ? full : layout === 'wide' ? wide : base;

export function ThemeHeader({ layoutWidth }: { layoutWidth?: string }) {
  const { theme } = useTheme();
  const header = theme.layout.header;
  const classes = [
    widthClass(layoutWidth, layoutStyles.header, layoutStyles.headerWide, layoutStyles.headerFull),
    'rwp-header rwpt-row',
    header.options.sticky ? 'rwpt-sticky' : '',
  ].filter(Boolean).join(' ');
  return (
    <header className={classes}>
      <AreaBlocks area="header" blocks={header.containers[0]?.blocks || []} />
      <UnplacedAreaCode area="header" />
    </header>
  );
}

export function ThemeFooter({ layoutWidth }: { layoutWidth?: string }) {
  const { theme } = useTheme();
  const { widgets } = useThemeChrome();
  const footer = theme.layout.footer;
  const footerClass = widthClass(layoutWidth, layoutStyles.footer, layoutStyles.footerWide, layoutStyles.footerFull);
  const columns = footer.containers.filter((container) => container.id !== 'bottom');
  const bottom = footer.containers.find((container) => container.id === 'bottom')?.blocks || [];

  // An empty widget area renders nothing, so it must not keep the (bordered) column row visible.
  const rendersSomething = (block: ThemeBlock) => block.style.visible
    && !(block.type === 'widget-area' && !(widgets?.[block.settings.source === 'footer' ? 'footer' : 'sidebar'] || []).length);
  const showColumns = columns.some((column) => column.blocks.some(rendersSomething));

  return (
    <>
      {showColumns && (
        <div className={`${footerClass} rwp-footer-columns`}>
          <div
            className={`${layoutStyles.footerWidgets} rwpt-footer-grid${columns.length > 1 ? ' rwpt-columns-fixed' : ''}`}
            style={{ '--rwpt-columns': columns.length } as CSSProperties}
          >
            {columns.map((column) => (
              <div key={column.id} className={`rwpt-footer-column rwpt-footer-${column.id}`}>
                <AreaBlocks area="footer" blocks={column.blocks} />
              </div>
            ))}
          </div>
        </div>
      )}
      <footer className={`${footerClass} rwp-footer rwpt-row`}>
        <AreaBlocks area="footer" blocks={bottom} />
        <UnplacedAreaCode area="footer" />
      </footer>
    </>
  );
}

export function ThemeSidebarBlocks({ renderWidgetArea }: { renderWidgetArea?: ChromeBlockProps['renderWidgetArea'] }) {
  const { theme } = useTheme();
  return (
    <>
      <AreaBlocks area="sidebar" blocks={theme.layout.sidebar.containers[0]?.blocks || []} renderWidgetArea={renderWidgetArea} />
      <UnplacedAreaCode area="sidebar" />
    </>
  );
}

/**
 * The structural areas the site chrome owns. Comments and the home/archive index are rendered by
 * CommentSection and PublicHome, which have the data those blocks need, using BlockFrame.
 */
export default function ThemeLayoutRenderer({ area, layoutWidth, renderWidgetArea }: {
  area: 'header' | 'footer' | 'sidebar';
  layoutWidth?: string;
  renderWidgetArea?: ChromeBlockProps['renderWidgetArea'];
}) {
  if (area === 'header') return <ThemeHeader layoutWidth={layoutWidth} />;
  if (area === 'footer') return <ThemeFooter layoutWidth={layoutWidth} />;
  return <ThemeSidebarBlocks renderWidgetArea={renderWidgetArea} />;
}
