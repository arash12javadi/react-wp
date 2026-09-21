import type { ComponentType, ReactNode } from 'react';
import { addAction, addFilter, applyFilters, doAction, DEFAULT_PRIORITY } from '../core/hooks';
import type { Page } from './types';

export type RwpActionName =
  | 'rwp_init'
  | 'rwp_admin_loaded'
  /** The admin has a signed-in user who may use it; receives their role. */
  | 'rwp_admin_ready'
  | 'rwp_public_loaded'
  | 'rwp_user_logged_in'
  | 'rwp_user_logged_out'
  | 'rwp_post_created'
  | 'rwp_post_updated'
  | 'rwp_post_deleted'
  | 'rwp_page_created'
  | 'rwp_page_updated'
  | 'rwp_page_deleted'
  | 'rwp_settings_saved'
  | 'rwp_menu_saved'
  | 'rwp_plugin_activated'
  | 'rwp_plugin_deactivated'
  // Plugins may define their own actions; prefix them with the plugin id.
  | (string & {});

export type RwpFilterName =
  | 'rwp_site_title'
  | 'rwp_site_description'
  | 'rwp_public_menu'
  | 'rwp_posts'
  | 'rwp_post_title'
  | 'rwp_post_excerpt'
  | 'rwp_post_content'
  | 'rwp_page_content'
  | 'rwp_admin_navigation'
  /** (items, group) — the default pages a new site gets; see src/lib/defaultContent.ts. */
  | 'rwp_default_content'
  /** (choices, key) — extra addresses offered for an account page, e.g. the shop's /my-account. */
  | 'rwp_account_page_choices';

export interface RwpAdminSubmenuItem {
  id: string;
  label: string;
  /** An emoji. Rendered as text, so it costs nothing to load. */
  icon?: string;
  /** Hides the item from roles without this capability. */
  capability?: string;
}

export interface RwpAdminPageProps {
  /** The selected submenu item id, or '' for pages without a submenu. */
  subsection: string;
  /** Moves to another admin screen, e.g. navigate('settings', 'seo'). */
  navigate: (section: string, subsection?: string) => void;
}

export interface RwpAdminPage {
  id: string;
  label: string;
  icon?: string;
  capability?: string;
  /** Shown under the page in the admin sidebar while it is open, like WordPress submenus. */
  submenu?: RwpAdminSubmenuItem[];
  component: ComponentType<RwpAdminPageProps>;
}

export interface RwpDashboardWidget {
  id: string;
  title: string;
  /** Roles without this capability do not see the widget. */
  capability?: string;
  component: ComponentType;
}

export type RwpSetupLevel = 'required' | 'recommended' | 'optional';

/** One item in Dashboard → Overview's setup checklist. */
export interface RwpSetupNotice {
  /** Stable across releases: a dismissed notice is remembered by this id. */
  id: string;
  level: RwpSetupLevel;
  title: string;
  description: string;
  /** Numbered instructions shown when the notice is expanded. */
  steps?: string[];
  /** An admin screen (section/subsection) or an external link (href). */
  action?: { label: string; section?: string; subsection?: string; href?: string };
}

export interface RwpSetupCheck {
  id: string;
  capability?: string;
  /** Returns the notices that still apply. Resolve to [] when everything is set up. */
  run: () => Promise<RwpSetupNotice[]>;
}

export interface RwpShortcode {
  name: string;
  render: (attributes: Record<string, string>) => ReactNode;
  /** Documentation for Dashboard → Guide. */
  description?: string;
  example?: string;
  attributes?: Array<{ name: string; description: string }>;
}

export interface RwpRouteProps {
  /** Named segments from the path pattern, e.g. { slug: 'blue-shirt' } for /product/:slug */
  params: Record<string, string>;
}

export interface RwpRoute {
  /**
   * Public path pattern. Segments starting with ":" are captured; a trailing "*" matches
   * the rest of the path into params["*"]. Example: "/product/:slug", "/my-account/*".
   */
  path: string;
  component: ComponentType<RwpRouteProps>;
  /** Wrap in the site header, menu and footer. Defaults to true. */
  chrome?: boolean;
}

export interface RwpHeaderItem {
  id: string;
  component: ComponentType;
}

export interface RwpContentRendererProps {
  page: Page;
  /** The comment section PublicContent would have shown, or null when comments are off. */
  comments: ReactNode;
}

export interface RwpContentRenderer {
  id: string;
  /** Receives the full pages row (select *), including columns added by plugin migrations. */
  match: (page: Page) => boolean;
  /** Replaces the title, excerpt and content of a page on the public site. */
  component: ComponentType<RwpContentRendererProps>;
  /** Where the toolbar's "Edit page" link should point for matching pages. */
  editHref?: (page: Page) => string;
}

export interface RwpContentAction {
  id: string;
  label: string;
  href: (page: Page) => string;
  /** Hide the action for some rows, e.g. posts. Shown for every row when omitted. */
  show?: (page: Page) => boolean;
}

/** What a site template is shown for. Archives carry what is being listed. */
export type RwpArchive =
  | { kind: 'category'; slug: string }
  | { kind: 'author'; id: string }
  | { kind: 'date'; year: number; month?: number }
  | { kind: 'search'; term: string };

export interface RwpTemplateRenderProps {
  /** e.g. 'header', 'single_post', 'archive_category'. */
  type: string;
  /** The post or page being viewed, for single post and page templates. */
  post?: Page | null;
  archive?: RwpArchive;
  /** The content width of the screen around a header or footer ('boxed', 'wide', 'full'). */
  layoutWidth?: string;
}

/**
 * Replaces parts of the public site (header, footer, 404, single post, archives…) with designed
 * templates. has() must answer synchronously once preload() has resolved, so the public site
 * never flashes the default screen before the template.
 */
export interface RwpTemplateProvider {
  id: string;
  preload: () => Promise<void>;
  has: (type: string) => boolean;
  component: ComponentType<RwpTemplateRenderProps>;
}

export interface RwpPluginContext {
  actions: {
    /** `priority` works like WordPress's: lower runs first, 10 is the default. */
    add: (name: RwpActionName, callback: (...args: unknown[]) => void, priority?: number) => () => void;
    do: (name: RwpActionName, ...args: unknown[]) => void;
  };
  filters: {
    add: <T>(name: RwpFilterName, callback: (value: T, ...args: unknown[]) => T, priority?: number) => () => void;
    apply: <T>(name: RwpFilterName, value: T, ...args: unknown[]) => T;
  };
  admin: {
    registerPage: (page: RwpAdminPage) => () => void;
    registerDashboardWidget: (widget: RwpDashboardWidget) => () => void;
    /** Adds items to the setup checklist on Dashboard → Overview. */
    registerSetupCheck: (check: RwpSetupCheck) => () => void;
  };
  shortcodes: {
    register: (shortcode: RwpShortcode) => () => void;
  };
  routes: {
    register: (route: RwpRoute) => () => void;
  };
  header: {
    /** Renders next to the login links in the public site header (e.g. a cart link). */
    register: (item: RwpHeaderItem) => () => void;
  };
  content: {
    /** Takes over rendering of matching pages. The first registered match wins. */
    registerRenderer: (renderer: RwpContentRenderer) => () => void;
    /** Adds a link to each row in Pages & Posts and to the content editor. */
    registerAction: (action: RwpContentAction) => () => void;
    /** Provides site templates (see RwpTemplateProvider). The last registered provider wins. */
    registerTemplateProvider: (provider: RwpTemplateProvider) => () => void;
  };
}

/** Matches a pathname against a route pattern and returns its params, or null. */
export const matchRoutePath = (pattern: string, pathname: string): Record<string, string> | null => {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const part = patternParts[index];
    if (part === '*') {
      params['*'] = pathParts.slice(index).join('/');
      return params;
    }
    const value = pathParts[index];
    if (value === undefined) return null;
    if (part.startsWith(':')) params[part.slice(1)] = value;
    else if (part !== value) return null;
  }
  return pathParts.length === patternParts.length ? params : null;
};

export interface RwpPlugin {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  register?: (context: RwpPluginContext) => void | (() => void);
}

export interface RwpPluginManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  entry?: string;
}

export interface RwpInstalledPlugin extends RwpPlugin {
  active: boolean;
}

const adminPages = new Map<string, RwpAdminPage>();
const dashboardWidgets = new Map<string, RwpDashboardWidget>();
const setupChecks = new Map<string, RwpSetupCheck>();
const shortcodes = new Map<string, RwpShortcode>();
const routes = new Map<string, RwpRoute>();
const headerItems = new Map<string, RwpHeaderItem>();
const contentRenderers = new Map<string, RwpContentRenderer>();
const contentActions = new Map<string, RwpContentAction>();
const templateProviders = new Map<string, RwpTemplateProvider>();
interface PluginRecord {
  plugin: RwpPlugin;
  cleanup?: () => void;
  active: boolean;
}

const plugins = new Map<string, PluginRecord>();
const subscribers = new Set<() => void>();

const notifySubscribers = () => subscribers.forEach((subscriber) => subscriber());

export const rwp: RwpPluginContext & {
  registerPlugin: (plugin: RwpPlugin) => () => void;
  activatePlugin: (id: string) => boolean;
  deactivatePlugin: (id: string) => boolean;
  subscribe: (listener: () => void) => () => void;
  getAdminPages: () => RwpAdminPage[];
  getDashboardWidgets: () => RwpDashboardWidget[];
  getSetupChecks: () => RwpSetupCheck[];
  getShortcodes: () => RwpShortcode[];
  getRoutes: () => RwpRoute[];
  matchRoute: (pathname: string) => { route: RwpRoute; params: Record<string, string> } | null;
  getHeaderItems: () => RwpHeaderItem[];
  getContentRenderer: (page: Page) => RwpContentRenderer | null;
  getContentActions: (page: Page) => RwpContentAction[];
  getTemplateProvider: () => RwpTemplateProvider | null;
  getPlugins: () => RwpInstalledPlugin[];
} = {
  // Thin wrappers over the one registry in src/core/hooks.ts. A plugin written against either
  // API therefore sees the same callbacks; two registries would silently split them.
  actions: {
    add: (name, callback, priority = DEFAULT_PRIORITY) => addAction(name, callback, priority),
    do: (name, ...args) => doAction(name, ...args),
  },
  filters: {
    add: <T,>(name: RwpFilterName, callback: (value: T, ...args: unknown[]) => T, priority = DEFAULT_PRIORITY) =>
      addFilter<T>(name, callback, priority),
    apply: <T,>(name: RwpFilterName, value: T, ...args: unknown[]) => applyFilters<T>(name, value, ...args),
  },
  admin: {
    registerPage: (page) => {
      adminPages.set(page.id, page);
      notifySubscribers();
      return () => {
        adminPages.delete(page.id);
        notifySubscribers();
      };
    },
    registerDashboardWidget: (widget) => {
      dashboardWidgets.set(widget.id, widget);
      notifySubscribers();
      return () => {
        dashboardWidgets.delete(widget.id);
        notifySubscribers();
      };
    },
    registerSetupCheck: (check) => {
      setupChecks.set(check.id, check);
      notifySubscribers();
      return () => {
        setupChecks.delete(check.id);
        notifySubscribers();
      };
    },
  },
  shortcodes: {
    register: (shortcode) => {
      shortcodes.set(shortcode.name, shortcode);
      notifySubscribers();
      return () => {
        shortcodes.delete(shortcode.name);
        notifySubscribers();
      };
    },
  },
  routes: {
    register: (route) => {
      routes.set(route.path, route);
      notifySubscribers();
      return () => {
        routes.delete(route.path);
        notifySubscribers();
      };
    },
  },
  header: {
    register: (item) => {
      headerItems.set(item.id, item);
      notifySubscribers();
      return () => {
        headerItems.delete(item.id);
        notifySubscribers();
      };
    },
  },
  content: {
    registerRenderer: (renderer) => {
      contentRenderers.set(renderer.id, renderer);
      notifySubscribers();
      return () => {
        contentRenderers.delete(renderer.id);
        notifySubscribers();
      };
    },
    registerAction: (action) => {
      contentActions.set(action.id, action);
      notifySubscribers();
      return () => {
        contentActions.delete(action.id);
        notifySubscribers();
      };
    },
    registerTemplateProvider: (provider) => {
      templateProviders.set(provider.id, provider);
      notifySubscribers();
      return () => {
        templateProviders.delete(provider.id);
        notifySubscribers();
      };
    },
  },
  registerPlugin: (plugin) => {
    if (plugins.has(plugin.id)) throw new Error(`RWP plugin "${plugin.id}" is already registered.`);
    const record: PluginRecord = { plugin, active: false };
    plugins.set(plugin.id, record);
    return () => {
      rwp.deactivatePlugin(plugin.id);
      plugins.delete(plugin.id);
    };
  },
  activatePlugin: (id) => {
    const record = plugins.get(id);
    if (!record || record.active) return Boolean(record);
    const cleanup = record.plugin.register?.(rwp);
    record.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    record.active = true;
    rwp.actions.do('rwp_plugin_activated', record.plugin);
    notifySubscribers();
    return true;
  },
  deactivatePlugin: (id) => {
    const record = plugins.get(id);
    if (!record || !record.active) return Boolean(record);
    record.cleanup?.();
    record.cleanup = undefined;
    record.active = false;
    rwp.actions.do('rwp_plugin_deactivated', record.plugin);
    notifySubscribers();
    return true;
  },
  getAdminPages: () => [...adminPages.values()],
  getDashboardWidgets: () => [...dashboardWidgets.values()],
  getSetupChecks: () => [...setupChecks.values()],
  getShortcodes: () => [...shortcodes.values()],
  getRoutes: () => [...routes.values()],
  matchRoute: (pathname) => {
    // Literal segments beat parameters, so "/shop/cart" wins over "/shop/:slug".
    const score = (path: string) => path.split('/').filter(Boolean)
      .reduce((total, part) => total + (part === '*' ? 0 : part.startsWith(':') ? 1 : 2), 0);
    const candidates = [...routes.values()].sort((a, b) => score(b.path) - score(a.path));
    for (const route of candidates) {
      const params = matchRoutePath(route.path, pathname);
      if (params) return { route, params };
    }
    return null;
  },
  getHeaderItems: () => [...headerItems.values()],
  getContentRenderer: (page) => [...contentRenderers.values()].find((renderer) => renderer.match(page)) || null,
  getContentActions: (page) => [...contentActions.values()].filter((action) => !action.show || action.show(page)),
  getTemplateProvider: () => [...templateProviders.values()].pop() || null,
  getPlugins: () => [...plugins.values()].map(({ plugin, active }) => ({ ...plugin, active })),
  subscribe: (listener) => {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  },
};

