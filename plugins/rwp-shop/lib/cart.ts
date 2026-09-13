import { useSyncExternalStore } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';

export interface CartItem {
  key: string;
  product_id: string;
  variation_id: string | null;
  quantity: number;
  attributes: Record<string, string>;
}

export interface CartState {
  items: CartItem[];
  coupons: string[];
  shipping_method_id: string | null;
}

const storageKey = 'rwp_shop_cart';
const emptyCart: CartState = { items: [], coupons: [], shipping_method_id: null };
const listeners = new Set<() => void>();

const read = (): CartState => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (parsed && Array.isArray(parsed.items)) {
      return { ...emptyCart, ...parsed };
    }
  } catch {
    // Private browsing or corrupt JSON: start with an empty cart.
  }
  return emptyCart;
};

let state: CartState = typeof window === 'undefined' ? emptyCart : read();
let syncTimer: number | undefined;

const syncToAccount = () => {
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(async () => {
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (!userId) return;
      // Best effort: the cart is also in localStorage, so a failed sync loses nothing locally.
      await supabase.from('shop_customers').upsert({ id: userId, cart: state }, { onConflict: 'id' });
    } catch {
      // Ignored on purpose; see above.
    }
  }, 800);
};

const commit = (next: CartState, sync = true) => {
  state = next;
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Storage full or blocked; the in-memory cart still works for this tab.
  }
  listeners.forEach((listener) => listener());
  if (sync) syncToAccount();
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey) {
      state = read();
      listeners.forEach((listener) => listener());
    }
  });
}

export const itemKey = (productId: string, variationId: string | null, attributes: Record<string, string>) =>
  [productId, variationId || '', ...Object.entries(attributes).sort().map(([name, value]) => `${name}=${value}`)].join('|');

export const cart = {
  get: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  add: (productId: string, quantity: number, variationId: string | null = null, attributes: Record<string, string> = {}) => {
    const key = itemKey(productId, variationId, attributes);
    const existing = state.items.find((item) => item.key === key);
    const items = existing
      ? state.items.map((item) => (item.key === key ? { ...item, quantity: item.quantity + quantity } : item))
      : [...state.items, { key, product_id: productId, variation_id: variationId, quantity, attributes }];
    commit({ ...state, items });
  },
  setQuantity: (key: string, quantity: number) => {
    const items = quantity <= 0
      ? state.items.filter((item) => item.key !== key)
      : state.items.map((item) => (item.key === key ? { ...item, quantity } : item));
    commit({ ...state, items });
  },
  remove: (key: string) => commit({ ...state, items: state.items.filter((item) => item.key !== key) }),
  applyCoupon: (code: string) => {
    const normalized = code.trim().toLowerCase();
    if (!normalized || state.coupons.includes(normalized)) return;
    commit({ ...state, coupons: [...state.coupons, normalized] });
  },
  removeCoupon: (code: string) => commit({ ...state, coupons: state.coupons.filter((item) => item !== code) }),
  setShippingMethod: (id: string | null) => commit({ ...state, shipping_method_id: id }),
  clear: () => commit(emptyCart),
  /** After sign-in: adopt the account's saved cart when this browser's cart is empty. */
  restoreFromAccount: async () => {
    if (state.items.length) {
      syncToAccount();
      return;
    }
    const supabase = getSupabaseClient();
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;
    const { data: row } = await supabase.from('shop_customers').select('cart').eq('id', userId).maybeSingle();
    const saved = row?.cart as CartState | undefined;
    if (saved && Array.isArray(saved.items) && saved.items.length) commit({ ...emptyCart, ...saved }, false);
  },
};

export const useCart = () => useSyncExternalStore(cart.subscribe, cart.get, cart.get);

export const cartCount = (value: CartState) => value.items.reduce((total, item) => total + item.quantity, 0);
