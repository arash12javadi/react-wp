-- Translations (Settings -> Translations). Safe to re-run.
--
-- Interface strings an administrator can edit from the dashboard. t() in src/lib/i18n.ts looks
-- these up before core's bundled dictionaries (src/lib/locales) and before any plugin's
-- registerPluginTranslations(), so a row here changes the wording of any key on the public site,
-- in the admin, in shortcodes and in Page Builder widgets without a code change.
--
-- One row per (translation_key, locale). translation_value is null for a key that was only
-- discovered (see rwp_report_missing_translations below) and still waits for a translation;
-- those rows are never applied, so discovering a key cannot change what visitors see.
-- source_text is the text the code fell back to when the key was discovered, shown to the
-- translator as the original.
--
-- Writes need manage_options, like the rest of Settings. The strings are rendered as text by
-- React, never as HTML, so a translation cannot inject markup.

-- Table -------------------------------------------------------------------------------------------

create table if not exists public.rwp_translations (
  id uuid primary key default gen_random_uuid(),
  translation_key text not null,
  locale varchar(10) not null,
  translation_value text,
  source_text text,
  group_name varchar(50) not null default 'general',
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- A key is unique per language, not on its own: 'header.login' has one row for fa, one for ar.
-- Also what upsert's on_conflict=translation_key,locale resolves against.
create unique index if not exists rwp_translations_key_locale_key
  on public.rwp_translations (translation_key, locale);

-- What the public site loads on every visit: the applied strings of one or a few languages.
create index if not exists rwp_translations_locale_idx
  on public.rwp_translations (locale) where translation_value is not null;

-- Same shape as core's keys ('header.login') and plugin keys ('rwp-shop.cart', 'shop:cart').
alter table public.rwp_translations drop constraint if exists rwp_translations_key_format;
alter table public.rwp_translations add constraint rwp_translations_key_format
  check (translation_key ~ '^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,190}$');

-- The same language-tag rule as pages.locale.
alter table public.rwp_translations drop constraint if exists rwp_translations_locale_format;
alter table public.rwp_translations add constraint rwp_translations_locale_format
  check (locale ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})?$');

alter table public.rwp_translations drop constraint if exists rwp_translations_group_format;
alter table public.rwp_translations add constraint rwp_translations_group_format
  check (group_name ~ '^[a-z0-9_-]{1,50}$');

alter table public.rwp_translations drop constraint if exists rwp_translations_lengths;
alter table public.rwp_translations add constraint rwp_translations_lengths
  check (char_length(coalesce(translation_value, '')) <= 10000 and char_length(coalesce(source_text, '')) <= 2000);

create or replace function public.rwp_translations_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := timezone('utc'::text, now());
  -- Kept when there is no signed-in user (a discovery report never updates, but a service call might).
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists rwp_translations_touch on public.rwp_translations;
create trigger rwp_translations_touch
  before update on public.rwp_translations
  for each row execute function public.rwp_translations_touch();

-- Policies ----------------------------------------------------------------------------------------

alter table public.rwp_translations enable row level security;

-- Visitors need the applied strings. Discovered-but-untranslated rows are only for the admin.
drop policy if exists "Everyone reads translations" on public.rwp_translations;
create policy "Everyone reads translations"
  on public.rwp_translations for select to anon, authenticated
  using (translation_value is not null or public.user_has_cap('manage_options'));

drop policy if exists "Settings managers manage translations" on public.rwp_translations;
create policy "Settings managers manage translations"
  on public.rwp_translations for all to authenticated
  using (public.user_has_cap('manage_options'))
  with check (public.user_has_cap('manage_options'));

grant select on table public.rwp_translations to anon, authenticated;
grant insert, update, delete on table public.rwp_translations to authenticated;
revoke insert, update, delete on table public.rwp_translations from anon;

-- Missing-key discovery ---------------------------------------------------------------------------
-- Off by default. When the translation_auto_discovery option is 'true', the browser reports keys
-- t() could not find for the active language, and they appear under Settings -> Translations as
-- untranslated rows. on conflict do nothing: re-running never overrides an administrator's choice.

insert into public.options (option_name, option_value) values ('translation_auto_discovery', 'false')
on conflict (option_name) do nothing;

-- Callable by anon on purpose: visitors are the ones who hit untranslated text. What bounds it:
--   * it does nothing unless an administrator turned discovery on, checked here, not in the browser;
--   * only languages the site offers, only well-formed keys, at most 50 keys per call;
--   * it only inserts untranslated rows (translation_value stays null, so nothing a visitor sees
--     changes) and never updates one;
--   * at most 2000 untranslated rows exist at any time, so a flood of made-up keys stops there.
-- Returns how many keys were new.
create or replace function public.rwp_report_missing_translations(p_locale text, p_items jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_locale text := lower(trim(coalesce(p_locale, '')));
  v_raw text;
  v_supported text[];
  v_room integer;
  v_added integer;
begin
  if coalesce((select option_value from public.options where option_name = 'translation_auto_discovery'), 'false') <> 'true' then
    return 0;
  end if;
  if v_locale !~ '^[a-z]{2,3}(-[a-z0-9]{2,8})?$' then
    raise exception using errcode = '22023', message = format('"%s" is not a language code.', p_locale);
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Missing translation keys must be sent as a JSON array.';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception using errcode = '22023', message = 'At most 50 missing translation keys can be reported at once.';
  end if;

  -- supported_languages is a JSON array in a text column, or a comma list when edited by hand.
  select option_value into v_raw from public.options where option_name = 'supported_languages';
  begin
    v_supported := array(select lower(trim(value)) from jsonb_array_elements_text(coalesce(v_raw, '[]')::jsonb));
  exception when others then
    v_supported := array(select lower(trim(both '"[] ' from part)) from unnest(string_to_array(coalesce(v_raw, ''), ',')) part);
  end;
  v_supported := v_supported || array(
    select lower(trim(option_value)) from public.options
    where option_name in ('default_site_language', 'default_admin_language')
  ) || array['en'];
  -- A visitor with a language the site no longer offers is not an error worth showing.
  if not (v_locale = any(v_supported)) then
    return 0;
  end if;

  v_room := 2000 - (select count(*) from public.rwp_translations where translation_value is null)::integer;
  if v_room <= 0 then
    return 0;
  end if;

  insert into public.rwp_translations (translation_key, locale, source_text, group_name)
  select item.key, v_locale, item.source, item.grp
  from (
    select distinct on (trim(i ->> 'key'))
      trim(i ->> 'key') as key,
      nullif(left(i ->> 'source', 2000), '') as source,
      case when i ->> 'group' in ('frontend', 'admin') then i ->> 'group' else 'general' end as grp
    from jsonb_array_elements(p_items) i
    where jsonb_typeof(i) = 'object'
  ) item
  -- A malformed key is a bug in some component, not the visitor's fault: skipped, not raised.
  where item.key ~ '^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,190}$'
  limit v_room
  on conflict (translation_key, locale) do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

revoke execute on function public.rwp_report_missing_translations(text, jsonb) from public;
grant execute on function public.rwp_report_missing_translations(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
