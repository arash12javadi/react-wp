import { getOption, updateOption } from './db';

export type WidgetType = 'search' | 'recent-posts' | 'categories' | 'text' | 'menu' | 'login';

export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  settings: Record<string, string | number | boolean>;
}

export type WidgetAreaId = 'sidebar' | 'footer';

export type WidgetAreas = Record<WidgetAreaId, Widget[]>;

export const widgetAreasOption = 'rwp_widget_areas';

export const areaLabels: Record<WidgetAreaId, string> = {
  sidebar: 'Sidebar',
  footer: 'Footer',
};

export const widgetTypes: Array<{ type: WidgetType; label: string; description: string; defaults: Widget['settings'] }> = [
  { type: 'search', label: 'Search', description: 'A search box for posts.', defaults: { placeholder: 'Search posts…' } },
  { type: 'recent-posts', label: 'Recent Posts', description: 'Links to your latest posts.', defaults: { count: 5 } },
  { type: 'categories', label: 'Categories', description: 'A list of categories.', defaults: { showCounts: true } },
  { type: 'text', label: 'Text / HTML', description: 'Free-form rich content.', defaults: { content: '' } },
  { type: 'menu', label: 'Navigation Menu', description: 'One of the menus from the Menus tab.', defaults: { menuId: '' } },
  { type: 'login', label: 'Login / account', description: 'Sign in button, or account details when signed in.', defaults: { label: '', style: 'button' } },
];

export const emptyAreas: WidgetAreas = { sidebar: [], footer: [] };

const isWidget = (value: unknown): value is Widget => {
  if (!value || typeof value !== 'object') return false;
  const widget = value as Widget;
  return typeof widget.id === 'string'
    && typeof widget.type === 'string'
    && widgetTypes.some((item) => item.type === widget.type);
};

const readArea = (value: unknown): Widget[] =>
  Array.isArray(value)
    ? value.filter(isWidget).map((widget) => ({ ...widget, title: widget.title || '', settings: widget.settings || {} }))
    : [];

export const loadWidgetAreas = async (): Promise<WidgetAreas> => {
  const stored = await getOption<unknown>(widgetAreasOption, null);
  if (!stored || typeof stored !== 'object') return emptyAreas;
  const value = stored as Record<string, unknown>;
  return { sidebar: readArea(value.sidebar), footer: readArea(value.footer) };
};

export const saveWidgetAreas = async (areas: WidgetAreas): Promise<void> => {
  const saved = await updateOption(widgetAreasOption, areas);
  if (!saved) throw new Error('Widgets could not be saved. Check that your role can manage settings.');
};

export const createWidget = (type: WidgetType): Widget => {
  const definition = widgetTypes.find((item) => item.type === type);
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    title: definition?.label || type,
    settings: { ...(definition?.defaults || {}) },
  };
};
