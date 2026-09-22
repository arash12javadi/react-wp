-- rwp-shop: product likes/saves/views, Product Q&A, Make an Offer, price-drop alerts and
-- Frequently Bought Together. Safe to re-run.
--
-- For a site where the shop is already active: run supabase/migrations/20261004_engagement.sql first
-- (so products can be liked, saved and counted), then this file, in the Supabase SQL Editor.
-- Activating the shop on npm start runs plugins/rwp-shop/schema.sql, which contains all of this.
--
-- It replaces two existing functions with their new versions from plugins/rwp-shop/schema.sql:
--   * shop_settings(): defaults for enable_qa, enable_offers, offer_min_percent, offer_valid_days and
--     enable_price_alerts;
--   * shop_calculate(): applies Frequently Bought Together discounts (shop_apply_bundle_discounts)
--     after pricing the cart lines and before coupons.

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
