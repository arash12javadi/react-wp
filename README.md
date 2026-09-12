# React-WP

React-WP uses one Supabase project per deployed website, just like WordPress uses one database for one site. Configure the site's Supabase connection in the deployment environment so every browser loads the same content.

Copy `.env.example` to `.env.local` and set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The publishable key is safe for browser use when Row Level Security is configured. Never expose `SUPABASE_SECRET_KEY` to the browser or commit `.env.local`.

The browser-local setup wizard remains a development fallback when the Vite environment variables are absent. For a deployed site, configure the variables in the hosting provider (for example, Vercel) and redeploy.

## Self-hosted WordPress-style installation

For a host with a persistent Node.js process and writable storage, use the portable server:

```bash
npm run build
npm start
```

`npm start` rebuilds the frontend before starting the server, so changes to a
plugin manifest or source are included. If you run `node server.mjs` directly,
run `npm run build` first.

For hot-reloading development, start `npm start` first and then run
`npm run dev`. Vite serves the frontend at `http://localhost:5173`, reads the
same `data/react-wp-config.json`, and proxies `/api` requests to port 3000, so
both ports use the same Supabase installation.

The first installation writes the public site configuration to:

```text
data/react-wp-config.json
```

This is the React-WP equivalent of `wp-config.php`. It is created by the installer, is excluded from Git, and is served only through the public values needed by the browser. Database passwords and PostgreSQL connection strings are never returned to browsers.

Keep the `data/` directory on a persistent volume. If the host clears that directory on restart, React-WP will ask for installation again.

The installer first tries the generated PostgreSQL host. If that is unavailable from the host, enter the exact Supabase Session pooler connection string in the setup wizard. The server uses it to install the schema and then stores the shared public Supabase configuration for every browser.

## RWP plugin and hook API

React-WP exposes a typed extension API from [`src/lib/plugin-api.ts`](./src/lib/plugin-api.ts). Plugin IDs should use a unique prefix such as `ajdwp-`; public hooks use the `rwp_` prefix.

```ts
import { rwp } from './src/lib/plugin-api';

const cleanup = rwp.registerPlugin({
  id: 'ajdwp-seo-checklist',
  name: 'AJDWP SEO Checklist',
  version: '1.0.0',
  author: 'Arash Javadi',
  register({ actions, filters, admin, shortcodes }) {
    const removeFilter = filters.add('rwp_post_excerpt', (excerpt) => `${excerpt} [SEO]`);
    const removeAction = actions.add('rwp_post_created', (post) => {
      console.log('New post:', post);
    });
    const removePage = admin.registerPage({
      id: 'seo-checklist',
      label: 'SEO Checklist',
      component: SeoChecklistPage,
    });
    const removeShortcode = shortcodes.register({
      name: 'seo_score',
      render: () => 'SEO score',
    });
    return () => {
      removeFilter();
      removeAction();
      removePage();
      removeShortcode();
    };
  },
});
```

Available actions include `rwp_init`, `rwp_admin_loaded`, `rwp_public_loaded`, `rwp_user_logged_in`, `rwp_post_created`, `rwp_post_updated`, `rwp_settings_saved`, and `rwp_menu_saved`. Filters include `rwp_site_title`, `rwp_public_menu`, `rwp_posts`, `rwp_post_title`, `rwp_post_excerpt`, and `rwp_admin_navigation`.

Registered admin pages appear in the admin navigation, dashboard widgets render on the dashboard, and registered shortcodes can be rendered by future content components. Plugin cleanup functions should always remove registrations when a plugin is deactivated.

Administrators can manage registered plugins from the **Plugins** admin section. Activation state is stored in the `rwp_active_plugins` option, so it is shared across browsers and deployments connected to the same database. The current manager only activates plugins that are already bundled with the application. Arbitrary ZIP or JavaScript uploads are intentionally not executed; a future installer must validate manifests, isolate code, enforce permissions, and provide rollback before third-party uploads are enabled.

Bundled plugin source folders belong in [`plugins/`](./plugins). Each plugin folder should contain a `manifest.json` with its ID, name, version, metadata, and entry file. Vite automatically discovers `index.tsx` files one level below this directory at build time. The Supabase schema creates a `plugins` table containing the plugin ID, metadata, source folder, activation state, and timestamps. The Plugins screen synchronizes registered bundled plugins into this table and displays them in a WordPress-style table. Adding files to the folder makes them available after the next build; arbitrary runtime JavaScript is not executed.

The Plugins screen has a **Delete** action for removing a plugin record and its activation state from the database. Deleted bundled IDs are stored in the `rwp_deleted_plugins` option, so the same source folder is not immediately re-created. To permanently remove a bundled plugin, remove its folder, then rebuild and redeploy.

### Updating an existing database for plugins

If the site was installed before plugin support was added, run [`supabase/migrations/20260911_create_plugins.sql`](./supabase/migrations/20260911_create_plugins.sql) in the Supabase SQL Editor. The initial installer creates this table for new installations, but it cannot change an already-installed database unless the installation endpoint is run again.

### Unified pages and posts

Run [`supabase/migrations/20260911_create_pages_categories.sql`](./supabase/migrations/20260911_create_pages_categories.sql) for an existing installation. It creates `categories` and the unified `pages` table, then copies existing rows from `posts` into `pages` as blog posts. New installations create these tables from `supabase/schema.sql`.

### Roles, capabilities, and the media library

Run [`supabase/migrations/20260912_profiles_capabilities_media.sql`](./supabase/migrations/20260912_profiles_capabilities_media.sql) for an existing installation. New installations get all of it from `supabase/schema.sql`.

This migration moves user roles out of `auth.users.raw_user_meta_data` and into a new `public.profiles` table. That change is a security fix, not a refactor: Supabase lets any signed-in user rewrite their own `user_metadata` with `supabase.auth.updateUser()`, so while roles lived there, any subscriber could promote themselves to administrator, and the row level security policies that read the same value believed them. Roles now live in `profiles`, a trigger rejects anyone changing their own role, and every table policy checks `public.user_has_cap()` instead of the JWT.

The migration backfills existing users from their old metadata, so the administrator created at install time keeps that role. New sign-ups always start as `subscriber`.

Roles and their capabilities are defined in [`src/lib/roles.ts`](./src/lib/roles.ts) and mirrored into SQL by `public.user_has_cap()`. **If you change one, change the other** — the TypeScript map drives the admin UI, and the SQL function drives what the database actually permits.

Administrators can view every user and change roles under the **Users** admin section. Creating and deleting accounts is not exposed in the admin UI, because the Supabase admin API requires a secret key that must never reach the browser; use the Supabase dashboard for that.

### Media

The same migration adds the `public.media` table behind the **Media** admin section, which stores uploads to Cloudinary and ImageKit alongside plain external image URLs. Provider settings live under **Media → Upload settings**.

Which credentials you need depends on the operation, because Cloudinary and ImageKit differ:

| Operation | Cloudinary | ImageKit |
| --- | --- | --- |
| Upload | Cloud name + unsigned upload preset. Both are public and set in the admin. **No secret needed.** | Private key, server-side. |
| List / edit title and alt text | Nothing — this data lives in Supabase. | Nothing. |
| Delete the actual file | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, server-side. | Private key, server-side. |

The asymmetry is that Cloudinary supports genuinely unsigned uploads, so the browser can upload on its own, but its destroy API is signed-only. ImageKit signs both. Every signed call therefore goes through the server: `/api/imagekit-auth` issues upload credentials, and `/api/media-delete` performs deletions. Both verify the caller's Supabase session and role before doing anything, using only the publishable key and the caller's own access token.

**Never put an API secret or private key into the admin screen** — those fields are stored in `options`, which is publicly readable. Secrets belong in the server environment only. On Vercel, add them to the project environment variables.

If the delete credentials are not configured, deleting still works but only removes the library record. The Media screen now warns about this **before** you delete anything, rather than only failing at the moment you try.

**Secrets must go in `.env.local`, and the server reads that file itself.** Plain `node server.mjs` does not load `.env.local` the way Vite does, so [`server/env.mjs`](./server/env.mjs) loads it explicitly at startup before anything else reads `process.env`. Real environment variables still take precedence. Without this, credentials placed in `.env.local` were silently invisible to the server and every Cloudinary delete quietly left the file behind.

The Cloudinary cloud name is read from the `cloudinary_cloud_name` option you already set in the admin, so only `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` belong in the environment.

Files uploaded before the `provider_file_id` column existed are still deletable: the public id is recovered from the delivery URL, and the 20260915 migration backfills the column for existing rows.

To create a Cloudinary unsigned preset: **Settings → Upload → Upload presets → Add upload preset**, set Signing Mode to **Unsigned**, and copy the preset name into **Media → Upload settings** along with your cloud name.

### Page layout and SEO

Run [`supabase/migrations/20260913_page_layout_seo.sql`](./supabase/migrations/20260913_page_layout_seo.sql) for an existing installation. It adds per-page layout controls (`layout`, `show_sidebar`) and Yoast-style SEO fields to `pages`. Safe to re-run.

Each page can choose Boxed, Wide or Full width, with the sidebar on or off, from the editor's side panel. The SEO panel below the editor provides a search-result preview, SEO title and meta description with length limits, a focus keyword with a checklist, Open Graph and Twitter fields, canonical URL and a `noindex` toggle.

**How SEO tags are delivered matters more than the fields themselves.** React-WP is a client-rendered app, and Facebook, X, LinkedIn, WhatsApp and Slack never execute JavaScript — they read the raw HTML response. Meta tags set only by React would therefore produce blank link previews, while still looking correct in devtools, which makes the failure easy to miss.

So the tags are written twice, and the two are not redundant:

- [`server/seo.mjs`](./server/seo.mjs) looks up the page for the requested path and injects real tags into the HTML before it is sent. This is what crawlers consume.
- [`src/lib/seo.ts`](./src/lib/seo.ts) reapplies them during in-app navigation.

Both build their tags from the same function so they cannot drift apart. To verify the server half is working, request a page with `curl` and read the response body — if the tags appear only in devtools, social previews will be empty:

```bash
curl -s http://localhost:3000/your-slug | grep -i "og:title"
```

**This works on `npm start` only.** On Vercel the static build is served straight from the CDN, so no injection happens; matching it would need a rewrite routing HTML requests through a serverless function.

### Accounts, login and registration

Run [`supabase/migrations/20260914_auth_defaults.sql`](./supabase/migrations/20260914_auth_defaults.sql) for an existing installation.

The site has public `/login` and `/register` pages with email and password, plus optional Google and Facebook buttons. `/admin` no longer carries its own sign-in form; visiting it while signed out redirects to `/login?redirect=/admin`.

**New accounts get the role set under Settings → Accounts, and that is applied by the database, not the browser.** The `handle_new_user` trigger reads `default_user_role` from `options` and ignores whatever the sign-up request contains, because that payload is entirely attacker-controlled — accepting a role from it would restore the escalation path that [`public.profiles`](#roles-capabilities-and-the-media-library) exists to close. The trigger also refuses `administrator` and `super_admin` outright, so the dropdown offers Subscriber, Contributor, Author and Editor only. Promote accounts beyond that by hand under **Users**.

To verify this is actually holding, try to defeat it from the browser console and confirm the profile still comes back as the configured default:

```js
await supabase.auth.signUp({ email: 't@example.com', password: 'secret123', options: { data: { role: 'administrator' } } })
```

#### Social sign-in needs Supabase configuration

The toggles under Settings → Accounts only decide whether the buttons appear. Supabase performs the OAuth handshake, so each provider must also be set up there or the button returns an error:

1. **Authentication → Providers** — enable Google or Facebook and paste in the client ID and secret from Google Cloud Console or Meta for Developers.
2. **Authentication → URL Configuration** — add `http://localhost:3000/login` and your production equivalent to **Redirect URLs**. A missing entry here is the usual cause of a redirect mismatch on the first attempt.

#### The `[rwp_login]` shortcode

Add `[rwp_login]` to any page or post to place a login/logout button there. It accepts `label="Sign in"` and `style="link"`. The navbar links are separate and can be switched off under Settings → Accounts while the shortcode keeps working.

This is also the release where the shortcode API documented above started doing anything. `parseShortcodes` existed but was never called, and content rendered through `dangerouslySetInnerHTML`, which cannot host a React component. [`ContentRenderer`](./src/components/ContentRenderer.tsx) now replaces each shortcode in the parsed DOM with a host element and portals the component into it, so shortcodes work inline as well as on their own line — and plugin-registered shortcodes work for the first time.

### Comments, profiles and widgets

Run [`supabase/migrations/20260915_comments_profiles_widgets.sql`](./supabase/migrations/20260915_comments_profiles_widgets.sql) for an existing installation.

Then run [`supabase/migrations/20260916_comment_author_fk.sql`](./supabase/migrations/20260916_comment_author_fk.sql).

**The comments table had to be repointed.** It referenced `posts(id)`, but all content has lived in the unified `pages` table since the 20260911 migration, so comments could not attach to anything the site actually renders. The migration adds `page_id`, `parent_id` and `author_id`, carries existing rows across by matching slugs, and drops `post_id`.

`comments.author_id` references `public.profiles(id)`, not `auth.users(id)`. That distinction matters: PostgREST can only embed a table it has a foreign key path to, so pointing at `auth.users` made every comment read fail while inserts kept working — a confusing split that the 20260916 migration corrects. `profiles.id` is itself a reference to `auth.users(id)`, so the two are equivalent in what they constrain.

The author's display name is also stored on the comment row. `public.profiles` is readable by authenticated users only, since it holds email addresses, so without that copy every comment would show as "Someone" to signed-out readers.

Commenting requires an account. The insert policy enforces `author_id = auth.uid()`, so a comment cannot be attributed to another user even by a hand-crafted request — the UI is not what stops it. Replies nest without limit in the data; `comment_max_depth` only caps how far they are indented when rendered. Comments are held for approval by default and moderated under **Comments** in the admin; individual pages can close discussion from the editor.

**Profile** lives under its own admin section: display name, bio, avatar from the media library, email and password. Changing an email sends a confirmation link and does not take effect until it is clicked, which the screen states rather than claiming the change is saved. Roles are read-only here by design — self-service role changes are exactly what the profiles table exists to prevent.

**Widgets** are under **Menus & Widgets → Sidebar & Widgets**. Six widget types (Search, Recent Posts, Categories, Text/HTML, Navigation Menu, Login) can be dragged into a Sidebar or Footer area and reordered. Configuration is stored in the `rwp_widget_areas` option. The sidebar appears on pages with **Show sidebar** enabled; when no widgets are configured, the original default sidebar still renders so nothing disappears on upgrade.

### The editor

The content editor is built on [TipTap](https://tiptap.dev) (ProseMirror). It replaced a hand-rolled `contentEditable` implementation that reassigned `innerHTML` from a React effect on every keystroke, which moved the caret back to the start of the document mid-sentence. TipTap owns its DOM, and external values are only applied while the editor is unfocused, so that class of bug cannot recur.

### Installing a personal copy

The repository contains only placeholders. Each person can download or clone the project and install it against their own Supabase project:

1. Copy the project to their computer or Node.js host.
2. Run `npm install`, `npm run build`, and `npm start`.
3. Open the site and enter their own Supabase URL, publishable/anon key, database password, and (when needed) Session pooler connection string.
4. Complete the administrator setup.

The installer creates `data/react-wp-config.json` locally on that installation. The file is intentionally ignored by Git, so it is not uploaded to GitHub. It contains only the public Supabase URL/key used by browsers; database passwords and PostgreSQL connection strings are used by the server during installation and are not written to that file.

Never commit `.env`, `.env.local`, database dumps, connection strings, database passwords, secret keys, or service-role keys. The tracked [`react-wp.config.example.json`](./react-wp.config.example.json) contains placeholders only.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
