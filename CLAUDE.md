# React-WP

A WordPress-style CMS: React 19 + Vite SPA, Supabase (Postgres + Auth) as the whole backend, and a small Node server (`server.mjs`) for self-hosting. README.md explains each feature and why it was built that way — read it before changing anything.

## Commands

- `npm start` — build, then run `server.mjs` on :3000. This is how the site is actually hosted.
- `npm run dev` — Vite on :5173, proxying `/api` to :3000 (run `npm start` first).
- `npm run build` and `npm run lint` — the only automated checks. There is **no TypeScript compiler** configured (no `typescript` dep, no tsconfig); Vite strips types without checking them. ESLint only covers `.js/.jsx`, so `.ts/.tsx` files are not linted either.
- `git` is not on the shell PATH. Use `C:\Users\arash\AppData\Local\GitHubDesktop\app-3.6.5\resources\app\git\cmd\git.exe`.

## Database migrations

Migrations in `supabase/migrations/` are **run by hand in the Supabase SQL Editor**; the app cannot apply them. `supabase/schema.sql` is the canonical fresh-install schema and must be kept in sync with every migration.

Every migration must be safely re-runnable, because partial failures get re-run:

- `drop policy if exists` for the **new** policy name, not only the one being replaced, before every `create policy`.
- `drop trigger if exists` before every `create trigger` (Postgres has no `if not exists` for triggers).
- `if not exists` on tables, columns and indexes.
- End with `notify pgrst, 'reload schema';` or PostgREST won't see new columns.

Audit that programmatically before handing a migration over. Getting this wrong has broken reruns twice.

## Things that are not obvious from the code

- **Roles live in `public.profiles`, not `user_metadata`** (users can rewrite their own metadata). The capability map is duplicated: `src/lib/roles.ts` drives the UI, `public.user_has_cap()` drives RLS. Change both or neither.
- **New accounts get their role from the `default_user_role` option**, applied by the `handle_new_user` trigger. Never read a role from the signup payload. Administrator and super_admin are refused on purpose.
- **An RLS-blocked UPDATE returns no error and affects zero rows.** Use `.select()` and check the returned rows before reporting success.
- **Supabase errors are plain objects, not `Error`s.** Use `describeDbError` from `src/lib/db.ts`; `instanceof Error` checks swallow them.
- **PostgREST embeds need a real FK to the embedded table.** `comments.author_id` references `profiles`, not `auth.users`, for this reason.
- **`server.mjs` loads `.env.local` itself** via `server/env.mjs`, which must stay the first import (ESM hoists imports, and other modules read `process.env` at load time). Secrets: `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `IMAGEKIT_PRIVATE_KEY`.
- **SEO tags are written twice on purpose:** server-side in `server/seo.mjs` (what social crawlers read) and client-side in `src/lib/seo.ts`. This does not work on Vercel.
- **Content renders through `ContentRenderer`**, which portals shortcode components (e.g. `[rwp_login]`) into the sanitized HTML. Don't go back to raw `dangerouslySetInnerHTML`.
- **The TipTap editor (`ClassicEditor.tsx`)** syncs external values by comparing against the last HTML it emitted, because TipTap normalises HTML. Don't wrap it in a `<label>`: labels forward clicks to the toolbar `<select>`. Its CSS is scoped under `.editor` so parent form styles can't override it.
- Cloudinary uploads are unsigned (no secret needed); deletes are signed and go through `/api/media-delete`.
- **Plugins can own public routes, header items and server routes** (`routes.register`, `header.register`, `plugins/<id>/server.mjs`). Server modules must be imported by hand in `server/plugins.mjs`, or Vercel won't bundle them.
- **Shop (`plugins/rwp-shop`) prices, tax, shipping, coupons and stock are computed in SQL** (`shop_calculate`, `shop_place_order`). Never trust an amount from the browser. `shop_mark_order_paid`, `shop_claim_order_email` and `shop_set_gateway_data` are granted to `service_role` only; the server calls them with `SUPABASE_SECRET_KEY` after verifying the payment with the gateway.
- **Page builder (`plugins/rwp-page-builder`)**: the layout JSON lives in `pages.builder_data`, which anyone can read for a published page. So form email recipients are edited as `settings.private_*` on the widget but stripped on save into `builder_form_settings` (`stripPrivate` in `lib/api.ts`); keep that when adding private widget settings. Custom HTML is admin-only via the `builder_guard_html` trigger, not the UI. Widget styles are generated from JSON by `render/generateCss.ts` and target global `rwpb-*` classes in `render/builder.css`, so those class names must stay unhashed (not CSS modules). The editor canvas renders the real widget views; editor-only behaviour is injected through `EditorBridge` in `render/context.tsx`, so the public bundle never imports editor code.
- **Content renderers and actions** (`content.registerRenderer` / `registerAction` in `src/lib/rwp.tsx`) let a plugin replace a page's public body and add links to Pages & Posts.
- **App Settings (`src/lib/appSettings.ts`) are one JSON document in the public `rwp_app_settings` option**, read in SQL by `rwp_app_settings()`. Role grants in it are applied by both `applyCapabilityGrants` (`roles.ts`) and `user_has_cap()`; media scoping by `rwp_can_manage_media()`; upload limits by the `media_enforce_upload_rules` trigger. Rename a key and all of those break silently. Anything private (quota overrides, keyed by email) goes in its own table, never that option.
- **`media_enforce_upload_rules` overwrites `uploaded_by`, `bytes`, `width` and `height`** (pinned on insert, frozen on update) for any caller with `auth.uid()`. Don't write code that expects to change them from the browser.
- **`/api/media-delete` takes only the media row `id`** and reads the provider id from the database. Never go back to trusting a provider id from the request body.
- **Tracking scripts are injected twice on purpose, but only run once**: `server/seo.mjs` writes them plus `<meta name="rwp-scripts">`, and `injectTrackingScripts` skips when that marker exists. Both use `src/lib/scriptSanitizer.js`, plain JS so Node can import it.
- **New `public` functions are executable by anon by default** (Supabase default privileges). Internal SECURITY DEFINER helpers must `revoke execute ... from public, anon, authenticated`.
- There is no local database, but SQL can be exercised in PGlite (`@electric-sql/pglite` with the `pgcrypto` contrib) with small stubs for `auth.uid()` and the anon/authenticated/service_role roles.

## Working with the owner

Changes are tested by hand in the browser against the live Supabase project, and the exact error text gets reported back. Error messages must name the real cause: a wrong diagnosis in an error string costs a debugging round.
