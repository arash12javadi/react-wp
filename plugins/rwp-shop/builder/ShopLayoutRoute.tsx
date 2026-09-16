/**
 * Shop routes that show a Page Builder template (Page Builder → Templates → Shop) when one is
 * published for their screen, and the built-in screen otherwise. Widgets read the product or
 * category being viewed from ShopRouteContext instead of ?product= / ?product_category=.
 */
import { createContext, useContext, useEffect, useState, type ComponentType } from 'react';
import type { RwpRouteProps } from '../../../src/lib/plugin-api';
import type { Page } from '../../../src/lib/types';
import { BuilderPageContent } from '../../rwp-page-builder/render/BuilderRenderer';
import { liveTemplate, preloadLiveTemplates } from '../../rwp-page-builder/lib/siteTemplates';
import { PageShell } from '../public/components';

export type ShopTemplateType = 'shop' | 'product' | 'product_category' | 'cart' | 'checkout' | 'my_account';

export interface ShopRoute {
  type: ShopTemplateType;
  params: Record<string, string>;
  productSlug: string;
  categorySlug: string;
  tagSlug: string;
}

const ShopRouteContext = createContext<ShopRoute | null>(null);

/** The shop route a builder template is being shown on, or null on an ordinary page and in the editor. */
export const useShopRoute = () => useContext(ShopRouteContext);

export function withShopLayout(type: ShopTemplateType, Fallback: ComponentType<RwpRouteProps>): ComponentType<RwpRouteProps> {
  return function ShopLayoutRoute(props: RwpRouteProps) {
    // The public site preloads templates before its first render; this covers any route reached without it.
    const [ready, setReady] = useState(() => liveTemplate(type) !== null);
    useEffect(() => {
      if (ready) return undefined;
      let active = true;
      void preloadLiveTemplates().then(() => { if (active) setReady(true); });
      return () => { active = false; };
    }, [ready]);

    const template = liveTemplate(type);
    if (!ready && !template) return null;
    if (!template) return <Fallback {...props} />;

    const path = typeof window === 'undefined' ? '' : window.location.pathname;
    const slug = props.params.slug || '';
    const route: ShopRoute = {
      type,
      params: props.params,
      productSlug: type === 'product' ? slug : '',
      categorySlug: path.startsWith('/product-category/') ? slug : '',
      tagSlug: path.startsWith('/product-tag/') ? slug : '',
    };
    const content = <BuilderPageContent page={template as unknown as Page} comments={null} />;
    return (
      <ShopRouteContext.Provider value={route}>
        {template.layout === 'boxed' ? <PageShell>{content}</PageShell> : <main>{content}</main>}
      </ShopRouteContext.Provider>
    );
  };
}
