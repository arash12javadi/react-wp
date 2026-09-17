export type ProductType = 'simple' | 'variable' | 'grouped' | 'external';
/** 'trash' needs supabase/migrations/20260926_bulk_actions_trash.sql. */
export type ProductStatus = 'draft' | 'pending' | 'private' | 'publish' | 'trash';
export type StockStatus = 'instock' | 'outofstock' | 'onbackorder';
export type OrderStatus = 'pending' | 'processing' | 'on-hold' | 'completed' | 'cancelled' | 'refunded' | 'failed';

export interface ProductAttribute {
  name: string;
  attribute_id: string | null;
  options: string[];
  visible: boolean;
  variation: boolean;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  type: ProductType;
  status: ProductStatus;
  featured: boolean;
  catalog_visibility: 'visible' | 'catalog' | 'search' | 'hidden';
  description: string;
  short_description: string;
  sku: string | null;
  regular_price: number | null;
  sale_price: number | null;
  sale_from: string | null;
  sale_to: string | null;
  tax_status: 'taxable' | 'shipping' | 'none';
  tax_class: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  stock_status: StockStatus;
  backorders: 'no' | 'notify' | 'yes';
  low_stock_amount: number | null;
  sold_individually: boolean;
  weight: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  shipping_class_id: string | null;
  virtual: boolean;
  downloadable: boolean;
  download_limit: number | null;
  download_expiry_days: number | null;
  external_url: string | null;
  button_text: string | null;
  grouped_ids: string[];
  upsell_ids: string[];
  cross_sell_ids: string[];
  attributes: ProductAttribute[];
  default_attributes: Record<string, string>;
  image_url: string | null;
  gallery: string[];
  purchase_note: string | null;
  reviews_allowed: boolean;
  menu_order: number;
  total_sales: number;
  average_rating: number;
  rating_count: number;
  seo_title: string | null;
  meta_description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Variation {
  id: string;
  product_id: string;
  attributes: Record<string, string>;
  sku: string | null;
  regular_price: number | null;
  sale_price: number | null;
  sale_from: string | null;
  sale_to: string | null;
  manage_stock: boolean;
  stock_quantity: number | null;
  stock_status: StockStatus;
  backorders: 'no' | 'notify' | 'yes';
  weight: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  shipping_class_id: string | null;
  tax_class: string | null;
  virtual: boolean;
  downloadable: boolean;
  image_url: string | null;
  description: string;
  enabled: boolean;
  menu_order: number;
}

export interface CatalogProduct {
  id: string;
  name: string;
  slug: string;
  type: ProductType;
  featured: boolean;
  image_url: string | null;
  gallery: string[];
  short_description: string;
  price_min: number | null;
  price_max: number | null;
  regular_price: number | null;
  sale_price: number | null;
  on_sale: boolean;
  in_stock: boolean;
  stock_status: StockStatus;
  manage_stock: boolean;
  stock_quantity: number | null;
  average_rating: number;
  rating_count: number;
  external_url: string | null;
  button_text: string | null;
  sold_individually: boolean;
  sale_to: string | null;
}

export interface CatalogResult {
  total: number;
  page: number;
  per_page: number;
  price_bounds: { min: number | null; max: number | null };
  products: CatalogProduct[];
}

export interface Taxonomy {
  id: string;
  name: string;
  slug: string;
  description: string;
  parent_id?: string | null;
  image_url?: string | null;
  menu_order?: number;
}

export interface Address {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
}

export interface CalculatedItem {
  key: string;
  product_id: string;
  variation_id: string | null;
  name: string;
  product_name: string;
  slug: string;
  sku: string | null;
  image_url: string | null;
  quantity: number;
  unit_price: number;
  regular_price: number | null;
  on_sale: boolean;
  line_base: number;
  discount: number;
  attributes: Record<string, string>;
  virtual: boolean;
  subtotal: number;
  subtotal_tax: number;
  total: number;
  total_tax: number;
  max_quantity: number | null;
}

export interface ShippingOption {
  id: string;
  type: 'flat_rate' | 'free_shipping' | 'local_pickup';
  title: string;
  cost: number;
  tax: number;
}

export interface CartCalculation {
  currency: string;
  decimals: number;
  prices_include_tax: boolean;
  taxes_enabled: boolean;
  items: CalculatedItem[];
  coupons: Array<{ code: string; discount: number; free_shipping: boolean }>;
  needs_shipping: boolean;
  shipping_methods: ShippingOption[];
  chosen_shipping_method: ShippingOption | null;
  tax_lines: Array<{ rate_id: string; label: string; compound: boolean; tax_total: number; shipping_tax_total: number }>;
  totals: {
    subtotal: number;
    subtotal_tax: number;
    discount_total: number;
    discount_tax: number;
    shipping_total: number;
    shipping_tax: number;
    cart_tax: number;
    total_tax: number;
    total: number;
  };
  errors: string[];
  notices: string[];
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: string | null;
  variation_id: string | null;
  name: string;
  sku: string | null;
  quantity: number;
  price: number;
  subtotal: number;
  subtotal_tax: number;
  total: number;
  total_tax: number;
  tax_class: string;
  meta: { attributes?: Record<string, string>; purchase_note?: string | null };
  refunded_quantity: number;
  slug?: string | null;
  image_url?: string | null;
  downloads?: Array<{ id: string; name: string; downloads_remaining: number | null; expires_at: string | null }>;
}

export interface OrderNote {
  id: number;
  order_id: number;
  note: string;
  is_customer_note: boolean;
  author_name: string;
  created_at: string;
}

export interface Refund {
  id: number;
  order_id: number;
  amount: number;
  reason: string;
  refunded_payment: boolean;
  gateway_refund_id: string | null;
  created_at: string;
}

export interface Order {
  id: number;
  order_key: string;
  status: OrderStatus;
  customer_id: string | null;
  currency: string;
  prices_include_tax: boolean;
  subtotal: number;
  subtotal_tax: number;
  discount_total: number;
  discount_tax: number;
  shipping_total: number;
  shipping_tax: number;
  cart_tax: number;
  total_tax: number;
  total: number;
  refunded_total: number;
  payment_method: string;
  payment_method_title: string;
  transaction_id: string | null;
  paid_at: string | null;
  completed_at: string | null;
  billing: Address;
  shipping: Address;
  shipping_lines: Array<{ method_id: string; type: string; title: string; total: number; tax: number }>;
  tax_lines: Array<{ rate_id: string; label: string; tax_total: number; shipping_tax_total: number }>;
  coupon_lines: Array<{ code: string; discount: number }>;
  customer_note: string;
  created_via: string;
  gateway_data?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  items?: OrderItem[];
  notes?: OrderNote[];
  refunds?: Refund[];
  bank_accounts?: BankAccount[];
  payment_instructions?: string;
}

export interface BankAccount {
  account_name: string;
  account_number: string;
  bank_name: string;
  sort_code: string;
  iban: string;
  bic: string;
}

export interface Coupon {
  id: string;
  code: string;
  description: string;
  discount_type: 'percent' | 'fixed_cart' | 'fixed_product';
  amount: number;
  free_shipping: boolean;
  expires_at: string | null;
  minimum_spend: number | null;
  maximum_spend: number | null;
  individual_use: boolean;
  exclude_sale_items: boolean;
  product_ids: string[];
  excluded_product_ids: string[];
  category_ids: string[];
  excluded_category_ids: string[];
  allowed_emails: string[];
  usage_limit: number | null;
  usage_limit_per_user: number | null;
  limit_usage_to_x_items: number | null;
  usage_count: number;
  active: boolean;
}

export interface Review {
  id: number;
  product_id: string;
  author_id: string | null;
  author_name: string;
  rating: number | null;
  content: string;
  status: 'pending' | 'approved' | 'spam';
  verified: boolean;
  created_at: string;
}

export const orderStatusLabels: Record<OrderStatus, string> = {
  pending: 'Pending payment',
  processing: 'Processing',
  'on-hold': 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  failed: 'Failed',
};
