/**
 * Theme Header and Theme Footer: the header and footer laid out under Appearance → Theme Editor,
 * as widgets. The default Header and Footer templates use them, so publishing those templates keeps
 * the site looking the same until they are redesigned with other widgets.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ThemeChromeProvider, ThemeFooter, ThemeHeader, useThemeChrome, type ThemeChrome } from '../../../../src/components/theme/ThemeLayoutRenderer';
import { getSupabaseClient } from '../../../../src/lib/db';
import { rwp } from '../../../../src/lib/rwp';
import { loadWidgetAreas } from '../../../../src/lib/widgets';
import { opts } from '../../lib/controls';
import type { WidgetDefinition } from '../../lib/registry';
import { useRenderContext, useTemplateContext } from '../context';
import { pick, useSiteSettings } from './kit';

/**
 * On the public site these render inside PublicLayout, which already provides the menu, site title
 * and signed-in state. The editor canvas has none of that, so it is loaded here for the preview.
 */
function EditorChrome({ children }: { children: ReactNode }) {
  const { mode } = useRenderContext();
  const outer = useThemeChrome();
  const site = useSiteSettings();
  const [extra, setExtra] = useState<Pick<ThemeChrome, 'menuLinks' | 'widgets'> | null>(null);
  const needed = mode === 'edit' && !outer.siteTitle;

  useEffect(() => {
    if (!needed) return undefined;
    let active = true;
    void Promise.all([
      getSupabaseClient().from('options').select('option_value').eq('option_name', 'menu_links').maybeSingle(),
      loadWidgetAreas().catch(() => ({ sidebar: [], footer: [] })),
    ]).then(([{ data }, widgets]) => {
      let menuLinks: ThemeChrome['menuLinks'] = [{ label: 'Home', url: '/' }];
      try {
        const parsed: unknown = data?.option_value ? JSON.parse(data.option_value) : null;
        if (Array.isArray(parsed)) menuLinks = rwp.filters.apply('rwp_public_menu', parsed);
      } catch {
        // Keep the one-link preview menu when the option is not valid JSON.
      }
      if (active) setExtra({ menuLinks, widgets });
    });
    return () => { active = false; };
  }, [needed]);

  if (!needed) return <>{children}</>;
  if (!site || !extra) return null;
  return (
    <ThemeChromeProvider value={{
      siteTitle: site.site_title, branding: site, menuLinks: extra.menuLinks, signedIn: false,
      showAuthLinks: site.show_auth_links, canRegister: site.users_can_register, widgets: extra.widgets,
    }}>
      {children}
    </ThemeChromeProvider>
  );
}

const widthControl = { key: 'width', label: 'Width', type: 'select' as const, options: opts(['auto', 'Same as the page'], ['boxed', 'Boxed'], ['wide', 'Wide'], ['full', 'Full width']) };

/** "Same as the page" is what the Theme Editor header does: it follows each page's content width. */
function useWidth(value: unknown) {
  const pageWidth = useTemplateContext()?.layoutWidth;
  const chosen = pick(value, ['auto', 'boxed', 'wide', 'full'] as const, 'auto');
  return chosen === 'auto' ? pageWidth || 'wide' : chosen;
}

export const themeHeader: WidgetDefinition = {
  type: 'theme-header',
  label: 'Theme Header',
  icon: 'panel-top',
  category: 'site',
  keywords: ['header', 'site header', 'theme editor', 'navigation'],
  defaults: () => ({ settings: { width: 'auto' } }),
  controls: [
    { ...widthControl, help: 'The logo, menu and buttons are arranged under Appearance → Theme Editor → Header. To design the header here instead, replace this widget with Site Logo, Nav Menu, Search and Button widgets.' },
  ],
  View: function ThemeHeaderView({ node }) {
    const width = useWidth(node.settings.width);
    return <div className="rwpb-theme-part"><EditorChrome><ThemeHeader layoutWidth={width} /></EditorChrome></div>;
  },
};

export const themeFooter: WidgetDefinition = {
  type: 'theme-footer',
  label: 'Theme Footer',
  icon: 'app-window',
  category: 'site',
  keywords: ['footer', 'site footer', 'copyright', 'theme editor'],
  defaults: () => ({ settings: { width: 'auto' } }),
  controls: [
    { ...widthControl, help: 'The footer columns and copyright line are arranged under Appearance → Theme Editor → Footer. To design the footer here instead, replace this widget with Text, Nav Menu and Social Icons widgets.' },
  ],
  View: function ThemeFooterView({ node }) {
    const width = useWidth(node.settings.width);
    return <div className="rwpb-theme-part"><EditorChrome><ThemeFooter layoutWidth={width} /></EditorChrome></div>;
  },
};
