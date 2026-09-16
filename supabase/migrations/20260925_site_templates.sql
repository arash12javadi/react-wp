-- Page builder: site templates (Page Builder -> Templates) and default content.
-- Safe to re-run: guarded column renames, "if not exists" columns and index, drop-then-add
-- constraint, "drop ... if exists" before triggers and replaced functions, "create or replace",
-- revoke and grant. Supersedes 20260924_shop_page_layouts.sql (its rows are kept); running this
-- one alone is enough.
--
-- A site template is a pages row flagged is_site_template, with template_type naming what it
-- replaces: the header, footer, single post, standard page, 404, search results, archives (one
-- shared layout plus optional category/author/date overrides) and the six shop screens. One row per
-- type. The public site uses a template only while it is published and builder-enabled.
--
-- Templates change every page, so builder_guard_site_template() lets only manage_shop roles
-- (Administrator, Shop Manager; super_admin has every capability) create, edit or reassign them.
--
-- rwp_install_default_content() creates the starter pages and templates once per group ('site',
-- 'shop'), recorded in the rwp_default_content option, so deleted defaults are not recreated.

-- Columns: rename the 20260924 names when present, otherwise add ------------------------------------

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pages' and column_name = 'is_shop_page')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pages' and column_name = 'is_site_template') then
    alter table public.pages rename column is_shop_page to is_site_template;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pages' and column_name = 'shop_page_type')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pages' and column_name = 'template_type') then
    alter table public.pages rename column shop_page_type to template_type;
  end if;
end;
$$;

alter table public.pages add column if not exists is_site_template boolean not null default false;
alter table public.pages add column if not exists template_type varchar(50);

-- The 20260924 objects refer to the old column names.
drop trigger if exists builder_guard_shop_page on public.pages;
drop function if exists public.builder_guard_shop_page();
drop function if exists public.builder_create_shop_page(text, text, jsonb);
alter table public.pages drop constraint if exists pages_shop_page_type_check;
drop index if exists public.pages_shop_page_type_key;

create or replace function public.rwp_template_types()
returns text[] language sql immutable set search_path = public as $$
  select array[
    'header', 'footer', 'single_post', 'page', '404', 'search',
    'archive', 'archive_category', 'archive_author', 'archive_date',
    'shop', 'product', 'product_category', 'cart', 'checkout', 'my_account'
  ];
$$;

alter table public.pages drop constraint if exists pages_template_type_check;
alter table public.pages add constraint pages_template_type_check check (
  (not is_site_template and template_type is null)
  or (is_site_template and template_type = any(public.rwp_template_types()))
);

create unique index if not exists pages_template_type_key
  on public.pages (template_type) where template_type is not null;

-- Guard ----------------------------------------------------------------------------------------------

create or replace function public.builder_guard_site_template()
returns trigger language plpgsql set search_path = public as $$
begin
  -- The SQL Editor, service role and restores without a session are not restricted.
  if auth.uid() is null then
    return new;
  end if;
  if (new.is_site_template
      or (tg_op = 'UPDATE' and (old.is_site_template or old.template_type is distinct from new.template_type)))
     and not public.user_has_cap('manage_shop') then
    raise exception using
      errcode = '42501',
      message = 'Site templates (header, footer, single post, archives, shop screens…) can only be created or edited by Administrators and Shop Managers (the manage_shop capability).';
  end if;
  return new;
end;
$$;

drop trigger if exists builder_guard_site_template on public.pages;
create trigger builder_guard_site_template
  before insert or update on public.pages
  for each row execute function public.builder_guard_site_template();

-- Create one template -------------------------------------------------------------------------------

-- A free slug starting with p_base: p_base, p_base-2, p_base-3… (Invoker: sees only what the caller can.)
create or replace function public.rwp_free_slug(p_base text)
returns text language plpgsql stable set search_path = public as $$
declare
  v_slug text := p_base;
  v_n integer := 1;
begin
  while exists (select 1 from public.pages where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := p_base || '-' || v_n;
  end loop;
  return v_slug;
end;
$$;

-- Returns the type's page id, creating it the first time. Security invoker, so the insert goes
-- through the pages RLS (publishing needs publish_posts) and the guard trigger above.
create or replace function public.builder_create_site_template(p_type text, p_title text, p_builder_data jsonb, p_status text default 'draft')
returns bigint language plpgsql set search_path = public as $$
declare
  v_id bigint;
begin
  if p_type is null or not (p_type = any(public.rwp_template_types())) then
    raise exception using errcode = '22023', message = format('Unknown template type "%s".', p_type);
  end if;
  if coalesce(p_status, 'draft') not in ('draft', 'published') then
    raise exception using errcode = '22023', message = format('Unknown status "%s": use draft or published.', p_status);
  end if;
  if not public.user_has_cap('manage_shop') then
    raise exception using
      errcode = '42501',
      message = 'Creating a site template needs the manage_shop capability (Administrator or Shop Manager).';
  end if;

  select id into v_id from public.pages where template_type = p_type;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.pages (title, slug, status, is_site_template, template_type, builder_data, is_builder_enabled,
                            author_id, noindex, comments_open)
  values (coalesce(nullif(trim(p_title), ''), p_type), public.rwp_free_slug('template-' || replace(p_type, '_', '-')),
          coalesce(p_status, 'draft'), true, p_type,
          coalesce(p_builder_data, '{"version":1,"settings":{},"content":[]}'::jsonb), true,
          auth.uid(), true, false)
  on conflict (template_type) where template_type is not null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.pages where template_type = p_type;
  end if;
  return v_id;
end;
$$;

-- Default content -----------------------------------------------------------------------------------

-- p_items: [{ "key": "home", "title": "Home", "slug": "home", "template_type": null | "header",
--             "content": "<p>…</p>", "builder_data": {…} | null }]
-- Items whose slug or template type already exists are skipped. With p_reading, the created
-- "home" and "blog" items become the front page and posts page, but only when both are unset.
-- Returns { installed: bool, created: [{ key, id }] }.
create or replace function public.rwp_install_default_content(p_group text, p_items jsonb, p_reading boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_done jsonb;
  v_item jsonb;
  v_type text;
  v_slug text;
  v_id bigint;
  v_created jsonb := '[]'::jsonb;
  v_home bigint;
  v_blog bigint;
begin
  if p_group not in ('site', 'shop') then
    raise exception using errcode = '22023', message = format('Unknown default content group "%s".', p_group);
  end if;
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Installing default content needs a signed-in user.';
  end if;
  if p_group = 'site' and not public.user_has_cap('manage_options') then
    raise exception using errcode = '42501', message = 'Installing the default site pages needs an Administrator (manage_options).';
  end if;
  if not public.user_has_cap('manage_shop') then
    raise exception using errcode = '42501', message = 'Installing default templates needs an Administrator or Shop Manager (manage_shop).';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Default content items must be a JSON array.';
  end if;

  -- One install per group, even when two admins open the dashboard at once.
  perform pg_advisory_xact_lock(hashtext('rwp_install_default_content'));
  select coalesce((select option_value::jsonb from public.options where option_name = 'rwp_default_content'), '[]'::jsonb) into v_done;
  if v_done ? p_group then
    return jsonb_build_object('installed', false, 'created', '[]'::jsonb);
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_type := nullif(v_item ->> 'template_type', '');
    v_slug := nullif(trim(v_item ->> 'slug'), '');
    if v_type is not null and not (v_type = any(public.rwp_template_types())) then
      raise exception using errcode = '22023', message = format('Unknown template type "%s" in default content.', v_type);
    end if;
    if p_group = 'shop' and (v_type is null or v_type not in ('shop', 'product', 'product_category', 'cart', 'checkout', 'my_account')) then
      raise exception using errcode = '22023', message = 'The shop default content may only contain shop templates.';
    end if;
    if v_type is null and v_slug is null then
      raise exception using errcode = '22023', message = 'A default page needs a slug.';
    end if;
    if (v_type is not null and exists (select 1 from public.pages where template_type = v_type))
       or (v_type is null and exists (select 1 from public.pages where slug = v_slug)) then
      continue;
    end if;

    -- Runs as the definer, so the Custom HTML and template guards still see auth.uid() of the caller.
    insert into public.pages (title, slug, content, status, is_post, is_site_template, template_type,
                              builder_data, is_builder_enabled, author_id, noindex, comments_open)
    values (
      coalesce(nullif(trim(v_item ->> 'title'), ''), coalesce(v_type, v_slug)),
      case when v_type is not null then public.rwp_free_slug('template-' || replace(v_type, '_', '-')) else v_slug end,
      coalesce(v_item ->> 'content', ''),
      'published', false, v_type is not null, v_type,
      case when jsonb_typeof(v_item -> 'builder_data') = 'object' then v_item -> 'builder_data' else null end,
      jsonb_typeof(v_item -> 'builder_data') = 'object',
      auth.uid(), v_type is not null, false
    )
    returning id into v_id;
    v_created := v_created || jsonb_build_object('key', v_item ->> 'key', 'id', v_id);
    if v_item ->> 'key' = 'home' then v_home := v_id; end if;
    if v_item ->> 'key' = 'blog' then v_blog := v_id; end if;
  end loop;

  if p_reading and v_home is not null and v_blog is not null
     and coalesce((select option_value from public.options where option_name = 'home_page_id'), '') = ''
     and coalesce((select option_value from public.options where option_name = 'posts_page_id'), '') = '' then
    insert into public.options (option_name, option_value) values ('home_page_id', v_home::text)
      on conflict (option_name) do update set option_value = excluded.option_value;
    insert into public.options (option_name, option_value) values ('posts_page_id', v_blog::text)
      on conflict (option_name) do update set option_value = excluded.option_value;
  end if;

  insert into public.options (option_name, option_value) values ('rwp_default_content', (v_done || to_jsonb(p_group))::text)
    on conflict (option_name) do update set option_value = excluded.option_value;

  return jsonb_build_object('installed', true, 'created', v_created);
end;
$$;

revoke execute on function public.builder_guard_site_template() from public, anon, authenticated;
revoke execute on function public.rwp_free_slug(text) from public, anon;
grant execute on function public.rwp_free_slug(text) to authenticated;
revoke execute on function public.builder_create_site_template(text, text, jsonb, text) from public, anon;
revoke execute on function public.rwp_install_default_content(text, jsonb, boolean) from public, anon;
grant execute on function public.builder_create_site_template(text, text, jsonb, text) to authenticated;
grant execute on function public.rwp_install_default_content(text, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
