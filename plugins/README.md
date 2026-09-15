# React-WP plugins

Put bundled React-WP plugins in this directory. Each plugin should have its own
folder and a `manifest.json` file.

Example:

```text
plugins/
  my-plugin/
    manifest.json
    index.tsx
    server.mjs      (optional)
```

Example manifest:

```json
{
  "id": "vendor-my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "Vendor",
  "description": "A React-WP extension.",
  "entry": "./index.tsx"
}
```

Vite automatically discovers plugin `index.tsx` files one level below this
directory at build time. It does not execute arbitrary files discovered at
runtime. A plugin folder becomes available after the next build.

## What a plugin can register

Inside `defineRwpPlugin(manifest, (context) => { ... })`:

| API | What it does |
| --- | --- |
| `actions.add / actions.do` | Hooks such as `rwp_user_logged_in`. Plugins may fire their own, prefixed with the plugin id. |
| `filters.add / filters.apply` | Filters such as `rwp_site_title` and `rwp_public_menu`. |
| `admin.registerPage({ id, label, icon, capability, submenu, component })` | An admin screen. `capability` hides it from, and blocks it for, roles without that capability. `submenu: [{ id, label, icon, capability }]` shows under the page in the sidebar while it is open; the component receives `{ subsection, navigate }`. Use an emoji for `icon`. |
| `admin.registerDashboardWidget({ id, title, capability, component })` | A panel on Dashboard → Overview. |
| `admin.registerSetupCheck({ id, capability, run })` | `run()` resolves to the setup notices that still apply (`{ id, level: 'required' \| 'recommended' \| 'optional', title, description, steps, action }`), shown in Dashboard → Overview's checklist. Keep ids stable: hidden notices are remembered by id. |
| `shortcodes.register({ name, render, description, example, attributes })` | `[name attr="value"]` in page content. The optional fields document it in Dashboard → Guide. |
| `routes.register({ path, component, chrome })` | A public URL. `:param` segments and a trailing `*` are captured into `params`. Plugin routes win over page slugs. `chrome: false` renders without the site header and footer. |
| `header.register({ id, component })` | Something in the public header next to the login links, such as a cart link. |
| `content.registerRenderer({ id, match, component, editHref })` | Takes over the body of pages where `match(page)` is true. The component gets `{ page, comments }`; `editHref` redirects the toolbar's "Edit page" link. The page builder uses this. |
| `content.registerAction({ id, label, href, show })` | A link on each row of Pages & Posts and at the top of the content editor, e.g. "Edit with Builder". |

Components rendered inside a route can read site settings and the signed-in user with
`usePublicChrome()` from `src/components/PublicChrome.tsx`.

Return a cleanup function that removes every registration, so deactivating the plugin
removes it completely.

## Server routes

A plugin that needs secrets or must talk to a third party (payments, email) can ship a
`server.mjs` that default-exports `{ id, routes }`:

```js
export default {
  id: 'vendor-my-plugin',
  routes: {
    'POST hello/:name': async (ctx) => ({ status: 200, body: { hello: ctx.params.name, you: ctx.json() } }),
  },
};
```

It is served at `/api/plugins/<id>/<route>` by `server.mjs` (self-hosted) and by
`api/plugins.ts` on Vercel. The context has `json()`, `rawBody` (a Buffer, for webhook
signatures), `headers`, `query`, `params`, `bearerToken` (the caller's Supabase access
token), `origin`, and `supabase: { url, publishableKey, secretKey }`.

**Server modules are registered by hand in `server/plugins.mjs`.** Vercel bundles a
function by tracing its imports, so a module found with `readdir` at runtime (and the npm
packages it imports) would be missing from the deployment. Routes of a plugin that is not
active under Plugins return 404.

## Test plugin

The `sample-rwp-plugin` folder is a working example. It registers an admin
page, a dashboard widget, and a site-title filter. It is discovered by the
Vite plugin glob in `src/main.jsx`.

During development, run `npm run dev` and use `http://localhost:5173`. Plugin
modules include HMR cleanup so edits replace the previous plugin instance and
remove old styles, hooks, pages, and widgets. Port 3000 serves the production
build and only changes after `npm run build` and a server restart.

## Shop plugin

`rwp-shop` is a full store. See the "Shop" section of the root README for setup.

## Page builder plugin

`rwp-page-builder` is a visual page builder. See the "Page builder" section of the root README.

Other plugins can add builder widgets with `registerWidget` from
`plugins/rwp-page-builder/lib/registry.ts`: a definition is `{ type, label, icon, category,
defaults, controls, View, css }`. `controls` is plain data (the editor renders it), `View`
renders for visitors and on the canvas, and `css(bag, node, device)` returns style rules for
one device, which the builder turns into media queries.
