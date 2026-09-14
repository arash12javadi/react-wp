import { lazy, Suspense } from 'react';
import { defineRwpPlugin, type RwpRouteProps } from '../../src/lib/plugin-api';
import manifest from './manifest.json';
import { BuilderPageContent } from './render/BuilderRenderer';

/**
 * The editor (dnd-kit, the inspector, every control) is a separate chunk, loaded only on
 * /builder/:id. Public pages load the renderer and widget views alone.
 */
const PageBuilderApp = lazy(() => import('./editor/PageBuilderApp'));
const PreviewPage = lazy(() => import('./editor/PreviewPage'));
const BuilderAdmin = lazy(() => import('./admin/BuilderAdmin'));

const loading = <div style={{ padding: 40, font: '500 15px system-ui', color: '#475569' }} role="status">Loading…</div>;

function EditorRoute(props: RwpRouteProps) {
  return <Suspense fallback={loading}><PageBuilderApp {...props} /></Suspense>;
}

function PreviewRoute(props: RwpRouteProps) {
  return <Suspense fallback={loading}><PreviewPage {...props} /></Suspense>;
}

function AdminScreen() {
  return <Suspense fallback={loading}><BuilderAdmin /></Suspense>;
}

const hasLayout = (page: object) => {
  const record = page as { is_builder_enabled?: boolean; builder_data?: { content?: unknown } | null };
  return Boolean(record.is_builder_enabled && Array.isArray(record.builder_data?.content));
};

export const pageBuilderCleanup = defineRwpPlugin(manifest, ({ admin, routes, content }) => {
  const cleanups = [
    admin.registerPage({ id: 'rwp-page-builder', label: 'Page Builder', icon: '▣', capability: 'edit_posts', component: AdminScreen }),
    routes.register({ path: '/builder/:id', component: EditorRoute, chrome: false }),
    routes.register({ path: '/builder/:id/preview', component: PreviewRoute }),
    content.registerRenderer({
      id: 'rwp-page-builder',
      match: hasLayout,
      component: BuilderPageContent,
      editHref: (page) => `/builder/${page.id}`,
    }),
    content.registerAction({
      id: 'rwp-page-builder-edit',
      label: 'Edit with Builder',
      href: (page) => `/builder/${page.id}`,
    }),
  ];
  return () => cleanups.forEach((cleanup) => cleanup());
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    pageBuilderCleanup();
  });
}
