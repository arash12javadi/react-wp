# React-WP

A WordPress-style CMS: React 19 + Vite SPA, Supabase (Postgres + Auth) as the whole backend, and a small Node server (`server.mjs`) for self-hosting. README.md explains each feature and why it was built that way — read it before changing anything.

## Commands

- `npm start` — build, then run `server.mjs` on :3000. This is how the site is actually hosted.
- `npm run dev` — Vite on :5173, proxying `/api` to :3000 (run `npm start` first).
- `npm run build` and `npm run lint` — the only automated checks. There is **no TypeScript compiler** configured (no `typescript` dep, no tsconfig); Vite strips types without checking them.
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

## Working with the owner

Changes are tested by hand in the browser against the live Supabase project, and the exact error text gets reported back. Error messages must name the real cause: a wrong diagnosis in an error string costs a debugging round.
