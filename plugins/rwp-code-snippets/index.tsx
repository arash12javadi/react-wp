import { lazy, Suspense } from 'react';
import { defineRwpPlugin, type RwpAdminPageProps } from '../../src/lib/plugin-api';
import { startSnippetRuntime } from '../../src/core/SnippetInjector';
import manifest from './manifest.json';
import { fetchServerStatus } from './lib/api';

/**
 * Code Snippets & AI Developer Assistant.
 *
 * Activating the plugin starts the snippet runtime; deactivating it under Plugins returns the
 * cleanup, which removes every style, script and hook the snippets added. That is why the runtime
 * is started here rather than mounted in the app root: switching the plugin off has to switch the
 * snippets off with it.
 *
 * The admin screens (the editor, the assistant drawer, the backup modal) are a separate chunk, so
 * a visitor loading the public site downloads only the runtime.
 */

const SnippetManager = lazy(() => import('./SnippetManager'));

const loading = <div style={{ padding: 40, font: '500 15px system-ui', color: '#475569' }} role="status">Loading…</div>;

function AdminScreen(props: RwpAdminPageProps) {
  return <Suspense fallback={loading}><SnippetManager {...props} /></Suspense>;
}

export const codeSnippetsCleanup = defineRwpPlugin(manifest, ({ admin }) => {
  const cleanups = [
    admin.registerPage({
      id: 'rwp-code-snippets',
      label: 'Code Snippets',
      icon: '🧩',
      // Snippets run in every visitor's browser, including a signed-in administrator's, so the
      // screen is limited to the same capability the database requires for writing them.
      capability: 'manage_options',
      component: AdminScreen,
      submenu: [
        { id: 'snippets', label: 'All Snippets', icon: '📄' },
        { id: 'status', label: 'Status', icon: '🩺' },
      ],
    }),
    admin.registerSetupCheck({
      id: 'rwp-code-snippets',
      capability: 'manage_options',
      run: async () => {
        const status = await fetchServerStatus();
        // No server (Vite dev on its own, a static host): nothing to report — snippets still work.
        if (!status || status.gemini) return [];
        return [{
          id: 'code-snippets-gemini-key',
          level: 'optional',
          title: 'The snippet AI assistant has no Gemini key',
          description: 'Snippets work without it. The key is only needed for "Generate with AI" and the assistant drawer.',
          steps: [
            'Create a free API key at aistudio.google.com/apikey.',
            'Add GEMINI_API_KEY=… to .env.local. Never use a VITE_ prefix: Vite compiles those into the public JavaScript.',
            'Restart the server with npm start.',
          ],
          action: { label: 'Open Code Snippets → Status', section: 'rwp-code-snippets', subsection: 'status' },
        }];
      },
    }),
    // Loads the active snippets for this surface and applies them.
    startSnippetRuntime(),
  ];
  return () => cleanups.forEach((cleanup) => cleanup());
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    codeSnippetsCleanup();
  });
}
