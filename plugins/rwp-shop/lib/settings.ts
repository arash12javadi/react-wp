import { useEffect, useState } from 'react';
import { describeDbError, getSupabaseClient } from '../../../src/lib/db';
import type { BankAccount } from './types';

export interface GatewaySettings {
  enabled: boolean;
  title: string;
  description: string;
  instructions: string;
}

export type EmailEvent =
  | 'new_order' | 'cancelled_order' | 'failed_order'
  | 'customer_on_hold' | 'customer_processing' | 'customer_completed'
  | 'customer_refunded' | 'customer_note' | 'low_stock';

export interface ShopSettings {
  currency: string;
  currency_position: 'left' | 'right' | 'left_space' | 'right_space';
  thousand_separator: string;
  decimal_separator: string;
  decimals: number;

  store_address: string;
  store_address_2: string;
  store_city: string;
  store_postcode: string;
  store_country: string;
  store_state: string;

  selling_locations: 'all' | 'specific' | 'all_except';
  selling_countries: string[];
  except_countries: string[];
  shipping_locations: 'selling' | 'all' | 'specific';
  shipping_countries: string[];
  default_customer_location: 'base' | 'none';

  enable_coupons: boolean;
  calc_discounts_sequentially: boolean;

  enable_taxes: boolean;
  prices_include_tax: boolean;
  tax_based_on: 'shipping' | 'billing' | 'base';
  shipping_tax_class: string;
  tax_classes: string[];
  tax_total_display: 'itemized' | 'single';
  price_suffix: string;

  enable_shipping: boolean;

  manage_stock: boolean;
  hold_stock_minutes: number;
  notify_low_stock: boolean;
  notify_no_stock: boolean;
  stock_email_recipient: string;
  low_stock_amount: number;
  out_of_stock_amount: number;
  hide_out_of_stock: boolean;
  stock_format: 'always' | 'low' | 'never';

  shop_page_title: string;
  shop_page_description: string;
  products_per_page: number;
  default_orderby: string;
  redirect_to_cart: boolean;
  placeholder_image: string;
  weight_unit: string;
  dimension_unit: string;
  show_cart_in_header: boolean;

  enable_reviews: boolean;
  reviews_require_approval: boolean;
  verified_owners_only: boolean;
  show_verified_label: boolean;
  review_rating_required: boolean;

  /** Product Q&A, Make an Offer and price-drop alerts. Read by SQL too (shop_settings()). */
  enable_qa: boolean;
  enable_offers: boolean;
  /** Offers below this percentage of the price are refused by shop_make_offer. */
  offer_min_percent: number;
  /** How long the coupon of an accepted offer stays valid. */
  offer_valid_days: number;
  enable_price_alerts: boolean;

  guest_checkout: boolean;
  login_reminder: boolean;
  terms_page_url: string;
  privacy_text: string;
  checkout_phone: 'required' | 'optional' | 'hidden';
  checkout_company: 'required' | 'optional' | 'hidden';

  gateway_order: string[];
  gateways: {
    bacs: GatewaySettings & { accounts: BankAccount[] };
    cheque: GatewaySettings;
    cod: GatewaySettings;
    stripe: GatewaySettings;
    paypal: GatewaySettings & { sandbox: boolean };
  };

  emails: {
    from_name: string;
    admin_recipient: string;
    footer_text: string;
    base_color: string;
    enabled: Record<EmailEvent, boolean>;
  };
}

const gateway = (title: string, description: string): GatewaySettings => ({
  enabled: false, title, description, instructions: '',
});

export const defaultShopSettings: ShopSettings = {
  currency: 'USD',
  currency_position: 'left',
  thousand_separator: ',',
  decimal_separator: '.',
  decimals: 2,

  store_address: '',
  store_address_2: '',
  store_city: '',
  store_postcode: '',
  store_country: '',
  store_state: '',

  selling_locations: 'all',
  selling_countries: [],
  except_countries: [],
  shipping_locations: 'selling',
  shipping_countries: [],
  default_customer_location: 'base',

  enable_coupons: true,
  calc_discounts_sequentially: false,

  enable_taxes: false,
  prices_include_tax: false,
  tax_based_on: 'shipping',
  shipping_tax_class: 'inherit',
  tax_classes: ['reduced', 'zero'],
  tax_total_display: 'itemized',
  price_suffix: '',

  enable_shipping: true,

  manage_stock: true,
  hold_stock_minutes: 60,
  notify_low_stock: true,
  notify_no_stock: true,
  stock_email_recipient: '',
  low_stock_amount: 2,
  out_of_stock_amount: 0,
  hide_out_of_stock: false,
  stock_format: 'always',

  shop_page_title: 'Shop',
  shop_page_description: '',
  products_per_page: 12,
  default_orderby: 'menu_order',
  redirect_to_cart: false,
  placeholder_image: '',
  weight_unit: 'kg',
  dimension_unit: 'cm',
  show_cart_in_header: true,

  enable_reviews: true,
  reviews_require_approval: true,
  verified_owners_only: false,
  show_verified_label: true,
  review_rating_required: true,

  enable_qa: true,
  enable_offers: true,
  offer_min_percent: 50,
  offer_valid_days: 7,
  enable_price_alerts: true,

  guest_checkout: true,
  login_reminder: true,
  terms_page_url: '',
  privacy_text: 'Your personal data will be used to process your order and support your experience on this website.',
  checkout_phone: 'optional',
  checkout_company: 'optional',

  gateway_order: ['stripe', 'paypal', 'bacs', 'cheque', 'cod'],
  gateways: {
    bacs: { ...gateway('Direct bank transfer', 'Make your payment directly into our bank account. Use your order number as the payment reference. Your order will not be shipped until the funds have cleared.'), accounts: [] },
    cheque: gateway('Check payments', 'Please send a check to our store address.'),
    cod: gateway('Cash on delivery', 'Pay with cash upon delivery.'),
    stripe: gateway('Credit card', 'Pay securely with your card via Stripe.'),
    paypal: { ...gateway('PayPal', 'Pay with your PayPal account.'), sandbox: true },
  },

  emails: {
    from_name: '',
    admin_recipient: '',
    footer_text: '',
    base_color: '#7f54b3',
    enabled: {
      new_order: true,
      cancelled_order: true,
      failed_order: true,
      customer_on_hold: true,
      customer_processing: true,
      customer_completed: true,
      customer_refunded: true,
      customer_note: true,
      low_stock: true,
    },
  },
};

/** Merges a stored (possibly partial or outdated) object over the defaults, one level deep for groups. */
export const mergeShopSettings = (stored: Partial<ShopSettings> | null | undefined): ShopSettings => {
  const value = stored && typeof stored === 'object' ? stored : {};
  const gateways = (value.gateways || {}) as Partial<ShopSettings['gateways']>;
  const emails = (value.emails || {}) as Partial<ShopSettings['emails']>;
  return {
    ...defaultShopSettings,
    ...value,
    gateways: {
      bacs: { ...defaultShopSettings.gateways.bacs, ...gateways.bacs },
      cheque: { ...defaultShopSettings.gateways.cheque, ...gateways.cheque },
      cod: { ...defaultShopSettings.gateways.cod, ...gateways.cod },
      stripe: { ...defaultShopSettings.gateways.stripe, ...gateways.stripe },
      paypal: { ...defaultShopSettings.gateways.paypal, ...gateways.paypal },
    },
    emails: {
      ...defaultShopSettings.emails,
      ...emails,
      enabled: { ...defaultShopSettings.emails.enabled, ...emails.enabled },
    },
  };
};

let cache: Promise<ShopSettings> | null = null;

export const loadShopSettings = (force = false): Promise<ShopSettings> => {
  if (!cache || force) {
    cache = (async () => {
      const { data, error } = await getSupabaseClient()
        .from('options').select('option_value').eq('option_name', 'shop_settings').maybeSingle();
      if (error) throw new Error(describeDbError(error));
      if (!data?.option_value) return defaultShopSettings;
      try {
        return mergeShopSettings(JSON.parse(data.option_value));
      } catch {
        return defaultShopSettings;
      }
    })();
    cache.catch(() => { cache = null; });
  }
  return cache;
};

export const saveShopSettings = async (settings: ShopSettings): Promise<void> => {
  const { data, error } = await getSupabaseClient()
    .from('options')
    .upsert({ option_name: 'shop_settings', option_value: JSON.stringify(settings) })
    .select('option_name');
  if (error) throw new Error(describeDbError(error));
  // RLS rejections on upsert can come back as zero rows rather than an error.
  if (!data?.length) {
    throw new Error('The database did not save the shop settings. Your role needs the manage_shop capability (Shop Manager or Administrator), and the shop migration must have been run.');
  }
  cache = Promise.resolve(settings);
};

export const useShopSettings = () => {
  const [settings, setSettings] = useState<ShopSettings>(defaultShopSettings);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    loadShopSettings()
      .then((loaded) => { if (mounted) setSettings(loaded); })
      .catch(() => { /* Defaults keep the storefront usable. */ })
      .finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, []);
  return { settings, ready };
};

export const enabledGateways = (settings: ShopSettings) =>
  settings.gateway_order
    .filter((id): id is keyof ShopSettings['gateways'] => id in settings.gateways)
    .filter((id) => settings.gateways[id].enabled)
    .map((id) => ({ id, ...settings.gateways[id] }));
