import { lazy, Suspense } from 'react';
import { defineRwpPlugin, type RwpAdminPageProps, type RwpRouteProps } from '../../src/lib/plugin-api';
import manifest from './manifest.json';
import { BuilderPageContent } from './render/BuilderRenderer';
import { fetchServerStatus } from './lib/api';

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

function AdminScreen(props: RwpAdminPageProps) {
  return <Suspense fallback={loading}><BuilderAdmin {...props} /></Suspense>;
}

const hasLayout = (page: object) => {
  const record = page as { is_builder_enabled?: boolean; builder_data?: { content?: unknown } | null };
  return Boolean(record.is_builder_enabled && Array.isArray(record.builder_data?.content));
};

export const pageBuilderCleanup = defineRwpPlugin(manifest, ({ admin, routes, content }) => {
  const cleanups = [
    admin.registerPage({
      id: 'rwp-page-builder', label: 'Page Builder', icon: '🧱', capability: 'edit_posts', component: AdminScreen,
      submenu: [
        { id: 'pages', label: 'Pages', icon: '📄' },
        { id: 'templates', label: 'Templates', icon: '🗂️' },
        { id: 'submissions', label: 'Form submissions', icon: '📥', capability: 'edit_pages' },
        { id: 'status', label: 'Status', icon: '🩺', capability: 'edit_pages' },
      ],
    }),
    admin.registerSetupCheck({
      id: 'rwp-page-builder',
      capability: 'edit_pages',
      run: async () => {
        const status = await fetchServerStatus();
        if (!status || (status.smtp && status.secretKey)) return [];
        return [{
          id: 'builder-form-email',
          level: 'optional',
          title: 'Page builder forms cannot send notification emails yet',
          description: `Form entries are stored either way (Page Builder → Form submissions). To be emailed about them, the server needs ${[!status.smtp && 'SMTP settings', !status.secretKey && 'SUPABASE_SECRET_KEY'].filter(Boolean).join(' and ')}.`,
          steps: [
            ...(!status.smtp ? ['Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM to .env.local.'] : []),
            ...(!status.secretKey ? ['Add SUPABASE_SECRET_KEY (Supabase → Project Settings → API Keys → secret key) to .env.local.'] : []),
            'Restart the server with npm start.',
          ],
          action: { label: 'Open Page Builder → Status', section: 'rwp-page-builder', subsection: 'status' },
        }];
      },
    }),
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
