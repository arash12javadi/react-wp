/**
 * Product Q&A, Make an Offer, price-drop alerts and Frequently Bought Together
 * (supabase/migrations/20261005_shop_engagement.sql). Amounts are decided in SQL: an offer is only a
 * request until the store accepts it, and the agreed price reaches checkout as a single-use coupon.
 */
import { describeDbError, getSupabaseClient } from '../../../src/lib/db';
import { callShopServer, fetchCatalog } from './api';
import type { CatalogProduct } from './types';

export const commerceMigration = 'supabase/migrations/20261005_shop_engagement.sql';

/** Names the real cause, including "the migration has not run". */
export const explainCommerceError = (error: unknown): string => {
  const message = describeDbError(error);
  if (/PGRST202|PGRST205|42P01|42883|schema cache|Could not find the function|shop_product_(qa|offers|bundles)|shop_price_drop_alerts/i.test(message)
    && /does not exist|Could not find|schema cache|PGRST20/i.test(message)) {
    return `The shop's Q&A, offers, alerts and bundles are not in the database yet. Run ${commerceMigration} in the Supabase SQL Editor (after 20261004_engagement.sql), then reload.`;
  }
  if (/row-level security/i.test(message)) {
    return `The database refused this under row level security. Managing offers, questions and bundles needs the manage_shop capability. (${message})`;
  }
  return message.replace(/\s*\((?:42501|22023|54000|P0001)\)$/, '');
};

const fail = (error: unknown): never => { throw new Error(explainCommerceError(error)); };

const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await getSupabaseClient().rpc(name, args);
  if (error) fail(error);
  return data as T;
};

export const currentUserId = async () => (await getSupabaseClient().auth.getSession()).data.session?.user.id || '';

// Q&A --------------------------------------------------------------------------------------------

export type QuestionStatus = 'pending' | 'published' | 'hidden';

export interface ProductQuestion {
  id: string;
  product_id: string;
  user_id: string;
  author_name: string;
  question: string;
  answer: string | null;
  answered_at: string | null;
  status: QuestionStatus;
  created_at: string;
  shop_products?: { name: string; slug: string } | null;
}

/** Published questions, plus the signed-in person's own pending ones (row level security decides). */
export const fetchProductQuestions = async (productId: string): Promise<ProductQuestion[]> => {
  const { data, error } = await getSupabaseClient().from('shop_product_qa').select('*')
    .eq('product_id', productId).neq('status', 'hidden').order('created_at', { ascending: false }).limit(200);
  if (error) fail(error);
  return (data || []) as ProductQuestion[];
};

export const askQuestion = async (productId: string, question: string): Promise<ProductQuestion> => {
  const text = question.trim();
  if (text.length < 3) throw new Error('Please write your question (at least 3 characters).');
  if (text.length > 1000) throw new Error('A question can be at most 1,000 characters long.');
  const { data, error } = await getSupabaseClient().from('shop_product_qa').insert({ product_id: productId, question: text }).select('*');
  if (error) fail(error);
  if (!data?.length) throw new Error('The question was not saved: the database accepted the request but stored nothing.');
  return data[0] as ProductQuestion;
};

export const deleteQuestion = async (id: string) => {
  const { data, error } = await getSupabaseClient().from('shop_product_qa').delete().eq('id', id).select('id');
  if (error) fail(error);
  if (!data?.length) throw new Error('Nothing was deleted: an answered question can only be deleted by the store.');
};

export const fetchQuestionsForAdmin = async (status: QuestionStatus | ''): Promise<ProductQuestion[]> => {
  let query = getSupabaseClient().from('shop_product_qa').select('*, shop_products(name,slug)').order('created_at', { ascending: false }).limit(300);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) fail(error);
  return (data || []) as ProductQuestion[];
};

export const updateQuestion = async (id: string, patch: Partial<Pick<ProductQuestion, 'answer' | 'status' | 'question'>>) => {
  const { data, error } = await getSupabaseClient().from('shop_product_qa').update(patch).eq('id', id).select('*');
  if (error) fail(error);
  if (!data?.length) throw new Error('The question was not updated: row level security blocked it. Your role needs the manage_shop capability.');
  return data[0] as ProductQuestion;
};

// Offers -----------------------------------------------------------------------------------------

export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'countered' | 'withdrawn';

export interface ProductOffer {
  id: string;
  product_id: string;
  user_id: string;
  offered_price: number;
  list_price: number | null;
  status: OfferStatus;
  counter_price: number | null;
  message: string;
  response_message: string;
  coupon_code: string | null;
  expires_at: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
  shop_products?: { name: string; slug: string; image_url: string | null } | null;
  profiles?: { display_name: string | null; email: string | null } | null;
}

const toOffer = (row: ProductOffer): ProductOffer => ({
  ...row,
  offered_price: Number(row.offered_price),
  list_price: row.list_price === null ? null : Number(row.list_price),
  counter_price: row.counter_price === null ? null : Number(row.counter_price),
});

/** The signed-in person's latest offer on a product, or null. */
export const fetchMyOffer = async (productId: string): Promise<ProductOffer | null> => {
  const uid = await currentUserId();
  if (!uid) return null;
  const { data, error } = await getSupabaseClient().from('shop_product_offers').select('*')
    .eq('product_id', productId).eq('user_id', uid).order('created_at', { ascending: false }).limit(1);
  if (error) fail(error);
  return data?.[0] ? toOffer(data[0] as ProductOffer) : null;
};

export const fetchMyOffers = async (): Promise<ProductOffer[]> => {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data, error } = await getSupabaseClient().from('shop_product_offers').select('*, shop_products(name,slug,image_url)')
    .eq('user_id', uid).order('updated_at', { ascending: false }).limit(100);
  if (error) fail(error);
  return ((data || []) as ProductOffer[]).map(toOffer);
};

export const makeOffer = async (productId: string, price: number, message: string) =>
  toOffer(await rpc<ProductOffer>('shop_make_offer', { p_product_id: productId, p_offered_price: price, p_message: message }));

export const answerCounterOffer = async (offerId: string, accept: boolean) =>
  toOffer(await rpc<ProductOffer>('shop_answer_counter_offer', { p_offer_id: offerId, p_accept: accept }));

export const withdrawOffer = async (offerId: string) => toOffer(await rpc<ProductOffer>('shop_withdraw_offer', { p_offer_id: offerId }));

export const fetchOffersForAdmin = async (status: OfferStatus | ''): Promise<ProductOffer[]> => {
  let query = getSupabaseClient().from('shop_product_offers')
    .select('*, shop_products(name,slug,image_url), profiles!shop_product_offers_user_id_fkey(display_name,email)')
    .order('created_at', { ascending: false }).limit(300);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) fail(error);
  return ((data || []) as ProductOffer[]).map(toOffer);
};

export const respondToOffer = async (offerId: string, action: 'accept' | 'reject' | 'counter', counterPrice: number | null, message: string) =>
  toOffer(await rpc<ProductOffer>('shop_respond_to_offer', {
    p_offer_id: offerId, p_action: action, p_counter_price: counterPrice, p_message: message,
  }));

/** Emails the customer about the store's answer. Best effort: the answer is saved either way. */
export const notifyOfferCustomer = (offerId: string) =>
  callShopServer<{ sent: boolean; skipped?: string }>('offers/notify', { offer_id: offerId })
    .catch((error: unknown) => ({ sent: false, skipped: error instanceof Error ? error.message : 'Email failed.' }));

// Price alerts ------------------------------------------------------------------------------------

export interface PriceAlert {
  id: string;
  product_id: string;
  user_id: string;
  target_price: number;
  is_notified: boolean;
  notified_at: string | null;
  notified_price: number | null;
  emailed_at: string | null;
  created_at: string;
  shop_products?: { name: string; slug: string } | null;
  profiles?: { display_name: string | null; email: string | null } | null;
}

const toAlert = (row: PriceAlert): PriceAlert => ({
  ...row,
  target_price: Number(row.target_price),
  notified_price: row.notified_price === null ? null : Number(row.notified_price),
});

export const fetchMyPriceAlert = async (productId: string): Promise<PriceAlert | null> => {
  const uid = await currentUserId();
  if (!uid) return null;
  const { data, error } = await getSupabaseClient().from('shop_price_drop_alerts').select('*')
    .eq('product_id', productId).eq('user_id', uid).maybeSingle();
  if (error) fail(error);
  return data ? toAlert(data as PriceAlert) : null;
};

export const setPriceAlert = async (productId: string, target: number) =>
  toAlert(await rpc<PriceAlert>('shop_set_price_alert', { p_product_id: productId, p_target_price: target }));

export const removePriceAlert = async (productId: string) => {
  const uid = await currentUserId();
  const { data, error } = await getSupabaseClient().from('shop_price_drop_alerts').delete()
    .eq('product_id', productId).eq('user_id', uid).select('id');
  if (error) fail(error);
  if (!data?.length) throw new Error('There was no price alert to remove.');
};

export const fetchAlertsForAdmin = async (): Promise<PriceAlert[]> => {
  const { data, error } = await getSupabaseClient().from('shop_price_drop_alerts')
    .select('*, shop_products(name,slug), profiles!shop_price_drop_alerts_user_id_fkey(display_name,email)')
    .order('created_at', { ascending: false }).limit(500);
  if (error) fail(error);
  return ((data || []) as PriceAlert[]).map(toAlert);
};

/** Marks alerts whose price has been reached (catches scheduled sales too). */
export const checkPriceAlerts = () => rpc<number>('shop_check_price_alerts', { p_product_id: null });

export const sendPriceAlertEmails = () =>
  callShopServer<{ sent: number; failed: string[]; skipped?: string }>('price-alerts/send', {});

// Frequently bought together ----------------------------------------------------------------------

export interface ProductBundle {
  id: string;
  main_product_id: string;
  suggested_product_id: string;
  discount_percentage: number;
  menu_order: number;
}

export const fetchBundleRows = async (mainProductId: string): Promise<ProductBundle[]> => {
  const { data, error } = await getSupabaseClient().from('shop_product_bundles').select('*')
    .eq('main_product_id', mainProductId).order('menu_order').order('created_at');
  if (error) fail(error);
  return ((data || []) as ProductBundle[]).map((row) => ({ ...row, discount_percentage: Number(row.discount_percentage) }));
};

export interface BundleView {
  main: CatalogProduct | null;
  items: Array<{ product: CatalogProduct; discount: number }>;
}

/** The main product and its published suggestions, with display prices from shop_catalog. */
export const fetchBundle = async (mainProductId: string): Promise<BundleView> => {
  const rows = await fetchBundleRows(mainProductId);
  if (!rows.length) return { main: null, items: [] };
  const ids = [mainProductId, ...rows.map((row) => row.suggested_product_id)];
  const catalog = await fetchCatalog({ ids, per_page: ids.length });
  const byId = new Map(catalog.products.map((product) => [product.id, product]));
  return {
    main: byId.get(mainProductId) || null,
    items: rows.filter((row) => byId.has(row.suggested_product_id))
      .map((row) => ({ product: byId.get(row.suggested_product_id)!, discount: row.discount_percentage })),
  };
};

export const saveBundleRow = async (row: Omit<ProductBundle, 'id'> & { id?: string }) => {
  if (row.main_product_id === row.suggested_product_id) throw new Error('A product cannot be suggested with itself.');
  if (!(row.discount_percentage >= 0 && row.discount_percentage <= 90)) throw new Error('The discount must be between 0 and 90 percent.');
  const { data, error } = await getSupabaseClient().from('shop_product_bundles')
    .upsert(row, { onConflict: 'main_product_id,suggested_product_id' }).select('*');
  if (error) fail(error);
  if (!data?.length) throw new Error('The bundle was not saved: row level security blocked it. Your role needs the manage_shop capability.');
};

export const deleteBundleRow = async (id: string) => {
  const { data, error } = await getSupabaseClient().from('shop_product_bundles').delete().eq('id', id).select('id');
  if (error) fail(error);
  if (!data?.length) throw new Error('Nothing was deleted: row level security blocked it, or it was already gone.');
};

export const fetchProductChoices = async (): Promise<Array<{ id: string; name: string; status: string; type: string }>> => {
  const { data, error } = await getSupabaseClient().from('shop_products').select('id,name,status,type').neq('status', 'trash').order('name');
  if (error) fail(error);
  return (data || []) as Array<{ id: string; name: string; status: string; type: string }>;
};
