import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { publicConfig, readConfig } from './server/config.mjs'
import { apiPort, devApiServer } from './vite.devApi.mjs'

/**
 * Where the dev server sends `/api`.
 *
 * Those routes are not the SPA's: the Setup Wizard's Step 3 probe, sessions, media deletes and DDL
 * live on the Node server, which `devApiServer()` starts for `npm run dev`. Both read the same
 * `PORT`, so moving the API server moves the proxy with it instead of leaving it aimed at :3000.
 */
const apiOrigin = `http://localhost:${apiPort()}`

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
      // Server-only drivers are loaded lazily (src/lib/db/adapters, src/lib/auth, src/lib/storage)
      // and must never be bundled into the browser build. Mark them external so Rolldown leaves the
      // dynamic import() calls untouched; they only resolve at runtime on a Node/edge server.
      external: (id) => {
        const serverOnly = ['pg', 'mysql2', 'better-sqlite3', '@libsql/client', 'bcryptjs', 'jose', '@aws-sdk/client-s3'];
        return serverOnly.some((module) => id === module || id.startsWith(`${module}/`));
      },
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
    // The API server itself, so `npm run dev` is enough on its own.
    devApiServer(),
  ],
  server: {
    proxy: {
      '/api': {
        target: apiOrigin,
        /**
         * Names the one failure the browser could not: an unreachable API server.
         *
         * Vite answers a proxy error with a bare `502` and an empty body, so a missing `server.mjs`
         * reached the Setup Wizard as `Connection test failed (HTTP 502)` — for a Supabase project
         * that was perfectly reachable, on a step whose every other error is specific. This hook is
         * registered before Vite's own (which runs after `configure`), and Vite writes its plain 502
         * only when nothing has been sent yet, so the JSON body below is the one that survives and
         * every caller can print it verbatim.
         */
        configure(proxy) {
          proxy.on('error', (error, _request, response) => {
            if (typeof response?.writeHead !== 'function' || response.headersSent || response.writableEnded) return
            const message = `The React-WP API server at ${apiOrigin} could not be reached (${error.code || error.message}). `
              + 'Run "npm run dev", which starts it, or start it yourself with "npm start".'
            response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
            response.end(JSON.stringify({ success: false, ok: false, error: message, message }))
          })
        },
      },
    },
  },
})
