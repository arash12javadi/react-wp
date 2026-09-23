-- Shop support for the chatbot (plugins/rwp-chat). Safe to re-run.
-- Kept identical to the "Chatbot support" section at the end of plugins/rwp-shop/schema.sql.
--
-- rwp-chat never references a shop object. It publishes two names and looks them up with
-- to_regprocedure at run time, exactly as core's engagement system finds
-- rwp_engagement_target_product:
--
--   public.rwp_chat_card_product(p_id text) returns jsonb
--   public.rwp_chat_order_status(p_order_key text, p_email text) returns jsonb
--
-- Both are created here, by the shop, and dropped by plugins/rwp-shop/uninstall.sql. On a site
-- with the chatbot but no shop they simply do not exist, and the widget hides the product card
-- and the order tracker instead of failing.

-- A product card for the chat stream: what the visitor is looking at, or what the bot suggests.
-- Only published, non-hidden products, because the card is shown to anonymous visitors. The price
-- is read through shop_effective_price, the same function the catalogue uses, so a card never
-- shows a sale price that checkout will not honour.
create or replace function public.rwp_chat_card_product(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'kind', 'product',
    'title', p.name,
    'url', '/product/' || p.slug,
    'image', nullif(p.image_url, ''),
    -- Tags become spaces, then runs of whitespace collapse: "<p>A <b>blue</b> shirt.</p>" would
    -- otherwise arrive as "A  blue  shirt.", and the card is read by customers.
    'excerpt', nullif(btrim(regexp_replace(regexp_replace(p.short_description, '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')), ''),
    'price', public.shop_effective_price(p.regular_price, p.sale_price, p.sale_from, p.sale_to),
    'regular_price', p.regular_price,
    'on_sale', public.shop_effective_price(p.regular_price, p.sale_price, p.sale_from, p.sale_to) is distinct from p.regular_price,
    'currency', coalesce(public.shop_settings()->>'currency', 'USD'),
    'stock_status', p.stock_status,
    -- Variable products need options chosen, so the card links to the page instead of the cart.
    'purchasable', p.type = 'simple' and p.stock_status <> 'outofstock',
    'product_id', p.id,
    'rating', p.average_rating,
    'rating_count', p.rating_count
  )
  from public.shop_products p
  -- Either identifier: the chat's subject is announced by whatever rendered the page, and the
  -- product route knows the slug long before it knows the uuid.
  where (p.id = public.shop_try_uuid(p_id) or p.slug = p_id)
    and p.status = 'publish'
    and p.catalog_visibility <> 'hidden'
  limit 1;
$$;

-- Order tracking from inside the chat widget.
--
-- The order key alone is not enough to see an order: it appears in confirmation emails and in
-- browser history, and it would otherwise hand a stranger the customer's address. The email on
-- the order must match as well, which is the same rule the shop's guest order screens use.
-- Nothing about payment is returned beyond the method title — no gateway data, no transaction id.
create or replace function public.rwp_chat_order_status(p_order_key text, p_email text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_order public.shop_orders;
  v_key text := btrim(coalesce(p_order_key, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_key = '' or v_email = '' then
    return null;
  end if;
  -- Customers paste "#rwp_order_ab12" or just the digits of the order number.
  v_key := regexp_replace(v_key, '^#', '');

  select * into v_order
    from public.shop_orders o
   where (o.order_key = v_key or (v_key ~ '^[0-9]{1,18}$' and o.id = v_key::bigint))
     and lower(coalesce(o.billing->>'email', '')) = v_email
   limit 1;

  if v_order.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'kind', 'order',
    'id', v_order.id,
    'order_key', v_order.order_key,
    'status', v_order.status,
    'currency', v_order.currency,
    'total', v_order.total,
    'paid_at', v_order.paid_at,
    'completed_at', v_order.completed_at,
    'created_at', v_order.created_at,
    'payment_method_title', v_order.payment_method_title,
    'url', '/checkout/order-received/' || v_order.id || '?key=' || v_order.order_key,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity) order by i.id)
        from public.shop_order_items i where i.order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$$;

-- Both are called by rwp_chat_card / rwp_chat_track_order, which are themselves SECURITY DEFINER
-- and already bound their arguments. Anon needs execute because most visitors are not signed in.
revoke execute on function public.rwp_chat_card_product(text) from public;
revoke execute on function public.rwp_chat_order_status(text, text) from public;
grant execute on function public.rwp_chat_card_product(text) to anon, authenticated;
grant execute on function public.rwp_chat_order_status(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
