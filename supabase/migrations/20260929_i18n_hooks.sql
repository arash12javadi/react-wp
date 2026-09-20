-- Multilingual sites: the four language options, and per-locale page content.
--
-- - public.options gains default_site_language, default_admin_language,
--   show_header_language_switcher and supported_languages. They live in `options` rather than
--   inside the rwp_app_settings document because the public site reads them before anything
--   else loads (src/lib/i18n.ts), and because options is already publicly readable.
-- - public.pages gains locale, translation_group_id and builder_data_i18n, so one page can hold
--   a Page Builder layout per language (correct ordering and spacing for LTR and RTL) and so
--   translations of the same page can find each other.
--
-- Values are stored as plain text, like every other option: booleans are 'true'/'false' and
-- supported_languages is a JSON array in a text column. option_value is `text`, not jsonb.
--
-- Safe to re-run.

-- 1. Language options -----------------------------------------------------------------------
-- on conflict do nothing: re-running must never overwrite what an administrator has chosen.

insert into public.options (option_name, option_value) values
  ('default_site_language', 'en'),
  ('default_admin_language', 'en'),
  ('show_header_language_switcher', 'true'),
  ('supported_languages', '["en"]')
on conflict (option_name) do nothing;

-- The site's language, for column defaults below. Falls back to 'en' when the option is missing
-- or was hand-edited to something empty. Deliberately NOT revoked from anon/authenticated: it is
-- used as a column default, which runs as the inserting user, and it only reads a public option.
create or replace function public.rwp_default_locale()
returns varchar(10) language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(trim(lower((select option_value from public.options where option_name = 'default_site_language'))), ''),
    'en'
  )::varchar(10);
$$;

-- 2. Per-language page content ---------------------------------------------------------------

alter table public.pages add column if not exists locale varchar(10);
alter table public.pages add column if not exists translation_group_id uuid;
alter table public.pages add column if not exists builder_data_i18n jsonb not null default '{}'::jsonb;

-- Existing rows predate multilingual support, so they are in whatever the site default is.
update public.pages set locale = public.rwp_default_locale() where locale is null;

-- Set after the backfill, so the default applies to new rows only.
alter table public.pages alter column locale set default public.rwp_default_locale();

-- A language tag, not free text: 'fa', 'en', 'pt-br'. Kept loose enough for regional codes.
alter table public.pages drop constraint if exists pages_locale_format;
alter table public.pages add constraint pages_locale_format
  check (locale is null or locale ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})?$');

-- builder_data_i18n maps a locale code to a builder document:
--   { "fa": { "version": 1, "settings": {…}, "content": […] } }
-- builder_data stays the layout for the page's own locale, so every existing page, every
-- renderer and every backup keeps working unchanged.
alter table public.pages drop constraint if exists pages_builder_data_i18n_object;
alter table public.pages add constraint pages_builder_data_i18n_object
  check (builder_data_i18n is null or jsonb_typeof(builder_data_i18n) = 'object');

create index if not exists pages_locale_idx on public.pages (locale);
create index if not exists pages_translation_group_idx on public.pages (translation_group_id)
  where translation_group_id is not null;

-- 3. Translation groups -----------------------------------------------------------------------
-- Two rows are translations of each other when they share a translation_group_id. The same
-- language must not appear twice in one group, or nothing could decide which row to show.

create unique index if not exists pages_translation_group_locale_key
  on public.pages (translation_group_id, locale)
  where translation_group_id is not null;

/*
 * Links p_page into the same translation group as p_translation_of, creating the group if the
 * other page has none yet. SECURITY INVOKER: the caller's own RLS decides whether they may
 * update both rows, exactly as a normal edit would.
 */
create or replace function public.rwp_link_translation(p_page bigint, p_translation_of bigint)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_group uuid;
  v_locale varchar(10);
  v_other_locale varchar(10);
begin
  if p_page = p_translation_of then
    raise exception 'A page cannot be a translation of itself.';
  end if;

  select locale, translation_group_id into v_locale, v_group from public.pages where id = p_page;
  if not found then
    raise exception 'Page % was not found, or your role cannot see it.', p_page;
  end if;

  select locale, coalesce(translation_group_id, v_group) into v_other_locale, v_group
  from public.pages where id = p_translation_of;
  if not found then
    raise exception 'Page % was not found, or your role cannot see it.', p_translation_of;
  end if;

  if v_locale is not distinct from v_other_locale then
    raise exception 'Both pages are in the same language (%), so neither is a translation of the other.', v_locale;
  end if;

  v_group := coalesce(v_group, gen_random_uuid());

  update public.pages set translation_group_id = v_group, updated_at = now()
  where id in (p_page, p_translation_of);

  -- An update RLS refused changes no rows and raises nothing, so it has to be checked.
  if not exists (select 1 from public.pages where id = p_page and translation_group_id = v_group) then
    raise exception 'The pages were not linked: your role cannot edit one of them.';
  end if;

  return v_group;
end;
$$;

revoke execute on function public.rwp_link_translation(bigint, bigint) from public, anon;
grant execute on function public.rwp_link_translation(bigint, bigint) to authenticated;

-- 4. Reload -------------------------------------------------------------------------------------
-- Without this PostgREST keeps serving the old column list and every new column reads as missing.

notify pgrst, 'reload schema';
