-- rwp-shop: drop everything plugins/rwp-shop/schema.sql creates.
--
-- Run by POST /api/plugins/uninstall when the administrator chooses "wipe data".
-- Never run automatically: deactivating or deleting a plugin leaves this untouched.
--
-- Safe to re-run: every statement is "if exists". Runs inside one transaction, so a
-- failure part way through leaves the shop schema exactly as it was.
--
-- Deliberately NOT dropped, because they are core objects the shop only borrows:
--   * public.pages rows with is_site_template and a shop template_type (shop, product,
--     product_category, cart, checkout, my_account). They are ordinary pages; deleting them
--     would remove layouts the administrator may have hand-edited. Delete them from
--     Page Builder -> Templates if they are no longer wanted.
--   * the 'shop' entry in the rwp_default_content option, so reinstalling does not silently
--     recreate templates the administrator deleted on purpose.
--   * the shop_manager role on existing profiles, and the manage_shop capability in
--     public.user_has_cap(). Both are core, and a role string with no shop attached is inert.
--   * likes, saved items and page views of products (rows with target_type 'product' in core's
--     likes, bookmarks and page_views). They are core rows keyed by product id: without the shop
--     nothing shows them, and restoring the shop from its backup brings them back to life.

-- Triggers the shop put on core's engagement tables (20261004_engagement.sql). Those tables may not
-- exist, and DROP TRIGGER needs its table, so only when they do.
do $$
begin
  if to_regclass('public.likes') is not null then
    execute 'drop trigger if exists shop_likes_maintain_counts on public.likes';
  end if;
  if to_regclass('public.page_views') is not null then
    execute 'drop trigger if exists shop_views_maintain_counts on public.page_views';
  end if;
end;
$$;

-- Triggers first: dropping a function a trigger uses would otherwise need cascade, which
-- silently takes the trigger with it and hides mistakes.
drop trigger if exists shop_products_guard_engagement_counts on public.shop_products;
drop trigger if exists shop_products_forget_engagement on public.shop_products;
drop trigger if exists shop_products_price_alerts on public.shop_products;
drop trigger if exists shop_variations_price_alerts on public.shop_variations;
drop trigger if exists shop_product_qa_before_insert on public.shop_product_qa;
drop trigger if exists shop_product_qa_before_update on public.shop_product_qa;
drop trigger if exists shop_products_stock_guard on public.shop_products;
drop trigger if exists shop_variations_stock_guard on public.shop_variations;
drop trigger if exists shop_orders_before_update on public.shop_orders;
drop trigger if exists shop_reviews_before_insert on public.shop_reviews;
drop trigger if exists shop_reviews_update_rating on public.shop_reviews;

-- Policy on a core table.
drop policy if exists "Shop managers can write shop options" on public.options;

-- Functions whose signature uses a shop table's row type go before that table.
drop function if exists public.shop_offer_coupon(public.shop_product_offers, numeric);

-- Tables. cascade takes their own policies, indexes, constraints and foreign keys with them.
drop table if exists public.shop_product_bundles cascade;
drop table if exists public.shop_price_drop_alerts cascade;
drop table if exists public.shop_product_offers cascade;
drop table if exists public.shop_product_qa cascade;
drop table if exists public.shop_refunds cascade;
drop table if exists public.shop_order_notes cascade;
drop table if exists public.shop_order_items cascade;
drop table if exists public.shop_orders cascade;
drop table if exists public.shop_reviews cascade;
drop table if exists public.shop_product_downloads cascade;
drop table if exists public.shop_variations cascade;
drop table if exists public.shop_product_tags cascade;
drop table if exists public.shop_product_categories cascade;
drop table if exists public.shop_products cascade;
drop table if exists public.shop_shipping_methods cascade;
drop table if exists public.shop_shipping_zones cascade;
drop table if exists public.shop_tax_rates cascade;
drop table if exists public.shop_coupons cascade;
drop table if exists public.shop_customers cascade;
drop table if exists public.shop_shipping_classes cascade;
drop table if exists public.shop_attribute_terms cascade;
drop table if exists public.shop_attributes cascade;
drop table if exists public.shop_tags cascade;
drop table if exists public.shop_categories cascade;

-- Functions. Signatures must match schema.sql exactly, or the drop is a silent no-op.
drop function if exists public.shop_apply_bundle_discounts(jsonb[], integer);
drop function if exists public.shop_variations_price_alerts();
drop function if exists public.shop_products_price_alerts();
drop function if exists public.shop_check_price_alerts(uuid);
drop function if exists public.shop_set_price_alert(uuid, numeric);
drop function if exists public.shop_withdraw_offer(uuid);
drop function if exists public.shop_answer_counter_offer(uuid, boolean);
drop function if exists public.shop_respond_to_offer(uuid, text, numeric, text);
drop function if exists public.shop_make_offer(uuid, numeric, text);
drop function if exists public.shop_product_qa_before_update();
drop function if exists public.shop_product_qa_before_insert();
drop function if exists public.shop_product_current_price(uuid);
drop function if exists public.rwp_engagement_feed_product(uuid, integer, timestamptz);
drop function if exists public.shop_products_forget_engagement();
drop function if exists public.shop_views_maintain_counts();
drop function if exists public.shop_likes_maintain_counts();
drop function if exists public.shop_products_guard_engagement_counts();
drop function if exists public.rwp_engagement_target_product(text);
drop function if exists public.shop_customer_summary();
drop function if exists public.shop_report(timestamptz, timestamptz);
drop function if exists public.shop_reviews_update_rating();
drop function if exists public.shop_reviews_before_insert();
drop function if exists public.shop_catalog(jsonb);
drop function if exists public.shop_claim_guest_orders();
drop function if exists public.shop_consume_download(bigint, text, bigint, uuid);
drop function if exists public.shop_create_refund(bigint, numeric, text, jsonb, boolean, text);
drop function if exists public.shop_set_gateway_data(bigint, jsonb);
drop function if exists public.shop_claim_order_email(bigint, text);
drop function if exists public.shop_mark_order_paid(bigint, text, text, numeric, text, jsonb);
drop function if exists public.shop_cancel_order(bigint, text);
drop function if exists public.shop_get_order(bigint, text);
drop function if exists public.shop_place_order(jsonb);
drop function if exists public.shop_calculate(jsonb);
drop function if exists public.shop_orders_before_update();
drop function if exists public.shop_change_coupon_usage(jsonb, integer);
drop function if exists public.shop_increment_sales(bigint);
drop function if exists public.shop_adjust_order_stock(bigint, integer);
drop function if exists public.shop_stock_guard();
drop function if exists public.shop_matching_zone(text, text, text);
drop function if exists public.shop_calc_tax(numeric, jsonb, boolean, integer);
drop function if exists public.shop_matching_tax_rates(text, text, text, text, text, boolean);
drop function if exists public.shop_postcode_matches(text[], text);
drop function if exists public.shop_effective_price(numeric, numeric, timestamptz, timestamptz);
drop function if exists public.shop_try_uuid(text);
drop function if exists public.shop_settings();

-- Stored settings: currency, tax mode, gateway configuration, email templates. The backup
-- taken before a wipe includes these rows, because they are what makes a store reinstallable.
delete from public.options where option_name like 'shop\_%';

notify pgrst, 'reload schema';
