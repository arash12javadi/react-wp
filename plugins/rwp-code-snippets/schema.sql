-- rwp-code-snippets database schema.
-- Installed by the Plugins screen (POST /api/plugins/install-schema), never by
-- supabase/schema.sql. Safe to re-run.

-- Code Snippets & AI Developer Assistant (plugins/rwp-code-snippets). Safe to re-run.
--
-- One row per snippet of CSS, JavaScript, HTML or a React hook registration that the site
-- injects at runtime (src/core/SnippetInjector.tsx).
--
-- Who may write this table: manage_options only, for exactly the reason theme_settings gives.
-- Every active snippet runs in every visitor's browser, including a signed-in administrator's,
-- so a role that could save a <script> here could take over an administrator session. The
-- original draft of this table used `auth.role() = 'authenticated'`, which would have let any
-- subscriber who can sign up do that.
--
-- Who may read it: everyone, but only the active rows. The public site loads snippets with the
-- anon key before anyone signs in, so reads cannot be capability-gated. Inactive rows (drafts,
-- snippets being worked on) stay private to managers. Being readable is not the same as being
-- run: `location` decides where a snippet executes, and the reader is the site itself.

create table if not exists public.code_snippets (
  id uuid primary key default gen_random_uuid(),
  title varchar(255) not null,
  description text not null default '',
  snippet_type varchar(20) not null,
  code text not null,
  location varchar(30) not null default 'frontend',
  is_active boolean not null default false,
  priority integer not null default 10,
  tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Who saved it last, for the admin list. Never used in a policy: the capability decides.
alter table public.code_snippets add column if not exists created_by uuid;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'code_snippets_created_by_fkey' and conrelid = 'public.code_snippets'::regclass
  ) then
    alter table public.code_snippets
      add constraint code_snippets_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;
  end if;
end $$;

-- Constraints are dropped first: a re-run must be able to replace a definition that changed.
alter table public.code_snippets drop constraint if exists code_snippets_snippet_type_check;
alter table public.code_snippets add constraint code_snippets_snippet_type_check
  check (snippet_type in ('css', 'javascript', 'html', 'hook'));

alter table public.code_snippets drop constraint if exists code_snippets_location_check;
alter table public.code_snippets add constraint code_snippets_location_check
  check (location in ('head', 'footer', 'admin', 'frontend', 'everywhere'));

alter table public.code_snippets drop constraint if exists code_snippets_title_check;
alter table public.code_snippets add constraint code_snippets_title_check
  check (char_length(btrim(title)) between 1 and 255);

-- Every active snippet is sent to every visitor, so the size of a page response is bounded here.
alter table public.code_snippets drop constraint if exists code_snippets_code_length_check;
alter table public.code_snippets add constraint code_snippets_code_length_check
  check (char_length(code) <= 100000 and char_length(description) <= 5000);

alter table public.code_snippets drop constraint if exists code_snippets_priority_check;
alter table public.code_snippets add constraint code_snippets_priority_check
  check (priority between 0 and 1000);

-- A JSON array of strings, like the tag lists everywhere else in the app.
alter table public.code_snippets drop constraint if exists code_snippets_tags_array_check;
alter table public.code_snippets add constraint code_snippets_tags_array_check
  check (jsonb_typeof(tags) = 'array' and pg_column_size(tags) <= 8192);

-- The public site's only query: active rows for one surface, in priority order.
create index if not exists code_snippets_active_idx on public.code_snippets (is_active, location, priority);
create index if not exists code_snippets_type_idx on public.code_snippets (snippet_type);

-- The admin list sorts by updated_at and shows "edited 5 minutes ago", so the database sets it:
-- a browser clock that is wrong (or a client that simply forgets) would make that meaningless.
create or replace function public.code_snippets_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

-- Postgres has no "create trigger if not exists".
drop trigger if exists code_snippets_touch on public.code_snippets;
create trigger code_snippets_touch
  before insert or update on public.code_snippets
  for each row execute function public.code_snippets_touch();

alter table public.code_snippets enable row level security;

drop policy if exists "Allow admin full access to code_snippets" on public.code_snippets;

drop policy if exists "Anyone can read active snippets" on public.code_snippets;
create policy "Anyone can read active snippets"
  on public.code_snippets for select to anon
  using (is_active);

drop policy if exists "Signed-in users read active snippets, managers read all" on public.code_snippets;
create policy "Signed-in users read active snippets, managers read all"
  on public.code_snippets for select to authenticated
  using (is_active or public.user_has_cap('manage_options'));

drop policy if exists "Settings managers can add snippets" on public.code_snippets;
create policy "Settings managers can add snippets"
  on public.code_snippets for insert to authenticated
  with check (public.user_has_cap('manage_options'));

drop policy if exists "Settings managers can update snippets" on public.code_snippets;
create policy "Settings managers can update snippets"
  on public.code_snippets for update to authenticated
  using (public.user_has_cap('manage_options'))
  with check (public.user_has_cap('manage_options'));

drop policy if exists "Settings managers can delete snippets" on public.code_snippets;
create policy "Settings managers can delete snippets"
  on public.code_snippets for delete to authenticated
  using (public.user_has_cap('manage_options'));

-- RLS already refuses anon writes; this makes it explicit.
revoke insert, update, delete on table public.code_snippets from anon;
grant select on table public.code_snippets to anon, authenticated;
grant insert, update, delete on table public.code_snippets to authenticated;

-- Without this PostgREST keeps serving the old column list and every new column reads as missing.
notify pgrst, 'reload schema';
