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

### Shop (the `rwp-shop` plugin)

A WooCommerce-style store, shipped as a bundled plugin in [`plugins/rwp-shop`](./plugins/rwp-shop).

**Setup**

1. Run [`supabase/migrations/20260917_shop_plugin.sql`](./supabase/migrations/20260917_shop_plugin.sql) in the Supabase SQL Editor. Safe to re-run. New installations get it from `schema.sql`.
2. Activate **RWP Shop** under **Plugins**. **Shop** then appears in the admin menu for Administrators and the new **Shop Manager** role.
3. Under **Shop → Settings**: pick the currency, store address, payment methods, tax and shipping zones. Add products under **Shop → Products**. Dashboard → Overview lists whatever the shop still needs.
4. For online payments and email, set the server environment variables listed in [`.env.example`](./.env.example) and restart: `SUPABASE_SECRET_KEY`, then any of `STRIPE_SECRET_KEY` (+ `STRIPE_WEBHOOK_SECRET`), `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET`/`PAYPAL_MODE`, and `SMTP_*`. **Shop → Settings → Status** shows which are set.

Public pages: `/shop`, `/product-category/<slug>`, `/product-tag/<slug>`, `/product/<slug>`, `/cart`, `/checkout`, `/checkout/order-received/<id>`, `/checkout/order-pay/<id>`, `/my-account`. Shortcodes: `[rwp_products limit="4" category="slug" featured="1" on_sale="1" orderby="popularity"]`, `[rwp_add_to_cart id="<product id>"]`, `[rwp_cart_link]`.

Features: simple, variable (attributes → variations), grouped and external products; sale prices with schedules; stock with backorders, low-stock thresholds and held stock for unpaid orders; categories, tags and global attributes with layered filtering; gallery; upsells and cross-sells; downloadable products with limits and expiry; coupons (percent, fixed cart, fixed product; spend limits, product/category/email restrictions, usage limits); tax rates by country/state/postcode/city with classes, priorities and compound rates, prices entered with or without tax; shipping zones with flat rate (per item and per shipping class), free shipping and local pickup; Stripe Checkout, PayPal, bank transfer, cheque and cash on delivery; refunds (manual, or through Stripe/PayPal); order notes; guest checkout and customer accounts (orders, downloads, addresses); reviews with verified owners; reports; order emails.

**Prices are decided by the database, never the browser.** The cart sends only product ids and quantities. `shop_calculate()` works out prices, coupons, tax and shipping, and `shop_place_order()` repeats that calculation and takes stock with a conditional update inside the same transaction, so two customers cannot both buy the last item. A total computed in the browser would be attacker-controlled.

**Online payments are confirmed with the gateway, server-side.** After Stripe or PayPal redirects back (or Stripe's webhook fires), the server asks the gateway whether the payment succeeded and then calls `shop_mark_order_paid()`, which checks the amount and currency against the order total. That function is granted to `service_role` only, which is why `SUPABASE_SECRET_KEY` is needed; anon and signed-in users get "permission denied". The secret key is used for nothing else.

**Order emails** go out through SMTP. Emails that a guest's browser can trigger (a new order) are recorded in `shop_orders.emails_sent` so a replayed request cannot send them twice; that record also needs the secret key.

**On Vercel** the shop works the same way: `api/plugins.ts` serves the plugin routes, and `vercel.json` now also routes unknown paths to `index.html`, so refreshing `/shop` or any other client route no longer 404s. Set the same environment variables in the Vercel project.

The migration also fixes a sign-up bug in `handle_new_user`: when the `default_user_role` option had never been saved, `null not in (...)` evaluated to null rather than true, so the fallback to `subscriber` never ran and every sign-up failed.

To test Stripe without real money use a `sk_test_` key and card `4242 4242 4242 4242`; for PayPal leave `PAYPAL_MODE=sandbox` and use a sandbox buyer account.

### Page builder (the `rwp-page-builder` plugin)

An Elementor-style visual builder, shipped as a bundled plugin in [`plugins/rwp-page-builder`](./plugins/rwp-page-builder).

**Setup**

1. Run [`supabase/migrations/20260918_page_builder.sql`](./supabase/migrations/20260918_page_builder.sql) in the Supabase SQL Editor. Safe to re-run. New installations get it from `schema.sql`.
2. Activate **RWP Page Builder** under **Plugins**.
3. Open any page from **Page Builder**, or with **Edit with Builder** in Pages & Posts. The builder runs full screen at `/builder/<page id>`.
4. For form notification emails, set `SMTP_*` and `SUPABASE_SECRET_KEY` on the server. **Page Builder → Status** shows which are set. Entries are stored either way.

**What it does.** Sections → columns → widgets, dragged from the panel or the navigator, with inner sections one level deep. Every element has Content, Style and Advanced tabs; responsive values are set per device (desktop, tablet 768px, mobile 375px) and inherit from larger devices. Widgets: Heading, Text Editor, Image (lightbox), Button, Divider, Spacer, Icon, Icon Box, Video (YouTube/Vimeo/self-hosted, click-to-load), Posts (grid/list/masonry, pagination), Form, Slideshow, Call to Action, Accordion (optional FAQ schema), Nav Menu, Custom HTML, and dynamic Post Title, Excerpt, Content, Featured Image and Post Meta. Also: dynamic tags such as `{{page.title}}` and `{{user.name|there}}`, entrance animations, sticky elements, custom CSS per element (`selector { … }`), global colours and fonts, section and page templates (with JSON import/export), 30 revisions per page, undo/redo, autosave to the browser, a preview of unsaved changes, and a conflict check when two people save the same page.

**How a layout is stored and shown.** The layout is a JSON tree in `pages.builder_data`; `is_builder_enabled` switches the public page from its classic content to the layout. The public site renders it with `BuilderRenderer`, which loads only the widget views: the editor, dnd-kit and the controls are a separate chunk that loads on `/builder/…` alone. Each element's styles are generated into one stylesheet with media queries at 1024px and 767px. In the editor the same generator runs for the previewed device only, so the canvas matches what that device shows without resizing the browser window.

Three rules are enforced by the database, not the editor:

- **Custom HTML is administrators only.** Its code runs in every visitor's browser, including an administrator's, so a contributor's script could take over an admin session. The `builder_guard_html` trigger refuses any save to a page or template that adds or changes Custom HTML code unless the user has `manage_options`. Moving or keeping existing code is allowed, so editors can still work on those pages.
- **Form recipients are private.** `builder_data` is readable by anyone for a published page, so the email address a form notifies is saved in `builder_form_settings` (page editors and the server only), never in the layout. Revisions and templates don't contain it either.
- **Submissions are validated against the saved form.** The browser posts values to `/api/plugins/rwp-page-builder/forms/submit`. `builder_submit_form()` looks the form up in the *published* page and checks required fields, email format and allowed choices; unknown fields are dropped. Visitors can't insert into `form_submissions` directly. Each form accepts at most 20 submissions a minute, the server limits each IP to 10 a minute, and a honeypot field drops simple bots.

**Featured images.** Pages have no separate featured image column, so the Posts and Featured Image widgets use each post's social image (SEO panel → og:image).

**Author names** in Post Meta come from `builder_author_names()`, which returns only the display names of people with published content: `profiles` itself is readable only when signed in, because it holds emails.

### Backup and restore

Run [`supabase/migrations/20260919_backup_restore.sql`](./supabase/migrations/20260919_backup_restore.sql) for an existing installation. Safe to re-run.

**Settings → Backup** has two buttons. **Export backup** downloads one `.zip` file; **Restore backup** puts its contents onto this site, or onto a fresh installation somewhere else. Administrators only (`manage_options`), enforced by the database functions, not the screen.

**What's in the file.** `backup.json` holds every row of every table in `public` except `profiles`: pages, posts, menus, widgets and all other options, comments, the media library, plugin state, shop products, orders and coupons, builder layouts, revisions, templates and form entries. Tables added later by migrations or plugins are included automatically. It also lists each user's email, display name, bio, avatar and role. It never contains passwords, `auth.users`, or anything from `.env.local`. It does contain customer emails, addresses and form entries, so store it like a database dump.

**Why the restore runs in SQL.** `rwp_backup_import()` truncates and refills every table inside one transaction, so a failure (a bad row, a timeout) leaves the site exactly as it was. The browser could not do that with one request per table. The function also turns off user triggers while it inserts, so restored rows keep their timestamps, and the stock guard, review bookkeeping and builder revision triggers don't run a second time. It restores ids as they were, then moves each identity sequence past the highest id.

**Accounts are matched by email, not copied.** A Supabase account can't be recreated from a backup without its password hash, and that hash must not leave the database. So every user reference (any column with a foreign key to `profiles` or `auth.users`) is re-pointed to the account on the target site with the same email. Unmatched references are cleared, and rows that can't exist without their account (`shop_customers`) are skipped. The report names the unmatched emails. The importing administrator's own role is never changed, and only a super admin can restore `super_admin`. The target's `installed` option is kept.

**Media.** Cloudinary and ImageKit files are not in Supabase, so there are two levels of backup:

- **Links only** (untick *Include media files*): the backup keeps the URLs. They keep working anywhere as long as the files stay in the original account. The file is small.
- **Files included** (the default): the browser downloads every Cloudinary/ImageKit file into `media/` inside the ZIP. Both providers send `Access-Control-Allow-Origin: *`, so no server or secret is needed. Any file that fails to download is listed, and only its link is kept. External image links are always kept as links. On restore, tick *Upload the media files to this site's media account* when the original account won't stay available. Each file is uploaded with this site's upload settings, and every copy of its old URL is replaced across the whole backup (page HTML, builder JSON, product galleries, avatars, options) before the database restore runs. The target also keeps its own Cloudinary/ImageKit settings. Only exact URLs are rewritten. A hand-edited Cloudinary transformation URL (`/upload/w_300/…`) keeps pointing at the old account.

Everything happens in the browser and in Supabase, so this also works on Vercel.

**Size limits.** The whole backup is held in browser memory, which is fine for hundreds of megabytes of media, not tens of gigabytes. Supabase cancels statements from signed-in users after 8 seconds by default; a very large restore can hit that and is rolled back. The error says so and gives the fix: `alter role authenticated set statement_timeout = '60s'; notify pgrst, 'reload config';`.

### App Settings

Run [`supabase/migrations/20260920_app_settings.sql`](./supabase/migrations/20260920_app_settings.sql) for an existing installation. Safe to re-run. These settings are now under **Settings → General, Uploads, SEO and Roles** in the admin (administrators only); one Save button covers all four.

- **General** — show or hide titles on pages and posts and publish dates on posts (a hidden title stays in the page for screen readers); limit Authors, Contributors and Subscribers to media they uploaded; excerpt length in words or characters (moved here from Settings → Site); and the target of the `#profile_url#` menu placeholder.
- **Uploads** — maximum file size, minimum and maximum image dimensions, a disk quota per role, and per-person overrides by email address.
- **SEO** — a Meta keywords field in the page editor, and header and body tracking scripts such as Google Tag Manager.
- **Roles** — let Subscribers upload or write draft posts, and let Contributors upload or publish.

Menus gained two things under **Menus → Edit** on each item: labels and URLs can use `#profile_name#`, `#profile_avatar#`, `#profile_both#` and `#profile_url#`, and each item chooses what logged-out visitors see (the item, nothing, or another label and link). Items with a profile placeholder are hidden from logged-out visitors unless given a replacement. This is presentation only: the menu is public data, so hiding a link does not protect the page behind it.

**What the database enforces, and what it cannot.** The settings are one JSON document in the `rwp_app_settings` option. Three parts of it are enforced in SQL, not just in the UI:

- **Role grants** are read by `public.user_has_cap()`, so every existing policy honours them. Only those four grants exist; nothing above Author can be handed out from settings.
- **Media scoping** goes through `rwp_can_manage_media()`, used by both the media update/delete policies and `/api/media-delete`. That endpoint used to delete whatever provider file id the browser sent, so any uploader could delete anyone's file; it now takes only the library row id and reads the provider id from the database.
- **Upload rules and quotas** are checked by the `media_enforce_upload_rules` trigger when a file is added to the library. It also sets `uploaded_by` to the caller, so an upload cannot be attributed to someone else to dodge their quota, and it stops size and owner fields being edited afterwards.

The upload limit is not a hard limit on what reaches Cloudinary. Files go straight from the browser to the provider, so the size and dimensions the trigger checks are the ones the browser reports, and the unsigned preset accepts uploads from anyone who has it. The browser checks every file before sending it, which is what stops normal use and avoids leaving rejected files behind at the provider. For a hard limit, restrict the Cloudinary upload preset as well. ImageKit is stricter: `/api/imagekit-auth` now requires a signed-in uploader with room in their quota before it signs anything. Before this change it signed uploads for anyone.

**Quota overrides are private.** `options` is publicly readable, and overrides are keyed by email, so they live in their own `rwp_quota_overrides` table that only administrators can read. Keying by email lets you set an allowance before the person signs up. An override applies to Administrators too; without one they are unlimited.

**Tracking scripts** are written into the HTML by `server/seo.mjs` on `npm start`, so tag managers load before the app. The server also adds `<meta name="rwp-scripts">`, and the browser only injects the scripts itself when that marker is missing (Vercel, `npm run dev`), so pageviews are not counted twice. Neither path runs on `/admin` or `/builder/…`. Pasted code passes through [`src/lib/scriptSanitizer.js`](./src/lib/scriptSanitizer.js), which keeps only `<script>`, `<noscript>` with an iframe or image, `<link>` and `<meta>`, with https URLs, and lists anything it removed before you save. That keeps a snippet from breaking the page markup; it cannot make the JavaScript itself safe, which is why only administrators can save it.

Deliberately not included from the legacy theme: a toggle for like/follow buttons (React-WP has no like or follow system), a switch for thumbnail generation (Cloudinary and ImageKit generate sizes on request, so nothing is generated at upload), and a comments scoping toggle (comments were already limited: only Editors and above can open the Comments screen, and everyone else sees only approved comments and their own).

### Dashboard, admin navigation, logo and profile details

Run [`supabase/migrations/20260921_profile_details.sql`](./supabase/migrations/20260921_profile_details.sql) for an existing installation. Safe to re-run. Everything else in this section needs no migration.

**Admin navigation works like WordPress.** Each sidebar item opens its screen and shows its submenu underneath: Settings → Site, Accounts, General, Uploads, SEO, Roles, Backup (App Settings is merged into Settings); Pages & Posts → All content, Add post, Add page, Categories; Media → Library, Upload providers; Menus → Menus, Sidebar & Widgets; Shop → Orders, Products, Reports, Customers, Coupons, Reviews, Settings. The location is kept in the URL (`/admin?section=settings&tab=seo`), so reloads and bookmarks return to the same screen, and the old ids (`app-settings`, `categories`, `rwp-shop-products`) still resolve. Icons are emoji: text, so the sidebar loads no icon font or image. Plugins add a submenu with `submenu` on `admin.registerPage`; the page component receives `subsection` and `navigate`.

**Dashboard → Overview** is the admin's landing screen. Its setup checklist lists what is still missing, each item marked Required, Recommended or Optional, expandable into numbered steps with a link to the screen (or external dashboard) that fixes it: site title and tagline, logo and icon, an upload provider, Cloudinary delete keys, the ImageKit private key, missing migrations, the menu, social sign-in configuration, pending comments, your profile, and, from plugins, the shop's store address, payment methods, Stripe/PayPal keys, `SUPABASE_SECRET_KEY` and SMTP. Items can be hidden (remembered per person in the browser) and shown again. The number of visible required and recommended items, plus available updates, shows as a badge on Dashboard in the sidebar. Server secrets are only ever reported as set or not set: `/api/media-config` and the plugins' status routes never return a value. Plugin widgets such as *Shop at a glance* moved here from Pages & Posts, next to an *At a glance* panel of counts. Plugins add checklist items with `admin.registerSetupCheck`.

**Dashboard → Updates** (administrators) compares the running version of the app (`package.json`) and each plugin (`manifest.json`) with a JSON feed, by default [`updates.json`](./updates.json) in this repository on GitHub. It can check by hand or automatically (every admin visit, daily, weekly or monthly); the result is stored in the `rwp_update_status` option so every administrator sees it, and the schedule in `rwp_update_settings`. There is no background process: a due check runs in the browser of the next administrator who opens the admin. Each update lists its notes and the migrations it needs. **Installing stays a step on the host** (`git pull` or a new ZIP, `npm install`, run the migrations, `npm start`), and the screen explains it: the site runs from a build, so the browser cannot replace the code, and a server that downloads and runs code from a URL would let whoever controls that URL run anything on your host. To publish a release, bump `version` in `package.json` or the plugin's `manifest.json` and in `updates.json`, and list any new migration.

**Dashboard → Guide & shortcodes** is documentation for new users inside the admin: first steps, running migrations, every `.env.local` variable and where to get it, content, menus and placeholders, media providers, a role/capability table generated from `roles.ts`, the page builder's dynamic tags, shop setup, backups and updates, plugin development, and troubleshooting. Shortcodes are listed from the registry, so a plugin's shortcodes appear automatically with the `description`, `example` and `attributes` it registers. Shop → Products has a *Copy shortcode* action for `[rwp_add_to_cart]`.

**Logo.** Settings → Site → Header logo sets a logo image, its height, and what the header shows: title and tagline, title only, logo only, logo and title, or logo, title and tagline. A logo-based choice with no logo falls back to the title. This also fixed the header, which always showed the text "Just another React-WP site" instead of the saved tagline. The admin sidebar uses the site icon (or logo) instead of the "R" mark.

**Site title in the browser tab.** `index.html` has a placeholder `<title>`. Only pages from the `pages` table replaced it, so the admin, login, register and plugin routes kept the placeholder ("react-wp") whatever the site title was. The server now writes the site title into the admin and builder HTML, and the app sets the tab title on every screen (`Screen ‹ Site title` in the admin).

**Profile details.** Profile → More about you adds optional first and last name, pronouns, job title, company, website, location, time zone, phone, birth date and social links. They live in `public.profile_details`, not on `profiles`, because `profiles` is readable by every signed-in user and a phone number or birth date must not be: the new table is readable only by its owner and by roles with `list_users`, and writable by its owner and by `edit_users`. Websites must be `http(s)` URLs (enforced by a check constraint as well as the form). The table is included in backups automatically, and restored rows are matched to accounts by email like every other user reference.

### Appearance → Theme Editor

Run [`supabase/migrations/20260922_theme_editor.sql`](./supabase/migrations/20260922_theme_editor.sql) for an existing installation. Safe to re-run. Until it has run, the site renders the default layout and the editor explains why it cannot save.

**What it edits.** Six tabs: Header, Footer, Sidebar, Comments, Layout / Index, and Custom CSS & Code. Each of the first five has two modes:

- **Visual builder**: drag blocks from the block library onto the canvas, reorder them (by dragging or with the arrow buttons), and click one to change its content, alignment, padding, background and text colour, and visibility (hidden, not on mobile, mobile only). Area settings sit above the canvas: sticky header or sidebar, 1–4 footer columns plus a bottom bar, avatars, nested replies, comment order and comments per page, sidebar left/right/hidden, and numbered, newer/older or load-more pagination. Blocks include the logo, navigation menu, search bar, header action buttons (register, log in and plugin buttons such as the cart), social links, Custom HTML, text, copyright, menu links, recent posts, categories, login, widget areas (the widgets from Menus → Sidebar & Widgets), comments list, comment form, comments pagination, discussion rules, hero, post feed and pagination.
- **Code**: the area's raw code, plus its layout as JSON. The Header tab has `<head>` code and Header HTML, Footer has Footer HTML and Footer scripts, Sidebar has Sidebar HTML, Comments has Comments CSS. **Validate code** reports unclosed or stray tags, unbalanced CSS braces and unterminated comments or strings (with line numbers in the gutter), and lists what the sanitisers will remove. Save runs the same checks and refuses to save while there are errors.

One draft covers every tab. The sticky bar has Undo/Redo (Ctrl+Z, Ctrl+Shift+Z), **Reset … to theme default** for the current tab, **Live preview** and **Save changes** (Ctrl+S). Live preview opens the site in another tab showing the unsaved draft and updates as you edit. The draft is kept in this browser's `localStorage`, so nobody else sees it, and the preview never runs `<head>` code or footer scripts.

**How it is stored.** One row in `public.theme_settings`: `layout_structure` (JSON), `custom_header_code`, `custom_header_html`, `custom_footer_code`, `custom_footer_html`, `custom_sidebar_code`, `custom_comments_css` and `custom_css`. The HTML columns are separate from the script columns because they are sanitised differently. The row is readable by anyone, since all of it is rendered into public pages, and writable only with `manage_options`: the code runs in every visitor's browser, including an administrator's. Saves are conditional on `updated_at`, which a trigger sets, so two administrators editing at once get a conflict message instead of silently overwriting each other.

**How it renders.** The default layout reproduces the header, footer, sidebar, comments and home page as they were, so nothing changes until you save. `ThemeLayoutRenderer` renders every block inside its own error boundary: a block that throws disappears (the preview says why) instead of breaking the page. HTML goes through `ContentRenderer`, so shortcodes work and `<script>`, `<style>`, `<iframe>` and event handlers are removed. `<head>` code and footer scripts go through the same allowlist as the SEO tracking scripts. Layout JSON is normalised on load: unknown blocks, settings and containers are dropped, colours must be colours, and links must be `http(s)`, site-relative, `mailto:` or `tel:`.

On `npm start`, `server/seo.mjs` writes Custom CSS (plus Comments CSS), the `<head>` code and the footer scripts into the HTML, with `<meta name="rwp-theme">` so the browser does not add the scripts again. The CSS goes just before `</head>`, after the app's stylesheet, so your rules win at equal specificity. On Vercel and `npm run dev` the browser adds them after loading. None of it runs on `/admin` or `/builder/…`.

**Targeting things with CSS.** Build classes are hashed, so Custom CSS should use the stable hooks: `.rwp-site`, `.rwp-header`, `.rwp-nav`, `.rwp-brand`, `.rwp-header-actions`, `.rwp-footer`, `.rwp-footer-columns`, `.rwp-sidebar`, `.rwp-index`, `.rwp-hero`, `.rwp-posts-feed`, `.rwp-post-card`, `.rwp-comments`, `.rwp-comment`, and `.rwpt-block-<block type>` on every block.

**Deliberately not included.** Sidebar code is HTML, not JSX: saved text cannot run React components without shipping a compiler to every visitor and executing arbitrary code, but shortcodes provide the same thing safely. Comments CSS can restyle comments, but there is no HTML template for them. Comment text is written by visitors, and saved HTML wrapped around it would be an unescaped template.

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
