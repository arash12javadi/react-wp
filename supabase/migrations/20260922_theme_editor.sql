-- Appearance → Theme Editor. Safe to re-run.
--
-- One row holds the whole theme: the block layout of the header, footer, sidebar, comments and
-- home/archive index (layout_structure), plus the raw code from each area's Code mode.
--
-- Everything here is rendered into public pages, so anyone may read it. Only manage_options
-- (administrators) may write it, because the code fields run in every visitor's browser,
-- including an administrator's: a lower role able to save a <script> could take over an
-- admin session.
--
-- Columns beyond the original spec, because each needs different sanitising:
--   custom_header_code   <head> tags only (script, noscript, link, meta), via scriptSanitizer.js
--   custom_header_html   markup shown in the header, via ContentRenderer's sanitizer
--   custom_footer_code   scripts added at the end of <body> (same allowlist as the <head> code)
--   custom_footer_html   markup shown in the footer
--   custom_sidebar_code  markup shown in the sidebar
--   custom_comments_css  CSS for the comments area, appended after custom_css

create table if not exists public.theme_settings (
  id uuid primary key default gen_random_uuid(),
  active_theme text not null default 'default',
  layout_structure jsonb not null default '{}'::jsonb,
  custom_header_code text not null default '',
  custom_footer_code text not null default '',
  custom_sidebar_code text not null default '',
  custom_css text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.theme_settings add column if not exists singleton boolean not null default true;
alter table public.theme_settings add column if not exists custom_header_html text not null default '';
alter table public.theme_settings add column if not exists custom_footer_html text not null default '';
alter table public.theme_settings add column if not exists custom_comments_css text not null default '';

-- Exactly one row: the theme is site-wide, and the app reads "the" row with limit 1.
alter table public.theme_settings drop constraint if exists theme_settings_singleton_check;
alter table public.theme_settings add constraint theme_settings_singleton_check check (singleton);
create unique index if not exists theme_settings_singleton_idx on public.theme_settings (singleton);

alter table public.theme_settings drop constraint if exists theme_settings_active_theme_check;
alter table public.theme_settings add constraint theme_settings_active_theme_check
  check (active_theme ~ '^[a-z0-9-]{1,64}$');

alter table public.theme_settings drop constraint if exists theme_settings_layout_check;
alter table public.theme_settings add constraint theme_settings_layout_check
  check (jsonb_typeof(layout_structure) = 'object' and pg_column_size(layout_structure) <= 512000);

-- Limits the size of every page response, since all of this is sent to every visitor.
alter table public.theme_settings drop constraint if exists theme_settings_code_length_check;
alter table public.theme_settings add constraint theme_settings_code_length_check check (
  char_length(custom_header_code) <= 100000
  and char_length(custom_header_html) <= 100000
  and char_length(custom_footer_code) <= 100000
  and char_length(custom_footer_html) <= 100000
  and char_length(custom_sidebar_code) <= 100000
  and char_length(custom_comments_css) <= 100000
  and char_length(custom_css) <= 200000
);

-- The editor saves with "where updated_at = <what I loaded>", so two administrators editing at
-- once get a conflict instead of silently overwriting each other. That needs the database, not
-- the browser, to set the timestamp.
create or replace function public.theme_settings_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists theme_settings_touch on public.theme_settings;
create trigger theme_settings_touch
  before update on public.theme_settings
  for each row execute function public.theme_settings_touch();

insert into public.theme_settings (singleton) values (true) on conflict (singleton) do nothing;

alter table public.theme_settings enable row level security;

drop policy if exists "Anyone can read the theme" on public.theme_settings;
create policy "Anyone can read the theme"
  on public.theme_settings for select to anon, authenticated
  using (true);

drop policy if exists "Settings managers can add the theme" on public.theme_settings;
create policy "Settings managers can add the theme"
  on public.theme_settings for insert to authenticated
  with check (public.user_has_cap('manage_options'));

drop policy if exists "Settings managers can update the theme" on public.theme_settings;
create policy "Settings managers can update the theme"
  on public.theme_settings for update to authenticated
  using (public.user_has_cap('manage_options'))
  with check (public.user_has_cap('manage_options'));

drop policy if exists "Settings managers can delete the theme" on public.theme_settings;
create policy "Settings managers can delete the theme"
  on public.theme_settings for delete to authenticated
  using (public.user_has_cap('manage_options'));

-- RLS already refuses anon writes; this makes it explicit.
revoke insert, update, delete on table public.theme_settings from anon;
grant select on table public.theme_settings to anon, authenticated;
grant insert, update, delete on table public.theme_settings to authenticated;

notify pgrst, 'reload schema';
