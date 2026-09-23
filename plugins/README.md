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

## Code snippets plugin

`rwp-code-snippets` adds the Code Snippets screen: CSS, JavaScript, HTML and React hook
snippets stored in `public.code_snippets`, a Gemini-backed code generator and assistant,
and JSON backup/restore. See the "Code snippets and the AI developer assistant" section of
the root README, and run `supabase/migrations/20260930_code_snippets.sql` first.

The runtime that applies snippets lives in core, at `src/core/SnippetInjector.tsx`, because
core must not import plugin code. The plugin starts it on activation and returns its cleanup,
so deactivating the plugin removes every style, script and hook the snippets added. Anything
else that wants the same behaviour can call `startSnippetRuntime()` or mount `<SnippetInjector />`.

## Chat plugin

`rwp-chat` is a chat widget with a Gemini-backed assistant and handover to a person. Activate it
under Plugins, which installs `plugins/rwp-chat/schema.sql`; the same text is in
`supabase/migrations/20261008_chat_system.sql` for sites that prefer the SQL Editor. Set
`GEMINI_API_KEY` in `.env.local` for the assistant — never `VITE_GEMINI_API_KEY`, which Vite
compiles into the JavaScript every visitor downloads.

Anonymous visitors cannot read the chat tables at all: RLS refuses anon even a select, because a
readable `chat_sessions` row is a list of every lead's email and phone number. They reach their
own conversation through `rwp_chat_*` functions that take the session's own secret token. Staff
use ordinary queries: `moderate_comments` for the inbox, `manage_options` for the settings.
Credentials (the Telegram bot token, the WhatsApp API token) are in `chat_secrets`, which no
browser can read — not even the settings screen, which shows only whether each one is set.

The chatbot has no reference to a shop object anywhere. It publishes two names and looks them up
with `to_regprocedure` at run time, the way core finds `rwp_engagement_target_product`:

```sql
public.rwp_chat_card_product(p_id text) returns jsonb            -- a product card
public.rwp_chat_order_status(p_key text, p_email text) returns jsonb  -- order tracking
```

`plugins/rwp-shop/schema.sql` creates both and drops them in its `uninstall.sql`. Without the shop
they do not exist and the widget hides the product card and the order tracker.

Which page a conversation is about is *announced*, not guessed:

```js
doAction('rwp_chat_subject', 'product', 'blue-cotton-shirt');  // entering the page
doAction('rwp_chat_subject', null, null);                      // leaving it
```

Anything that renders a page can fire that — the shop's product route does. Likewise
`doAction('rwp_chat_add_to_cart', productId, quantity)` is how the in-chat "Add to cart" button
reaches the shop's cart without either plugin importing the other.

## Persian Origins plugin

`persian-origins` makes every page, post and category bilingual (English and Persian by default)
and switches the whole site instantly: text, direction, fonts and theme. Every other word on the
page (menus, header, footer, widgets, buttons, messages) is translated as Site text. Mark anything
a visitor wrote with `data-rwp-user-content` so it is never translated. Activate it under Plugins,
which installs `plugins/persian-origins/schema.sql`. See the "Persian Origins" section of the root
README. Fonts go in `plugins/persian-origins/assets/fonts/<language>/<family>/` (see the README
there) and are discovered at build time.

Other plugins can add builder widgets with `registerWidget` from
`plugins/rwp-page-builder/lib/registry.ts`: a definition is `{ type, label, icon, category,
defaults, controls, View, css }`. `controls` is plain data (the editor renders it), `View`
renders for visitors and on the canvas, and `css(bag, node, device)` returns style rules for
one device, which the builder turns into media queries.
