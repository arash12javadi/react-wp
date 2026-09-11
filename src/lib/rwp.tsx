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
  | 'rwp_settings_saved'
  | 'rwp_menu_saved';

export type RwpFilterName =
  | 'rwp_site_title'
  | 'rwp_site_description'
  | 'rwp_public_menu'
  | 'rwp_posts'
  | 'rwp_post_title'
  | 'rwp_post_excerpt'
  | 'rwp_post_content'
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
}

export interface RwpPlugin {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  register?: (context: RwpPluginContext) => void | (() => void);
}

type ActionCallback = (...args: unknown[]) => void;
type FilterCallback = (value: unknown, ...args: unknown[]) => unknown;

const actions = new Map<RwpActionName, Set<ActionCallback>>();
const filters = new Map<RwpFilterName, Set<FilterCallback>>();
const adminPages = new Map<string, RwpAdminPage>();
const dashboardWidgets = new Map<string, RwpDashboardWidget>();
const shortcodes = new Map<string, RwpShortcode>();
const plugins = new Map<string, RwpPlugin>();

function addTo<T>(map: Map<string, Set<T>>, name: string, callback: T) {
  const callbacks = map.get(name) || new Set<T>();
  callbacks.add(callback);
  map.set(name, callbacks);
  return () => callbacks.delete(callback);
}

export const rwp: RwpPluginContext & {
  registerPlugin: (plugin: RwpPlugin) => () => void;
  getAdminPages: () => RwpAdminPage[];
  getDashboardWidgets: () => RwpDashboardWidget[];
  getPlugins: () => RwpPlugin[];
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
      return () => adminPages.delete(page.id);
    },
    registerDashboardWidget: (widget) => {
      dashboardWidgets.set(widget.id, widget);
      return () => dashboardWidgets.delete(widget.id);
    },
  },
  shortcodes: {
    register: (shortcode) => {
      shortcodes.set(shortcode.name, shortcode);
      return () => shortcodes.delete(shortcode.name);
    },
  },
  registerPlugin: (plugin) => {
    if (plugins.has(plugin.id)) throw new Error(`RWP plugin "${plugin.id}" is already registered.`);
    plugins.set(plugin.id, plugin);
    const cleanup = plugin.register?.(rwp);
    return () => {
      if (typeof cleanup === 'function') cleanup();
      plugins.delete(plugin.id);
    };
  },
  getAdminPages: () => [...adminPages.values()],
  getDashboardWidgets: () => [...dashboardWidgets.values()],
  getPlugins: () => [...plugins.values()],
};

export function parseShortcodes(content: string): ReactNode[] {
  const output: ReactNode[] = [];
  const shortcodePattern = /\[([a-zA-Z0-9_-]+)([^\]]*)\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = shortcodePattern.exec(content))) {
    if (match.index > cursor) output.push(content.slice(cursor, match.index));
    const shortcode = shortcodes.get(match[1]);
    if (!shortcode) output.push(match[0]);
    else {
      const attributes: Record<string, string> = {};
      const attributePattern = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
      let attribute: RegExpExecArray | null;
      while ((attribute = attributePattern.exec(match[2]))) attributes[attribute[1]] = attribute[2];
      output.push(shortcode.render(attributes));
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) output.push(content.slice(cursor));
  return output;
}
