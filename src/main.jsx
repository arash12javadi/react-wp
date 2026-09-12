import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { registerBuiltinShortcodes } from './lib/builtin-shortcodes.tsx'
import './index.css'

registerBuiltinShortcodes()

// Bundled plugins are discovered by folder convention at build time.
import.meta.glob('../plugins/*/index.tsx', { eager: true })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)