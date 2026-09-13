import { describeDbError, getSupabaseClient } from '../../../src/lib/db';
import type { CartState } from './cart';
import type {
  Address, CartCalculation, CatalogResult, Order, Product, Review, Taxonomy, Variation,
} from './types';

const migrationHint = 'Run supabase/migrations/20260917_shop_plugin.sql in the Supabase SQL Editor, then reload.';

/** Names the real cause for the failures a missing or stale migration produces. */
export const explainShopError = (error: unknown): string => {
  const message = describeDbError(error);
  if (/PGRST202|Could not find the function/i.test(message)) {
    return `The shop database functions are missing. ${migrationHint} If you already ran it, run "notify pgrst, 'reload schema';" or wait a minute.`;
  }
  if (/PGRST205|schema cache|relation "shop_|42P01/i.test(message)) {
    return `The shop tables are missing or Supabase has not reloaded its schema. ${migrationHint}`;
  }
  if (/row-level security/i.test(message)) {
    return `The database refused this under row level security. Shop management needs the manage_shop capability (Shop Manager or Administrator). (${message})`;
  }
  return message;
};

const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await getSupabaseClient().rpc(name, args);
  if (error) throw new Error(explainShopError(error));
  return data as T;
};

export interface CheckoutDetails {
  billing: Address;
  shipping?: Address;
  ship_to_different?: boolean;
  payment_method?: string;
  customer_note?: string;
  terms_accepted?: boolean;
}

export const cartInput = (cart: CartState, details: Partial<CheckoutDetails> = {}) => ({
  items: cart.items.map((item) => ({
    key: item.key,
    product_id: item.product_id,
    variation_id: item.variation_id,
    quantity: item.quantity,
    attributes: item.attributes,
  })),
  coupons: cart.coupons,
  shipping_method_id: cart.shipping_method_id,
  ...details,
});

export const calculateCart = (input: Record<string, unknown>) =>
  rpc<CartCalculation>('shop_calculate', { p_input: input });

export type PlaceOrderResult =
  | { ok: true; order_id: number; order_key: string; status: string; total: number; payment_method: string }
  | { ok: false; errors: string[] };

export const placeOrder = (input: Record<string, unknown>) =>
  rpc<PlaceOrderResult>('shop_place_order', { p_input: input });

export const getOrder = (orderId: number, orderKey: string) =>
  rpc<Order | null>('shop_get_order', { p_order_id: orderId, p_order_key: orderKey });

export const cancelOrder = (orderId: number, orderKey: string) =>
  rpc<{ ok: boolean; error?: string }>('shop_cancel_order', { p_order_id: orderId, p_order_key: orderKey });

export const consumeDownload = (orderId: number, orderKey: string, itemId: number, downloadId: string) =>
  rpc<string>('shop_consume_download', { p_order_id: orderId, p_order_key: orderKey, p_item_id: itemId, p_download_id: downloadId });

export const claimGuestOrders = () => rpc<number>('shop_claim_guest_orders', {});

export interface CatalogQuery {
  search?: string;
  category?: string;
  tag?: string;
  attributes?: Record<string, string[]>;
  min_price?: number | null;
  max_price?: number | null;
  on_sale?: boolean;
  featured?: boolean;
  ids?: string[];
  orderby?: string;
  page?: number;
  per_page?: number;
}

export const fetchCatalog = (query: CatalogQuery) => rpc<CatalogResult>('shop_catalog', { p: query });

export interface ProductDetail extends Product {
  categories: Taxonomy[];
  tags: Taxonomy[];
  variations: Variation[];
}

export const fetchProductBySlug = async (slug: string): Promise<ProductDetail | null> => {
  const { data, error } = await getSupabaseClient()
    .from('shop_products')
    .select('*, shop_product_categories(shop_categories(*)), shop_product_tags(shop_tags(*)), shop_variations(*)')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(explainShopError(error));
  if (!data) return null;
  const row = data as Product & {
    shop_product_categories: Array<{ shop_categories: Taxonomy }>;
    shop_product_tags: Array<{ shop_tags: Taxonomy }>;
    shop_variations: Variation[];
  };
  return {
    ...row,
    categories: row.shop_product_categories.map((link) => link.shop_categories).filter(Boolean),
    tags: row.shop_product_tags.map((link) => link.shop_tags).filter(Boolean),
    variations: row.shop_variations.filter((variation) => variation.enabled).sort((a, b) => a.menu_order - b.menu_order),
  };
};

export const fetchCategories = async (): Promise<Taxonomy[]> => {
  const { data, error } = await getSupabaseClient().from('shop_categories').select('*').order('menu_order').order('name');
  if (error) throw new Error(explainShopError(error));
  return (data || []) as Taxonomy[];
};

export const fetchApprovedReviews = async (productId: string): Promise<Review[]> => {
  const { data, error } = await getSupabaseClient()
    .from('shop_reviews').select('*').eq('product_id', productId).eq('status', 'approved')
    .order('created_at', { ascending: false });
  if (error) throw new Error(explainShopError(error));
  return (data || []) as Review[];
};

export const submitReview = async (productId: string, rating: number | null, content: string) => {
  const { error } = await getSupabaseClient()
    .from('shop_reviews')
    .insert({ product_id: productId, rating, content })
    .select('id');
  if (error) {
    if (error.code === '23505') throw new Error('You have already reviewed this product.');
    throw new Error(explainShopError(error));
  }
};

// Server routes (server.mjs / api/plugins.ts) -----------------------------------

const accessToken = async () => {
  const { data } = await getSupabaseClient().auth.getSession();
  return data.session?.access_token || '';
};

export const callShopServer = async <T>(route: string, body: Record<string, unknown>): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`/api/plugins/rwp-shop/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await accessToken()}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the site server. If you are running npm run dev, npm start must also be running on port 3000.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error
      || `The shop server did not handle ${route} (HTTP ${response.status}). If you are running npm run dev, npm start must also be running on port 3000.`);
  }
  return payload as T;
};

export const startOnlinePayment = (gateway: 'stripe' | 'paypal', orderId: number, orderKey: string) =>
  callShopServer<{ url: string }>(`${gateway}/start`, { order_id: orderId, order_key: orderKey });

export const confirmOnlinePayment = (gateway: 'stripe' | 'paypal', orderId: number, orderKey: string, reference: string) =>
  callShopServer<{ status: string }>(`${gateway}/confirm`, { order_id: orderId, order_key: orderKey, reference });

/** Emails are best effort: an order must never fail because mail is not configured. */
export const notifyOrderEvent = (orderId: number, orderKey: string, event: string, extra: Record<string, unknown> = {}) =>
  callShopServer<{ sent: string[]; skipped?: string }>('orders/notify', { order_id: orderId, order_key: orderKey, event, ...extra })
    .catch((error: unknown) => ({ sent: [], skipped: error instanceof Error ? error.message : 'Email failed.' }));
