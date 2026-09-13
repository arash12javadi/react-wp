import type { ComponentType, ReactNode } from 'react';

export type RwpActionName =
  | 'rwp_init'
  | 'rwp_admin_loaded'
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
  | 'rwp_admin_navigation';

export interface RwpAdminPage {
  id: string;
  label: string;
  icon?: string;
  capability?: string;
  component: ComponentType;
}

export interface RwpDashboardWidget {
  id: string;
  title: string;
  component: ComponentType;
}

export interface RwpShortcode {
  name: string;
  render: (attributes: Record<string, string>) => ReactNode;
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

export interface RwpPluginContext {
  actions: {
    add: (name: RwpActionName, callback: (...args: unknown[]) => void) => () => void;
    do: (name: RwpActionName, ...args: unknown[]) => void;
  };
  filters: {
    add: <T>(name: RwpFilterName, callback: (value: T, ...args: unknown[]) => T) => () => void;
    apply: <T>(name: RwpFilterName, value: T, ...args: unknown[]) => T;
  };
  admin: {
    registerPage: (page: RwpAdminPage) => () => void;
    registerDashboardWidget: (widget: RwpDashboardWidget) => () => void;
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

type ActionCallback = (...args: unknown[]) => void;
type FilterCallback = (value: unknown, ...args: unknown[]) => unknown;

const actions = new Map<RwpActionName, Set<ActionCallback>>();
const filters = new Map<RwpFilterName, Set<FilterCallback>>();
const adminPages = new Map<string, RwpAdminPage>();
const dashboardWidgets = new Map<string, RwpDashboardWidget>();
const shortcodes = new Map<string, RwpShortcode>();
const routes = new Map<string, RwpRoute>();
const headerItems = new Map<string, RwpHeaderItem>();
interface PluginRecord {
  plugin: RwpPlugin;
  cleanup?: () => void;
  active: boolean;
}

const plugins = new Map<string, PluginRecord>();
const subscribers = new Set<() => void>();

const notifySubscribers = () => subscribers.forEach((subscriber) => subscriber());

function addTo<T>(map: Map<string, Set<T>>, name: string, callback: T) {
  const callbacks = map.get(name) || new Set<T>();
  callbacks.add(callback);
  map.set(name, callbacks);
  return () => callbacks.delete(callback);
}

export const rwp: RwpPluginContext & {
  registerPlugin: (plugin: RwpPlugin) => () => void;
  activatePlugin: (id: string) => boolean;
  deactivatePlugin: (id: string) => boolean;
  subscribe: (listener: () => void) => () => void;
  getAdminPages: () => RwpAdminPage[];
  getDashboardWidgets: () => RwpDashboardWidget[];
  getShortcodes: () => RwpShortcode[];
  getRoutes: () => RwpRoute[];
  matchRoute: (pathname: string) => { route: RwpRoute; params: Record<string, string> } | null;
  getHeaderItems: () => RwpHeaderItem[];
  getPlugins: () => RwpInstalledPlugin[];
} = {
  actions: {
    add: (name, callback) => addTo(actions, name, callback),
    do: (name, ...args) => actions.get(name)?.forEach((callback) => callback(...args)),
  },
  filters: {
    add: <T,>(name: RwpFilterName, callback: (value: T, ...args: unknown[]) => T) =>
      addTo(filters, name, callback as FilterCallback),
    apply: <T,>(name: RwpFilterName, value: T, ...args: unknown[]) => {
      let filtered = value;
      filters.get(name)?.forEach((callback) => {
        filtered = callback(filtered, ...args) as T;
      });
      return filtered;
    },
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
  getPlugins: () => [...plugins.values()].map(({ plugin, active }) => ({ ...plugin, active })),
  subscribe: (listener) => {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  },
};

