import { useEffect, useState, type ReactNode } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';
import { recordView } from '../../../src/lib/engagement';
import type { RwpShortcode } from '../../../src/lib/plugin-api';
import { explainShopError, fetchProductBySlug, type ProductDetail } from '../lib/api';
import { effectivePrice } from '../lib/pricing';
import ProductQA from './ProductQA';
import MakeOfferModal from './MakeOfferModal';
import PriceAlertButton from './PriceAlertButton';
import FrequentlyBoughtTogether from './FrequentlyBoughtTogether';

/** The slug of the product page being viewed (/product/:slug), for shortcodes placed without an id. */
const slugFromPath = () => {
  const match = typeof window === 'undefined' ? null : window.location.pathname.match(/^\/product\/([^/]+)\/?$/);
  if (match) { try { return decodeURIComponent(match[1]); } catch { return match[1]; } }
  return new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('product') || '';
};

const slugCache = new Map<string, Promise<ProductDetail | null>>();

const productById = async (id: string) => {
  const { data, error } = await getSupabaseClient().from('shop_products').select('slug').eq('id', id).maybeSingle();
  if (error) throw new Error(explainShopError(error));
  return data?.slug ? fetchProductBySlug(data.slug as string) : null;
};

/** Resolves the product a shortcode is about: id="…", slug="…", or the product page it sits on. */
function ShortcodeProduct({ attributes, children }: { attributes: Record<string, string>; children: (product: ProductDetail) => ReactNode }) {
  const key = attributes.id ? `id:${attributes.id}` : `slug:${attributes.slug || slugFromPath()}`;
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (key === 'slug:') return;
    let promise = slugCache.get(key);
    if (!promise) {
      promise = key.startsWith('id:') ? productById(key.slice(3)) : fetchProductBySlug(key.slice(5));
      promise.catch(() => slugCache.delete(key));
      slugCache.set(key, promise);
    }
    let active = true;
    promise.then((loaded) => { if (active) setProduct(loaded); }).catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Product not found.'); });
    return () => { active = false; };
  }, [key]);
  if (error) return <span className="rwp-shop-error">{error}</span>;
  return product ? <>{children(product)}</> : null;
}

const productAttributes = [
  { name: 'id', description: 'The product id (Shop → Products). Leave out id and slug to use the product page the shortcode is on.' },
  { name: 'slug', description: 'The product slug, instead of id.' },
];

export const commerceShortcodes: RwpShortcode[] = [
  {
    name: 'rwp_product_qa',
    description: "A product's customer questions and the store's answers, with an \"Ask a question\" form.",
    example: '[rwp_product_qa slug="blue-shirt"]',
    attributes: [...productAttributes, { name: 'title', description: 'The heading. Default "Questions & answers".' }],
    render: (attributes) => (
      <ShortcodeProduct attributes={attributes}>{(product) => <ProductQA product_id={product.id} title={attributes.title || undefined} />}</ShortcodeProduct>
    ),
  },
  {
    name: 'rwp_make_offer',
    description: 'A "Make an offer" button for a simple product. Answer offers under Shop → Offers.',
    example: '[rwp_make_offer id="PRODUCT-ID"]',
    attributes: productAttributes,
    render: (attributes) => (
      <ShortcodeProduct attributes={attributes}>
        {(product) => <MakeOfferModal product_id={product.id} original_price={effectivePrice(product)} product_type={product.type} />}
      </ShortcodeProduct>
    ),
  },
  {
    name: 'rwp_price_alert',
    description: 'A bell button: signed-in customers are told when the price drops to their target.',
    example: '[rwp_price_alert slug="blue-shirt"]',
    attributes: productAttributes,
    render: (attributes) => (
      <ShortcodeProduct attributes={attributes}>{(product) => <PriceAlertButton product_id={product.id} current_price={effectivePrice(product)} />}</ShortcodeProduct>
    ),
  },
  {
    name: 'rwp_frequently_bought',
    description: 'The products bought together with this one (Shop → Bundles), with the bundle discount and "Add all to cart".',
    example: '[rwp_frequently_bought slug="camera"]',
    attributes: [...productAttributes, { name: 'title', description: 'The heading. Default "Frequently bought together".' }],
    render: (attributes) => (
      <ShortcodeProduct attributes={attributes}>{(product) => <FrequentlyBoughtTogether main_product_id={product.id} title={attributes.title || undefined} />}</ShortcodeProduct>
    ),
  },
];

/** Counts a view of /product/:slug, whether the built-in page or a Product template shows it. */
export function useProductView(slug: string | undefined) {
  useEffect(() => {
    if (!slug) return;
    let active = true;
    void getSupabaseClient().from('shop_products').select('id').eq('slug', slug).eq('status', 'publish').maybeSingle()
      .then(({ data }) => { if (active && data?.id) void recordView('product', data.id as string); });
    return () => { active = false; };
  }, [slug]);
}
