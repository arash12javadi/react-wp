-- rwp-shop: backup and restore of the shop (Shop -> Backup). Safe to re-run: it only creates or
-- replaces functions and revokes/grants their privileges.
--
-- For a site where the shop is already active: run this file in the Supabase SQL Editor.
-- Activating the shop on npm start runs plugins/rwp-shop/schema.sql, which contains all of this.

-- Shop backup and restore -------------------------------------------------------------------------
-- Kept identical to supabase/migrations/20261006_shop_backup.sql from this point on.
--
-- A shop backup is JSON: { format: 'rwp-shop-backup', version: 1, sections, tables, users }.
-- shop_backup_export returns the tables of the chosen sections; shop_backup_import writes them back
-- in one transaction, with a mode per section:
--   update     rows that already exist are overwritten, the rest are added;
--   skip       rows that already exist are left as they are, the rest are added;
--   replace    like update, then the section's rows that are not in the backup are deleted;
--   duplicate  every row is added as a new one (products and coupons only): new ids, and a slug or
--              coupon code that is taken gets a -2 suffix, a taken SKU is cleared.
-- Existing rows are found by id first, then by what identifies them to a person (slug, SKU, coupon
-- code, order key, ...), so a backup from another site updates the same products instead of adding
-- them twice. Every reference inside the backup (category parent, variation -> product, order item
-- -> product, coupon -> products, shipping class costs, ...) is re-pointed to the row it became.
-- Accounts cannot be created (a backup holds no passwords): references to people are matched by
-- email, and cleared (or the row skipped, when it cannot exist without its account) otherwise.
--
-- The helpers below take table names and SQL fragments, so they are executable by nobody but their
-- owner; shop_backup_import is the only way in, and it only passes constants.

create or replace function public.shop_backup_label(p_table text)
returns text language sql immutable as $$
  select case p_table
    when 'options' then 'shop settings'
    when 'shop_categories' then 'product categories'
    when 'shop_tags' then 'product tags'
    when 'shop_attributes' then 'product attributes'
    when 'shop_attribute_terms' then 'attribute terms'
    when 'shop_shipping_classes' then 'shipping classes'
    when 'shop_products' then 'products'
    when 'shop_product_categories' then 'product category links'
    when 'shop_product_tags' then 'product tag links'
    when 'shop_variations' then 'product variations'
    when 'shop_product_downloads' then 'downloadable files'
    when 'shop_customers' then 'customer addresses'
    when 'shop_coupons' then 'coupons'
    when 'shop_tax_rates' then 'tax rates'
    when 'shop_shipping_zones' then 'shipping zones'
    when 'shop_shipping_methods' then 'shipping methods'
    when 'shop_orders' then 'orders'
    when 'shop_order_items' then 'order items'
    when 'shop_order_notes' then 'order notes'
    when 'shop_refunds' then 'refunds'
    when 'shop_reviews' then 'reviews'
    when 'shop_product_qa' then 'questions'
    when 'shop_product_offers' then 'offers'
    when 'shop_price_drop_alerts' then 'price alerts'
    when 'shop_product_bundles' then 'bundles'
    else p_table
  end;
$$;

-- The tables of each section, in the order they are exported and imported.
create or replace function public.shop_backup_tables(p_section text)
returns text[] language sql immutable as $$
  select case p_section
    when 'settings' then array['options', 'shop_shipping_classes', 'shop_tax_rates', 'shop_shipping_zones', 'shop_shipping_methods']
    when 'products' then array['shop_categories', 'shop_tags', 'shop_attributes', 'shop_attribute_terms', 'shop_shipping_classes',
      'shop_products', 'shop_product_categories', 'shop_product_tags', 'shop_variations', 'shop_product_downloads']
    when 'customers' then array['shop_customers']
    when 'coupons' then array['shop_coupons']
    when 'orders' then array['shop_orders', 'shop_order_items', 'shop_order_notes', 'shop_refunds']
    when 'reviews' then array['shop_reviews']
    when 'questions' then array['shop_product_qa']
    when 'offers' then array['shop_product_offers']
    when 'alerts' then array['shop_price_drop_alerts']
    when 'bundles' then array['shop_product_bundles']
  end;
$$;

create or replace function public.shop_backup_export(p_sections text[], p_options jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_trash boolean := coalesce((p_options ->> 'include_trash')::boolean, true);
  v_section text;
  v_table text;
  v_rows jsonb;
  v_tables jsonb := '{}'::jsonb;
  v_references jsonb := '{}'::jsonb;
  v_users jsonb;
begin
  if not public.user_has_cap('manage_shop') then
    raise exception using errcode = '42501',
      message = 'Only shop managers can export a shop backup. It needs the manage_shop capability, and your role does not have it.';
  end if;
  if coalesce(cardinality(p_sections), 0) = 0 then
    raise exception using errcode = '22023', message = 'Choose at least one part of the shop to export.';
  end if;
  foreach v_section in array p_sections loop
    if public.shop_backup_tables(v_section) is null then
      raise exception using errcode = '22023', message = format('Unknown backup section "%s".', v_section);
    end if;
  end loop;
  begin
    v_from := nullif(p_options ->> 'orders_from', '')::timestamptz;
    v_to := nullif(p_options ->> 'orders_to', '')::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'The order date range is not a valid date.';
  end;

  foreach v_section in array p_sections loop
    foreach v_table in array public.shop_backup_tables(v_section) loop
      continue when v_tables ? v_table;
      if to_regclass(format('public.%I', v_table)) is null then
        -- A table from a migration this site has not run yet (the Q&A, offers, alerts and bundles tables).
        v_tables := v_tables || jsonb_build_object(v_table, '[]'::jsonb);
        continue;
      end if;
      v_rows := case v_table
        when 'options' then (select coalesce(jsonb_agg(to_jsonb(t) order by t.option_name), '[]'::jsonb)
          from public.options t where t.option_name like 'shop\_%')
        when 'shop_products' then (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at, t.id), '[]'::jsonb)
          from public.shop_products t where v_trash or t.status <> 'trash')
        when 'shop_product_categories' then (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
          from public.shop_product_categories t join public.shop_products p on p.id = t.product_id where v_trash or p.status <> 'trash')
        when 'shop_product_tags' then (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
          from public.shop_product_tags t join public.shop_products p on p.id = t.product_id where v_trash or p.status <> 'trash')
        when 'shop_variations' then (select coalesce(jsonb_agg(to_jsonb(t) order by t.product_id, t.menu_order, t.created_at), '[]'::jsonb)
          from public.shop_variations t join public.shop_products p on p.id = t.product_id where v_trash or p.status <> 'trash')
        when 'shop_product_downloads' then (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb)
          from public.shop_product_downloads t join public.shop_products p on p.id = t.product_id where v_trash or p.status <> 'trash')
        when 'shop_orders' then (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
          from public.shop_orders t
          where (v_from is null or t.created_at >= v_from) and (v_to is null or t.created_at < v_to))
        when 'shop_order_items' then (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
          from public.shop_order_items t join public.shop_orders o on o.id = t.order_id
          where (v_from is null or o.created_at >= v_from) and (v_to is null or o.created_at < v_to))
        when 'shop_order_notes' then (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
          from public.shop_order_notes t join public.shop_orders o on o.id = t.order_id
          where (v_from is null or o.created_at >= v_from) and (v_to is null or o.created_at < v_to))
        when 'shop_refunds' then (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
          from public.shop_refunds t join public.shop_orders o on o.id = t.order_id
          where (v_from is null or o.created_at >= v_from) and (v_to is null or o.created_at < v_to))
        else null
      end;
      if v_rows is null then
        execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t', v_table) into v_rows;
      end if;
      v_tables := v_tables || jsonb_build_object(v_table, v_rows);
    end loop;
  end loop;

  -- Without the products section, what identifies each product (and category, variation, file) still
  -- travels along, so reviews or orders imported into another site find the same product by slug or SKU.
  if not ('products' = any (p_sections))
    and p_sections && array['coupons', 'orders', 'reviews', 'questions', 'offers', 'alerts', 'bundles'] then
    v_references := jsonb_build_object(
      'shop_products', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'slug', p.slug, 'sku', p.sku)), '[]'::jsonb)
        from public.shop_products p),
      'shop_categories', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug)), '[]'::jsonb)
        from public.shop_categories c),
      'shop_variations', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'product_id', v.product_id, 'attributes', v.attributes)), '[]'::jsonb)
        from public.shop_variations v),
      'shop_product_downloads', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', d.id, 'product_id', d.product_id, 'variation_id', d.variation_id, 'url', d.url)), '[]'::jsonb)
        from public.shop_product_downloads d));
  end if;

  -- The accounts the exported rows point at, so the import can find them again by email.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'email', coalesce(u.email, p.email), 'display_name', p.display_name) order by p.id), '[]'::jsonb)
  into v_users
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id in (
    select public.shop_try_uuid(r ->> c.col)
    from (values ('shop_products', 'author_id'), ('shop_orders', 'customer_id'), ('shop_order_notes', 'created_by'),
      ('shop_refunds', 'created_by'), ('shop_customers', 'id'), ('shop_reviews', 'author_id'), ('shop_product_qa', 'user_id'),
      ('shop_product_qa', 'answered_by'), ('shop_product_offers', 'user_id'), ('shop_product_offers', 'responded_by'),
      ('shop_price_drop_alerts', 'user_id')) c(tbl, col)
    cross join lateral jsonb_array_elements(coalesce(v_tables -> c.tbl, '[]'::jsonb)) r);

  return jsonb_build_object(
    'format', 'rwp-shop-backup',
    'version', 1,
    'created_at', timezone('utc'::text, now()),
    'sections', to_jsonb(p_sections),
    'options', coalesce(p_options, '{}'::jsonb),
    'tables', v_tables,
    'references', v_references,
    'users', v_users
  );
end;
$$;

-- What a row id from the backup is on this site: the row it was imported as, else the same id when
-- this site has such a row, else null. '@user' looks up accounts (matched by email beforehand).
create or replace function public.shop_backup_resolve(p_table text, p_old text)
returns text language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_new text;
  v_type text;
  v_found boolean;
begin
  if coalesce(p_old, '') = '' then
    return null;
  end if;
  if p_table = '@user' then
    select u.new_id::text into v_new from pg_temp.shop_bk_users u where u.old_id = p_old;
    if v_new is not null then
      return v_new;
    end if;
    return (select p.id::text from public.profiles p where p.id = public.shop_try_uuid(p_old));
  end if;
  select m.new_id into v_new from pg_temp.shop_bk_map m where m.tbl = p_table and m.old_id = p_old;
  if v_new is not null then
    return v_new;
  end if;
  if to_regclass(format('public.%I', p_table)) is null then
    return null;
  end if;
  select format_type(a.atttypid, a.atttypmod) into v_type
  from pg_attribute a where a.attrelid = format('public.%I', p_table)::regclass and a.attname = 'id';
  if v_type = 'uuid' then
    if public.shop_try_uuid(p_old) is null then
      return null;
    end if;
  elsif p_old !~ '^[0-9]{1,18}$' then
    return null;
  end if;
  execute format('select exists (select 1 from public.%I where id = $1::%s)', p_table, v_type) into v_found using p_old;
  return case when v_found then p_old end;
end;
$$;

-- Re-points the references in one backup row. p_refs maps a column to what it references:
--   "shop_products"                a column holding one id;
--   "[]shop_products"              a JSON/uuid[] array of ids (unknown ids are dropped);
--   "{}shop_shipping_classes"      an object keyed by ids (non-id keys such as "none" are kept);
--   "[attribute_id]shop_attributes" an array of objects whose attribute_id field is an id;
--   "@user"                        an account.
create or replace function public.shop_backup_remap(p_row jsonb, p_refs jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_col text;
  v_spec text;
  v_target text;
  v_field text;
  v_value jsonb;
begin
  for v_col, v_spec in select key, value from jsonb_each_text(coalesce(p_refs, '{}'::jsonb)) loop
    v_value := p_row -> v_col;
    continue when v_value is null or v_value = 'null'::jsonb;
    if v_spec like '[]%' then
      v_target := substr(v_spec, 3);
      v_value := coalesce((
        select jsonb_agg(to_jsonb(s.ref) order by s.n)
        from (
          select e.n, public.shop_backup_resolve(v_target, e.value) as ref
          from jsonb_array_elements_text(case when jsonb_typeof(v_value) = 'array' then v_value else '[]'::jsonb end)
            with ordinality e(value, n)
        ) s
        where s.ref is not null), '[]'::jsonb);
    elsif v_spec like '{}%' then
      v_target := substr(v_spec, 3);
      v_value := coalesce((
        select jsonb_object_agg(coalesce(s.ref, s.key), s.value)
        from (
          select e.key, e.value, e.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' as is_id,
            public.shop_backup_resolve(v_target, e.key) as ref
          from jsonb_each(case when jsonb_typeof(v_value) = 'object' then v_value else '{}'::jsonb end) e
        ) s
        where not s.is_id or s.ref is not null), '{}'::jsonb);
    elsif v_spec like '[%]%' then
      v_field := substring(v_spec from '^\[([a-z_]+)\]');
      v_target := substring(v_spec from '^\[[a-z_]+\](.+)$');
      v_value := coalesce((
        select jsonb_agg(case
            when jsonb_typeof(e.value) = 'object' and coalesce(e.value -> v_field, 'null'::jsonb) <> 'null'::jsonb then
              jsonb_set(e.value, array[v_field], coalesce(
                case when jsonb_typeof(e.value -> v_field) = 'number'
                  then to_jsonb((public.shop_backup_resolve(v_target, e.value ->> v_field))::numeric)
                  else to_jsonb(public.shop_backup_resolve(v_target, e.value ->> v_field)) end,
                'null'::jsonb))
            else e.value end order by e.n)
        from jsonb_array_elements(case when jsonb_typeof(v_value) = 'array' then v_value else '[]'::jsonb end)
          with ordinality e(value, n)), '[]'::jsonb);
    else
      v_value := coalesce(to_jsonb(public.shop_backup_resolve(v_spec, p_row ->> v_col)), 'null'::jsonb);
    end if;
    p_row := jsonb_set(p_row, array[v_col], v_value);
  end loop;
  return p_row;
end;
$$;

-- Imports the rows of one table. p_match is a condition between an existing row x and the incoming
-- row r (a record of the table's type) that says they are the same thing. p_parent names the column
-- of a child table (variations, order items, ...): a child follows its parent, so the children of a
-- parent that was left alone are left alone, and an updated parent loses the children the backup
-- does not have. p_unique lists the columns duplicate mode must keep unique ("suffix" or "clear").
-- p_mode 'match' writes nothing: it only records which existing row each backup row is, for parts
-- that are imported without the rows they point at (reviews without products, for example).
create or replace function public.shop_backup_put(
  p_table text, p_rows jsonb, p_mode text, p_match text,
  p_refs jsonb default '{}'::jsonb, p_parent text default null, p_unique jsonb default '{}'::jsonb)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_rel regclass := to_regclass(format('public.%I', p_table));
  v_pk_type text;
  v_seq text;
  v_parent_table text := p_refs ->> p_parent;
  v_parent_type text;
  v_row record;
  v_col text;
  v_how text;
  v_value text;
  v_candidate text;
  v_suffix integer;
  v_taken boolean;
  v_cleared integer := 0;
  v_cols text[];
  v_base bigint;
  v_last bigint;
  v_added bigint;
  v_deleted bigint;
  v_state text;
  v_detail text;
begin
  if v_rel is null or p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return;
  end if;
  select format_type(a.atttypid, a.atttypmod) into v_pk_type from pg_attribute a where a.attrelid = v_rel and a.attname = 'id';
  v_seq := pg_get_serial_sequence(format('public.%I', p_table), 'id');

  truncate pg_temp.shop_bk_rows;
  insert into pg_temp.shop_bk_rows (ord, old_id, src, rec)
  select e.n, coalesce(e.value ->> 'id', 'row:' || e.n), e.value, public.shop_backup_remap(e.value, p_refs)
  from jsonb_array_elements(p_rows) with ordinality e(value, n)
  where jsonb_typeof(e.value) = 'object';

  -- A row that needs an account, product or order this site does not have cannot be imported.
  update pg_temp.shop_bk_rows b set action = 'dropped'
  where p_mode <> 'match' and exists (
    select 1 from jsonb_object_keys(p_refs) k
    join pg_attribute a on a.attrelid = v_rel and a.attname = k and a.attnotnull
    where coalesce(b.rec -> k, 'null'::jsonb) = 'null'::jsonb);

  if p_mode <> 'duplicate' then
    begin
      execute format(
        'update pg_temp.shop_bk_rows b set existing = (
           select x.id::text from public.%1$I x, jsonb_populate_record(null::public.%1$I, b.rec) r
           where %2$s
           order by (x.id = r.id) is true desc
           limit 1)
         where b.action is null', p_table, p_match);
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      raise exception using errcode = v_state,
        message = format('Reading the %s in the backup failed: %s', public.shop_backup_label(p_table), sqlerrm);
    end;
  end if;

  if p_mode = 'match' then
    insert into pg_temp.shop_bk_map (tbl, old_id, new_id, action)
    select distinct on (b.old_id) p_table, b.old_id, b.existing, 'matched'
    from pg_temp.shop_bk_rows b
    order by b.old_id, b.ord desc
    on conflict (tbl, old_id) do nothing;
    return;
  end if;

  if p_parent is not null then
    update pg_temp.shop_bk_rows b set action = 'skipped', new_id = b.existing
    from pg_temp.shop_bk_map m
    where b.action is null and m.tbl = v_parent_table and m.old_id = b.src ->> p_parent and m.action = 'skipped';
  end if;

  update pg_temp.shop_bk_rows b set
    action = case when b.existing is null then 'inserted' when p_mode = 'skip' then 'skipped' else 'updated' end,
    new_id = b.existing
  where b.action is null;

  -- New rows keep the backup's id when this site does not use it, so order numbers, links between
  -- products and download links in sent emails stay valid.
  if p_mode <> 'duplicate' then
    execute format(
      'update pg_temp.shop_bk_rows b set new_id = b.rec ->> ''id''
       where b.action = ''inserted'' and coalesce(b.rec ->> ''id'', '''') <> ''''
         and not exists (select 1 from public.%1$I x where x.id = (b.rec ->> ''id'')::%2$s)', p_table, v_pk_type);
  end if;

  -- The others get a fresh one. Numbered tables are counted on from the highest number in use, without
  -- nextval, so a preview does not use up order numbers (sequences ignore rollbacks).
  if v_seq is not null then
    execute format('select greatest(coalesce((select max(id) from public.%I), 0), (select case when is_called then last_value else last_value - 1 end from %s))',
      p_table, v_seq) into v_base;
    v_base := greatest(v_base, coalesce((select max(b.new_id::bigint) from pg_temp.shop_bk_rows b where b.action = 'inserted' and b.new_id is not null), 0));
    update pg_temp.shop_bk_rows b set new_id = (v_base + s.n)::text
    from (select ord, row_number() over (order by ord) as n from pg_temp.shop_bk_rows where action = 'inserted' and new_id is null) s
    where b.ord = s.ord;
    select greatest(v_base, coalesce(max(b.new_id::bigint), 0)) into v_added from pg_temp.shop_bk_rows b where b.action = 'inserted';
    execute format('select case when is_called then last_value else last_value - 1 end from %s', v_seq) into v_last;
    if v_added > v_last and current_setting('rwp_shop.backup_dry_run', true) is distinct from 'on' then
      perform setval(v_seq::regclass, v_added, true);
    end if;
  else
    update pg_temp.shop_bk_rows b set new_id = gen_random_uuid()::text where b.action = 'inserted' and b.new_id is null;
  end if;

  if p_mode = 'duplicate' then
    for v_row in select * from pg_temp.shop_bk_rows where action = 'inserted' order by ord loop
      for v_col, v_how in select key, value from jsonb_each_text(coalesce(p_unique, '{}'::jsonb)) loop
        v_value := v_row.rec ->> v_col;
        continue when coalesce(v_value, '') = '';
        v_candidate := v_value;
        v_suffix := 1;
        loop
          execute format('select exists (select 1 from public.%1$I x where lower(x.%2$I) = lower($1))', p_table, v_col)
            into v_taken using v_candidate;
          v_taken := v_taken or exists (
            select 1 from pg_temp.shop_bk_rows o
            where o.action = 'inserted' and o.ord <> v_row.ord and lower(o.rec ->> v_col) = lower(v_candidate));
          exit when not v_taken;
          if v_how = 'clear' then
            v_candidate := null;
            v_cleared := v_cleared + 1;
            exit;
          end if;
          v_suffix := v_suffix + 1;
          v_candidate := v_value || '-' || v_suffix;
        end loop;
        if v_candidate is distinct from v_value then
          v_row.rec := jsonb_set(v_row.rec, array[v_col], coalesce(to_jsonb(v_candidate), 'null'::jsonb));
          update pg_temp.shop_bk_rows set rec = v_row.rec where ord = v_row.ord;
        end if;
      end loop;
    end loop;
    if v_cleared > 0 then
      insert into pg_temp.shop_bk_warnings (message) values (format(
        '%s copied %s had a SKU this shop already uses, so the copy was saved without a SKU.', v_cleared, public.shop_backup_label(p_table)));
    end if;
  end if;

  update pg_temp.shop_bk_rows b set rec = jsonb_set(b.rec, '{id}', to_jsonb(b.new_id))
  where b.action in ('inserted', 'updated');

  -- Only columns both the backup and this table have: an older backup still imports, and columns
  -- added since take their defaults.
  select array_agg(a.attname::text order by a.attnum) into v_cols
  from pg_attribute a
  where a.attrelid = v_rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
    and (select b.rec from pg_temp.shop_bk_rows b where b.action in ('inserted', 'updated') limit 1) ? a.attname;

  if v_cols is not null then
    begin
      execute format(
        'insert into public.%1$I (%2$s) overriding system value
         select %3$s from pg_temp.shop_bk_rows b cross join lateral jsonb_populate_record(null::public.%1$I, b.rec) r
         where b.action = ''inserted'' order by b.ord',
        p_table,
        (select string_agg(format('%I', c), ', ') from unnest(v_cols) c),
        (select string_agg(format('r.%I', c), ', ') from unnest(v_cols) c));
      if exists (select 1 from unnest(v_cols) c where c <> 'id') then
        execute format(
          'update public.%1$I x set %2$s
           from pg_temp.shop_bk_rows b cross join lateral jsonb_populate_record(null::public.%1$I, b.rec) r
           where b.action = ''updated'' and x.id = r.id',
          p_table,
          (select string_agg(format('%1$I = r.%1$I', c), ', ') from unnest(v_cols) c where c <> 'id'));
      end if;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
      raise exception using errcode = v_state, detail = coalesce(v_detail, ''),
        message = format('Importing the %s failed, so nothing was imported: %s%s', public.shop_backup_label(p_table), sqlerrm,
          case when coalesce(v_detail, '') <> '' then ' (' || v_detail || ')' else '' end);
    end;
  end if;

  insert into pg_temp.shop_bk_map (tbl, old_id, new_id, action)
  select distinct on (b.old_id) p_table, b.old_id, b.new_id, b.action
  from pg_temp.shop_bk_rows b
  order by b.old_id, b.ord desc
  on conflict (tbl, old_id) do update set new_id = excluded.new_id, action = excluded.action;

  -- An updated parent ends up with exactly the children the backup has.
  if p_parent is not null and p_mode in ('update', 'replace') then
    select format_type(a.atttypid, a.atttypmod) into v_parent_type
    from pg_attribute a where a.attrelid = format('public.%I', v_parent_table)::regclass and a.attname = 'id';
    execute format(
      'delete from public.%1$I x
       where x.%2$I in (select (m.new_id)::%3$s from pg_temp.shop_bk_map m where m.tbl = %4$L and m.action = ''updated'')
         and not exists (select 1 from pg_temp.shop_bk_map c
           where c.tbl = %1$L and c.new_id = x.id::text and c.action in (''inserted'', ''updated''))',
      p_table, p_parent, v_parent_type, v_parent_table);
    get diagnostics v_deleted = row_count;
    if v_deleted > 0 then
      insert into pg_temp.shop_bk_deleted (tbl, n) values (p_table, v_deleted);
    end if;
  end if;
end;
$$;

-- Second pass for references to rows of the same table (a category's parent, a product's upsells),
-- which may come later in the backup than the row pointing at them.
create or replace function public.shop_backup_fix(p_table text, p_rows jsonb, p_refs jsonb)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_cols text[];
begin
  if to_regclass(format('public.%I', p_table)) is null or p_rows is null
    or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return;
  end if;
  select array_agg(k) into v_cols from jsonb_object_keys(p_refs) k where (p_rows -> 0) ? k;
  if v_cols is null then
    return;
  end if;
  execute format(
    'update public.%1$I x set %2$s
     from (
       select m.new_id, public.shop_backup_remap(e.value, $2) as rec
       from jsonb_array_elements($1) e
       join pg_temp.shop_bk_map m on m.tbl = %3$L and m.old_id = e.value ->> ''id'' and m.action in (''inserted'', ''updated'')
     ) b
     cross join lateral jsonb_populate_record(null::public.%1$I, b.rec) r
     where x.id = (b.new_id)::uuid',
    p_table,
    (select string_agg(format('%1$I = r.%1$I', c), ', ') from unnest(v_cols) c),
    p_table)
  using p_rows, p_refs;
end;
$$;

-- Link tables without an id of their own (product <-> category, product <-> tag): an imported product
-- gets exactly the backup's links; a product that was left alone keeps its own.
create or replace function public.shop_backup_links(
  p_table text, p_rows jsonb, p_mode text, p_parent_col text, p_parent_table text, p_other_col text, p_other_table text)
returns bigint language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_added bigint := 0;
  v_deleted bigint := 0;
begin
  if to_regclass(format('public.%I', p_table)) is null or p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return 0;
  end if;
  if p_mode in ('update', 'replace') then
    execute format(
      'delete from public.%1$I x where x.%2$I in (
         select (m.new_id)::uuid from pg_temp.shop_bk_map m where m.tbl = %3$L and m.action = ''updated'')',
      p_table, p_parent_col, p_parent_table);
    get diagnostics v_deleted = row_count;
  end if;
  execute format(
    'insert into public.%1$I (%2$I, %3$I)
     select distinct (m.new_id)::uuid, (s.other)::uuid
     from (select e.value ->> %2$L as parent, public.shop_backup_resolve(%5$L, e.value ->> %3$L) as other
           from jsonb_array_elements($1) e) s
     join pg_temp.shop_bk_map m on m.tbl = %4$L and m.old_id = s.parent and m.action in (''inserted'', ''updated'')
     where s.other is not null
     on conflict do nothing',
    p_table, p_parent_col, p_other_col, p_parent_table, p_other_table)
  using p_rows;
  get diagnostics v_added = row_count;
  -- Links are replaced wholesale, so only the difference is worth reporting.
  if v_added > v_deleted then
    insert into pg_temp.shop_bk_links (tbl, n) values (p_table, v_added - v_deleted);
  end if;
  return v_added;
end;
$$;

-- Replace mode: deletes the rows of a table that the import did not write.
create or replace function public.shop_backup_prune(p_table text)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_deleted bigint;
begin
  if to_regclass(format('public.%I', p_table)) is null then
    return;
  end if;
  execute format(
    'delete from public.%1$I x where not exists (
       select 1 from pg_temp.shop_bk_map m where m.tbl = %1$L and m.new_id = x.id::text and m.action in (''inserted'', ''updated''))',
    p_table);
  get diagnostics v_deleted = row_count;
  if v_deleted > 0 then
    insert into pg_temp.shop_bk_deleted (tbl, n) values (p_table, v_deleted);
  end if;
end;
$$;

-- p_modes: { "<section>": "update" | "skip" | "replace" | "duplicate" } for the sections to import.
-- With p_dry_run the whole import runs and is then rolled back, so the report is an exact preview.
create or replace function public.shop_backup_import(p_backup jsonb, p_modes jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  t jsonb := p_backup -> 'tables';
  v_references jsonb := case when jsonb_typeof(p_backup -> 'references') = 'object' then p_backup -> 'references' else '{}'::jsonb end;
  v_sections jsonb := p_backup -> 'sections';
  v_modes jsonb := '{}'::jsonb;
  v_section text;
  v_mode text;
  v_table text;
  v_taxonomy text;
  v_warnings jsonb := '[]'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_report jsonb;
  v_option record;
  v_current text;
  v_merged text;
  v_unmatched jsonb;
  v_users_matched integer;
  v_all_tables text[] := array[
    'shop_categories', 'shop_tags', 'shop_attributes', 'shop_attribute_terms', 'shop_shipping_classes',
    'shop_products', 'shop_product_categories', 'shop_product_tags', 'shop_variations', 'shop_product_downloads',
    'shop_customers', 'shop_coupons', 'shop_tax_rates', 'shop_shipping_zones', 'shop_shipping_methods',
    'shop_orders', 'shop_order_items', 'shop_order_notes', 'shop_refunds', 'shop_reviews',
    'shop_product_qa', 'shop_product_offers', 'shop_price_drop_alerts', 'shop_product_bundles'];
  v_stat record;
begin
  if not public.user_has_cap('manage_shop') then
    raise exception using errcode = '42501',
      message = 'Only shop managers can import a shop backup. It needs the manage_shop capability, and your role does not have it.';
  end if;
  if p_backup ->> 'format' is distinct from 'rwp-shop-backup' then
    raise exception using errcode = '22023', message = 'This is not a shop backup (its "format" field is missing or wrong).';
  end if;
  if coalesce((p_backup ->> 'version')::int, 0) <> 1 then
    raise exception using errcode = '22023', message = format(
      'This shop backup uses format version %s, but this site only understands version 1. Update the shop plugin to the version that made the backup.',
      coalesce(p_backup ->> 'version', 'none'));
  end if;
  if jsonb_typeof(t) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'The backup has no "tables" object, so there is nothing to import.';
  end if;
  if jsonb_typeof(p_modes) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Choose what to import: p_modes must be an object of section -> mode.';
  end if;

  for v_section, v_mode in select key, value from jsonb_each_text(p_modes) loop
    if public.shop_backup_tables(v_section) is null then
      raise exception using errcode = '22023', message = format('Unknown backup section "%s".', v_section);
    end if;
    if v_mode not in ('update', 'skip', 'replace', 'duplicate') then
      raise exception using errcode = '22023', message = format('Unknown import mode "%s" for %s: use update, skip, replace or duplicate.', v_mode, v_section);
    end if;
    if v_mode = 'duplicate' and v_section not in ('products', 'coupons') then
      raise exception using errcode = '22023', message = format('"Add as copies" is only possible for products and coupons, not for %s.', v_section);
    end if;
    if jsonb_typeof(v_sections) = 'array' and not v_sections ? v_section then
      v_warnings := v_warnings || to_jsonb(format('The backup does not contain %s, so that part was skipped.', v_section));
      continue;
    end if;
    v_modes := v_modes || jsonb_build_object(v_section, v_mode);
  end loop;
  if v_modes = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'Nothing to import: choose at least one part of the shop that the backup contains.';
  end if;

  -- Tables this database does not have yet (a migration that was not run) cannot take their rows.
  foreach v_table in array v_all_tables loop
    if to_regclass(format('public.%I', v_table)) is null and jsonb_array_length(coalesce(t -> v_table, '[]'::jsonb)) > 0
      and exists (select 1 from jsonb_object_keys(v_modes) s where v_table = any (public.shop_backup_tables(s))) then
      v_warnings := v_warnings || to_jsonb(format(
        'This database has no %s table, so the backup''s %s were skipped. Run the shop migrations in supabase/migrations/ and import again to include them.',
        v_table, public.shop_backup_label(v_table)));
    end if;
  end loop;

  begin
    create temp table if not exists shop_bk_map (tbl text not null, old_id text not null, new_id text, action text not null,
      primary key (tbl, old_id)) on commit drop;
    create index if not exists shop_bk_map_new_idx on pg_temp.shop_bk_map (tbl, new_id);
    create temp table if not exists shop_bk_rows (ord bigint, old_id text, src jsonb, rec jsonb, existing text, new_id text, action text)
      on commit drop;
    create temp table if not exists shop_bk_users (old_id text primary key, new_id uuid not null) on commit drop;
    create temp table if not exists shop_bk_warnings (message text not null) on commit drop;
    create temp table if not exists shop_bk_deleted (tbl text not null, n bigint not null) on commit drop;
    create temp table if not exists shop_bk_links (tbl text not null, n bigint not null) on commit drop;
    truncate pg_temp.shop_bk_map, pg_temp.shop_bk_rows, pg_temp.shop_bk_users, pg_temp.shop_bk_warnings,
      pg_temp.shop_bk_deleted, pg_temp.shop_bk_links;
    perform set_config('rwp_shop.backup_dry_run', case when p_dry_run then 'on' else 'off' end, true);

    -- Backup account id -> this site's account with the same email.
    insert into pg_temp.shop_bk_users (old_id, new_id)
    select distinct on (bu ->> 'id') bu ->> 'id', u.id
    from jsonb_array_elements(case when jsonb_typeof(p_backup -> 'users') = 'array' then p_backup -> 'users' else '[]'::jsonb end) bu
    join auth.users u on lower(u.email) = lower(bu ->> 'email')
    where coalesce(bu ->> 'id', '') <> '' and coalesce(bu ->> 'email', '') <> ''
    order by bu ->> 'id', u.created_at;
    select count(*) into v_users_matched from pg_temp.shop_bk_users;

    -- Triggers are off while the rows go in: they would stamp new dates, take stock again for orders,
    -- set every review's author to you and rate-limit questions. The backup already holds the results.
    foreach v_table in array v_all_tables loop
      if to_regclass(format('public.%I', v_table)) is not null then
        execute format('alter table public.%I disable trigger user', v_table);
      end if;
    end loop;

    -- Other parts point at products (coupons, order items, reviews, questions, offers, alerts, bundles).
    -- When products are not imported this time, find the backup's products on this site by the same
    -- rules, so a review imported on its own still lands on the product with the same slug.
    if not v_modes ? 'products' then
      perform public.shop_backup_put('shop_categories', coalesce(t -> 'shop_categories', v_references -> 'shop_categories'), 'match',
        'x.id = r.id or x.slug = r.slug');
      perform public.shop_backup_put('shop_products', coalesce(t -> 'shop_products', v_references -> 'shop_products'), 'match',
        'x.id = r.id or x.slug = r.slug or (coalesce(r.sku, '''') <> '''' and x.sku = r.sku)');
      perform public.shop_backup_put('shop_variations', coalesce(t -> 'shop_variations', v_references -> 'shop_variations'), 'match',
        'x.product_id = r.product_id and (x.id = r.id or x.attributes = r.attributes)', '{"product_id": "shop_products"}');
      perform public.shop_backup_put('shop_product_downloads',
        coalesce(t -> 'shop_product_downloads', v_references -> 'shop_product_downloads'), 'match',
        'x.product_id = r.product_id and (x.id = r.id or (x.url = r.url and x.variation_id is not distinct from r.variation_id))',
        '{"product_id": "shop_products", "variation_id": "shop_variations"}');
    end if;

    -- Settings: the shop_* options (currency, taxes, checkout, gateways, emails), tax rates and shipping.
    v_mode := v_modes ->> 'settings';
    if v_mode is not null then
      for v_option in
        select e.value ->> 'option_name' as name, e.value ->> 'option_value' as value
        from jsonb_array_elements(case when jsonb_typeof(t -> 'options') = 'array' then t -> 'options' else '[]'::jsonb end) e
        where e.value ->> 'option_name' like 'shop\_%' and e.value ->> 'option_value' is not null
      loop
        select o.option_value into v_current from public.options o where o.option_name = v_option.name;
        if not found then
          insert into public.options (option_name, option_value) values (v_option.name, v_option.value);
          v_merged := 'inserted';
        elsif v_mode = 'skip' then
          v_merged := 'skipped';
        else
          v_merged := v_option.value;
          -- Update keeps settings this site has and the backup does not (added by a newer version).
          if v_mode = 'update' then
            begin
              if jsonb_typeof(v_current::jsonb) = 'object' and jsonb_typeof(v_option.value::jsonb) = 'object' then
                v_merged := (v_current::jsonb || v_option.value::jsonb)::text;
              end if;
            exception when others then
              v_merged := v_option.value;
            end;
          end if;
          update public.options set option_value = v_merged where option_name = v_option.name;
          v_merged := 'updated';
        end if;
        insert into pg_temp.shop_bk_map (tbl, old_id, new_id, action) values ('options', v_option.name, v_option.name, v_merged)
        on conflict (tbl, old_id) do update set action = excluded.action;
      end loop;
      perform public.shop_backup_put('shop_shipping_classes', t -> 'shop_shipping_classes', v_mode,
        'x.id = r.id or x.slug = r.slug');
      perform public.shop_backup_put('shop_tax_rates', t -> 'shop_tax_rates', v_mode,
        'x.id = r.id or (x.country = r.country and x.state = r.state and x.tax_class = r.tax_class and x.name = r.name
           and x.priority = r.priority and x.postcodes = r.postcodes and x.cities = r.cities)');
      perform public.shop_backup_put('shop_shipping_zones', t -> 'shop_shipping_zones', v_mode,
        'x.id = r.id or x.name = r.name');
      perform public.shop_backup_put('shop_shipping_methods', t -> 'shop_shipping_methods', v_mode,
        'x.id = r.id or (x.zone_id is not distinct from r.zone_id and x.type = r.type and x.title = r.title)',
        '{"zone_id": "shop_shipping_zones", "class_costs": "{}shop_shipping_classes"}');
    end if;

    -- Products, with their categories, tags, attributes, variations and files.
    v_mode := v_modes ->> 'products';
    if v_mode is not null then
      -- Copies of products still share the categories, tags and attributes that already exist.
      v_taxonomy := case when v_mode = 'duplicate' then 'skip' else v_mode end;
      if v_modes ->> 'settings' is null then
        -- Products point at shipping classes; bring the missing ones along without touching the rest.
        perform public.shop_backup_put('shop_shipping_classes', t -> 'shop_shipping_classes', 'skip',
          'x.id = r.id or x.slug = r.slug');
      end if;
      perform public.shop_backup_put('shop_categories', t -> 'shop_categories', v_taxonomy,
        'x.id = r.id or x.slug = r.slug', '{"parent_id": "shop_categories"}');
      perform public.shop_backup_fix('shop_categories', t -> 'shop_categories', '{"parent_id": "shop_categories"}');
      perform public.shop_backup_put('shop_tags', t -> 'shop_tags', v_taxonomy, 'x.id = r.id or x.slug = r.slug');
      perform public.shop_backup_put('shop_attributes', t -> 'shop_attributes', v_taxonomy, 'x.id = r.id or x.slug = r.slug');
      perform public.shop_backup_put('shop_attribute_terms', t -> 'shop_attribute_terms', v_taxonomy,
        'x.attribute_id = r.attribute_id and (x.id = r.id or x.slug = r.slug)', '{"attribute_id": "shop_attributes"}', 'attribute_id');
      perform public.shop_backup_put('shop_products', t -> 'shop_products', v_mode,
        'x.id = r.id or x.slug = r.slug or (coalesce(r.sku, '''') <> '''' and x.sku = r.sku)',
        '{"shipping_class_id": "shop_shipping_classes", "author_id": "@user", "attributes": "[attribute_id]shop_attributes"}',
        null, '{"slug": "suffix", "sku": "clear"}');
      perform public.shop_backup_fix('shop_products', t -> 'shop_products',
        '{"grouped_ids": "[]shop_products", "upsell_ids": "[]shop_products", "cross_sell_ids": "[]shop_products"}');
      perform public.shop_backup_links('shop_product_categories', t -> 'shop_product_categories', v_mode,
        'product_id', 'shop_products', 'category_id', 'shop_categories');
      perform public.shop_backup_links('shop_product_tags', t -> 'shop_product_tags', v_mode,
        'product_id', 'shop_products', 'tag_id', 'shop_tags');
      perform public.shop_backup_put('shop_variations', t -> 'shop_variations', v_mode,
        'x.product_id = r.product_id and (x.id = r.id or x.attributes = r.attributes)',
        '{"product_id": "shop_products", "shipping_class_id": "shop_shipping_classes"}', 'product_id');
      perform public.shop_backup_put('shop_product_downloads', t -> 'shop_product_downloads', v_mode,
        'x.product_id = r.product_id and (x.id = r.id or (x.url = r.url and x.variation_id is not distinct from r.variation_id))',
        '{"product_id": "shop_products", "variation_id": "shop_variations"}', 'product_id');
    end if;

    -- Saved addresses and carts. The row's id is the account, so customers without an account here are skipped.
    v_mode := v_modes ->> 'customers';
    if v_mode is not null then
      perform public.shop_backup_put('shop_customers', t -> 'shop_customers', v_mode, 'x.id = r.id', '{"id": "@user"}');
    end if;

    v_mode := v_modes ->> 'coupons';
    if v_mode is not null then
      perform public.shop_backup_put('shop_coupons', t -> 'shop_coupons', v_mode,
        'x.id = r.id or lower(x.code) = lower(r.code)',
        '{"product_ids": "[]shop_products", "excluded_product_ids": "[]shop_products",
          "category_ids": "[]shop_categories", "excluded_category_ids": "[]shop_categories"}',
        null, '{"code": "suffix"}');
    end if;

    -- Orders are matched by their order key, never by number: order #12 on another site is another order.
    v_mode := v_modes ->> 'orders';
    if v_mode is not null then
      perform public.shop_backup_put('shop_orders', t -> 'shop_orders', v_mode, 'x.order_key = r.order_key', '{"customer_id": "@user"}');
      perform public.shop_backup_put('shop_order_items', t -> 'shop_order_items', v_mode,
        'x.order_id = r.order_id and x.id = r.id',
        '{"order_id": "shop_orders", "product_id": "shop_products", "variation_id": "shop_variations",
          "download_counts": "{}shop_product_downloads"}', 'order_id');
      perform public.shop_backup_put('shop_order_notes', t -> 'shop_order_notes', v_mode,
        'x.order_id = r.order_id and x.id = r.id', '{"order_id": "shop_orders", "created_by": "@user"}', 'order_id');
      perform public.shop_backup_put('shop_refunds', t -> 'shop_refunds', v_mode,
        'x.order_id = r.order_id and x.id = r.id',
        '{"order_id": "shop_orders", "created_by": "@user", "line_items": "[item_id]shop_order_items"}', 'order_id');
    end if;

    v_mode := v_modes ->> 'reviews';
    if v_mode is not null then
      perform public.shop_backup_put('shop_reviews', t -> 'shop_reviews', v_mode,
        'x.product_id = r.product_id and ((r.author_id is not null and x.author_id = r.author_id)
           or (x.author_name = r.author_name and x.created_at = r.created_at))',
        '{"product_id": "shop_products", "author_id": "@user"}');
    end if;

    v_mode := v_modes ->> 'questions';
    if v_mode is not null then
      perform public.shop_backup_put('shop_product_qa', t -> 'shop_product_qa', v_mode,
        'x.id = r.id or (x.product_id = r.product_id and x.user_id = r.user_id and x.created_at = r.created_at)',
        '{"product_id": "shop_products", "user_id": "@user", "answered_by": "@user"}');
    end if;

    -- A customer has one open negotiation per product, so an open offer matches the open one here.
    v_mode := v_modes ->> 'offers';
    if v_mode is not null then
      perform public.shop_backup_put('shop_product_offers', t -> 'shop_product_offers', v_mode,
        'x.id = r.id or (x.product_id = r.product_id and x.user_id = r.user_id and (x.created_at = r.created_at
           or (x.status in (''pending'', ''countered'') and r.status in (''pending'', ''countered''))))',
        '{"product_id": "shop_products", "user_id": "@user", "responded_by": "@user"}');
    end if;

    v_mode := v_modes ->> 'alerts';
    if v_mode is not null then
      perform public.shop_backup_put('shop_price_drop_alerts', t -> 'shop_price_drop_alerts', v_mode,
        'x.id = r.id or (x.product_id = r.product_id and x.user_id = r.user_id)',
        '{"product_id": "shop_products", "user_id": "@user"}');
    end if;

    v_mode := v_modes ->> 'bundles';
    if v_mode is not null then
      perform public.shop_backup_put('shop_product_bundles', t -> 'shop_product_bundles', v_mode,
        'x.id = r.id or (x.main_product_id = r.main_product_id and x.suggested_product_id = r.suggested_product_id)',
        '{"main_product_id": "shop_products", "suggested_product_id": "shop_products"}');
    end if;

    -- Ratings follow the reviews that are now in the shop, whatever the backup said.
    if v_modes ? 'products' or v_modes ? 'reviews' then
      update public.shop_products p set average_rating = s.average, rating_count = s.total
      from (
        select p2.id, coalesce(round(avg(r.rating)::numeric, 2), 0) as average, count(r.rating)::int as total
        from public.shop_products p2
        left join public.shop_reviews r on r.product_id = p2.id and r.status = 'approved' and r.rating is not null
        group by p2.id
      ) s
      where s.id = p.id and (p.average_rating, p.rating_count) is distinct from (s.average, s.total);
    end if;

    foreach v_table in array v_all_tables loop
      if to_regclass(format('public.%I', v_table)) is not null then
        execute format('alter table public.%I enable trigger user', v_table);
      end if;
    end loop;

    -- Replace: what the backup does not have goes. Triggers are back on, so a deleted product also
    -- takes its likes, saves and views. Products before categories, zones after their methods.
    if v_modes ->> 'settings' = 'replace' then
      with gone as (
        delete from public.options o
        where o.option_name like 'shop\_%'
          and not exists (select 1 from pg_temp.shop_bk_map m where m.tbl = 'options' and m.new_id = o.option_name)
        returning 1)
      insert into pg_temp.shop_bk_deleted (tbl, n) select 'options', count(*) from gone having count(*) > 0;
      perform public.shop_backup_prune('shop_shipping_methods');
      perform public.shop_backup_prune('shop_shipping_zones');
      perform public.shop_backup_prune('shop_tax_rates');
    end if;
    if v_modes ->> 'products' = 'replace' then
      perform public.shop_backup_prune('shop_products');
      perform public.shop_backup_prune('shop_categories');
      perform public.shop_backup_prune('shop_tags');
      perform public.shop_backup_prune('shop_attributes');
    end if;
    -- Shipping classes belong to settings, but products use them: only prune once no product can.
    if v_modes ->> 'settings' = 'replace' then
      perform public.shop_backup_prune('shop_shipping_classes');
    end if;
    foreach v_section in array array['customers', 'coupons', 'orders', 'reviews', 'questions', 'offers', 'alerts', 'bundles'] loop
      if v_modes ->> v_section = 'replace' then
        perform public.shop_backup_prune((public.shop_backup_tables(v_section))[1]);
      end if;
    end loop;

    -- The report, built before a preview is rolled back.
    for v_stat in
      select m.tbl,
        count(*) filter (where m.action = 'inserted') as inserted,
        count(*) filter (where m.action = 'updated') as updated,
        count(*) filter (where m.action = 'skipped') as skipped,
        count(*) filter (where m.action = 'dropped') as dropped
      from pg_temp.shop_bk_map m
      where m.action <> 'matched'
      group by m.tbl
    loop
      v_counts := v_counts || jsonb_build_object(v_stat.tbl, jsonb_build_object(
        'inserted', v_stat.inserted, 'updated', v_stat.updated, 'skipped', v_stat.skipped, 'dropped', v_stat.dropped, 'deleted', 0));
      if v_stat.dropped > 0 then
        v_warnings := v_warnings || to_jsonb(format(
          '%s %s were not imported because the account, product or order they belong to is not on this site (or was not imported).',
          v_stat.dropped, public.shop_backup_label(v_stat.tbl)));
      end if;
    end loop;
    for v_stat in select l.tbl, sum(l.n) as n from pg_temp.shop_bk_links l group by l.tbl loop
      v_counts := v_counts || jsonb_build_object(v_stat.tbl, jsonb_build_object(
        'inserted', v_stat.n, 'updated', 0, 'skipped', 0, 'dropped', 0, 'deleted', 0));
    end loop;
    for v_stat in select d.tbl, sum(d.n) as n from pg_temp.shop_bk_deleted d group by d.tbl loop
      v_counts := jsonb_set(v_counts, array[v_stat.tbl],
        coalesce(v_counts -> v_stat.tbl, jsonb_build_object('inserted', 0, 'updated', 0, 'skipped', 0, 'dropped', 0))
          || jsonb_build_object('deleted', v_stat.n));
    end loop;
    select v_warnings || coalesce(jsonb_agg(to_jsonb(w.message)), '[]'::jsonb) into v_warnings from pg_temp.shop_bk_warnings w;

    select jsonb_agg(bu ->> 'email' order by bu ->> 'email') into v_unmatched
    from jsonb_array_elements(case when jsonb_typeof(p_backup -> 'users') = 'array' then p_backup -> 'users' else '[]'::jsonb end) bu
    where not exists (select 1 from pg_temp.shop_bk_users u where u.old_id = bu ->> 'id')
      and not exists (select 1 from public.profiles p where p.id = public.shop_try_uuid(bu ->> 'id'));
    if v_unmatched is not null then
      v_warnings := v_warnings || to_jsonb(format(
        '%s account(s) in the backup have no account with the same email on this site: %s%s. Their orders were kept with the billing details but no linked account (each customer gets them back by signing up with that email and opening My Account); their saved addresses, reviews, questions, offers and price alerts were not imported.',
        jsonb_array_length(v_unmatched),
        (select string_agg(value, ', ') from (select value from jsonb_array_elements_text(v_unmatched) limit 20) s),
        case when jsonb_array_length(v_unmatched) > 20 then format(' and %s more', jsonb_array_length(v_unmatched) - 20) else '' end));
    end if;

    v_report := jsonb_build_object(
      'dry_run', p_dry_run,
      'modes', v_modes,
      'counts', v_counts,
      'warnings', v_warnings,
      'users_matched', v_users_matched,
      'users_unmatched', coalesce(jsonb_array_length(v_unmatched), 0));

    if p_dry_run then
      raise exception using errcode = 'RWPDR', message = 'Shop backup preview finished; rolling it back.';
    end if;
  exception when sqlstate 'RWPDR' then
    -- Everything the preview wrote is rolled back with this block; v_report survives.
    null;
  end;
  return v_report;
end;
$$;

revoke execute on function public.shop_backup_label(text) from public, anon, authenticated;
revoke execute on function public.shop_backup_tables(text) from public, anon, authenticated;
revoke execute on function public.shop_backup_resolve(text, text) from public, anon, authenticated;
revoke execute on function public.shop_backup_remap(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.shop_backup_put(text, jsonb, text, text, jsonb, text, jsonb) from public, anon, authenticated;
revoke execute on function public.shop_backup_fix(text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.shop_backup_links(text, jsonb, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.shop_backup_prune(text) from public, anon, authenticated;
revoke execute on function public.shop_backup_export(text[], jsonb) from public, anon;
revoke execute on function public.shop_backup_import(jsonb, jsonb, boolean) from public, anon;
grant execute on function public.shop_backup_export(text[], jsonb) to authenticated;
grant execute on function public.shop_backup_import(jsonb, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
