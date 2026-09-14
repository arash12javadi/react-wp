import type { ComponentType } from 'react';
import type { CssRules } from './style';
import type { Device, StyleBag, WidgetNode } from './types';

export type ControlType =
  | 'text' | 'textarea' | 'number' | 'toggle' | 'select' | 'color' | 'slider' | 'size'
  | 'dimensions' | 'image' | 'link' | 'richtext' | 'icon' | 'code' | 'align'
  | 'typography' | 'background' | 'border' | 'shadow' | 'textShadow'
  | 'repeater' | 'formFields' | 'menu' | 'category' | 'heading' | 'formEmail';

export type ControlTab = 'content' | 'style' | 'advanced';

export interface ControlOption { value: string; label: string }

export interface Control {
  key: string;
  label: string;
  type: ControlType;
  /** Defaults to content. */
  tab?: ControlTab;
  /** Where the value is stored. Defaults to settings for content, style for style, advanced for advanced. */
  store?: 'settings' | 'style' | 'advanced';
  /** Stored per device in the style bag. */
  responsive?: boolean;
  options?: ControlOption[];
  min?: number;
  max?: number;
  step?: number;
  units?: string[];
  placeholder?: string;
  help?: string;
  /** Offer the dynamic tag picker. */
  dynamic?: boolean;
  /** Repeater item controls (always stored on the item). */
  fields?: Control[];
  itemLabel?: string;
  newItem?: () => Record<string, unknown>;
  language?: 'html' | 'css' | 'js';
  condition?: (settings: Record<string, unknown>, style: StyleBag) => boolean;
}

export interface WidgetViewProps {
  node: WidgetNode;
}

export type WidgetCategory = 'layout' | 'basic' | 'pro' | 'dynamic';

export interface WidgetDefinition {
  type: string;
  label: string;
  /** A key of the curated icon map in lib/icons.tsx. */
  icon: string;
  category: WidgetCategory;
  keywords?: string[];
  defaults: () => { settings: Record<string, unknown>; style?: StyleBag };
  controls: Control[];
  View: ComponentType<WidgetViewProps>;
  css?: (bag: StyleBag, node: WidgetNode, device: Device) => CssRules;
  /** Only administrators can save it (enforced by the builder_guard_html trigger). */
  adminOnly?: boolean;
}

export const categoryLabels: Record<WidgetCategory, string> = {
  layout: 'Layout',
  basic: 'Basic',
  pro: 'Pro',
  dynamic: 'Dynamic content',
};

const widgets = new Map<string, WidgetDefinition>();

/** Other plugins can add widgets too; register before the builder renders. */
export function registerWidget(definition: WidgetDefinition): () => void {
  widgets.set(definition.type, definition);
  return () => { widgets.delete(definition.type); };
}

export const getWidget = (type: string) => widgets.get(type);
export const getWidgets = () => [...widgets.values()];
