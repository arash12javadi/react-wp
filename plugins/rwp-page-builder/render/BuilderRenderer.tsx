import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';
import { loadSettings } from '../../../src/lib/settings';
import type { Page } from '../../../src/lib/types';
import type { RwpContentRendererProps } from '../../../src/lib/plugin-api';
import { globalCss, googleFontFamilies, useGlobalStyles, useGoogleFonts } from '../lib/globals';
import type { DynamicContext } from '../lib/dynamic';
import type { BuilderDocument, BuilderPage } from '../lib/types';
import { RenderProvider, type RenderContextValue } from './context';
import { fetchDynamicPage, toDynamicPost } from './data';
import { generateCss } from './generateCss';
import { NodeView } from './NodeView';
import './widgets';
import './builder.css';

/** Accepts whatever is in the column: an object, a JSON string, or nothing. */
export function parseDocument(value: unknown): BuilderDocument | null {
  let data = value;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object' || !Array.isArray((data as BuilderDocument).content)) return null;
  const doc = data as BuilderDocument;
  return { version: 1, settings: doc.settings || {}, content: doc.content };
}

/**
 * Site, page and signed-in user data for dynamic tags. The page starts from the row already
 * loaded and is refined once author and category names arrive.
 */
export function useDynamicContext(page: Pick<BuilderPage, 'id'> & Partial<BuilderPage> | null): DynamicContext {
  const [site, setSite] = useState<DynamicContext['site']>({ title: '', tagline: '', url: typeof window === 'undefined' ? '' : window.location.origin });
  const [user, setUser] = useState<DynamicContext['user']>(null);
  const [resolvedPage, setResolvedPage] = useState<DynamicContext['page']>(null);
  const pageId = page?.id;

  useEffect(() => {
    let active = true;
    loadSettings().then((settings) => active && setSite((current) => ({ ...current, title: settings.site_title, tagline: settings.site_tagline }))).catch(() => {});
    const supabase = getSupabaseClient();
    void supabase.auth.getSession().then(async ({ data }) => {
      const sessionUser = data.session?.user;
      if (!sessionUser || !active) return;
      const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', sessionUser.id).maybeSingle();
      if (active) setUser({ id: sessionUser.id, email: sessionUser.email || '', name: profile?.display_name || sessionUser.email?.split('@')[0] || '' });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!pageId) return undefined;
    let active = true;
    void fetchDynamicPage(pageId).then((result) => active && result && setResolvedPage(result));
    return () => { active = false; };
  }, [pageId]);

  const fallbackPage = useMemo(() => (page && page.title !== undefined ? toDynamicPost({
    id: page.id, title: page.title || '', slug: page.slug || '', excerpt: page.excerpt || '', content: page.content || '',
    created_at: page.created_at || '', updated_at: page.updated_at || '', og_image: page.og_image || null,
    author_id: null, categories: null,
  }, 55) : null), [page]);

  const title = page?.title;
  // A title edited in the builder shows immediately, before it is saved and refetched.
  const current = useMemo(
    () => (resolvedPage && title ? { ...resolvedPage, title } : resolvedPage || fallbackPage),
    [resolvedPage, fallbackPage, title],
  );
  return useMemo(() => ({ page: current, user, site }), [current, user, site]);
}

function useEntranceAnimations(rootRef: RefObject<HTMLDivElement | null>, key: unknown) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const elements = root.querySelectorAll<HTMLElement>('.rwpb-anim:not(.rwpb-visible)');
    if (!elements.length) return undefined;
    if (!('IntersectionObserver' in window)) {
      elements.forEach((element) => element.classList.add('rwpb-visible'));
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('rwpb-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [rootRef, key]);
}

export interface BuilderRendererProps {
  doc: BuilderDocument;
  page: BuilderPage | null;
  children?: ReactNode;
}

/** Renders a saved layout for visitors. */
export default function BuilderRenderer({ doc, page, children }: BuilderRendererProps) {
  const globals = useGlobalStyles();
  useGoogleFonts(googleFontFamilies(globals, doc));
  const dynamic = useDynamicContext(page);
  const css = useMemo(() => `${globalCss(globals)}\n${generateCss(doc)}`, [doc, globals]);
  const rootRef = useRef<HTMLDivElement>(null);
  useEntranceAnimations(rootRef, doc);

  const context = useMemo<RenderContextValue>(() => ({
    mode: 'view', device: 'desktop', dynamic, pageId: page?.id ?? null, editor: null,
  }), [dynamic, page?.id]);

  return (
    <RenderProvider value={context}>
      <style>{css}</style>
      <div ref={rootRef} className="rwpb-root">
        {doc.settings.showTitle && page && <h1 className="rwpb-page-title">{page.title}</h1>}
        {doc.content.map((node) => <NodeView key={node.id} node={node} />)}
        {children}
      </div>
    </RenderProvider>
  );
}

/** Registered with rwp content.registerRenderer: replaces the body of builder-enabled pages. */
export function BuilderPageContent({ page, comments }: RwpContentRendererProps) {
  const builderPage = page as Page & BuilderPage;
  const doc = useMemo(() => parseDocument(builderPage.builder_data), [builderPage.builder_data]);
  if (!doc) return null;
  return (
    <BuilderRenderer doc={doc} page={builderPage}>
      {doc.settings.showComments && comments}
    </BuilderRenderer>
  );
}
