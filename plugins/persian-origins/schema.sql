-- persian-origins: bilingual content. Run on activation by POST /api/admin/plugins/install-schema,
-- or by hand in the Supabase SQL Editor. Safe to re-run.
--
-- Depends on core only (pages, categories, profiles, options, user_has_cap). Category names and
-- descriptions in other languages are deliberately NOT stored here: they are core translation
-- keys (category.<slug>.name / .description in rwp_translations), so core's own category widget
-- and archive titles show them too, and there is one place to edit them.
--
-- Per-language page fields are a table of their own rather than columns on public.pages. A plugin
-- column on a core table would be dropped by an uninstall wipe without being in the backup file,
-- because the uninstall backup exports only the tables a plugin declares.

-- Per-language title, excerpt and content of a page or post ----------------------------------------
-- The row's own title/excerpt/content stay the base language (pages.locale, else the site default).
-- A language without a row here falls back to them.

create table if not exists public.po_content_translations (
  id uuid primary key default gen_random_uuid(),
  page_id bigint not null references public.pages(id) on delete cascade,
  locale varchar(10) not null,
  title text not null default '',
  excerpt text not null default '',
  content text not null default '',
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

create unique index if not exists po_content_translations_page_locale_key
  on public.po_content_translations (page_id, locale);

alter table public.po_content_translations drop constraint if exists po_content_translations_locale_format;
alter table public.po_content_translations add constraint po_content_translations_locale_format
  check (locale ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})?$');

alter table public.po_content_translations drop constraint if exists po_content_translations_lengths;
alter table public.po_content_translations add constraint po_content_translations_lengths
  check (char_length(title) <= 500 and char_length(excerpt) <= 5000 and char_length(content) <= 1000000);

create or replace function public.po_content_translations_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := timezone('utc'::text, now());
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists po_content_translations_touch on public.po_content_translations;
create trigger po_content_translations_touch
  before update on public.po_content_translations
  for each row execute function public.po_content_translations_touch();

alter table public.po_content_translations enable row level security;

-- Visible exactly when the page is: the subquery runs under the caller's own RLS on pages, so a
-- draft's translation is as private as the draft.
drop policy if exists "Translations are visible with their page" on public.po_content_translations;
create policy "Translations are visible with their page"
  on public.po_content_translations for select to anon, authenticated
  using (exists (select 1 from public.pages p where p.id = page_id));

-- Writing a translation is editing the page, so it mirrors "Authors edit own content, editors
-- edit all" on pages, including its rule that only publish_posts may change published content.
drop policy if exists "Page editors write translations" on public.po_content_translations;
create policy "Page editors write translations"
  on public.po_content_translations for all to authenticated
  using (exists (
    select 1 from public.pages p
    where p.id = page_id
      and ((p.author_id = auth.uid() and public.user_has_cap('edit_posts')) or public.user_has_cap('edit_others_posts'))
      and (p.status in ('draft', 'trash') or public.user_has_cap('publish_posts'))
  ))
  with check (exists (
    select 1 from public.pages p
    where p.id = page_id
      and ((p.author_id = auth.uid() and public.user_has_cap('edit_posts')) or public.user_has_cap('edit_others_posts'))
      and (p.status in ('draft', 'trash') or public.user_has_cap('publish_posts'))
  ));

grant select on table public.po_content_translations to anon, authenticated;
grant insert, update, delete on table public.po_content_translations to authenticated;
revoke insert, update, delete on table public.po_content_translations from anon;

-- Category images and order for [po_categories] ------------------------------------------------------

create table if not exists public.po_category_meta (
  category_id uuid primary key references public.categories(id) on delete cascade,
  image_url text,
  sort_order integer not null default 0,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.po_category_meta drop constraint if exists po_category_meta_image_url;
alter table public.po_category_meta add constraint po_category_meta_image_url
  check (image_url is null or (image_url ~ '^https?://' and char_length(image_url) <= 2000));

alter table public.po_category_meta drop constraint if exists po_category_meta_sort_order;
alter table public.po_category_meta add constraint po_category_meta_sort_order
  check (sort_order between -10000 and 10000);

create or replace function public.po_category_meta_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists po_category_meta_touch on public.po_category_meta;
create trigger po_category_meta_touch
  before update on public.po_category_meta
  for each row execute function public.po_category_meta_touch();

alter table public.po_category_meta enable row level security;

drop policy if exists "Everyone reads category meta" on public.po_category_meta;
create policy "Everyone reads category meta"
  on public.po_category_meta for select to anon, authenticated using (true);

-- The same capability that edits categories themselves.
drop policy if exists "Category managers write category meta" on public.po_category_meta;
create policy "Category managers write category meta"
  on public.po_category_meta for all to authenticated
  using (public.user_has_cap('manage_categories'))
  with check (public.user_has_cap('manage_categories'));

grant select on table public.po_category_meta to anon, authenticated;
grant insert, update, delete on table public.po_category_meta to authenticated;
revoke insert, update, delete on table public.po_category_meta from anon;

-- A signed-in visitor's language, theme, fonts and text size, so they follow them to another
-- browser. Guests keep them in cookies and localStorage only.

create table if not exists public.po_user_preferences (
  user_id uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.po_user_preferences drop constraint if exists po_user_preferences_shape;
alter table public.po_user_preferences add constraint po_user_preferences_shape
  check (jsonb_typeof(preferences) = 'object' and pg_column_size(preferences) <= 4096);

alter table public.po_user_preferences enable row level security;

drop policy if exists "People manage their own display preferences" on public.po_user_preferences;
create policy "People manage their own display preferences"
  on public.po_user_preferences for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on table public.po_user_preferences from anon;
grant select, insert, update, delete on table public.po_user_preferences to authenticated;

-- Settings (Persian Origins → Appearance). on conflict do nothing: a re-run never resets them.
insert into public.options (option_name, option_value) values (
  'po_settings',
  '{"languages":["en","fa"],"floating_switch":false,"floating_settings":false,"header_switch":false,"default_theme":"light","default_fonts":{}}'
)
on conflict (option_name) do nothing;

notify pgrst, 'reload schema';
