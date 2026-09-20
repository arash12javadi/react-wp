import { useEffect, type ReactNode } from 'react';
import { doAction } from '../core/hooks';
import { useHooks } from '../core/HookSlot';
import I18nProvider, { useTranslation } from './I18nContext';
import type { I18nSurface } from '../lib/i18n';

/**
 * One wrapper for the app-wide providers.
 *
 * There is no HookProvider: the hook registry (src/core/hooks.ts) is a module singleton on
 * purpose, because plugins register into it from `register()` callbacks and from plain modules
 * that never sit inside a React tree. Putting it behind a context would mean those registrations
 * silently did nothing. `useHooks()` reads the same registry and re-renders on changes, so
 * components get the ergonomics without the split.
 */
export function AppProvider({ children, surface = 'public' }: { children: ReactNode; surface?: I18nSurface }) {
  useEffect(() => {
    doAction('app_providers_ready', surface);
  }, [surface]);
  return <I18nProvider surface={surface}>{children}</I18nProvider>;
}

export { useHooks, useTranslation };
export default AppProvider;
