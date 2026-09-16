import { useEffect, useState, type ReactNode } from 'react';
import { rwp, type RwpArchive } from '../lib/rwp';
import type { Page } from '../lib/types';

/** Whether a plugin has a live template for this part of the site (e.g. the Page Builder's header). */
export const hasSiteTemplate = (type: string) => Boolean(rwp.getTemplateProvider()?.has(type));

/**
 * Loads the live templates before the public site first renders. Failures are ignored: the site
 * then shows its default header, footer and screens.
 */
export const preloadSiteTemplates = async () => {
  await rwp.getTemplateProvider()?.preload().catch(() => undefined);
};

/** Re-renders when plugins are activated or deactivated, so a provider that appears later is used. */
function useRegistryVersion() {
  const [, setVersion] = useState(0);
  useEffect(() => rwp.subscribe(() => setVersion((value) => value + 1)), []);
}

/** The first live template among types (most specific first), or the fallback. */
export default function SiteTemplate({ types, fallback, post, archive, layoutWidth }: {
  types: string[];
  fallback: ReactNode;
  post?: Page | null;
  archive?: RwpArchive;
  layoutWidth?: string;
}) {
  useRegistryVersion();
  const provider = rwp.getTemplateProvider();
  const type = provider ? types.find((candidate) => provider.has(candidate)) : undefined;
  if (!provider || !type) return <>{fallback}</>;
  const Template = provider.component;
  return <Template type={type} post={post} archive={archive} layoutWidth={layoutWidth} />;
}
