import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { publicConfig, readConfig } from './server/config.mjs'

export default defineConfig({
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
