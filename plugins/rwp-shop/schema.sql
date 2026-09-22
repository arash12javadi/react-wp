-- rwp-shop database schema.
-- Installed by the Plugins screen (POST /api/plugins/install-schema), never by
-- supabase/schema.sql. Safe to re-run: every object is "if not exists" or "or replace",
-- and every policy is dropped by its own name first.
--
-- Requires the core schema (profiles, options, pages, user_has_cap).

-- Shop plugin (rwp-shop) ------------------------------------------------------
-- Kept identical to supabase/migrations/20260917_shop_plugin.sql from this point on.

-- Shop managers edit shop settings (options named shop_*) without full site settings.
drop policy if exists "Shop managers can write shop options" on public.options;
create policy "Shop managers can write shop options"
  on public.options for all to authenticated
  using (option_name like 'shop\_%' and public.user_has_cap('manage_shop'))
  with check (option_name like 'shop\_%' and public.user_has_cap('manage_shop'));

-- Tables -----------------------------------------------------------------------

create table if not exists public.shop_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  parent_id uuid references public.shop_categories(id) on delete set null,
  description text not null default '',
  image_url text,
  menu_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.shop_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.shop_attributes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  order_by text not null default 'menu_order' check (order_by in ('menu_order', 'name')),
  created_at timestamptz not null default now()
);

create table if not exists public.shop_attribute_terms (
  id uuid primary key default gen_random_uuid(),
  attribute_id uuid not null references public.shop_attributes(id) on delete cascade,
  name text not null,
  slug text not null,
  menu_order integer not null default 0,
  unique (attribute_id, slug)
);

create table if not exists public.shop_shipping_classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  description text not null default ''
);

create table if not exists public.shop_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  type text not null default 'simple' check (type in ('simple', 'variable', 'grouped', 'external')),
  status text not null default 'draft' check (status in ('draft', 'pending', 'private', 'publish', 'trash')),
  featured boolean not null default false,
  catalog_visibility text not null default 'visible' check (catalog_visibility in ('visible', 'catalog', 'search', 'hidden')),
  description text not null default '',
  short_description text not null default '',
  sku text,
  regular_price numeric(18,4),
  sale_price numeric(18,4),
  sale_from timestamptz,
  sale_to timestamptz,
  tax_status text not null default 'taxable' check (tax_status in ('taxable', 'shipping', 'none')),
  tax_class text not null default 'standard',
  manage_stock boolean not null default false,
  stock_quantity integer,
  stock_status text not null default 'instock' check (stock_status in ('instock', 'outofstock', 'onbackorder')),
  backorders text not null default 'no' check (backorders in ('no', 'notify', 'yes')),
  low_stock_amount integer,
  sold_individually boolean not null default false,
  weight numeric(12,3),
  length numeric(12,3),
  width numeric(12,3),
  height numeric(12,3),
  shipping_class_id uuid references public.shop_shipping_classes(id) on delete set null,
  virtual boolean not null default false,
  downloadable boolean not null default false,
  download_limit integer,
  download_expiry_days integer,
  external_url text,
  button_text text,
  grouped_ids uuid[] not null default '{}',
  upsell_ids uuid[] not null default '{}',
  cross_sell_ids uuid[] not null default '{}',
  -- [{ "name": "Color", "attribute_id": uuid|null, "options": ["Red"], "visible": true, "variation": true }]
  attributes jsonb not null default '[]'::jsonb,
  default_attributes jsonb not null default '{}'::jsonb,
  image_url text,
  gallery jsonb not null default '[]'::jsonb,
  purchase_note text,
  reviews_allowed boolean not null default true,
  menu_order integer not null default 0,
  total_sales integer not null default 0,
  average_rating numeric(3,2) not null default 0,
  rating_count integer not null default 0,
  seo_title text,
  meta_description text,
  author_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 'trash' was added by 20260926_bulk_actions_trash.sql; older installs have the inline check without it.
alter table public.shop_products drop constraint if exists shop_products_status_check;
alter table public.shop_products
  add constraint shop_products_status_check check (status in ('draft', 'pending', 'private', 'publish', 'trash'));

create index if not exists shop_products_status_idx on public.shop_products(status);
create unique index if not exists shop_products_sku_idx on public.shop_products(sku) where sku is not null and sku <> '';

create table if not exists public.shop_product_categories (
  product_id uuid not null references public.shop_products(id) on delete cascade,
  category_id uuid not null references public.shop_categories(id) on delete cascade,
  primary key (product_id, category_id)
);

create table if not exists public.shop_product_tags (
  product_id uuid not null references public.shop_products(id) on delete cascade,
  tag_id uuid not null references public.shop_tags(id) on delete cascade,
  primary key (product_id, tag_id)
);

create table if not exists public.shop_variations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.shop_products(id) on delete cascade,
  -- { "Color": "Red", "Size": "" } Ã¢â‚¬â€ an empty value means "any".
  attributes jsonb not null default '{}'::jsonb,
  sku text,
  regular_price numeric(18,4),
  sale_price numeric(18,4),
  sale_from timestamptz,
  sale_to timestamptz,
  manage_stock boolean not null default false,
  stock_quantity integer,
  stock_status text not null default 'instock' check (stock_status in ('instock', 'outofstock', 'onbackorder')),
  backorders text not null default 'no' check (backorders in ('no', 'notify', 'yes')),
  weight numeric(12,3),
  length numeric(12,3),
  width numeric(12,3),
  height numeric(12,3),
  shipping_class_id uuid references public.shop_shipping_classes(id) on delete set null,
  -- null inherits the parent product's tax class.
  tax_class text,
  virtual boolean not null default false,
  downloadable boolean not null default false,
  image_url text,
  description text not null default '',
  enabled boolean not null default true,
  menu_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shop_variations_product_idx on public.shop_variations(product_id);

-- Kept out of shop_products so file URLs are not readable by anyone who can read the
-- catalogue. Only shop managers read this table; buyers get a URL from shop_consume_download().
create table if not exists public.shop_product_downloads (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.shop_products(id) on delete cascade,
  variation_id uuid references public.shop_variations(id) on delete cascade,
  name text not null,
  url text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.shop_customers (
  id uuid primary key references public.profiles(id) on delete cascade,
  billing jsonb not null default '{}'::jsonb,
  shipping jsonb not null default '{}'::jsonb,
  cart jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  description text not null default '',
  discount_type text not null default 'percent' check (discount_type in ('percent', 'fixed_cart', 'fixed_product')),
  amount numeric(18,4) not null default 0,
  free_shipping boolean not null default false,
  expires_at timestamptz,
  minimum_spend numeric(18,4),
  maximum_spend numeric(18,4),
  individual_use boolean not null default false,
  exclude_sale_items boolean not null default false,
  product_ids uuid[] not null default '{}',
  excluded_product_ids uuid[] not null default '{}',
  category_ids uuid[] not null default '{}',
  excluded_category_ids uuid[] not null default '{}',
  allowed_emails text[] not null default '{}',
  usage_limit integer,
  usage_limit_per_user integer,
  limit_usage_to_x_items integer,
  usage_count integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists shop_coupons_code_idx on public.shop_coupons(lower(code));

create table if not exists public.shop_tax_rates (
  id uuid primary key default gen_random_uuid(),
  country text not null default '',
  state text not null default '',
  postcodes text[] not null default '{}',
  cities text[] not null default '{}',
  rate numeric(9,4) not null default 0,
  name text not null default 'Tax',
  priority integer not null default 1,
  compound boolean not null default false,
  shipping boolean not null default true,
  tax_class text not null default 'standard',
  menu_order integer not null default 0
);

create table if not exists public.shop_shipping_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- "US" for a country, "US:CA" for a state.
  regions text[] not null default '{}',
  -- "90210", "902*" or a numeric range "90210...90299".
  postcodes text[] not null default '{}',
  menu_order integer not null default 0
);

create table if not exists public.shop_shipping_methods (
  id uuid primary key default gen_random_uuid(),
  -- null: the "Locations not covered by your other zones" zone.
  zone_id uuid references public.shop_shipping_zones(id) on delete cascade,
  type text not null check (type in ('flat_rate', 'free_shipping', 'local_pickup')),
  title text not null,
  enabled boolean not null default true,
  cost numeric(18,4) not null default 0,
  cost_per_item numeric(18,4) not null default 0,
  -- { "<shipping_class_id>": 5, "none": 2 }
  class_costs jsonb not null default '{}'::jsonb,
  calculation_type text not null default 'class' check (calculation_type in ('class', 'order')),
  tax_status text not null default 'taxable' check (tax_status in ('taxable', 'none')),
  free_requires text not null default '' check (free_requires in ('', 'coupon', 'min_amount', 'either', 'both')),
  min_amount numeric(18,4) not null default 0,
  ignore_discounts boolean not null default false,
  menu_order integer not null default 0
);

create table if not exists public.shop_orders (
  id bigint generated by default as identity primary key,
  order_key text not null unique default ('rwp_order_' || encode(gen_random_bytes(12), 'hex')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed')),
  customer_id uuid references public.profiles(id) on delete set null,
  currency text not null default 'USD',
  prices_include_tax boolean not null default false,
  subtotal numeric(18,4) not null default 0,
  subtotal_tax numeric(18,4) not null default 0,
  discount_total numeric(18,4) not null default 0,
  discount_tax numeric(18,4) not null default 0,
  shipping_total numeric(18,4) not null default 0,
  shipping_tax numeric(18,4) not null default 0,
  cart_tax numeric(18,4) not null default 0,
  total_tax numeric(18,4) not null default 0,
  total numeric(18,4) not null default 0,
  refunded_total numeric(18,4) not null default 0,
  payment_method text not null default '',
  payment_method_title text not null default '',
  transaction_id text,
  paid_at timestamptz,
  completed_at timestamptz,
  billing jsonb not null default '{}'::jsonb,
  shipping jsonb not null default '{}'::jsonb,
  shipping_lines jsonb not null default '[]'::jsonb,
  tax_lines jsonb not null default '[]'::jsonb,
  coupon_lines jsonb not null default '[]'::jsonb,
  customer_note text not null default '',
  created_via text not null default 'checkout',
  stock_reduced boolean not null default false,
  coupons_counted boolean not null default false,
  sales_recorded boolean not null default false,
  emails_sent text[] not null default '{}',
  gateway_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shop_orders_customer_idx on public.shop_orders(customer_id);
create index if not exists shop_orders_status_idx on public.shop_orders(status);
create index if not exists shop_orders_created_idx on public.shop_orders(created_at);

create table if not exists public.shop_order_items (
  id bigint generated by default as identity primary key,
  order_id bigint not null references public.shop_orders(id) on delete cascade,
  product_id uuid references public.shop_products(id) on delete set null,
  variation_id uuid references public.shop_variations(id) on delete set null,
  name text not null,
  sku text,
  quantity integer not null check (quantity > 0),
  -- All amounts excluding tax. subtotal is before discounts, total after.
  price numeric(18,4) not null default 0,
  subtotal numeric(18,4) not null default 0,
  subtotal_tax numeric(18,4) not null default 0,
  total numeric(18,4) not null default 0,
  total_tax numeric(18,4) not null default 0,
  tax_class text not null default 'standard',
  meta jsonb not null default '{}'::jsonb,
  refunded_quantity integer not null default 0,
  download_counts jsonb not null default '{}'::jsonb
);

create index if not exists shop_order_items_order_idx on public.shop_order_items(order_id);

create table if not exists public.shop_order_notes (
  id bigint generated by default as identity primary key,
  order_id bigint not null references public.shop_orders(id) on delete cascade,
  note text not null,
  is_customer_note boolean not null default false,
  author_name text not null default 'System',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists shop_order_notes_order_idx on public.shop_order_notes(order_id);

create table if not exists public.shop_refunds (
  id bigint generated by default as identity primary key,
  order_id bigint not null references public.shop_orders(id) on delete cascade,
  amount numeric(18,4) not null check (amount > 0),
  reason text not null default '',
  line_items jsonb not null default '[]'::jsonb,
  refunded_payment boolean not null default false,
  gateway_refund_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.shop_reviews (
  id bigint generated by default as identity primary key,
  product_id uuid not null references public.shop_products(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete cascade,
  author_name text not null default '',
  rating integer check (rating between 1 and 5),
  content text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'spam')),
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (product_id, author_id)
);

create index if not exists shop_reviews_product_idx on public.shop_reviews(product_id);

-- Helpers ----------------------------------------------------------------------

-- Shop settings live in the shop_settings option as JSON. Defaults are merged underneath so
-- a partially saved object still yields every key the functions below read.
create or replace function public.shop_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  raw text;
  parsed jsonb;
begin
  select option_value into raw from public.options where option_name = 'shop_settings';
  begin
    parsed := coalesce(raw::jsonb, '{}'::jsonb);
  exception when others then
    parsed := '{}'::jsonb;
  end;
  if jsonb_typeof(parsed) <> 'object' then
    parsed := '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'currency', 'USD',
    'decimals', 2,
    'store_country', '', 'store_state', '', 'store_postcode', '', 'store_city', '',
    'selling_locations', 'all', 'selling_countries', '[]'::jsonb, 'except_countries', '[]'::jsonb,
    'shipping_locations', 'selling', 'shipping_countries', '[]'::jsonb,
    'default_customer_location', 'base',
    'enable_coupons', true, 'calc_discounts_sequentially', false,
    'enable_taxes', false, 'prices_include_tax', false, 'tax_based_on', 'shipping', 'shipping_tax_class', 'inherit',
    'enable_shipping', true,
    'manage_stock', true, 'hold_stock_minutes', 60, 'out_of_stock_amount', 0, 'hide_out_of_stock', false,
    'enable_reviews', true, 'reviews_require_approval', true, 'verified_owners_only', false,
    'guest_checkout', true, 'terms_page_url', '',
    'gateways', '{}'::jsonb,
    -- Product Q&A, Make an Offer and price-drop alerts (20261005_shop_engagement.sql).
    'enable_qa', true,
    'enable_offers', true, 'offer_min_percent', 50, 'offer_valid_days', 7,
    'enable_price_alerts', true
  ) || parsed;
end;
$$;

create or replace function public.shop_try_uuid(p_value text)
returns uuid language plpgsql immutable as $$
begin
  return nullif(trim(p_value), '')::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.shop_effective_price(p_regular numeric, p_sale numeric, p_from timestamptz, p_to timestamptz)
returns numeric language sql stable as $$
  select case
    when p_sale is not null
      and (p_from is null or p_from <= now())
      and (p_to is null or p_to > now())
      and (p_regular is null or p_sale < p_regular)
    then p_sale
    else p_regular
  end;
$$;

-- Patterns: exact ("90210"), wildcard ("902*") or numeric range ("90210...90299").
create or replace function public.shop_postcode_matches(p_patterns text[], p_postcode text)
returns boolean language plpgsql immutable as $$
declare
  pattern text;
  clean text := upper(regexp_replace(coalesce(p_postcode, ''), '\s', '', 'g'));
  low text;
  high text;
begin
  if cardinality(coalesce(p_patterns, '{}')) = 0 then
    return true;
  end if;
  if clean = '' then
    return false;
  end if;
  foreach pattern in array p_patterns loop
    pattern := upper(regexp_replace(coalesce(pattern, ''), '\s', '', 'g'));
    continue when pattern = '';
    if position('...' in pattern) > 0 then
      low := split_part(pattern, '...', 1);
      high := split_part(pattern, '...', 2);
      if clean ~ '^\d+$' and low ~ '^\d+$' and high ~ '^\d+$'
        and clean::numeric between low::numeric and high::numeric then
        return true;
      end if;
    elsif clean like replace(replace(replace(pattern, '%', ''), '_', '\_'), '*', '%') then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- One rate per priority, the most specific match winning, as WooCommerce does.
create or replace function public.shop_matching_tax_rates(
  p_class text, p_country text, p_state text, p_postcode text, p_city text, p_for_shipping boolean
)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(matched) order by matched.priority), '[]'::jsonb)
  from (
    select distinct on (r.priority) r.*
    from public.shop_tax_rates r
    where r.tax_class = coalesce(nullif(p_class, ''), 'standard')
      and (r.country = '' or upper(r.country) = upper(coalesce(p_country, '')))
      and (r.state = '' or upper(r.state) = upper(coalesce(p_state, '')))
      and public.shop_postcode_matches(r.postcodes, p_postcode)
      and (cardinality(r.cities) = 0 or exists (
        select 1 from unnest(r.cities) city where upper(trim(city)) = upper(trim(coalesce(p_city, '')))))
      and (not p_for_shipping or r.shipping)
    order by r.priority, (r.country <> '') desc, (r.state <> '') desc,
      (cardinality(r.postcodes) > 0) desc, (cardinality(r.cities) > 0) desc, r.menu_order
  ) matched;
$$;

-- Returns { net, tax, rates: [{ id, label, compound, amount }] } for an amount that either
-- includes tax (p_inclusive) or excludes it. Compound rates apply on top of earlier taxes.
create or replace function public.shop_calc_tax(p_amount numeric, p_rates jsonb, p_inclusive boolean, p_decimals integer)
returns jsonb language plpgsql immutable as $$
declare
  rate jsonb;
  simple_rate numeric := 0;
  multiplier numeric;
  net numeric;
  running numeric;
  amount numeric;
  total_tax numeric := 0;
  breakdown jsonb := '[]'::jsonb;
begin
  if coalesce(p_amount, 0) = 0 or p_rates is null or jsonb_array_length(p_rates) = 0 then
    return jsonb_build_object('net', coalesce(p_amount, 0), 'tax', 0, 'rates', '[]'::jsonb);
  end if;

  for rate in select value from jsonb_array_elements(p_rates) loop
    if not coalesce((rate->>'compound')::boolean, false) then
      simple_rate := simple_rate + (rate->>'rate')::numeric;
    end if;
  end loop;
  multiplier := 1 + simple_rate / 100;
  for rate in select value from jsonb_array_elements(p_rates) loop
    if coalesce((rate->>'compound')::boolean, false) then
      multiplier := multiplier * (1 + (rate->>'rate')::numeric / 100);
    end if;
  end loop;

  net := case when p_inclusive then p_amount / multiplier else p_amount end;

  for rate in select value from jsonb_array_elements(p_rates) loop
    if not coalesce((rate->>'compound')::boolean, false) then
      amount := round(net * (rate->>'rate')::numeric / 100, p_decimals);
      total_tax := total_tax + amount;
      breakdown := breakdown || jsonb_build_array(jsonb_build_object(
        'id', rate->>'id', 'label', rate->>'name', 'compound', false, 'amount', amount));
    end if;
  end loop;
  running := net + total_tax;
  for rate in select value from jsonb_array_elements(p_rates) order by (value->>'priority')::int loop
    if coalesce((rate->>'compound')::boolean, false) then
      amount := round(running * (rate->>'rate')::numeric / 100, p_decimals);
      total_tax := total_tax + amount;
      running := running + amount;
      breakdown := breakdown || jsonb_build_array(jsonb_build_object(
        'id', rate->>'id', 'label', rate->>'name', 'compound', true, 'amount', amount));
    end if;
  end loop;

  -- For inclusive prices, derive net from the rounded tax so net + tax equals the price exactly.
  if p_inclusive then
    net := p_amount - total_tax;
  end if;
  return jsonb_build_object('net', net, 'tax', total_tax, 'rates', breakdown);
end;
$$;

create or replace function public.shop_matching_zone(p_country text, p_state text, p_postcode text)
returns uuid language sql stable security definer set search_path = public as $$
  select z.id
  from public.shop_shipping_zones z
  where cardinality(z.regions) > 0
    and exists (
      select 1 from unnest(z.regions) region
      where upper(region) = upper(coalesce(p_country, ''))
         or upper(region) = upper(coalesce(p_country, '') || ':' || coalesce(p_state, '')))
    and public.shop_postcode_matches(z.postcodes, p_postcode)
  order by z.menu_order, z.name
  limit 1;
$$;

-- Keeps stock_status consistent with stock_quantity whenever stock is managed.
create or replace function public.shop_stock_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  threshold integer := coalesce((public.shop_settings()->>'out_of_stock_amount')::int, 0);
begin
  if new.manage_stock and new.stock_quantity is not null then
    new.stock_status := case
      when new.stock_quantity > threshold then 'instock'
      when new.backorders <> 'no' then 'onbackorder'
      else 'outofstock'
    end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists shop_products_stock_guard on public.shop_products;
create trigger shop_products_stock_guard
  before insert or update on public.shop_products
  for each row execute function public.shop_stock_guard();

drop trigger if exists shop_variations_stock_guard on public.shop_variations;
create trigger shop_variations_stock_guard
  before insert or update on public.shop_variations
  for each row execute function public.shop_stock_guard();

-- p_direction: -1 takes stock, +1 returns it.
create or replace function public.shop_adjust_order_stock(p_order_id bigint, p_direction integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  item public.shop_order_items%rowtype;
begin
  for item in select * from public.shop_order_items where order_id = p_order_id loop
    if item.variation_id is not null
      and exists (select 1 from public.shop_variations where id = item.variation_id and manage_stock) then
      update public.shop_variations
      set stock_quantity = coalesce(stock_quantity, 0) + p_direction * item.quantity
      where id = item.variation_id;
    elsif item.product_id is not null then
      update public.shop_products
      set stock_quantity = coalesce(stock_quantity, 0) + p_direction * item.quantity
      where id = item.product_id and manage_stock;
    end if;
  end loop;
end;
$$;

create or replace function public.shop_increment_sales(p_order_id bigint)
returns void language sql security definer set search_path = public as $$
  update public.shop_products p
  set total_sales = p.total_sales + sold.quantity
  from (
    select product_id, sum(quantity)::int as quantity
    from public.shop_order_items
    where order_id = p_order_id and product_id is not null
    group by product_id
  ) sold
  where p.id = sold.product_id;
$$;

create or replace function public.shop_change_coupon_usage(p_coupon_lines jsonb, p_delta integer)
returns void language sql security definer set search_path = public as $$
  update public.shop_coupons
  set usage_count = greatest(usage_count + p_delta, 0)
  where lower(code) in (select lower(line->>'code') from jsonb_array_elements(coalesce(p_coupon_lines, '[]'::jsonb)) line);
$$;

-- Status side effects live in one trigger so they apply however the status changes:
-- checkout, payment confirmation, the admin screen or a direct SQL update.
-- A caller can explain a change with: set_config('rwp_shop.status_note', '...', true)
create or replace function public.shop_orders_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  reason text := nullif(current_setting('rwp_shop.status_note', true), '');
  actor text;
begin
  new.updated_at := now();
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status in ('cancelled', 'failed') then
    if old.stock_reduced then
      perform public.shop_adjust_order_stock(new.id, 1);
      new.stock_reduced := false;
    end if;
    if old.coupons_counted then
      perform public.shop_change_coupon_usage(old.coupon_lines, -1);
      new.coupons_counted := false;
    end if;
  elsif new.status in ('processing', 'on-hold', 'completed') then
    if not old.stock_reduced and coalesce((public.shop_settings()->>'manage_stock')::boolean, true) then
      perform public.shop_adjust_order_stock(new.id, -1);
      new.stock_reduced := true;
    end if;
    if not old.coupons_counted then
      perform public.shop_change_coupon_usage(new.coupon_lines, 1);
      new.coupons_counted := true;
    end if;
  end if;

  if new.status in ('processing', 'completed') and not old.sales_recorded then
    perform public.shop_increment_sales(new.id);
    new.sales_recorded := true;
  end if;
  -- Cash on delivery is not paid when it starts processing, only when it completes.
  if new.paid_at is null and (new.status = 'completed' or (new.status = 'processing' and new.payment_method <> 'cod')) then
    new.paid_at := now();
  end if;
  if new.status = 'completed' and new.completed_at is null then
    new.completed_at := now();
  end if;

  select coalesce(display_name, email) into actor from public.profiles where id = auth.uid();
  insert into public.shop_order_notes (order_id, note, author_name, created_by)
  values (
    new.id,
    concat_ws(' ', reason, format('Order status changed from %s to %s.', old.status, new.status)),
    coalesce(actor, 'System'),
    auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists shop_orders_before_update on public.shop_orders;
create trigger shop_orders_before_update
  before update on public.shop_orders
  for each row execute function public.shop_orders_before_update();

-- Cart calculation -------------------------------------------------------------
-- Input:
--   { items: [{ key, product_id, variation_id, quantity, attributes: { Size: "M" } }],
--     coupons: ["CODE"], billing: {country,state,postcode,city,email},
--     shipping: {...}, ship_to_different: bool, shipping_method_id: uuid }
-- Output: items with prices and taxes, coupons, shipping methods, totals, tax_lines,
-- errors (blocking) and notices. Amounts in items[].subtotal/total are excluding tax.
create or replace function public.shop_calculate(p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s jsonb := public.shop_settings();
  d integer := coalesce((s->>'decimals')::int, 2);
  incl boolean := coalesce((s->>'prices_include_tax')::boolean, false);
  taxes_on boolean := coalesce((s->>'enable_taxes')::boolean, false);
  stock_on boolean := coalesce((s->>'manage_stock')::boolean, true);
  store jsonb := jsonb_build_object('country', s->>'store_country', 'state', s->>'store_state',
    'postcode', s->>'store_postcode', 'city', s->>'store_city');
  billing jsonb := coalesce(p_input->'billing', '{}'::jsonb);
  dest jsonb;
  tax_location jsonb;
  errors jsonb := '[]'::jsonb;
  notices jsonb := '[]'::jsonb;
  lines jsonb[] := '{}';
  entry jsonb;
  line jsonb;
  prod public.shop_products%rowtype;
  vari public.shop_variations%rowtype;
  has_variation boolean;
  skip boolean;
  qty integer;
  unit numeric;
  regular numeric;
  label text;
  attrs jsonb;
  attr_key text;
  attr_value text;
  chosen text;
  manage boolean;
  stock integer;
  backorder text;
  status_now text;
  line_is_virtual boolean;
  needs_shipping boolean := false;
  subtotal_base numeric := 0;
  i integer;
  -- coupons
  codes text[];
  v_code text;
  cpn public.shop_coupons%rowtype;
  individual text;
  customer_email text;
  used integer;
  eligible boolean[];
  eligible_total numeric;
  eligible_count integer;
  remaining numeric;
  amount numeric;
  allocated numeric;
  cap numeric;
  coupon_total numeric;
  units_left integer;
  applied_units integer;
  coupons jsonb := '[]'::jsonb;
  free_shipping_coupon boolean := false;
  discount_base numeric := 0;
  -- tax
  rates jsonb;
  tax_sub jsonb;
  tax_total jsonb;
  tax_rate jsonb;
  tax_totals jsonb := '{}'::jsonb;
  sum_subtotal numeric := 0;
  sum_subtotal_tax numeric := 0;
  sum_total numeric := 0;
  sum_total_tax numeric := 0;
  -- shipping
  zone uuid;
  method public.shop_shipping_methods%rowtype;
  methods jsonb := '[]'::jsonb;
  chosen_method jsonb;
  shippable_qty integer := 0;
  cost numeric;
  class_cost numeric;
  class_sum numeric;
  class_max numeric;
  class_key text;
  meets_min boolean;
  available boolean;
  shipping_class text;
  shipping_tax jsonb;
  shipping_total numeric := 0;
  shipping_tax_total numeric := 0;
  -- frequently bought together
  bundle jsonb;
begin
  dest := case when coalesce((p_input->>'ship_to_different')::boolean, false)
    then coalesce(p_input->'shipping', '{}'::jsonb) else billing end;
  if coalesce(dest->>'country', '') = '' and s->>'default_customer_location' = 'base' then
    dest := dest || store;
  end if;
  tax_location := case s->>'tax_based_on' when 'billing' then billing when 'base' then store else dest end;
  if coalesce(tax_location->>'country', '') = '' and s->>'default_customer_location' = 'base' then
    tax_location := store;
  end if;

  -- Selling locations
  if coalesce(billing->>'country', '') <> '' then
    if (s->>'selling_locations' = 'specific' and not (coalesce(s->'selling_countries', '[]'::jsonb) ? upper(billing->>'country')))
      or (s->>'selling_locations' = 'all_except' and (coalesce(s->'except_countries', '[]'::jsonb) ? upper(billing->>'country'))) then
      errors := errors || to_jsonb(format('Unfortunately we do not sell to %s.', upper(billing->>'country')));
    end if;
  end if;

  -- Items
  for entry in select value from jsonb_array_elements(coalesce(p_input->'items', '[]'::jsonb)) loop
    skip := false;
    qty := coalesce(nullif(regexp_replace(coalesce(entry->>'quantity', '1'), '[^0-9]', '', 'g'), '')::int, 0);
    continue when qty <= 0;

    select * into prod from public.shop_products where id = public.shop_try_uuid(entry->>'product_id');
    if not found or (prod.status <> 'publish' and not public.user_has_cap('manage_shop')) then
      errors := errors || to_jsonb('A product in your cart is no longer available. Please remove it from your cart.'::text);
      continue;
    end if;
    if prod.type in ('grouped', 'external') then
      errors := errors || to_jsonb(format('"%s" cannot be purchased directly.', prod.name));
      continue;
    end if;

    vari := null;
    has_variation := false;
    if prod.type = 'variable' then
      select * into vari from public.shop_variations
      where id = public.shop_try_uuid(entry->>'variation_id') and product_id = prod.id and enabled;
      if not found then
        errors := errors || to_jsonb(format('Please choose product options for "%s".', prod.name));
        continue;
      end if;
      has_variation := true;
    end if;

    if has_variation then
      unit := public.shop_effective_price(vari.regular_price, vari.sale_price, vari.sale_from, vari.sale_to);
      regular := vari.regular_price;
    else
      unit := public.shop_effective_price(prod.regular_price, prod.sale_price, prod.sale_from, prod.sale_to);
      regular := prod.regular_price;
    end if;
    if unit is null then
      errors := errors || to_jsonb(format('"%s" has no price and cannot be purchased.', prod.name));
      continue;
    end if;

    label := prod.name;
    attrs := '{}'::jsonb;
    if has_variation then
      attrs := coalesce(vari.attributes, '{}'::jsonb);
      for attr_key, attr_value in select key, value from jsonb_each_text(coalesce(vari.attributes, '{}'::jsonb)) loop
        if coalesce(attr_value, '') = '' then
          chosen := coalesce(entry->'attributes'->>attr_key, '');
          if chosen = '' or not exists (
            select 1 from jsonb_array_elements(prod.attributes) a, jsonb_array_elements_text(a->'options') o
            where a->>'name' = attr_key and o = chosen) then
            errors := errors || to_jsonb(format('Please choose a valid %s for "%s".', attr_key, prod.name));
            skip := true;
          else
            attrs := jsonb_set(attrs, array[attr_key], to_jsonb(chosen));
          end if;
        end if;
      end loop;
      continue when skip;
      select prod.name || ' - ' || string_agg(value, ', ') into label from jsonb_each_text(attrs);
      label := coalesce(label, prod.name);
    end if;

    if has_variation and vari.manage_stock then
      manage := true; stock := vari.stock_quantity; backorder := vari.backorders; status_now := vari.stock_status;
    elsif prod.manage_stock then
      manage := true; stock := prod.stock_quantity; backorder := prod.backorders; status_now := prod.stock_status;
    else
      manage := false; stock := null; backorder := 'yes';
      status_now := case when has_variation then vari.stock_status else prod.stock_status end;
    end if;
    manage := manage and stock_on;
    if not manage and status_now = 'outofstock' then
      errors := errors || to_jsonb(format('Sorry, "%s" is out of stock. Please remove it from your cart.', label));
      continue;
    end if;
    if manage and backorder = 'no' then
      if coalesce(stock, 0) <= 0 then
        errors := errors || to_jsonb(format('Sorry, "%s" is out of stock. Please remove it from your cart.', label));
        continue;
      elsif qty > stock then
        errors := errors || to_jsonb(format('Sorry, we only have %s of "%s" in stock. Please edit your cart.', stock, label));
        continue;
      end if;
    end if;
    if prod.sold_individually and qty > 1 then
      qty := 1;
      notices := notices || to_jsonb(format('You can only buy one "%s" per order.', prod.name));
    end if;

    line_is_virtual := case when has_variation then vari.virtual else prod.virtual end;
    if not line_is_virtual then
      needs_shipping := true;
      shippable_qty := shippable_qty + qty;
    end if;
    subtotal_base := subtotal_base + round(unit * qty, d);

    lines := array_append(lines, jsonb_build_object(
      'key', coalesce(nullif(entry->>'key', ''), prod.id::text || coalesce(':' || vari.id::text, '')),
      'product_id', prod.id,
      'variation_id', vari.id,
      'name', label,
      'product_name', prod.name,
      'slug', prod.slug,
      'sku', coalesce(nullif(vari.sku, ''), prod.sku),
      'image_url', coalesce(vari.image_url, prod.image_url),
      'quantity', qty,
      'unit_price', unit,
      'regular_price', regular,
      'on_sale', regular is not null and unit < regular,
      'line_base', round(unit * qty, d),
      'discount', 0,
      'attributes', attrs,
      'virtual', line_is_virtual,
      'downloadable', case when has_variation then vari.downloadable else prod.downloadable end,
      'shipping_class_id', coalesce(vari.shipping_class_id, prod.shipping_class_id),
      'tax_class', coalesce(nullif(vari.tax_class, ''), prod.tax_class),
      'tax_status', prod.tax_status,
      'category_ids', to_jsonb(array(select category_id from public.shop_product_categories where product_id = prod.id)),
      'purchase_note', prod.purchase_note,
      'max_quantity', case when manage and backorder = 'no' then stock else null end
    ));
  end loop;

  -- Frequently bought together: a suggested product in the same cart as its main product gets the
  -- bundle's percentage off here, so like every other price it is decided by the database.
  bundle := public.shop_apply_bundle_discounts(lines, d);
  lines := array(select item.value from jsonb_array_elements(bundle->'lines') with ordinality as item(value, position) order by item.position);
  notices := notices || coalesce(bundle->'notices', '[]'::jsonb);

  -- Coupons
  if coalesce((s->>'enable_coupons')::boolean, true) and cardinality(lines) > 0 then
    codes := array(
      select distinct lower(trim(value))
      from jsonb_array_elements_text(coalesce(p_input->'coupons', '[]'::jsonb))
      where trim(value) <> '');
    customer_email := lower(coalesce(nullif(trim(billing->>'email'), ''),
      (select email from auth.users where id = auth.uid())));

    -- An individual-use coupon cannot be combined with any other.
    select lower(c.code) into individual from public.shop_coupons c
    where lower(c.code) = any(codes) and c.individual_use and c.active
    order by array_position(codes, lower(c.code)) limit 1;
    if individual is not null and cardinality(codes) > 1 then
      notices := notices || to_jsonb(format('Coupon "%s" cannot be used with other coupons, so the others were removed.', individual));
      codes := array[individual];
    end if;

    foreach v_code in array codes loop
      select * into cpn from public.shop_coupons c where lower(c.code) = v_code;
      if not found or not cpn.active then
        errors := errors || to_jsonb(format('Coupon "%s" does not exist.', v_code));
        continue;
      end if;
      if cpn.expires_at is not null and cpn.expires_at < now() then
        errors := errors || to_jsonb(format('Coupon "%s" has expired.', v_code));
        continue;
      end if;
      if cpn.usage_limit is not null and cpn.usage_count >= cpn.usage_limit then
        errors := errors || to_jsonb(format('Coupon "%s" has reached its usage limit.', v_code));
        continue;
      end if;
      if cpn.usage_limit_per_user is not null and (auth.uid() is not null or customer_email is not null) then
        select count(*) into used from public.shop_orders o
        where o.status not in ('cancelled', 'failed')
          and o.coupon_lines @> jsonb_build_array(jsonb_build_object('code', v_code))
          and ((auth.uid() is not null and o.customer_id = auth.uid())
            or (customer_email is not null and lower(o.billing->>'email') = customer_email));
        if used >= cpn.usage_limit_per_user then
          errors := errors || to_jsonb(format('You have already used coupon "%s" the maximum number of times.', v_code));
          continue;
        end if;
      end if;
      if cardinality(cpn.allowed_emails) > 0 and customer_email is not null and not exists (
        select 1 from unnest(cpn.allowed_emails) allowed
        where customer_email like replace(lower(trim(allowed)), '*', '%')) then
        errors := errors || to_jsonb(format('Coupon "%s" is not valid for your email address.', v_code));
        continue;
      end if;
      if cpn.minimum_spend is not null and subtotal_base < cpn.minimum_spend then
        errors := errors || to_jsonb(format('The minimum spend for coupon "%s" is %s.', v_code, round(cpn.minimum_spend, d)));
        continue;
      end if;
      if cpn.maximum_spend is not null and subtotal_base > cpn.maximum_spend then
        errors := errors || to_jsonb(format('The maximum spend for coupon "%s" is %s.', v_code, round(cpn.maximum_spend, d)));
        continue;
      end if;

      eligible := '{}';
      eligible_total := 0;
      eligible_count := 0;
      for i in 1..cardinality(lines) loop
        line := lines[i];
        eligible := array_append(eligible,
          (cardinality(cpn.product_ids) = 0
            or public.shop_try_uuid(line->>'product_id') = any(cpn.product_ids)
            or public.shop_try_uuid(line->>'variation_id') = any(cpn.product_ids))
          and not (public.shop_try_uuid(line->>'product_id') = any(cpn.excluded_product_ids)
            or coalesce(public.shop_try_uuid(line->>'variation_id') = any(cpn.excluded_product_ids), false))
          and (cardinality(cpn.category_ids) = 0 or exists (
            select 1 from jsonb_array_elements_text(line->'category_ids') cat where cat::uuid = any(cpn.category_ids)))
          and not exists (
            select 1 from jsonb_array_elements_text(line->'category_ids') cat where cat::uuid = any(cpn.excluded_category_ids))
          and not (cpn.exclude_sale_items and (line->>'on_sale')::boolean));
        if eligible[i] then
          remaining := (line->>'line_base')::numeric
            - case when coalesce((s->>'calc_discounts_sequentially')::boolean, false) then (line->>'discount')::numeric else 0 end;
          eligible_total := eligible_total + greatest(remaining, 0);
          eligible_count := eligible_count + 1;
        end if;
      end loop;
      if eligible_count = 0 then
        errors := errors || to_jsonb(format('Coupon "%s" does not apply to the products in your cart.', v_code));
        continue;
      end if;

      coupon_total := 0;
      allocated := 0;
      units_left := cpn.limit_usage_to_x_items;
      cap := least(cpn.amount, eligible_total);
      for i in 1..cardinality(lines) loop
        continue when not eligible[i];
        line := lines[i];
        remaining := (line->>'line_base')::numeric
          - case when coalesce((s->>'calc_discounts_sequentially')::boolean, false) then (line->>'discount')::numeric else 0 end;
        applied_units := (line->>'quantity')::int;
        if units_left is not null then
          applied_units := least(applied_units, greatest(units_left, 0));
          units_left := units_left - applied_units;
        end if;
        amount := case cpn.discount_type
          when 'percent' then round(remaining * applied_units / (line->>'quantity')::int * cpn.amount / 100, d)
          when 'fixed_product' then cpn.amount * applied_units
          else case when eligible_total > 0 then round(cap * remaining / eligible_total, d) else 0 end
        end;
        if cpn.discount_type = 'fixed_cart' then
          allocated := allocated + amount;
          eligible_count := eligible_count - 1;
          -- The last eligible line absorbs rounding so the coupon's total is exact.
          if eligible_count = 0 then
            amount := amount + (cap - allocated);
          end if;
        end if;
        -- Never discount a line below zero.
        amount := greatest(least(amount, (line->>'line_base')::numeric - (line->>'discount')::numeric), 0);
        lines[i] := line || jsonb_build_object('discount', (line->>'discount')::numeric + amount);
        coupon_total := coupon_total + amount;
      end loop;

      discount_base := discount_base + coupon_total;
      coupons := coupons || jsonb_build_array(jsonb_build_object(
        'code', v_code, 'discount', coupon_total, 'free_shipping', cpn.free_shipping,
        'discount_type', cpn.discount_type, 'amount', cpn.amount));
      if cpn.free_shipping then
        free_shipping_coupon := true;
      end if;
    end loop;
  end if;

  -- Line taxes
  for i in 1..coalesce(cardinality(lines), 0) loop
    line := lines[i];
    if taxes_on and line->>'tax_status' = 'taxable' then
      rates := public.shop_matching_tax_rates(line->>'tax_class', tax_location->>'country', tax_location->>'state',
        tax_location->>'postcode', tax_location->>'city', false);
    else
      rates := '[]'::jsonb;
    end if;
    tax_sub := public.shop_calc_tax((line->>'line_base')::numeric, rates, incl, d);
    tax_total := public.shop_calc_tax((line->>'line_base')::numeric - (line->>'discount')::numeric, rates, incl, d);
    lines[i] := line || jsonb_build_object(
      'subtotal', tax_sub->'net', 'subtotal_tax', tax_sub->'tax',
      'total', tax_total->'net', 'total_tax', tax_total->'tax');
    sum_subtotal := sum_subtotal + (tax_sub->>'net')::numeric;
    sum_subtotal_tax := sum_subtotal_tax + (tax_sub->>'tax')::numeric;
    sum_total := sum_total + (tax_total->>'net')::numeric;
    sum_total_tax := sum_total_tax + (tax_total->>'tax')::numeric;
    for tax_rate in select value from jsonb_array_elements(tax_total->'rates') loop
      tax_totals := jsonb_set(tax_totals, array[tax_rate->>'id'], jsonb_build_object(
        'rate_id', tax_rate->>'id', 'label', tax_rate->>'label', 'compound', tax_rate->'compound',
        'tax_total', coalesce((tax_totals->(tax_rate->>'id')->>'tax_total')::numeric, 0) + (tax_rate->>'amount')::numeric,
        'shipping_tax_total', coalesce((tax_totals->(tax_rate->>'id')->>'shipping_tax_total')::numeric, 0)));
    end loop;
  end loop;

  -- Shipping
  if needs_shipping and coalesce((s->>'enable_shipping')::boolean, true) then
    if coalesce(dest->>'country', '') = '' then
      notices := notices || to_jsonb('Enter your address to see shipping options.'::text);
    elsif (s->>'shipping_locations' = 'specific' and not (coalesce(s->'shipping_countries', '[]'::jsonb) ? upper(dest->>'country')))
      or (s->>'shipping_locations' = 'selling' and s->>'selling_locations' = 'specific'
        and not (coalesce(s->'selling_countries', '[]'::jsonb) ? upper(dest->>'country'))) then
      errors := errors || to_jsonb(format('Unfortunately we do not ship to %s. Please enter a different shipping address.', upper(dest->>'country')));
    else
      zone := public.shop_matching_zone(dest->>'country', dest->>'state', dest->>'postcode');
      shipping_class := case when s->>'shipping_tax_class' = 'inherit'
        then coalesce((select l->>'tax_class' from unnest(lines) l where not (l->>'virtual')::boolean limit 1), 'standard')
        else s->>'shipping_tax_class' end;

      for method in
        select * from public.shop_shipping_methods m
        where m.enabled and m.zone_id is not distinct from zone
        order by m.menu_order, m.title
      loop
        if method.type = 'free_shipping' then
          meets_min := (subtotal_base - case when method.ignore_discounts then 0 else discount_base end) >= method.min_amount;
          available := case method.free_requires
            when 'coupon' then free_shipping_coupon
            when 'min_amount' then meets_min
            when 'either' then free_shipping_coupon or meets_min
            when 'both' then free_shipping_coupon and meets_min
            else true
          end;
          continue when not available;
          cost := 0;
        elsif method.type = 'flat_rate' then
          cost := method.cost + method.cost_per_item * shippable_qty;
          class_sum := 0;
          class_max := 0;
          for class_key in
            select distinct coalesce(l->>'shipping_class_id', 'none') from unnest(lines) l where not (l->>'virtual')::boolean
          loop
            class_cost := coalesce((method.class_costs->>class_key)::numeric, 0);
            class_sum := class_sum + class_cost;
            class_max := greatest(class_max, class_cost);
          end loop;
          cost := cost + case when method.calculation_type = 'order' then class_max else class_sum end;
        else
          cost := method.cost;
        end if;
        cost := round(cost, d);

        if taxes_on and method.tax_status = 'taxable' and cost > 0 then
          shipping_tax := public.shop_calc_tax(cost,
            public.shop_matching_tax_rates(shipping_class, tax_location->>'country', tax_location->>'state',
              tax_location->>'postcode', tax_location->>'city', true),
            false, d);
        else
          shipping_tax := jsonb_build_object('net', cost, 'tax', 0, 'rates', '[]'::jsonb);
        end if;
        methods := methods || jsonb_build_array(jsonb_build_object(
          'id', method.id, 'type', method.type, 'title', method.title,
          'cost', cost, 'tax', shipping_tax->'tax', 'tax_rates', shipping_tax->'rates'));
      end loop;

      if jsonb_array_length(methods) = 0 then
        errors := errors || to_jsonb('No shipping options were found for your address. Please check it, or contact us if you need help.'::text);
      else
        select value into chosen_method from jsonb_array_elements(methods)
        where value->>'id' = p_input->>'shipping_method_id';
        chosen_method := coalesce(chosen_method, methods->0);
        shipping_total := (chosen_method->>'cost')::numeric;
        shipping_tax_total := (chosen_method->>'tax')::numeric;
        for tax_rate in select value from jsonb_array_elements(chosen_method->'tax_rates') loop
          tax_totals := jsonb_set(tax_totals, array[tax_rate->>'id'], jsonb_build_object(
            'rate_id', tax_rate->>'id', 'label', tax_rate->>'label', 'compound', tax_rate->'compound',
            'tax_total', coalesce((tax_totals->(tax_rate->>'id')->>'tax_total')::numeric, 0),
            'shipping_tax_total', coalesce((tax_totals->(tax_rate->>'id')->>'shipping_tax_total')::numeric, 0) + (tax_rate->>'amount')::numeric));
        end loop;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'currency', s->>'currency',
    'decimals', d,
    'prices_include_tax', incl,
    'taxes_enabled', taxes_on,
    'items', coalesce(to_jsonb(lines), '[]'::jsonb),
    'coupons', coupons,
    'needs_shipping', needs_shipping and coalesce((s->>'enable_shipping')::boolean, true),
    'shipping_methods', methods,
    'chosen_shipping_method', chosen_method,
    'tax_lines', coalesce((select jsonb_agg(value) from jsonb_each(tax_totals)), '[]'::jsonb),
    'totals', jsonb_build_object(
      'subtotal', sum_subtotal,
      'subtotal_tax', sum_subtotal_tax,
      'discount_total', sum_subtotal - sum_total,
      'discount_tax', sum_subtotal_tax - sum_total_tax,
      'shipping_total', shipping_total,
      'shipping_tax', shipping_tax_total,
      'cart_tax', sum_total_tax,
      'total_tax', sum_total_tax + shipping_tax_total,
      'total', sum_total + sum_total_tax + shipping_total + shipping_tax_total
    ),
    'errors', errors,
    'notices', notices
  );
end;
$$;

-- Orders -----------------------------------------------------------------------

-- Places an order from the same input as shop_calculate plus:
--   payment_method, customer_note, terms_accepted, save_address,
--   and for shop managers only: admin: true, customer_id, status.
-- Returns { ok, order_id, order_key, status, total } or { ok: false, errors: [...] }.
create or replace function public.shop_place_order(p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  s jsonb := public.shop_settings();
  is_admin boolean := coalesce((p_input->>'admin')::boolean, false) and public.user_has_cap('manage_shop');
  v_billing jsonb := coalesce(p_input->'billing', '{}'::jsonb);
  ship_different boolean := coalesce((p_input->>'ship_to_different')::boolean, false);
  v_shipping jsonb;
  calc jsonb;
  errors jsonb := '[]'::jsonb;
  field text;
  gateway text := coalesce(p_input->>'payment_method', '');
  gateway_settings jsonb;
  order_total numeric;
  order_status text;
  new_order_id bigint;
  new_order_key text;
  line jsonb;
  qty integer;
  line_name text;
  hold integer := coalesce((s->>'hold_stock_minutes')::int, 0);
begin
  if auth.uid() is null and not coalesce((s->>'guest_checkout')::boolean, true) then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('Please log in or create an account to place an order.'));
  end if;

  -- Release stock held by unpaid online orders past the hold time. Done here instead of a
  -- cron job, so it needs no extension and still happens before stock is checked.
  if hold > 0 then
    perform set_config('rwp_shop.status_note', 'Unpaid order cancelled: time limit reached.', true);
    update public.shop_orders set status = 'cancelled'
    where status = 'pending' and created_via = 'checkout'
      and created_at < now() - make_interval(mins => hold);
    perform set_config('rwp_shop.status_note', '', true);
  end if;

  foreach field in array array['first_name', 'last_name', 'email', 'country', 'address_1', 'city'] loop
    if coalesce(trim(v_billing->>field), '') = '' then
      errors := errors || to_jsonb(format('Billing %s is a required field.', replace(field, '_', ' ')));
    end if;
  end loop;
  if coalesce(v_billing->>'email', '') <> '' and v_billing->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    errors := errors || to_jsonb('Billing email address is not valid.'::text);
  end if;
  if ship_different then
    v_shipping := coalesce(p_input->'shipping', '{}'::jsonb);
    foreach field in array array['first_name', 'last_name', 'country', 'address_1', 'city'] loop
      if coalesce(trim(v_shipping->>field), '') = '' then
        errors := errors || to_jsonb(format('Shipping %s is a required field.', replace(field, '_', ' ')));
      end if;
    end loop;
  else
    v_shipping := v_billing - 'email' - 'phone';
  end if;

  calc := public.shop_calculate(p_input);
  errors := errors || coalesce(calc->'errors', '[]'::jsonb);
  if jsonb_array_length(calc->'items') = 0 then
    errors := errors || to_jsonb('Your cart is empty.'::text);
  end if;
  if (calc->>'needs_shipping')::boolean and jsonb_typeof(calc->'chosen_shipping_method') is distinct from 'object'
    and jsonb_array_length(coalesce(calc->'errors', '[]'::jsonb)) = 0 then
    errors := errors || to_jsonb('Please choose a shipping method.'::text);
  end if;

  order_total := (calc->'totals'->>'total')::numeric;
  gateway_settings := s->'gateways'->gateway;
  if order_total > 0 and not is_admin then
    if gateway not in ('stripe', 'paypal', 'bacs', 'cheque', 'cod')
      or gateway_settings is null or not coalesce((gateway_settings->>'enabled')::boolean, false) then
      errors := errors || to_jsonb('Please choose a valid payment method.'::text);
    end if;
  end if;
  if not is_admin and coalesce(s->>'terms_page_url', '') <> '' and not coalesce((p_input->>'terms_accepted')::boolean, false) then
    errors := errors || to_jsonb('Please read and accept the terms and conditions to place your order.'::text);
  end if;

  if jsonb_array_length(errors) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors, 'calculation', calc);
  end if;

  order_status := case
    when is_admin then coalesce(nullif(p_input->>'status', ''), 'pending')
    when order_total <= 0 then 'processing'
    when gateway = 'cod' then 'processing'
    when gateway in ('bacs', 'cheque') then 'on-hold'
    else 'pending'
  end;
  if order_status not in ('pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed') then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array(format('"%s" is not a valid order status.', order_status)));
  end if;

  insert into public.shop_orders (
    status, customer_id, currency, prices_include_tax,
    subtotal, subtotal_tax, discount_total, discount_tax, shipping_total, shipping_tax,
    cart_tax, total_tax, total,
    payment_method, payment_method_title, paid_at,
    billing, shipping, shipping_lines, tax_lines, coupon_lines, customer_note, created_via,
    stock_reduced, coupons_counted, sales_recorded
  ) values (
    order_status,
    case when is_admin then public.shop_try_uuid(p_input->>'customer_id') else auth.uid() end,
    coalesce(calc->>'currency', 'USD'),
    coalesce((calc->>'prices_include_tax')::boolean, false),
    (calc->'totals'->>'subtotal')::numeric, (calc->'totals'->>'subtotal_tax')::numeric,
    (calc->'totals'->>'discount_total')::numeric, (calc->'totals'->>'discount_tax')::numeric,
    (calc->'totals'->>'shipping_total')::numeric, (calc->'totals'->>'shipping_tax')::numeric,
    (calc->'totals'->>'cart_tax')::numeric, (calc->'totals'->>'total_tax')::numeric,
    order_total,
    case when order_total <= 0 and not is_admin then 'free' else gateway end,
    case when order_total <= 0 and not is_admin then 'No payment required'
      else coalesce(gateway_settings->>'title', gateway) end,
    case when order_total <= 0 and not is_admin then now() end,
    v_billing,
    v_shipping,
    case when jsonb_typeof(calc->'chosen_shipping_method') = 'object' then jsonb_build_array(jsonb_build_object(
      'method_id', calc->'chosen_shipping_method'->>'id',
      'type', calc->'chosen_shipping_method'->>'type',
      'title', calc->'chosen_shipping_method'->>'title',
      'total', calc->'chosen_shipping_method'->'cost',
      'tax', calc->'chosen_shipping_method'->'tax')) else '[]'::jsonb end,
    coalesce(calc->'tax_lines', '[]'::jsonb),
    coalesce(calc->'coupons', '[]'::jsonb),
    left(coalesce(p_input->>'customer_note', ''), 2000),
    case when is_admin then 'admin' else 'checkout' end,
    false,
    order_status not in ('cancelled', 'failed'),
    order_status in ('processing', 'completed')
  )
  returning id, order_key into new_order_id, new_order_key;

  for line in select value from jsonb_array_elements(calc->'items') loop
    qty := (line->>'quantity')::int;
    insert into public.shop_order_items (
      order_id, product_id, variation_id, name, sku, quantity, price,
      subtotal, subtotal_tax, total, total_tax, tax_class, meta
    ) values (
      new_order_id,
      public.shop_try_uuid(line->>'product_id'),
      public.shop_try_uuid(line->>'variation_id'),
      line->>'name',
      line->>'sku',
      qty,
      round((line->>'subtotal')::numeric / qty, 4),
      (line->>'subtotal')::numeric,
      (line->>'subtotal_tax')::numeric,
      (line->>'total')::numeric,
      (line->>'total_tax')::numeric,
      coalesce(line->>'tax_class', 'standard'),
      jsonb_build_object('attributes', line->'attributes', 'purchase_note', line->'purchase_note')
    );
  end loop;

  -- Take stock with a conditional update, so two customers buying the last item cannot
  -- both succeed. Raising aborts the whole order.
  if order_status not in ('cancelled', 'failed') and coalesce((s->>'manage_stock')::boolean, true) then
    for line in select value from jsonb_array_elements(calc->'items') loop
      qty := (line->>'quantity')::int;
      line_name := line->>'name';
      if public.shop_try_uuid(line->>'variation_id') is not null and exists (
        select 1 from public.shop_variations where id = public.shop_try_uuid(line->>'variation_id') and manage_stock) then
        update public.shop_variations
        set stock_quantity = coalesce(stock_quantity, 0) - qty
        where id = public.shop_try_uuid(line->>'variation_id')
          and (backorders <> 'no' or coalesce(stock_quantity, 0) >= qty);
        if not found then
          raise exception 'Sorry, "%" does not have enough stock left to fill your order. Please edit your cart and try again.', line_name;
        end if;
      else
        update public.shop_products
        set stock_quantity = coalesce(stock_quantity, 0) - qty
        where id = public.shop_try_uuid(line->>'product_id') and manage_stock
          and (backorders <> 'no' or coalesce(stock_quantity, 0) >= qty);
        if not found and exists (
          select 1 from public.shop_products where id = public.shop_try_uuid(line->>'product_id') and manage_stock) then
          raise exception 'Sorry, "%" does not have enough stock left to fill your order. Please edit your cart and try again.', line_name;
        end if;
      end if;
    end loop;
    update public.shop_orders set stock_reduced = true where id = new_order_id;
  end if;

  if order_status not in ('cancelled', 'failed') then
    perform public.shop_change_coupon_usage(calc->'coupons', 1);
  end if;
  if order_status in ('processing', 'completed') then
    perform public.shop_increment_sales(new_order_id);
  end if;

  insert into public.shop_order_notes (order_id, note)
  values (new_order_id, case gateway
    when 'bacs' then 'Awaiting bank transfer payment.'
    when 'cheque' then 'Awaiting cheque payment.'
    when 'cod' then 'Payment to be collected on delivery.'
    else 'Order created.'
  end);

  if auth.uid() is not null and not is_admin and coalesce((p_input->>'save_address')::boolean, true) then
    insert into public.shop_customers (id, billing, shipping)
    values (auth.uid(), v_billing, v_shipping)
    on conflict (id) do update set billing = excluded.billing, shipping = excluded.shipping, updated_at = now();
  end if;

  return jsonb_build_object('ok', true, 'order_id', new_order_id, 'order_key', new_order_key,
    'status', order_status, 'total', order_total, 'payment_method', gateway);
end;
$$;

-- Readable with the order key (guests, from the order-received link), by the customer, or
-- by a shop manager.
create or replace function public.shop_get_order(p_order_id bigint, p_order_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  o public.shop_orders%rowtype;
  manager boolean := public.user_has_cap('manage_shop');
  paid boolean;
begin
  select * into o from public.shop_orders where id = p_order_id;
  if not found or not (
    o.order_key = p_order_key
    or (auth.uid() is not null and o.customer_id = auth.uid())
    or manager) then
    return null;
  end if;
  paid := o.status in ('processing', 'completed') and o.paid_at is not null;

  return (to_jsonb(o) - 'emails_sent' - case when manager then '' else 'gateway_data' end) || jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) || jsonb_build_object(
        'slug', p.slug,
        'image_url', coalesce(v.image_url, p.image_url),
        'downloads', case when paid then coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', dl.id, 'name', dl.name,
            'downloads_remaining', case when p.download_limit is null then null
              else greatest(p.download_limit - coalesce((i.download_counts->>dl.id::text)::int, 0), 0) end,
            'expires_at', case when p.download_expiry_days is null then null
              else o.paid_at + make_interval(days => p.download_expiry_days) end))
          from public.shop_product_downloads dl
          where dl.product_id = i.product_id and (dl.variation_id is null or dl.variation_id = i.variation_id)
        ), '[]'::jsonb) else '[]'::jsonb end
      ) order by i.id)
      from public.shop_order_items i
      left join public.shop_products p on p.id = i.product_id
      left join public.shop_variations v on v.id = i.variation_id
      where i.order_id = o.id
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(to_jsonb(n) order by n.created_at desc)
      from public.shop_order_notes n
      where n.order_id = o.id and (n.is_customer_note or manager)
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at)
      from public.shop_refunds r where r.order_id = o.id
    ), '[]'::jsonb),
    'bank_accounts', case when o.payment_method = 'bacs'
      then coalesce(public.shop_settings()->'gateways'->'bacs'->'accounts', '[]'::jsonb) else '[]'::jsonb end,
    'payment_instructions', coalesce(public.shop_settings()->'gateways'->o.payment_method->>'instructions', '')
  );
end;
$$;

create or replace function public.shop_cancel_order(p_order_id bigint, p_order_key text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  o public.shop_orders%rowtype;
begin
  select * into o from public.shop_orders where id = p_order_id for update;
  if not found or not (o.order_key = p_order_key or (auth.uid() is not null and o.customer_id = auth.uid())) then
    return jsonb_build_object('ok', false, 'error', 'Order not found.');
  end if;
  if o.status not in ('pending', 'failed') then
    return jsonb_build_object('ok', false, 'error', format('This order is %s and can no longer be cancelled. Please contact us.', o.status));
  end if;
  perform set_config('rwp_shop.status_note', 'Order cancelled by the customer.', true);
  update public.shop_orders set status = 'cancelled' where id = p_order_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Server only (service_role): called after the server has verified the payment with
-- Stripe or PayPal directly. Never grant this to anon or authenticated.
create or replace function public.shop_mark_order_paid(
  p_order_id bigint, p_gateway text, p_transaction_id text, p_amount numeric, p_currency text, p_data jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  o public.shop_orders%rowtype;
  instant boolean;
  next_status text;
begin
  select * into o from public.shop_orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', format('Order %s does not exist.', p_order_id));
  end if;
  if o.transaction_id is not distinct from p_transaction_id and o.paid_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'status', o.status);
  end if;
  if o.payment_method <> p_gateway then
    return jsonb_build_object('ok', false, 'error', format('Order %s was placed with %s, not %s.', p_order_id, o.payment_method, p_gateway));
  end if;
  if upper(o.currency) <> upper(p_currency) or abs(o.total - p_amount) > 0.01 then
    perform set_config('rwp_shop.status_note', format(
      'Payment of %s %s via %s (%s) does not match the order total of %s %s. Check it in the gateway before fulfilling.',
      p_amount, upper(p_currency), p_gateway, p_transaction_id, round(o.total, 2), o.currency), true);
    update public.shop_orders
    set status = 'on-hold', transaction_id = p_transaction_id, gateway_data = gateway_data || coalesce(p_data, '{}'::jsonb)
    where id = p_order_id;
    return jsonb_build_object('ok', false, 'error', 'Payment amount does not match the order total. The order is on hold.');
  end if;

  -- Orders containing only virtual downloadable items need no fulfilment, so they complete.
  instant := not exists (
    select 1 from public.shop_order_items i
    left join public.shop_products p on p.id = i.product_id
    left join public.shop_variations v on v.id = i.variation_id
    where i.order_id = p_order_id
      and not (coalesce(v.virtual, p.virtual, false) and coalesce(v.downloadable, p.downloadable, false)));
  next_status := case when instant then 'completed' else 'processing' end;

  perform set_config('rwp_shop.status_note', format('Payment received via %s (transaction %s).', p_gateway, p_transaction_id), true);
  update public.shop_orders
  set status = next_status, paid_at = coalesce(paid_at, now()), transaction_id = p_transaction_id,
      gateway_data = gateway_data || coalesce(p_data, '{}'::jsonb)
  where id = p_order_id;
  if o.status = next_status then
    insert into public.shop_order_notes (order_id, note)
    values (p_order_id, format('Payment received via %s (transaction %s).', p_gateway, p_transaction_id));
  end if;
  return jsonb_build_object('ok', true, 'status', next_status);
end;
$$;

-- Server only: records that an email for an event was sent, so a replayed request cannot
-- send it twice. Returns false if it was already sent.
create or replace function public.shop_claim_order_email(p_order_id bigint, p_event text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  update public.shop_orders
  set emails_sent = array_append(emails_sent, p_event)
  where id = p_order_id and not (p_event = any(emails_sent));
  return found;
end;
$$;

-- Server only: stores gateway references (Stripe session id, PayPal order id) on an order.
create or replace function public.shop_set_gateway_data(p_order_id bigint, p_data jsonb)
returns void language sql volatile security definer set search_path = public as $$
  update public.shop_orders set gateway_data = gateway_data || coalesce(p_data, '{}'::jsonb) where id = p_order_id;
$$;

-- p_items: [{ item_id, quantity, restock }]
create or replace function public.shop_create_refund(
  p_order_id bigint, p_amount numeric, p_reason text, p_items jsonb,
  p_refunded_payment boolean, p_gateway_refund_id text
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  o public.shop_orders%rowtype;
  entry jsonb;
  item public.shop_order_items%rowtype;
  qty integer;
  refunded numeric;
  refund_id bigint;
begin
  if not public.user_has_cap('manage_shop') then
    raise exception 'Only shop managers can refund orders.';
  end if;
  select * into o from public.shop_orders where id = p_order_id for update;
  if not found then
    raise exception 'Order % does not exist.', p_order_id;
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'The refund amount must be greater than zero.';
  end if;
  if p_amount > o.total - o.refunded_total + 0.00001 then
    raise exception 'The most that can still be refunded on this order is %.', round(o.total - o.refunded_total, 2);
  end if;

  for entry in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into item from public.shop_order_items
    where id = (entry->>'item_id')::bigint and order_id = p_order_id;
    continue when not found;
    qty := least(greatest(coalesce((entry->>'quantity')::int, 0), 0), item.quantity - item.refunded_quantity);
    continue when qty = 0;
    update public.shop_order_items set refunded_quantity = refunded_quantity + qty where id = item.id;
    if coalesce((entry->>'restock')::boolean, false) then
      if item.variation_id is not null and exists (select 1 from public.shop_variations where id = item.variation_id and manage_stock) then
        update public.shop_variations set stock_quantity = coalesce(stock_quantity, 0) + qty where id = item.variation_id;
      else
        update public.shop_products set stock_quantity = coalesce(stock_quantity, 0) + qty where id = item.product_id and manage_stock;
      end if;
    end if;
  end loop;

  insert into public.shop_refunds (order_id, amount, reason, line_items, refunded_payment, gateway_refund_id, created_by)
  values (p_order_id, p_amount, coalesce(p_reason, ''), coalesce(p_items, '[]'::jsonb), coalesce(p_refunded_payment, false),
    p_gateway_refund_id, auth.uid())
  returning id into refund_id;

  refunded := o.refunded_total + p_amount;
  perform set_config('rwp_shop.status_note', format('Refunded %s%s.', round(p_amount, 2),
    case when coalesce(p_reason, '') <> '' then ': ' || p_reason else '' end), true);
  update public.shop_orders
  set refunded_total = refunded,
      status = case when refunded >= o.total - 0.00001 then 'refunded' else status end
  where id = p_order_id;
  if refunded < o.total - 0.00001 then
    insert into public.shop_order_notes (order_id, note, created_by)
    values (p_order_id, format('Refunded %s%s.', round(p_amount, 2),
      case when coalesce(p_reason, '') <> '' then ': ' || p_reason else '' end), auth.uid());
  end if;
  perform set_config('rwp_shop.status_note', '', true);
  return jsonb_build_object('ok', true, 'refund_id', refund_id, 'refunded_total', refunded);
end;
$$;

-- Returns the file URL after checking payment, the download limit and expiry.
create or replace function public.shop_consume_download(p_order_id bigint, p_order_key text, p_item_id bigint, p_download_id uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  o public.shop_orders%rowtype;
  item public.shop_order_items%rowtype;
  prod public.shop_products%rowtype;
  file public.shop_product_downloads%rowtype;
  used integer;
begin
  select * into o from public.shop_orders where id = p_order_id;
  if not found or not (o.order_key = p_order_key or (auth.uid() is not null and o.customer_id = auth.uid())) then
    raise exception 'Order not found.';
  end if;
  if o.status not in ('processing', 'completed') or o.paid_at is null then
    raise exception 'Downloads become available once payment for this order is complete.';
  end if;
  select * into item from public.shop_order_items where id = p_item_id and order_id = p_order_id;
  select * into file from public.shop_product_downloads
  where id = p_download_id and product_id = item.product_id and (variation_id is null or variation_id = item.variation_id);
  if item.id is null or file.id is null then
    raise exception 'This file is not part of your order.';
  end if;
  select * into prod from public.shop_products where id = item.product_id;
  used := coalesce((item.download_counts->>file.id::text)::int, 0);
  if prod.download_limit is not null and used >= prod.download_limit then
    raise exception 'You have reached the download limit for this file.';
  end if;
  if prod.download_expiry_days is not null and o.paid_at + make_interval(days => prod.download_expiry_days) < now() then
    raise exception 'This download has expired.';
  end if;
  update public.shop_order_items
  set download_counts = jsonb_set(download_counts, array[file.id::text], to_jsonb(used + 1))
  where id = item.id;
  return file.url;
end;
$$;

-- Attaches guest orders placed with the signed-in user's email, once that email is confirmed.
create or replace function public.shop_claim_guest_orders()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  confirmed_email text;
  claimed integer;
begin
  select lower(email) into confirmed_email from auth.users
  where id = auth.uid() and email_confirmed_at is not null;
  if confirmed_email is null then
    return 0;
  end if;
  update public.shop_orders set customer_id = auth.uid()
  where customer_id is null and lower(billing->>'email') = confirmed_email;
  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

-- Catalogue --------------------------------------------------------------------
-- p: { search, category (slug), tag (slug), attributes: { Color: ["Red"] }, min_price,
--      max_price, on_sale, featured, ids: [uuid], orderby, page, per_page }
-- orderby: menu_order | popularity | rating | date | price | price-desc | title
create or replace function public.shop_catalog(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  per_page integer := least(greatest(coalesce((p->>'per_page')::int, 12), 1), 100);
  page integer := greatest(coalesce((p->>'page')::int, 1), 1);
  search text := nullif(trim(coalesce(p->>'search', '')), '');
  category_slug text := nullif(p->>'category', '');
  tag_slug text := nullif(p->>'tag', '');
  orderby text := coalesce(nullif(p->>'orderby', ''), 'menu_order');
  min_price numeric := nullif(p->>'min_price', '')::numeric;
  max_price numeric := nullif(p->>'max_price', '')::numeric;
  only_sale boolean := coalesce((p->>'on_sale')::boolean, false);
  only_featured boolean := coalesce((p->>'featured')::boolean, false);
  hide_out_of_stock boolean := coalesce((public.shop_settings()->>'hide_out_of_stock')::boolean, false);
  attribute_filter jsonb := coalesce(p->'attributes', '{}'::jsonb);
  wanted_ids uuid[] := case when jsonb_typeof(p->'ids') = 'array'
    then array(select public.shop_try_uuid(value) from jsonb_array_elements_text(p->'ids')) end;
  result jsonb;
begin
  with base as (
    select pr.*,
      case pr.type
        when 'variable' then (select min(public.shop_effective_price(v.regular_price, v.sale_price, v.sale_from, v.sale_to))
          from public.shop_variations v where v.product_id = pr.id and v.enabled)
        when 'grouped' then (select min(public.shop_effective_price(c.regular_price, c.sale_price, c.sale_from, c.sale_to))
          from public.shop_products c where c.id = any(pr.grouped_ids) and c.status = 'publish')
        else public.shop_effective_price(pr.regular_price, pr.sale_price, pr.sale_from, pr.sale_to)
      end as price_min,
      case pr.type
        when 'variable' then (select max(public.shop_effective_price(v.regular_price, v.sale_price, v.sale_from, v.sale_to))
          from public.shop_variations v where v.product_id = pr.id and v.enabled)
        when 'grouped' then (select max(public.shop_effective_price(c.regular_price, c.sale_price, c.sale_from, c.sale_to))
          from public.shop_products c where c.id = any(pr.grouped_ids) and c.status = 'publish')
        else public.shop_effective_price(pr.regular_price, pr.sale_price, pr.sale_from, pr.sale_to)
      end as price_max,
      case pr.type
        when 'variable' then exists (select 1 from public.shop_variations v where v.product_id = pr.id and v.enabled
          and public.shop_effective_price(v.regular_price, v.sale_price, v.sale_from, v.sale_to) < v.regular_price)
        else coalesce(public.shop_effective_price(pr.regular_price, pr.sale_price, pr.sale_from, pr.sale_to) < pr.regular_price, false)
      end as on_sale,
      case pr.type
        when 'variable' then exists (select 1 from public.shop_variations v where v.product_id = pr.id and v.enabled
          and v.stock_status <> 'outofstock')
        else pr.stock_status <> 'outofstock'
      end as in_stock
    from public.shop_products pr
    where pr.status = 'publish'
      and (wanted_ids is not null or case when search is null
        then pr.catalog_visibility in ('visible', 'catalog')
        else pr.catalog_visibility in ('visible', 'search') end)
      and (search is null or pr.name ilike '%' || search || '%' or pr.sku ilike search
        or pr.short_description ilike '%' || search || '%')
      and (category_slug is null or exists (
        select 1 from public.shop_product_categories pc
        join public.shop_categories c on c.id = pc.category_id
        left join public.shop_categories parent on parent.id = c.parent_id
        where pc.product_id = pr.id and (c.slug = category_slug or parent.slug = category_slug)))
      and (tag_slug is null or exists (
        select 1 from public.shop_product_tags pt join public.shop_tags t on t.id = pt.tag_id
        where pt.product_id = pr.id and t.slug = tag_slug))
      and (not only_featured or pr.featured)
      and (wanted_ids is null or pr.id = any(wanted_ids))
      and not exists (
        select 1 from jsonb_each(attribute_filter) f
        where jsonb_typeof(f.value) = 'array' and jsonb_array_length(f.value) > 0
          and not exists (
            select 1 from jsonb_array_elements(pr.attributes) a, jsonb_array_elements_text(a->'options') o
            where lower(a->>'name') = lower(f.key)
              and o in (select jsonb_array_elements_text(f.value))))
  ),
  filtered as (
    select * from base
    where (not hide_out_of_stock or in_stock)
      and (min_price is null or price_max >= min_price)
      and (max_price is null or price_min <= max_price)
      and (not only_sale or on_sale)
  ),
  ordered as (
    select filtered.*, row_number() over (order by
      case when orderby = 'price' then price_min end asc nulls last,
      case when orderby = 'price-desc' then price_max end desc nulls last,
      case when orderby = 'popularity' then total_sales end desc,
      case when orderby = 'rating' then average_rating end desc,
      case when orderby = 'date' then created_at end desc,
      case when orderby = 'title' then name end asc,
      menu_order, name) as position
    from filtered
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'page', page,
    'per_page', per_page,
    'price_bounds', (select jsonb_build_object('min', min(price_min), 'max', max(price_max)) from base),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'slug', slug, 'type', type, 'featured', featured,
        'image_url', image_url, 'gallery', gallery, 'short_description', short_description,
        'price_min', price_min, 'price_max', price_max,
        'regular_price', regular_price, 'sale_price', sale_price, 'on_sale', on_sale,
        'in_stock', in_stock, 'stock_status', stock_status, 'manage_stock', manage_stock,
        'stock_quantity', stock_quantity, 'average_rating', average_rating, 'rating_count', rating_count,
        'external_url', external_url, 'button_text', button_text, 'sold_individually', sold_individually,
        'sale_to', sale_to
      ) order by position)
      from ordered
      where position > (page - 1) * per_page and position <= page * per_page
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- Reviews ----------------------------------------------------------------------

create or replace function public.shop_reviews_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s jsonb := public.shop_settings();
  manager boolean := public.user_has_cap('manage_shop');
begin
  if auth.uid() is null then
    raise exception 'Please log in to leave a review.';
  end if;
  if not coalesce((s->>'enable_reviews')::boolean, true)
    or not exists (select 1 from public.shop_products where id = new.product_id and reviews_allowed and status = 'publish') then
    raise exception 'Reviews are closed for this product.';
  end if;
  new.author_id := auth.uid();
  select coalesce(display_name, split_part(email, '@', 1)) into new.author_name from public.profiles where id = auth.uid();
  new.verified := exists (
    select 1 from public.shop_orders o join public.shop_order_items i on i.order_id = o.id
    where o.customer_id = auth.uid() and o.status in ('processing', 'completed') and i.product_id = new.product_id);
  if coalesce((s->>'verified_owners_only')::boolean, false) and not new.verified and not manager then
    raise exception 'Only customers who have bought this product can review it.';
  end if;
  if not manager then
    new.status := case when coalesce((s->>'reviews_require_approval')::boolean, true) then 'pending' else 'approved' end;
  end if;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists shop_reviews_before_insert on public.shop_reviews;
create trigger shop_reviews_before_insert
  before insert on public.shop_reviews
  for each row execute function public.shop_reviews_before_insert();

create or replace function public.shop_reviews_update_rating()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target uuid := coalesce(new.product_id, old.product_id);
begin
  update public.shop_products p
  set average_rating = coalesce(stats.average, 0), rating_count = coalesce(stats.total, 0)
  from (
    select round(avg(rating)::numeric, 2) as average, count(rating)::int as total
    from public.shop_reviews where product_id = target and status = 'approved' and rating is not null
  ) stats
  where p.id = target;
  return null;
end;
$$;

drop trigger if exists shop_reviews_update_rating on public.shop_reviews;
create trigger shop_reviews_update_rating
  after insert or update or delete on public.shop_reviews
  for each row execute function public.shop_reviews_update_rating();

-- Reports ----------------------------------------------------------------------

create or replace function public.shop_report(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if not public.user_has_cap('manage_shop') then
    raise exception 'Only shop managers can view shop reports.';
  end if;
  with paid as (
    select * from public.shop_orders
    where status in ('processing', 'completed', 'on-hold', 'refunded')
      and created_at >= p_from and created_at < p_to
  )
  select jsonb_build_object(
    'orders', (select count(*) from paid),
    'gross_sales', (select coalesce(sum(total), 0) from paid),
    'refunds', (select coalesce(sum(refunded_total), 0) from paid),
    'tax', (select coalesce(sum(total_tax), 0) from paid),
    'shipping', (select coalesce(sum(shipping_total), 0) from paid),
    'discounts', (select coalesce(sum(discount_total), 0) from paid),
    'net_sales', (select coalesce(sum(total - total_tax - shipping_total - refunded_total), 0) from paid),
    'items_sold', (select coalesce(sum(i.quantity - i.refunded_quantity), 0) from public.shop_order_items i join paid on paid.id = i.order_id),
    'average_order', (select coalesce(round(avg(total), 2), 0) from paid),
    'by_status', (select coalesce(jsonb_object_agg(status, total), '{}'::jsonb) from (
      select status, count(*) as total from public.shop_orders
      where created_at >= p_from and created_at < p_to group by status) counts),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', day, 'orders', orders, 'sales', sales) order by day), '[]'::jsonb) from (
      select date_trunc('day', created_at)::date as day, count(*) as orders, sum(total - refunded_total) as sales
      from paid group by 1) days),
    'top_products', (select coalesce(jsonb_agg(row_to_json(top)::jsonb), '[]'::jsonb) from (
      select i.product_id, max(i.name) as name, sum(i.quantity - i.refunded_quantity) as quantity, sum(i.total) as sales
      from public.shop_order_items i join paid on paid.id = i.order_id
      group by i.product_id order by sum(i.quantity) desc limit 10) top),
    'top_coupons', (select coalesce(jsonb_agg(row_to_json(c)::jsonb), '[]'::jsonb) from (
      select line->>'code' as code, count(*) as uses, sum((line->>'discount')::numeric) as discount
      from paid, jsonb_array_elements(paid.coupon_lines) line
      group by 1 order by 2 desc limit 10) c),
    'low_stock', (select coalesce(jsonb_agg(row_to_json(l)::jsonb), '[]'::jsonb) from (
      select id, name, stock_quantity from public.shop_products
      where manage_stock and stock_quantity <= coalesce(low_stock_amount, 2)
      order by stock_quantity limit 20) l)
  ) into result;
  return result;
end;
$$;

create or replace function public.shop_customer_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.user_has_cap('manage_shop') then
    raise exception 'Only shop managers can view customers.';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(c)::jsonb order by c.last_order desc nulls last)
    from (
      select
        o.customer_id,
        lower(o.billing->>'email') as email,
        max(concat_ws(' ', o.billing->>'first_name', o.billing->>'last_name')) as name,
        max(o.billing->>'country') as country,
        max(o.billing->>'city') as city,
        count(*) as orders,
        sum(case when o.status in ('processing', 'completed') then o.total - o.refunded_total else 0 end) as total_spent,
        max(o.created_at) as last_order
      from public.shop_orders o
      group by o.customer_id, lower(o.billing->>'email')
    ) c
  ), '[]'::jsonb);
end;
$$;

-- Row level security -----------------------------------------------------------

alter table public.shop_categories enable row level security;
alter table public.shop_tags enable row level security;
alter table public.shop_attributes enable row level security;
alter table public.shop_attribute_terms enable row level security;
alter table public.shop_shipping_classes enable row level security;
alter table public.shop_products enable row level security;
alter table public.shop_product_categories enable row level security;
alter table public.shop_product_tags enable row level security;
alter table public.shop_variations enable row level security;
alter table public.shop_product_downloads enable row level security;
alter table public.shop_customers enable row level security;
alter table public.shop_coupons enable row level security;
alter table public.shop_tax_rates enable row level security;
alter table public.shop_shipping_zones enable row level security;
alter table public.shop_shipping_methods enable row level security;
alter table public.shop_orders enable row level security;
alter table public.shop_order_items enable row level security;
alter table public.shop_order_notes enable row level security;
alter table public.shop_refunds enable row level security;
alter table public.shop_reviews enable row level security;

-- Catalogue tables readable by everyone, writable by shop managers.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'shop_categories', 'shop_tags', 'shop_attributes', 'shop_attribute_terms', 'shop_shipping_classes',
    'shop_product_categories', 'shop_product_tags', 'shop_tax_rates', 'shop_shipping_zones', 'shop_shipping_methods'
  ] loop
    execute format('drop policy if exists "Public can read %1$s" on public.%1$I', table_name);
    execute format('create policy "Public can read %1$s" on public.%1$I for select to anon, authenticated using (true)', table_name);
    execute format('drop policy if exists "Shop managers can write %1$s" on public.%1$I', table_name);
    execute format('create policy "Shop managers can write %1$s" on public.%1$I for all to authenticated using (public.user_has_cap(''manage_shop'')) with check (public.user_has_cap(''manage_shop''))', table_name);
  end loop;
end;
$$;

drop policy if exists "Public can read published products" on public.shop_products;
create policy "Public can read published products"
  on public.shop_products for select to anon, authenticated
  using (status = 'publish' or public.user_has_cap('manage_shop'));
drop policy if exists "Shop managers can write products" on public.shop_products;
create policy "Shop managers can write products"
  on public.shop_products for all to authenticated
  using (public.user_has_cap('manage_shop')) with check (public.user_has_cap('manage_shop'));

drop policy if exists "Public can read variations of published products" on public.shop_variations;
create policy "Public can read variations of published products"
  on public.shop_variations for select to anon, authenticated
  using (public.user_has_cap('manage_shop') or exists (
    select 1 from public.shop_products p where p.id = product_id and p.status = 'publish'));
drop policy if exists "Shop managers can write variations" on public.shop_variations;
create policy "Shop managers can write variations"
  on public.shop_variations for all to authenticated
  using (public.user_has_cap('manage_shop')) with check (public.user_has_cap('manage_shop'));

drop policy if exists "Shop managers manage downloads" on public.shop_product_downloads;
create policy "Shop managers manage downloads"
  on public.shop_product_downloads for all to authenticated
  using (public.user_has_cap('manage_shop')) with check (public.user_has_cap('manage_shop'));

drop policy if exists "Customers manage their own details" on public.shop_customers;
create policy "Customers manage their own details"
  on public.shop_customers for all to authenticated
  using (id = auth.uid() or public.user_has_cap('manage_shop'))
  with check (id = auth.uid() or public.user_has_cap('manage_shop'));

-- Coupon codes are not public; checkout validates them inside shop_calculate().
drop policy if exists "Shop managers manage coupons" on public.shop_coupons;
create policy "Shop managers manage coupons"
  on public.shop_coupons for all to authenticated
  using (public.user_has_cap('manage_shop')) with check (public.user_has_cap('manage_shop'));

-- Orders are created only through shop_place_order(), so there is no insert policy for customers.
drop policy if exists "Customers read their own orders" on public.shop_orders;
create policy "Customers read their own orders"
  on public.shop_orders for select to authenticated
  using (customer_id = auth.uid() or public.user_has_cap('manage_shop'));
drop policy if exists "Shop managers manage orders" on public.shop_orders;
create policy "Shop managers manage orders"
  on public.shop_orders for all to authenticated
  using (public.user_has_cap('manage_shop')) with check (public.user_has_cap('manage_shop'));

drop policy if exists "Customers read their own order items" on public.shop_order_items;
create policy "Customers read their own order items"
  on public.shop_order_items for select to authenticated
  using (public.user_has_cap('manage_shop') or exists (
    select 1 from public.shop_orders o where o.id = order_id and o.customer_id = auth.uid()));
drop policy if exists "Shop managers manage order items" on public.shop_order_items;
create policy "Shop managers manage order items"
  on public.shop_order_items for all to authenticated
  using (public.user_has_cap('manage_shop')) with check (public.user_has_cap('manage_shop'));

drop policy if exists "Customers read notes addressed to them" on public.shop_order_notes;
create policy "Customers read notes addressed to them"
  on public.shop_order_notes for select to authenticated
  using (public.user_has_cap('manage_shop') or (is_customer_note and exists (
    select 1 from public.shop_orders o where o.id = order_id and o.customer_id = auth.uid())));
drop policy if exists "Shop managers manage order notes" on public.shop_order_notes;
create policy "Shop managers manage order notes"
  on public.shop_order_notes for all to authenticated
  using (public.user_has_cap('manage_shop')) with check (public.user_has_cap('manage_shop'));

drop policy if exists "Customers read their own refunds" on public.shop_refunds;
create policy "Customers read their own refunds"
  on public.shop_refunds for select to authenticated
  using (public.user_has_cap('manage_shop') or exists (
    select 1 from public.shop_orders o where o.id = order_id and o.customer_id = auth.uid()));

drop policy if exists "Public can read approved reviews" on public.shop_reviews;
create policy "Public can read approved reviews"
  on public.shop_reviews for select to anon, authenticated
  using (status = 'approved' or author_id = auth.uid() or public.user_has_cap('manage_shop'));
drop policy if exists "Members can write reviews" on public.shop_reviews;
create policy "Members can write reviews"
  on public.shop_reviews for insert to authenticated
  with check (true);
drop policy if exists "Shop managers moderate reviews" on public.shop_reviews;
create policy "Shop managers moderate reviews"
  on public.shop_reviews for update to authenticated
  using (public.user_has_cap('manage_shop')) with check (public.user_has_cap('manage_shop'));
drop policy if exists "Authors and shop managers delete reviews" on public.shop_reviews;
create policy "Authors and shop managers delete reviews"
  on public.shop_reviews for delete to authenticated
  using (author_id = auth.uid() or public.user_has_cap('manage_shop'));

-- Function privileges ----------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default, and Supabase exposes every public function
-- over the API. Internal helpers must be revoked, or anyone could call them directly.

revoke execute on function public.shop_adjust_order_stock(bigint, integer) from public, anon, authenticated;
revoke execute on function public.shop_increment_sales(bigint) from public, anon, authenticated;
revoke execute on function public.shop_change_coupon_usage(jsonb, integer) from public, anon, authenticated;
revoke execute on function public.shop_orders_before_update() from public, anon, authenticated;
revoke execute on function public.shop_reviews_before_insert() from public, anon, authenticated;
revoke execute on function public.shop_reviews_update_rating() from public, anon, authenticated;
revoke execute on function public.shop_stock_guard() from public, anon, authenticated;

revoke execute on function public.shop_mark_order_paid(bigint, text, text, numeric, text, jsonb) from public, anon, authenticated;
revoke execute on function public.shop_claim_order_email(bigint, text) from public, anon, authenticated;
revoke execute on function public.shop_set_gateway_data(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.shop_mark_order_paid(bigint, text, text, numeric, text, jsonb) to service_role;
grant execute on function public.shop_claim_order_email(bigint, text) to service_role;
grant execute on function public.shop_set_gateway_data(bigint, jsonb) to service_role;

grant execute on function public.shop_settings() to anon, authenticated;
grant execute on function public.shop_calculate(jsonb) to anon, authenticated;
grant execute on function public.shop_place_order(jsonb) to anon, authenticated;
grant execute on function public.shop_get_order(bigint, text) to anon, authenticated;
grant execute on function public.shop_cancel_order(bigint, text) to anon, authenticated;
grant execute on function public.shop_consume_download(bigint, text, bigint, uuid) to anon, authenticated;
grant execute on function public.shop_catalog(jsonb) to anon, authenticated;
grant execute on function public.shop_claim_guest_orders() to authenticated;
grant execute on function public.shop_create_refund(bigint, numeric, text, jsonb, boolean, text) to authenticated;
grant execute on function public.shop_report(timestamptz, timestamptz) to authenticated;
grant execute on function public.shop_customer_summary() to authenticated;

notify pgrst, 'reload schema';

-- Product engagement and commerce tools -------------------------------------------------------------
-- Kept identical to supabase/migrations/20261005_shop_engagement.sql (after its copies of
-- shop_settings and shop_calculate) from this point on.
--
-- 1. Products in core's engagement system: likes, saves, views and the Following feed. Core finds
--    products through rwp_engagement_target_product / rwp_engagement_feed_product (see
--    supabase/migrations/20261004_engagement.sql) and never references a shop object itself. The
--    triggers on core's likes and page_views tables are only created when those tables exist, so
--    the shop still activates on a site that has not run the core engagement migration.
-- 2. Product Q&A (shop_product_qa), Make an Offer (shop_product_offers), price-drop alerts
--    (shop_price_drop_alerts) and Frequently Bought Together (shop_product_bundles).
--
-- Amounts follow the shop's rule: nothing the browser sends is trusted. An accepted offer becomes a
-- single-use coupon for that product and that customer, so the agreed price is enforced by
-- shop_calculate like any coupon. Bundle discounts are applied inside shop_calculate by
-- shop_apply_bundle_discounts.

-- 1. Products as engagement targets ----------------------------------------------------------------

alter table public.shop_products add column if not exists views_count integer not null default 0;
alter table public.shop_products add column if not exists likes_count integer not null default 0;

-- The Following feed lists products by the people a customer follows: the account that created them.
alter table public.shop_products alter column author_id set default auth.uid();

create or replace function public.rwp_engagement_target_product(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'title', p.name,
    'url', '/product/' || p.slug,
    'image', p.image_url,
    'excerpt', nullif(btrim(regexp_replace(p.short_description, '<[^>]*>', ' ', 'g')), ''),
    'author_id', p.author_id,
    'published_at', p.created_at,
    'views_count', p.views_count,
    'likes_count', p.likes_count
  )
  from public.shop_products p
  where p.id = public.shop_try_uuid(p_id) and p.status = 'publish' and p.catalog_visibility <> 'hidden';
$$;

-- The product editor saves whole rows; without this a save would put back the counts it loaded.
create or replace function public.shop_products_guard_engagement_counts()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.views_count := 0;
    new.likes_count := 0;
  else
    new.views_count := old.views_count;
    new.likes_count := old.likes_count;
  end if;
  return new;
end;
$$;

drop trigger if exists shop_products_guard_engagement_counts on public.shop_products;
create trigger shop_products_guard_engagement_counts
  before insert or update of views_count, likes_count on public.shop_products
  for each row execute function public.shop_products_guard_engagement_counts();

create or replace function public.shop_likes_maintain_counts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.target_type = 'product' then
    update public.shop_products set likes_count = likes_count + 1 where id = public.shop_try_uuid(new.target_id);
  elsif tg_op = 'DELETE' and old.target_type = 'product' then
    update public.shop_products set likes_count = greatest(likes_count - 1, 0) where id = public.shop_try_uuid(old.target_id);
  end if;
  return null;
end;
$$;

create or replace function public.shop_views_maintain_counts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.target_type = 'product' then
    update public.shop_products set views_count = views_count + 1 where id = public.shop_try_uuid(new.target_id);
  end if;
  return null;
end;
$$;

-- A deleted product takes its likes, saves and views with it. Checked at run time, so a site without
-- the core engagement tables can still delete products.
create or replace function public.shop_products_forget_engagement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if to_regclass('public.likes') is not null then
    delete from public.likes where target_type = 'product' and target_id = old.id::text;
  end if;
  if to_regclass('public.bookmarks') is not null then
    delete from public.bookmarks where target_type = 'product' and target_id = old.id::text;
  end if;
  if to_regclass('public.page_views') is not null then
    delete from public.page_views where target_type = 'product' and target_id = old.id::text;
  end if;
  return null;
end;
$$;

drop trigger if exists shop_products_forget_engagement on public.shop_products;
create trigger shop_products_forget_engagement
  after delete on public.shop_products
  for each row execute function public.shop_products_forget_engagement();

-- New products by the people the customer follows. Called by core's rwp_following_feed as its owner.
create or replace function public.rwp_engagement_feed_product(p_user uuid, p_limit integer, p_before timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('public.follows') is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(item order by (item ->> 'published_at')::timestamptz desc)
    from (
      select jsonb_build_object(
        'target_type', 'product',
        'target_id', p.id::text,
        'title', p.name,
        'url', '/product/' || p.slug,
        'image', p.image_url,
        'excerpt', nullif(btrim(regexp_replace(p.short_description, '<[^>]*>', ' ', 'g')), ''),
        'published_at', p.created_at,
        'author_id', p.author_id,
        'author_name', coalesce(nullif(pr.display_name, ''), 'Shop'),
        'category_name', null,
        'reason', 'author'
      ) as item
      from public.shop_products p
      join public.follows f on f.follower_id = p_user and f.following_id = p.author_id
      left join public.profiles pr on pr.id = p.author_id
      where p.status = 'publish' and p.catalog_visibility in ('visible', 'catalog')
        and (p_before is null or p.created_at < p_before)
      order by p.created_at desc
      limit least(greatest(coalesce(p_limit, 20), 1), 50)
    ) products
  ), '[]'::jsonb);
end;
$$;

do $$
begin
  if to_regclass('public.likes') is not null then
    execute 'drop trigger if exists shop_likes_maintain_counts on public.likes';
    execute 'create trigger shop_likes_maintain_counts after insert or delete on public.likes for each row execute function public.shop_likes_maintain_counts()';
  end if;
  if to_regclass('public.page_views') is not null then
    execute 'drop trigger if exists shop_views_maintain_counts on public.page_views';
    execute 'create trigger shop_views_maintain_counts after insert on public.page_views for each row execute function public.shop_views_maintain_counts()';
  end if;
end;
$$;

-- 2. Tables ----------------------------------------------------------------------------------------

create table if not exists public.shop_product_qa (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.shop_products(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Copied on insert: profiles is readable only when signed in, and questions are public.
  author_name text not null default '',
  question text not null,
  answer text,
  answered_by uuid references public.profiles(id) on delete set null,
  answered_at timestamptz,
  -- pending: waiting for the store; published: public (answering publishes); hidden: moderated away.
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.shop_product_offers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.shop_products(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  offered_price numeric(18,4) not null,
  -- The product's price when the offer was made, so the store sees what was offered against.
  list_price numeric(18,4),
  status text not null default 'pending',
  counter_price numeric(18,4),
  message text not null default '',
  response_message text not null default '',
  -- Set when accepted: the single-use coupon that gives the agreed price, and when it lapses.
  coupon_code text,
  expires_at timestamptz,
  responded_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_price_drop_alerts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.shop_products(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_price numeric(18,4) not null,
  is_notified boolean not null default false,
  notified_at timestamptz,
  notified_price numeric(18,4),
  -- Set by the server once the email went out (Shop -> Offers & Q&A -> Price alerts -> Send emails).
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint shop_price_drop_alerts_product_user_key unique (product_id, user_id)
);

create table if not exists public.shop_product_bundles (
  id uuid primary key default gen_random_uuid(),
  main_product_id uuid not null references public.shop_products(id) on delete cascade,
  suggested_product_id uuid not null references public.shop_products(id) on delete cascade,
  discount_percentage numeric(5,2) not null default 0,
  menu_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint shop_product_bundles_pair_key unique (main_product_id, suggested_product_id)
);

-- Constraints (dropped first so a re-run can change them) ------------------------------------------

alter table public.shop_product_qa drop constraint if exists shop_product_qa_status_check;
alter table public.shop_product_qa add constraint shop_product_qa_status_check check (status in ('pending', 'published', 'hidden'));
alter table public.shop_product_qa drop constraint if exists shop_product_qa_lengths;
alter table public.shop_product_qa add constraint shop_product_qa_lengths
  check (char_length(btrim(question)) between 3 and 1000 and char_length(coalesce(answer, '')) <= 5000);

alter table public.shop_product_offers drop constraint if exists shop_product_offers_status_check;
alter table public.shop_product_offers add constraint shop_product_offers_status_check
  check (status in ('pending', 'accepted', 'rejected', 'countered', 'withdrawn'));
alter table public.shop_product_offers drop constraint if exists shop_product_offers_amounts;
alter table public.shop_product_offers add constraint shop_product_offers_amounts
  check (offered_price > 0 and (counter_price is null or counter_price > 0));
alter table public.shop_product_offers drop constraint if exists shop_product_offers_lengths;
alter table public.shop_product_offers add constraint shop_product_offers_lengths
  check (char_length(message) <= 1000 and char_length(response_message) <= 1000);

alter table public.shop_price_drop_alerts drop constraint if exists shop_price_drop_alerts_target_positive;
alter table public.shop_price_drop_alerts add constraint shop_price_drop_alerts_target_positive check (target_price > 0);

alter table public.shop_product_bundles drop constraint if exists shop_product_bundles_not_self;
alter table public.shop_product_bundles add constraint shop_product_bundles_not_self check (main_product_id <> suggested_product_id);
alter table public.shop_product_bundles drop constraint if exists shop_product_bundles_discount_range;
alter table public.shop_product_bundles add constraint shop_product_bundles_discount_range check (discount_percentage between 0 and 90);

-- Indexes -----------------------------------------------------------------------------------------

create index if not exists shop_product_qa_product_idx on public.shop_product_qa (product_id, status, created_at desc);
create index if not exists shop_product_qa_status_idx on public.shop_product_qa (status, created_at desc);
create index if not exists shop_product_offers_product_idx on public.shop_product_offers (product_id, created_at desc);
create index if not exists shop_product_offers_status_idx on public.shop_product_offers (status, created_at desc);
create index if not exists shop_product_offers_user_idx on public.shop_product_offers (user_id, created_at desc);
-- One open negotiation per customer and product.
create unique index if not exists shop_product_offers_open_key
  on public.shop_product_offers (product_id, user_id) where status in ('pending', 'countered');
create index if not exists shop_price_drop_alerts_due_idx on public.shop_price_drop_alerts (product_id) where not is_notified;
create index if not exists shop_price_drop_alerts_unsent_idx on public.shop_price_drop_alerts (notified_at) where is_notified and emailed_at is null;
create index if not exists shop_product_bundles_main_idx on public.shop_product_bundles (main_product_id, menu_order);
create index if not exists shop_product_bundles_suggested_idx on public.shop_product_bundles (suggested_product_id);

-- 3. Helpers --------------------------------------------------------------------------------------

-- What one unit of a product costs right now: the cheapest enabled variation of a variable product.
create or replace function public.shop_product_current_price(p_product uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case p.type
    when 'variable' then (
      select min(public.shop_effective_price(v.regular_price, v.sale_price, v.sale_from, v.sale_to))
      from public.shop_variations v where v.product_id = p.id and v.enabled)
    else public.shop_effective_price(p.regular_price, p.sale_price, p.sale_from, p.sale_to)
  end
  from public.shop_products p where p.id = p_product;
$$;

-- 4. Product Q&A ----------------------------------------------------------------------------------

create or replace function public.shop_product_qa_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  manager boolean := public.user_has_cap('manage_shop');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Please log in to ask a question.';
  end if;
  if not coalesce((public.shop_settings() ->> 'enable_qa')::boolean, true) and not manager then
    raise exception using errcode = '42501', message = 'Questions are turned off for this shop (Shop -> Offers & Q&A -> Settings).';
  end if;
  if not exists (select 1 from public.shop_products where id = new.product_id and status = 'publish') then
    raise exception using errcode = '22023', message = 'This product is not available, so questions about it cannot be asked.';
  end if;
  if not manager and (select count(*) from public.shop_product_qa
      where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 5 then
    raise exception using errcode = '54000', message = 'You have asked 5 questions in the last hour. Please wait a little before asking another.';
  end if;
  new.user_id := auth.uid();
  new.question := btrim(new.question);
  select coalesce(nullif(display_name, ''), split_part(email, '@', 1)) into new.author_name from public.profiles where id = auth.uid();
  new.author_name := coalesce(new.author_name, 'Customer');
  if manager then
    if nullif(btrim(coalesce(new.answer, '')), '') is not null then
      new.answered_by := auth.uid();
      new.answered_at := now();
      new.status := case when new.status = 'hidden' then 'hidden' else 'published' end;
    end if;
  else
    new.answer := null;
    new.answered_by := null;
    new.answered_at := null;
    new.status := 'pending';
  end if;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists shop_product_qa_before_insert on public.shop_product_qa;
create trigger shop_product_qa_before_insert
  before insert on public.shop_product_qa
  for each row execute function public.shop_product_qa_before_insert();

-- Answering publishes a pending question and records who answered. The asker and product never change.
create or replace function public.shop_product_qa_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id := old.user_id;
  new.product_id := old.product_id;
  new.author_name := old.author_name;
  new.created_at := old.created_at;
  new.answer := nullif(btrim(coalesce(new.answer, '')), '');
  if new.answer is distinct from old.answer then
    new.answered_by := case when new.answer is null then null else coalesce(auth.uid(), old.answered_by) end;
    new.answered_at := case when new.answer is null then null else now() end;
    if new.answer is not null and new.status = 'pending' then
      new.status := 'published';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists shop_product_qa_before_update on public.shop_product_qa;
create trigger shop_product_qa_before_update
  before update on public.shop_product_qa
  for each row execute function public.shop_product_qa_before_update();

-- 5. Make an Offer --------------------------------------------------------------------------------

-- Creates the single-use coupon that gives the agreed price for one unit, for the buyer's email only.
create or replace function public.shop_offer_coupon(p_offer public.shop_product_offers, p_price numeric)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  s jsonb := public.shop_settings();
  d integer := coalesce((s ->> 'decimals')::int, 2);
  v_current numeric := public.shop_product_current_price(p_offer.product_id);
  v_email text;
  v_code text := 'OFFER-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
begin
  select lower(email) into v_email from auth.users where id = p_offer.user_id;
  v_email := coalesce(v_email, (select lower(email) from public.profiles where id = p_offer.user_id));
  if v_email is null then
    raise exception 'The customer who made this offer has no email address, so the offer price cannot be tied to their account.';
  end if;
  if v_current is null then
    raise exception 'This product has no price any more, so an offer price cannot be applied to it.';
  end if;
  insert into public.shop_coupons (
    code, description, discount_type, amount, expires_at, individual_use, product_ids, allowed_emails,
    usage_limit, usage_limit_per_user, limit_usage_to_x_items, active)
  values (
    v_code, format('Accepted offer %s: %s for one unit', p_offer.id, round(p_price, d)), 'fixed_product',
    greatest(round(v_current - p_price, d), 0),
    now() + make_interval(days => greatest(coalesce((s ->> 'offer_valid_days')::int, 7), 1)),
    true, array[p_offer.product_id], array[v_email], 1, 1, 1, true);
  return v_code;
end;
$$;

-- The buyer's side: makes an offer, or changes a pending one. Returns the offer.
create or replace function public.shop_make_offer(p_product_id uuid, p_offered_price numeric, p_message text default '')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  s jsonb := public.shop_settings();
  d integer := coalesce((s ->> 'decimals')::int, 2);
  v_uid uuid := auth.uid();
  v_product public.shop_products%rowtype;
  v_price numeric;
  v_min numeric;
  v_offer public.shop_product_offers%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Please log in to make an offer.';
  end if;
  if not coalesce((s ->> 'enable_offers')::boolean, true) then
    raise exception using errcode = '42501', message = 'This shop is not accepting offers at the moment.';
  end if;
  select * into v_product from public.shop_products where id = p_product_id and status = 'publish';
  if not found then
    raise exception using errcode = '22023', message = 'This product is not available, so no offer can be made on it.';
  end if;
  if v_product.type <> 'simple' then
    raise exception using errcode = '22023', message = 'Offers can only be made on simple products (not on products with options, groups or external links).';
  end if;
  if v_product.stock_status = 'outofstock' then
    raise exception using errcode = '22023', message = 'This product is out of stock, so it is not taking offers.';
  end if;
  v_price := public.shop_product_current_price(p_product_id);
  if v_price is null then
    raise exception using errcode = '22023', message = 'This product has no price, so an offer cannot be compared with it.';
  end if;
  p_offered_price := round(coalesce(p_offered_price, 0), d);
  if p_offered_price <= 0 then
    raise exception using errcode = '22023', message = 'Enter the amount you would like to pay.';
  end if;
  if p_offered_price >= v_price then
    raise exception using errcode = '22023', message = format('Your offer (%s) is not below the current price (%s). Just add the product to your cart.', p_offered_price, round(v_price, d));
  end if;
  v_min := round(v_price * least(greatest(coalesce((s ->> 'offer_min_percent')::numeric, 50), 0), 100) / 100, d);
  if p_offered_price < v_min then
    raise exception using errcode = '22023', message = format('Offers below %s%% of the price are not accepted. The lowest offer for this product is %s.', (s ->> 'offer_min_percent'), v_min);
  end if;
  if char_length(coalesce(p_message, '')) > 1000 then
    raise exception using errcode = '22023', message = 'The message can be at most 1,000 characters long.';
  end if;

  select * into v_offer from public.shop_product_offers
  where product_id = p_product_id and user_id = v_uid and status in ('pending', 'countered') for update;
  if found and v_offer.status = 'countered' then
    raise exception using errcode = '22023', message = format('The store has made you a counter-offer of %s. Accept or decline it before making a new offer.', round(v_offer.counter_price, d));
  end if;
  if found then
    update public.shop_product_offers set offered_price = p_offered_price, list_price = v_price,
      message = coalesce(btrim(p_message), ''), updated_at = now()
    where id = v_offer.id returning * into v_offer;
    return to_jsonb(v_offer);
  end if;

  if (select count(*) from public.shop_product_offers where user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception using errcode = '54000', message = 'You have made 20 offers today, the most allowed. Please try again tomorrow.';
  end if;
  insert into public.shop_product_offers (product_id, user_id, offered_price, list_price, message)
  values (p_product_id, v_uid, p_offered_price, v_price, coalesce(btrim(p_message), ''))
  returning * into v_offer;
  return to_jsonb(v_offer);
end;
$$;

-- The store's side (manage_shop): accept, reject or counter a pending offer.
create or replace function public.shop_respond_to_offer(p_offer_id uuid, p_action text, p_counter_price numeric default null, p_message text default '')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  s jsonb := public.shop_settings();
  d integer := coalesce((s ->> 'decimals')::int, 2);
  v_offer public.shop_product_offers%rowtype;
  v_price numeric;
begin
  if not public.user_has_cap('manage_shop') then
    raise exception using errcode = '42501', message = 'Only shop managers can answer offers. It needs the manage_shop capability.';
  end if;
  select * into v_offer from public.shop_product_offers where id = p_offer_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'This offer no longer exists.';
  end if;
  if v_offer.status <> 'pending' then
    raise exception using errcode = '22023', message = format('This offer is already %s, so it cannot be answered again.', v_offer.status);
  end if;
  if char_length(coalesce(p_message, '')) > 1000 then
    raise exception using errcode = '22023', message = 'The message can be at most 1,000 characters long.';
  end if;

  if p_action = 'accept' then
    update public.shop_product_offers set status = 'accepted', coupon_code = public.shop_offer_coupon(v_offer, v_offer.offered_price),
      expires_at = now() + make_interval(days => greatest(coalesce((s ->> 'offer_valid_days')::int, 7), 1)),
      response_message = coalesce(btrim(p_message), ''), responded_by = auth.uid(), responded_at = now(), updated_at = now()
    where id = v_offer.id returning * into v_offer;
  elsif p_action = 'reject' then
    update public.shop_product_offers set status = 'rejected',
      response_message = coalesce(btrim(p_message), ''), responded_by = auth.uid(), responded_at = now(), updated_at = now()
    where id = v_offer.id returning * into v_offer;
  elsif p_action = 'counter' then
    v_price := public.shop_product_current_price(v_offer.product_id);
    p_counter_price := round(coalesce(p_counter_price, 0), d);
    if p_counter_price <= v_offer.offered_price then
      raise exception using errcode = '22023', message = format('A counter-offer must be higher than the customer''s offer of %s; to agree to that amount, accept the offer instead.', round(v_offer.offered_price, d));
    end if;
    if v_price is not null and p_counter_price >= v_price then
      raise exception using errcode = '22023', message = format('A counter-offer must be below the current price of %s.', round(v_price, d));
    end if;
    update public.shop_product_offers set status = 'countered', counter_price = p_counter_price,
      response_message = coalesce(btrim(p_message), ''), responded_by = auth.uid(), responded_at = now(), updated_at = now()
    where id = v_offer.id returning * into v_offer;
  else
    raise exception using errcode = '22023', message = format('Unknown action "%s": use accept, reject or counter.', p_action);
  end if;
  return to_jsonb(v_offer);
end;
$$;

-- The buyer's answer to a counter-offer. Accepting creates the coupon at the counter price.
create or replace function public.shop_answer_counter_offer(p_offer_id uuid, p_accept boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  s jsonb := public.shop_settings();
  v_offer public.shop_product_offers%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Please log in to answer this offer.';
  end if;
  select * into v_offer from public.shop_product_offers where id = p_offer_id and user_id = auth.uid() for update;
  if not found then
    raise exception using errcode = '22023', message = 'This offer does not exist or is not yours.';
  end if;
  if v_offer.status <> 'countered' then
    raise exception using errcode = '22023', message = format('This offer is %s, not a counter-offer waiting for your answer.', v_offer.status);
  end if;
  if coalesce(p_accept, false) then
    update public.shop_product_offers set status = 'accepted', coupon_code = public.shop_offer_coupon(v_offer, v_offer.counter_price),
      expires_at = now() + make_interval(days => greatest(coalesce((s ->> 'offer_valid_days')::int, 7), 1)), updated_at = now()
    where id = v_offer.id returning * into v_offer;
  else
    update public.shop_product_offers set status = 'withdrawn', updated_at = now()
    where id = v_offer.id returning * into v_offer;
  end if;
  return to_jsonb(v_offer);
end;
$$;

create or replace function public.shop_withdraw_offer(p_offer_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_offer public.shop_product_offers%rowtype;
begin
  update public.shop_product_offers set status = 'withdrawn', updated_at = now()
  where id = p_offer_id and user_id = auth.uid() and status in ('pending', 'countered')
  returning * into v_offer;
  if not found then
    raise exception using errcode = '22023', message = 'Only your own pending or countered offers can be withdrawn.';
  end if;
  return to_jsonb(v_offer);
end;
$$;

-- 6. Price-drop alerts ----------------------------------------------------------------------------

create or replace function public.shop_set_price_alert(p_product_id uuid, p_target_price numeric)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  s jsonb := public.shop_settings();
  d integer := coalesce((s ->> 'decimals')::int, 2);
  v_price numeric;
  v_alert public.shop_price_drop_alerts%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Please log in to get price alerts.';
  end if;
  if not coalesce((s ->> 'enable_price_alerts')::boolean, true) then
    raise exception using errcode = '42501', message = 'Price alerts are turned off for this shop.';
  end if;
  if not exists (select 1 from public.shop_products where id = p_product_id and status = 'publish') then
    raise exception using errcode = '22023', message = 'This product is not available, so no price alert can be set for it.';
  end if;
  v_price := public.shop_product_current_price(p_product_id);
  p_target_price := round(coalesce(p_target_price, 0), d);
  if p_target_price <= 0 then
    raise exception using errcode = '22023', message = 'Enter the price you are waiting for.';
  end if;
  if v_price is not null and p_target_price >= v_price then
    raise exception using errcode = '22023', message = format('The price is already %s, at or below %s. Alerts are for a price lower than today''s.', round(v_price, d), p_target_price);
  end if;
  if (select count(*) from public.shop_price_drop_alerts where user_id = auth.uid()) >= 200
     and not exists (select 1 from public.shop_price_drop_alerts where user_id = auth.uid() and product_id = p_product_id) then
    raise exception using errcode = '54000', message = 'You have 200 price alerts, the most one account can keep. Remove some first.';
  end if;
  insert into public.shop_price_drop_alerts (product_id, user_id, target_price)
  values (p_product_id, auth.uid(), p_target_price)
  on conflict (product_id, user_id) do update set target_price = excluded.target_price,
    is_notified = false, notified_at = null, notified_price = null, emailed_at = null, created_at = now()
  returning * into v_alert;
  return to_jsonb(v_alert);
end;
$$;

-- Marks alerts whose target the current price has reached. Called by the price triggers below for one
-- product, and by shop managers (and the email route) for every product with p_product null, which
-- also catches scheduled sales that started without anyone saving the product.
create or replace function public.shop_check_price_alerts(p_product_id uuid default null)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_marked integer;
begin
  if p_product_id is null and auth.uid() is not null and not public.user_has_cap('manage_shop') then
    raise exception using errcode = '42501', message = 'Only shop managers can check every price alert at once. It needs the manage_shop capability.';
  end if;
  update public.shop_price_drop_alerts a
  set is_notified = true, notified_at = now(), notified_price = current.price
  from (
    select p.id, public.shop_product_current_price(p.id) as price
    from public.shop_products p
    where p.status = 'publish' and (p_product_id is null or p.id = p_product_id)
  ) current
  where a.product_id = current.id and not a.is_notified
    and current.price is not null and current.price <= a.target_price;
  get diagnostics v_marked = row_count;
  return v_marked;
end;
$$;

-- Two small trigger functions, because shop_products and shop_variations name the product differently.
create or replace function public.shop_products_price_alerts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.shop_check_price_alerts(new.id);
  return null;
end;
$$;

create or replace function public.shop_variations_price_alerts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.shop_check_price_alerts(new.product_id);
  return null;
end;
$$;

drop trigger if exists shop_products_price_alerts on public.shop_products;
create trigger shop_products_price_alerts
  after update of regular_price, sale_price, sale_from, sale_to, status on public.shop_products
  for each row execute function public.shop_products_price_alerts();

drop trigger if exists shop_variations_price_alerts on public.shop_variations;
create trigger shop_variations_price_alerts
  after insert or update of regular_price, sale_price, sale_from, sale_to, enabled on public.shop_variations
  for each row execute function public.shop_variations_price_alerts();

-- 7. Frequently bought together -------------------------------------------------------------------

-- Called by shop_calculate after the cart lines are priced. A suggested product gets the best bundle
-- discount from any of its main products that is also in the cart, for as many units as there are of
-- that main product. Returns { lines, notices }.
create or replace function public.shop_apply_bundle_discounts(p_lines jsonb[], p_decimals integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_lines jsonb[] := coalesce(p_lines, '{}'::jsonb[]);
  v_notices jsonb := '[]'::jsonb;
  i integer;
  line jsonb;
  best record;
  units integer;
  amount numeric;
begin
  if cardinality(v_lines) < 2 then
    return jsonb_build_object('lines', to_jsonb(v_lines), 'notices', v_notices);
  end if;
  for i in 1..cardinality(v_lines) loop
    line := v_lines[i];
    select b.discount_percentage, b.main_product_id, mp.name as main_name,
      (select sum((l ->> 'quantity')::int) from unnest(p_lines) l where l ->> 'product_id' = b.main_product_id::text) as main_quantity
    into best
    from public.shop_product_bundles b
    join public.shop_products mp on mp.id = b.main_product_id
    where b.suggested_product_id = public.shop_try_uuid(line ->> 'product_id')
      and b.discount_percentage > 0
      and exists (select 1 from unnest(p_lines) l where l ->> 'product_id' = b.main_product_id::text)
    order by b.discount_percentage desc, b.menu_order
    limit 1;
    continue when not found;
    units := least((line ->> 'quantity')::int, coalesce(best.main_quantity, 0));
    continue when units <= 0;
    amount := round((line ->> 'unit_price')::numeric * units * best.discount_percentage / 100, p_decimals);
    amount := least(amount, (line ->> 'line_base')::numeric - (line ->> 'discount')::numeric);
    continue when amount <= 0;
    v_lines[i] := line || jsonb_build_object(
      'discount', (line ->> 'discount')::numeric + amount,
      'bundle_discount', amount,
      'bundle_main_product_id', best.main_product_id);
    v_notices := v_notices || to_jsonb(format('Bought together with "%s": %s%% off "%s".',
      best.main_name, best.discount_percentage::float8, line ->> 'product_name'));
  end loop;
  return jsonb_build_object('lines', to_jsonb(v_lines), 'notices', v_notices);
end;
$$;

-- 8. Row level security ---------------------------------------------------------------------------

alter table public.shop_product_qa enable row level security;
alter table public.shop_product_offers enable row level security;
alter table public.shop_price_drop_alerts enable row level security;
alter table public.shop_product_bundles enable row level security;

drop policy if exists "Public can read published questions" on public.shop_product_qa;
create policy "Public can read published questions"
  on public.shop_product_qa for select to anon, authenticated
  using (status = 'published' or user_id = auth.uid() or public.user_has_cap('manage_shop'));
drop policy if exists "Members can ask questions" on public.shop_product_qa;
create policy "Members can ask questions"
  on public.shop_product_qa for insert to authenticated with check (true);
drop policy if exists "Shop managers answer questions" on public.shop_product_qa;
create policy "Shop managers answer questions"
  on public.shop_product_qa for update to authenticated
  using (public.user_has_cap('manage_shop')) with check (public.user_has_cap('manage_shop'));
drop policy if exists "Askers and shop managers delete questions" on public.shop_product_qa;
create policy "Askers and shop managers delete questions"
  on public.shop_product_qa for delete to authenticated
  using ((user_id = auth.uid() and answer is null) or public.user_has_cap('manage_shop'));

-- Offers change only through the functions above; customers and managers can read them.
drop policy if exists "Customers and shop managers read offers" on public.shop_product_offers;
create policy "Customers and shop managers read offers"
  on public.shop_product_offers for select to authenticated
  using (user_id = auth.uid() or public.user_has_cap('manage_shop'));
drop policy if exists "Shop managers delete offers" on public.shop_product_offers;
create policy "Shop managers delete offers"
  on public.shop_product_offers for delete to authenticated
  using (public.user_has_cap('manage_shop'));

drop policy if exists "Customers and shop managers read price alerts" on public.shop_price_drop_alerts;
create policy "Customers and shop managers read price alerts"
  on public.shop_price_drop_alerts for select to authenticated
  using (user_id = auth.uid() or public.user_has_cap('manage_shop'));
drop policy if exists "Customers remove their price alerts" on public.shop_price_drop_alerts;
create policy "Customers remove their price alerts"
  on public.shop_price_drop_alerts for delete to authenticated
  using (user_id = auth.uid() or public.user_has_cap('manage_shop'));
-- The email route marks alerts as sent with the manager's own session.
drop policy if exists "Shop managers update price alerts" on public.shop_price_drop_alerts;
create policy "Shop managers update price alerts"
  on public.shop_price_drop_alerts for update to authenticated
  using (public.user_has_cap('manage_shop')) with check (public.user_has_cap('manage_shop'));

drop policy if exists "Public can read product bundles" on public.shop_product_bundles;
create policy "Public can read product bundles"
  on public.shop_product_bundles for select to anon, authenticated using (true);
drop policy if exists "Shop managers write product bundles" on public.shop_product_bundles;
create policy "Shop managers write product bundles"
  on public.shop_product_bundles for all to authenticated
  using (public.user_has_cap('manage_shop')) with check (public.user_has_cap('manage_shop'));

revoke all on table public.shop_product_offers from anon;
revoke all on table public.shop_price_drop_alerts from anon;
revoke insert, update, delete on table public.shop_product_qa from anon;
revoke insert, update, delete on table public.shop_product_bundles from anon;

-- 9. Function privileges --------------------------------------------------------------------------

revoke execute on function public.rwp_engagement_target_product(text) from public, anon, authenticated;
revoke execute on function public.rwp_engagement_feed_product(uuid, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.shop_products_guard_engagement_counts() from public, anon, authenticated;
revoke execute on function public.shop_likes_maintain_counts() from public, anon, authenticated;
revoke execute on function public.shop_views_maintain_counts() from public, anon, authenticated;
revoke execute on function public.shop_products_forget_engagement() from public, anon, authenticated;
revoke execute on function public.shop_product_qa_before_insert() from public, anon, authenticated;
revoke execute on function public.shop_product_qa_before_update() from public, anon, authenticated;
revoke execute on function public.shop_offer_coupon(public.shop_product_offers, numeric) from public, anon, authenticated;
revoke execute on function public.shop_products_price_alerts() from public, anon, authenticated;
revoke execute on function public.shop_variations_price_alerts() from public, anon, authenticated;
revoke execute on function public.shop_apply_bundle_discounts(jsonb[], integer) from public, anon, authenticated;

grant execute on function public.shop_product_current_price(uuid) to anon, authenticated;
revoke execute on function public.shop_make_offer(uuid, numeric, text) from public, anon;
revoke execute on function public.shop_respond_to_offer(uuid, text, numeric, text) from public, anon;
revoke execute on function public.shop_answer_counter_offer(uuid, boolean) from public, anon;
revoke execute on function public.shop_withdraw_offer(uuid) from public, anon;
revoke execute on function public.shop_set_price_alert(uuid, numeric) from public, anon;
revoke execute on function public.shop_check_price_alerts(uuid) from public, anon;
grant execute on function public.shop_make_offer(uuid, numeric, text) to authenticated;
grant execute on function public.shop_respond_to_offer(uuid, text, numeric, text) to authenticated;
grant execute on function public.shop_answer_counter_offer(uuid, boolean) to authenticated;
grant execute on function public.shop_withdraw_offer(uuid) to authenticated;
grant execute on function public.shop_set_price_alert(uuid, numeric) to authenticated;
grant execute on function public.shop_check_price_alerts(uuid) to authenticated;

notify pgrst, 'reload schema';
