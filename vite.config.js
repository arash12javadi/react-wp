import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { publicConfig, readConfig } from './server/config.mjs'

export default defineConfig({
  build: {
    // Split the always-loaded third-party libraries into their own long-lived
    // chunks so a vendor chunk can be reused from the browser cache across
    // deploys. Vite 8 bundles with Rolldown, which replaces Rollup's object-form
    // `manualChunks` with `output.codeSplitting.groups`. Use [\\/] so the test
    // matches on Windows too.
    //
    // With the vendors split out, every library chunk is under 500 kB; the
    // remaining entry chunk is this app's own code (App.tsx eagerly imports the
    // admin screens, including the TipTap-based editor). The limit is raised so
    // the warning again means "a library chunk got unusually big". Lazy-loading
    // the admin screens in src/App.tsx would shrink the entry chunk further.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/, priority: 20 },
            { name: 'tiptap', test: /node_modules[\\/](@tiptap|prosemirror-)/, priority: 20 },
            // Catch-all for the rest of the third-party code, lowest priority so
            // the named groups above win. Keeps app code in the entry chunk.
            { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
  plugins: [
    react(),
    {
      name: 'react-wp-server-config',
      async transformIndexHtml(html) {
        const config = publicConfig(await readConfig())
        return html.replace(
          'window.__REACT_WP_CONFIG__=null;',
          `window.__REACT_WP_CONFIG__=${JSON.stringify(config)};`,
        )
      },
    },
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
