-- Page builder: Shop Pages (Page Builder -> Shop Pages).
-- SUPERSEDED by 20260925_site_templates.sql, which renames these columns and replaces these
-- functions. New installs can skip this file; running it before 20260925 is also fine.
-- Safe to re-run: "if not exists" columns and index, drop-then-add constraint, "create or replace"
-- functions, "drop trigger if exists" before the trigger, revoke and grant.
--
-- A shop layout is an ordinary pages row flagged is_shop_page, with shop_page_type naming the
-- store screen it replaces. The partial unique index reserves one row per slot. Rows are created
-- from the admin through builder_create_shop_page(), so they get a real author and the RLS of
-- pages still applies. The storefront uses a layout only while it is published and builder-enabled;
-- otherwise the built-in React screen is shown.
--
-- Changing which screen a store shows is a shop decision, so builder_guard_shop_page() lets only
-- manage_shop (Shop Manager, Administrator) create, edit or reassign shop layouts. Editors can
-- still edit site pages. Prices, stock and payments are unaffected: the Cart and Checkout widgets
-- embed the real screens, which call shop_calculate / shop_place_order as before.

alter table public.pages add column if not exists is_shop_page boolean not null default false;
alter table public.pages add column if not exists shop_page_type varchar(50);

alter table public.pages drop constraint if exists pages_shop_page_type_check;
alter table public.pages add constraint pages_shop_page_type_check check (
  (not is_shop_page and shop_page_type is null)
  or (is_shop_page and shop_page_type in ('shop', 'product', 'product_category', 'cart', 'checkout', 'my_account'))
);

create unique index if not exists pages_shop_page_type_key
  on public.pages (shop_page_type) where shop_page_type is not null;

create or replace function public.builder_guard_shop_page()
returns trigger language plpgsql set search_path = public as $$
begin
  -- The SQL Editor, service role and backups restored without a session are not restricted.
  if auth.uid() is null then
    return new;
  end if;
  if (new.is_shop_page
      or (tg_op = 'UPDATE' and (old.is_shop_page or old.shop_page_type is distinct from new.shop_page_type)))
     and not public.user_has_cap('manage_shop') then
    raise exception using
      errcode = '42501',
      message = 'Shop page layouts can only be created or edited by roles with the manage_shop capability (Shop Manager or Administrator).';
  end if;
  return new;
end;
$$;

drop trigger if exists builder_guard_shop_page on public.pages;
create trigger builder_guard_shop_page
  before insert or update on public.pages
  for each row execute function public.builder_guard_shop_page();

-- Returns the slot's page id, creating a draft layout the first time. Security invoker, so the
-- insert goes through the pages RLS and the guard trigger above.
create or replace function public.builder_create_shop_page(p_type text, p_title text, p_builder_data jsonb)
returns bigint language plpgsql set search_path = public as $$
declare
  v_id bigint;
  v_base text;
  v_slug text;
  v_n integer := 1;
begin
  if p_type is null or p_type not in ('shop', 'product', 'product_category', 'cart', 'checkout', 'my_account') then
    raise exception using errcode = '22023', message = format('Unknown shop page type "%s".', p_type);
  end if;
  if not public.user_has_cap('manage_shop') then
    raise exception using
      errcode = '42501',
      message = 'Creating a shop page layout needs the manage_shop capability (Shop Manager or Administrator).';
  end if;

  select id into v_id from public.pages where shop_page_type = p_type;
  if v_id is not null then
    return v_id;
  end if;

  v_base := 'shop-layout-' || replace(p_type, '_', '-');
  v_slug := v_base;
  while exists (select 1 from public.pages where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  insert into public.pages (title, slug, status, is_shop_page, shop_page_type, builder_data, is_builder_enabled,
                            author_id, noindex, comments_open)
  values (coalesce(nullif(trim(p_title), ''), v_base), v_slug, 'draft', true, p_type,
          coalesce(p_builder_data, '{"version":1,"settings":{},"content":[]}'::jsonb), true,
          auth.uid(), true, false)
  on conflict (shop_page_type) where shop_page_type is not null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.pages where shop_page_type = p_type;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.builder_guard_shop_page() from public, anon, authenticated;
revoke execute on function public.builder_create_shop_page(text, text, jsonb) from public, anon;
grant execute on function public.builder_create_shop_page(text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
