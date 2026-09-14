import { cssUrl, cssValue } from './sanitize';
import type { Device, ResponsiveStyle, StyleBag } from './types';

/** selector suffix ('' = the element itself) → declarations */
export type CssRules = Record<string, Record<string, string | number | undefined | null>>;

export interface Box { top?: string | number; right?: string | number; bottom?: string | number; left?: string | number; unit?: string }
export interface SizeValue { size?: number | string; unit?: string }
export interface Typography {
  family?: string;
  size?: number | string;
  sizeUnit?: string;
  weight?: string;
  lineHeight?: number | string;
  letterSpacing?: number | string;
  transform?: string;
  style?: string;
  decoration?: string;
}
export interface Background {
  type?: 'classic' | 'gradient';
  color?: string;
  image?: string;
  position?: string;
  size?: string;
  repeat?: string;
  attachment?: string;
  gradientFrom?: string;
  gradientTo?: string;
  gradientAngle?: number;
  overlayColor?: string;
  overlayOpacity?: number;
}
export interface Border { style?: string; width?: Box; color?: string; radius?: Box }
export interface Shadow { x?: number; y?: number; blur?: number; spread?: number; color?: string }

/** Desktop is the base; each smaller device inherits whatever it does not override. */
export function effectiveBag(style: ResponsiveStyle | undefined, device: Device): StyleBag {
  const desktop = style?.desktop || {};
  if (device === 'desktop') return desktop;
  const tablet = { ...desktop, ...(style?.tablet || {}) };
  return device === 'tablet' ? tablet : { ...tablet, ...(style?.mobile || {}) };
}

export function effectiveValue<T = unknown>(style: ResponsiveStyle | undefined, device: Device, key: string): T | undefined {
  return effectiveBag(style, device)[key] as T | undefined;
}

export const isSet = (value: unknown) => value !== undefined && value !== null && value !== '';

/** Colours may reference a global: "global:primary" → var(--rwpb-primary). */
export function color(value: unknown): string | undefined {
  if (!isSet(value)) return undefined;
  const text = String(value);
  if (text.startsWith('global:')) return `var(--rwpb-${text.slice(7).replace(/[^\w-]/g, '')})`;
  return cssValue(text) || undefined;
}

export function fontFamily(value: unknown): string | undefined {
  if (!isSet(value)) return undefined;
  const text = String(value);
  if (text.startsWith('global:')) return `var(--rwpb-font-${text.slice(7).replace(/[^\w-]/g, '')})`;
  const clean = cssValue(text).replace(/["']/g, '');
  return clean ? `"${clean}", system-ui, sans-serif` : undefined;
}

export const length = (value: unknown, unit = 'px'): string | undefined => {
  if (!isSet(value)) return undefined;
  const number = Number(value);
  if (Number.isFinite(number)) return number === 0 ? '0' : `${number}${cssValue(unit) || 'px'}`;
  return cssValue(value) || undefined;
};

export const size = (value: SizeValue | undefined, fallbackUnit = 'px') =>
  value ? length(value.size, value.unit || fallbackUnit) : undefined;

export function boxSides(prefix: 'margin' | 'padding' | 'border-width', value: Box | undefined): Record<string, string | undefined> {
  if (!value) return {};
  const unit = value.unit || 'px';
  const side = (name: string) => (prefix === 'border-width' ? `border-${name}-width` : `${prefix}-${name}`);
  return {
    [side('top')]: length(value.top, unit),
    [side('right')]: length(value.right, unit),
    [side('bottom')]: length(value.bottom, unit),
    [side('left')]: length(value.left, unit),
  };
}

export function radius(value: Box | undefined): Record<string, string | undefined> {
  if (!value) return {};
  const unit = value.unit || 'px';
  return {
    'border-top-left-radius': length(value.top, unit),
    'border-top-right-radius': length(value.right, unit),
    'border-bottom-right-radius': length(value.bottom, unit),
    'border-bottom-left-radius': length(value.left, unit),
  };
}

export function typography(value: Typography | undefined): Record<string, string | undefined> {
  if (!value) return {};
  return {
    'font-family': fontFamily(value.family),
    'font-size': length(value.size, value.sizeUnit || 'px'),
    'font-weight': isSet(value.weight) ? cssValue(value.weight) : undefined,
    'line-height': isSet(value.lineHeight) ? cssValue(value.lineHeight) : undefined,
    'letter-spacing': length(value.letterSpacing, 'px'),
    'text-transform': isSet(value.transform) ? cssValue(value.transform) : undefined,
    'font-style': isSet(value.style) ? cssValue(value.style) : undefined,
    'text-decoration': isSet(value.decoration) ? cssValue(value.decoration) : undefined,
  };
}

export function background(value: Background | undefined): Record<string, string | undefined> {
  if (!value) return {};
  if (value.type === 'gradient' && (value.gradientFrom || value.gradientTo)) {
    return {
      'background-image': `linear-gradient(${Number(value.gradientAngle ?? 180)}deg, ${color(value.gradientFrom) || 'transparent'}, ${color(value.gradientTo) || 'transparent'})`,
    };
  }
  const image = cssUrl(value.image);
  return {
    'background-color': color(value.color),
    'background-image': image || undefined,
    'background-position': image ? cssValue(value.position || 'center center') : undefined,
    'background-size': image ? cssValue(value.size || 'cover') : undefined,
    'background-repeat': image ? cssValue(value.repeat || 'no-repeat') : undefined,
    'background-attachment': image && value.attachment === 'fixed' ? 'fixed' : undefined,
  };
}

export function border(value: Border | undefined): Record<string, string | undefined> {
  if (!value) return {};
  const hasStyle = isSet(value.style) && value.style !== 'none';
  return {
    ...(hasStyle ? { 'border-style': cssValue(value.style), 'border-color': color(value.color), ...boxSides('border-width', value.width) } : {}),
    ...radius(value.radius),
  };
}

export function shadow(value: Shadow | undefined): string | undefined {
  if (!value || !isSet(value.color)) return undefined;
  return `${Number(value.x || 0)}px ${Number(value.y || 0)}px ${Number(value.blur || 0)}px ${Number(value.spread || 0)}px ${color(value.color)}`;
}

export function textShadow(value: Shadow | undefined): string | undefined {
  if (!value || !isSet(value.color)) return undefined;
  return `${Number(value.x || 0)}px ${Number(value.y || 0)}px ${Number(value.blur || 0)}px ${color(value.color)}`;
}

export const alignToFlex = (align: unknown): string | undefined =>
  align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : align === 'center' ? 'center' : align === 'justify' ? 'stretch' : undefined;

export function serializeRules(scope: string, rules: CssRules): string {
  return Object.entries(rules).map(([suffix, declarations]) => {
    const body = Object.entries(declarations)
      .filter(([, value]) => isSet(value))
      .map(([property, value]) => `${property}:${value}`)
      .join(';');
    if (!body) return '';
    // A suffix may list several selectors: ", .x" must be scoped on each part.
    const selector = suffix.split('|').map((part) => `${scope}${part}`).join(',');
    return `${selector}{${body}}`;
  }).join('');
}
