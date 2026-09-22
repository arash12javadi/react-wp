/**
 * Page builder widgets for the shop (Elementor's WooCommerce widgets).
 *
 * Registered from the shop plugin's register(), so they appear in the builder only while the shop
 * is active, and pages that use them show nothing once it is switched off. Prices, stock and totals
 * all come from the same SQL functions as the shop pages; nothing here computes an amount.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import ContentRenderer from '../../../src/components/ContentRenderer';
import { PublicChromeProvider } from '../../../src/components/PublicChrome';
import { getSupabaseClient } from '../../../src/lib/db';
import { alignControl, colorControl, headingTags, opts, typographyControl } from '../../rwp-page-builder/lib/controls';
import { Icon } from '../../rwp-page-builder/lib/icons';
import { registerWidget, type Control, type WidgetDefinition } from '../../rwp-page-builder/lib/registry';
import { alignToFlex, color, isSet, length, typography, type Typography } from '../../rwp-page-builder/lib/style';
import { useRenderContext } from '../../rwp-page-builder/render/context';
import {
  clamp, headingTag, num, pick, str, useAsync, useGalleryLightbox, WidgetError,
} from '../../rwp-page-builder/render/widgets/kit';
import { EditorPlaceholder } from '../../rwp-page-builder/render/widgets/shared';
import {
  calculateCart, cartInput, explainShopError, fetchApprovedReviews, fetchCatalog, fetchCategories, fetchProductBySlug, type ProductDetail,
} from '../lib/api';
import { cart, cartCount, useCart } from '../lib/cart';
import { formatPrice } from '../lib/currencies';
import { effectivePrice } from '../lib/pricing';
import { useShopSettings, type ShopSettings } from '../lib/settings';
import type { Variation } from '../lib/types';
import AccountPage from '../public/AccountPage';
import CartPage from '../public/CartPage';
import CheckoutPage from '../public/CheckoutPage';
import { OrderReceivedPage } from '../public/OrderViews';
import ShopPage from '../public/ShopPage';
import { ProductCard, ProductPriceHtml, SaleBadge, Stars } from '../public/components';
import { useShopRoute } from './ShopLayoutRoute';
import EngagementBar from '../../../src/components/engagement/EngagementBar';
import ProductQA from '../components/ProductQA';
import MakeOfferModal from '../components/MakeOfferModal';
import PriceAlertButton from '../components/PriceAlertButton';
import FrequentlyBoughtTogether from '../components/FrequentlyBoughtTogether';
import './shop-widgets.css';

const isBrowser = typeof window !== 'undefined';
const urlParam = (name: string) => (isBrowser ? new URLSearchParams(window.location.search).get(name) || '' : '');

// Product context -----------------------------------------------------------------------------------------

const productCache = new Map<string, Promise<ProductDetail | null>>();

const loadProduct = (slug: string) => {
  let promise = productCache.get(slug);
  if (!promise) {
    promise = fetchProductBySlug(slug);
    promise.catch(() => productCache.delete(slug));
    productCache.set(slug, promise);
  }
  return promise;
};

let previewSlug: Promise<string> | null = null;

/** In the editor, a product widget left on "from the URL" previews the first product. */
const firstProductSlug = () => {
  if (!previewSlug) previewSlug = fetchCatalog({ per_page: 1 }).then((result) => result.products[0]?.slug || '');
  return previewSlug;
};

const productOptions = async () => {
  const { data, error } = await getSupabaseClient().from('shop_products').select('name,slug,status').order('name');
  if (error) throw new Error(explainShopError(error));
  return ((data || []) as Array<{ name: string; slug: string; status: string }>)
    .map((row) => ({ value: row.slug, label: row.status === 'publish' ? row.name : `${row.name} (${row.status})` }));
};

const categoryOptions = async () => (await fetchCategories()).map((category) => ({ value: category.slug, label: category.name }));

const productControl = (): Control => ({
  key: 'product', label: 'Product', type: 'asyncSelect', loadOptions: productOptions, placeholder: '— From the page URL (?product=slug) —',
  help: 'Pick a product, or leave it on the URL to build one layout for many products: link to this page with ?product=the-product-slug.',
});

/** The product a single-product widget shows: chosen in the widget, the /product/:slug being viewed, or ?product= in the URL. */
function useProduct(settings: Record<string, unknown>) {
  const { mode } = useRenderContext();
  const route = useShopRoute();
  const chosen = str(settings.product) || route?.productSlug || urlParam('product');
  const slug = useAsync(!chosen && mode === 'edit' ? 'shop-preview-slug' : null, firstProductSlug);
  const resolved = chosen || slug.data || '';
  const product = useAsync(resolved ? `shop-product:${resolved}` : null, () => loadProduct(resolved));
  return { product: product.data, error: product.error, loading: product.loading || slug.loading, slug: resolved };
}

function ProductWidget({ settings, children }: { settings: Record<string, unknown>; children: (product: ProductDetail, shop: ShopSettings) => ReactNode }) {
  const { product, error, loading, slug } = useProduct(settings);
  const { settings: shop, ready } = useShopSettings();
  if (error) return <WidgetError message={error} />;
  if (!slug) return <EditorPlaceholder>Choose a product in the Content tab, or open this page with ?product=slug.</EditorPlaceholder>;
  if (loading || !ready) return null;
  if (!product) return <EditorPlaceholder>No product with the slug “{slug}”.</EditorPlaceholder>;
  return <>{children(product, shop)}</>;
}

/** Keeps the page title: the embedded shop pages set document.title for their own routes. */
function KeepTitle({ children }: { children: ReactNode }) {
  const [title] = useState(() => (isBrowser ? document.title : ''));
  useEffect(() => { if (title) document.title = title; });
  return <>{children}</>;
}

/** Full shop screens (cart, checkout, account) inside a builder page. */
function Embedded({ children, label }: { children: ReactNode; label: string }) {
  const { mode } = useRenderContext();
  if (mode === 'edit') return <div className="rwpb-placeholder"><Icon name="cart" size={16} /> {label} appears here on the live page.</div>;
  return <div className="rwpb-shop-embed"><PublicChromeProvider><KeepTitle>{children}</KeepTitle></PublicChromeProvider></div>;
}

const textControls = (key: string, label: string): Control[] => [colorControl(`${key}Color`, `${label} colour`), typographyControl(`${key}Typography`, `${label} typography`)];
const textCss = (bag: Record<string, unknown>, key: string) => ({ color: color(bag[`${key}Color`]), ...typography(bag[`${key}Typography`] as Typography | undefined) });
const alignCss = (bag: Record<string, unknown>) => ({ 'text-align': isSet(bag.align) ? String(bag.align) : undefined });

// Products and categories ------------------------------------------------------------------------------------

const productGridControls: Control[] = [
  { key: 'limit', label: 'Number of products', type: 'number', min: 1, max: 48 },
  { key: 'columns', label: 'Columns', type: 'slider', store: 'style', responsive: true, min: 1, max: 6 },
  { key: 'gap', label: 'Gap (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 60 },
  colorControl('titleColor', 'Title colour'),
  colorControl('cardBg', 'Card background'),
];

// Product cards are the shop's own component (CSS-module classes), so only element selectors are used here.
const productGridCss = (bag: Record<string, unknown>) => ({
  ' .rwpb-shop-grid': { 'grid-template-columns': `repeat(${clamp(Math.round(num(bag.columns, 4)), 1, 6)}, minmax(0, 1fr))`, gap: length(bag.gap ?? 20, 'px') },
  ' .rwpb-shop-grid article': { 'background-color': color(bag.cardBg) },
  ' .rwpb-shop-grid h3| .rwpb-shop-grid h3 a': { color: color(bag.titleColor) },
});

function ProductGrid({ query, emptyText }: { query: Parameters<typeof fetchCatalog>[0] | null; emptyText: string }) {
  const { settings, ready } = useShopSettings();
  const state = useAsync(query ? JSON.stringify(query) : null, () => fetchCatalog(query!));
  if (state.error) return <WidgetError message={state.error} />;
  if (!state.data || !ready) return null;
  if (!state.data.products.length) return <EditorPlaceholder>{emptyText}</EditorPlaceholder>;
  return <div className="rwpb-shop-grid">{state.data.products.map((product) => <ProductCard key={product.id} product={product} settings={settings} />)}</div>;
}

const products: WidgetDefinition = {
  type: 'shop-products',
  label: 'Products',
  icon: 'store',
  category: 'shop',
  keywords: ['woocommerce', 'shop', 'product grid', 'catalog'],
  defaults: () => ({ settings: { limit: 8, orderby: 'menu_order', category: '', tag: '', featured: false, onSale: false }, style: { columns: 4, gap: 20 } }),
  controls: [
    { key: 'category', label: 'Category', type: 'asyncSelect', loadOptions: categoryOptions, placeholder: 'All categories' },
    { key: 'tag', label: 'Tag slug', type: 'text' },
    { key: 'featured', label: 'Featured products only', type: 'toggle' },
    { key: 'onSale', label: 'On-sale products only', type: 'toggle' },
    { key: 'orderby', label: 'Order by', type: 'select', options: opts(['menu_order', 'Default sorting'], ['popularity', 'Popularity'], ['rating', 'Average rating'], ['date', 'Latest'], ['price', 'Price: low to high'], ['price-desc', 'Price: high to low'], ['title', 'Name']) },
    ...productGridControls,
  ],
  css: productGridCss,
  View: function ProductsView({ node }) {
    const settings = node.settings;
    return (
      <ProductGrid emptyText="No products match these settings." query={{
        per_page: clamp(Math.round(num(settings.limit, 8)), 1, 48), orderby: str(settings.orderby) || undefined,
        category: str(settings.category) || undefined, tag: str(settings.tag) || undefined,
        featured: Boolean(settings.featured), on_sale: Boolean(settings.onSale),
      }} />
    );
  },
};

const productCategories: WidgetDefinition = {
  type: 'shop-product-categories',
  label: 'Product Categories',
  icon: 'boxes',
  category: 'shop',
  keywords: ['woocommerce', 'categories', 'collections'],
  defaults: () => ({ settings: { topLevelOnly: true, limit: 8 }, style: { columns: 4, gap: 16 } }),
  controls: [
    { key: 'topLevelOnly', label: 'Top-level categories only', type: 'toggle' },
    { key: 'limit', label: 'Number of categories', type: 'number', min: 1, max: 48 },
    { key: 'columns', label: 'Columns', type: 'slider', store: 'style', responsive: true, min: 1, max: 6 },
    { key: 'gap', label: 'Gap (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 60 },
    ...textControls('title', 'Name'),
  ],
  css: (bag) => ({
    ' .rwpb-shop-categories': { 'grid-template-columns': `repeat(${clamp(Math.round(num(bag.columns, 4)), 1, 6)}, minmax(0, 1fr))`, gap: length(bag.gap ?? 16, 'px') },
    ' .rwpb-shop-category-name': textCss(bag, 'title'),
  }),
  View: function ProductCategoriesView({ node }) {
    const state = useAsync('shop-categories', fetchCategories);
    if (state.error) return <WidgetError message={state.error} />;
    if (!state.data) return null;
    const categories = state.data.filter((category) => !node.settings.topLevelOnly || !category.parent_id).slice(0, clamp(Math.round(num(node.settings.limit, 8)), 1, 48));
    if (!categories.length) return <EditorPlaceholder>No product categories yet (Shop → Products → Categories).</EditorPlaceholder>;
    return (
      <div className="rwpb-shop-categories">
        {categories.map((category) => (
          <a key={category.id} className="rwpb-shop-category" href={`/product-category/${category.slug}`}>
            <span className="rwpb-shop-category-image">{category.image_url ? <img src={category.image_url} alt="" loading="lazy" /> : <Icon name="package" size={32} />}</span>
            <span className="rwpb-shop-category-name">{category.name}</span>
          </a>
        ))}
      </div>
    );
  },
};

// Menu Cart -------------------------------------------------------------------------------------------------------

const menuCart: WidgetDefinition = {
  type: 'shop-menu-cart',
  label: 'Menu Cart',
  icon: 'cart',
  category: 'shop',
  keywords: ['woocommerce', 'mini cart', 'header cart', 'basket'],
  defaults: () => ({ settings: { showSubtotal: true, showCount: true, openOn: 'click', hideEmpty: false }, style: { align: 'right' } }),
  controls: [
    { key: 'showCount', label: 'Item count badge', type: 'toggle' },
    { key: 'showSubtotal', label: 'Subtotal next to the icon', type: 'toggle' },
    { key: 'openOn', label: 'Mini cart opens on', type: 'select', options: opts(['click', 'Click'], ['hover', 'Hover'], ['none', 'Never (go to the cart page)']) },
    { key: 'hideEmpty', label: 'Hide when the cart is empty', type: 'toggle' },
    alignControl(),
    colorControl('iconColor', 'Icon colour'),
    colorControl('badgeBg', 'Badge colour'),
    colorControl('panelBg', 'Mini cart background'),
  ],
  css: (bag) => ({
    ' .rwpb-menu-cart': { 'justify-content': alignToFlex(bag.align) },
    ' .rwpb-menu-cart-toggle': { color: color(bag.iconColor) },
    ' .rwpb-menu-cart-badge': { 'background-color': color(bag.badgeBg) },
    ' .rwpb-menu-cart-panel': { 'background-color': color(bag.panelBg) },
  }),
  View: function MenuCartView({ node }) {
    const { mode } = useRenderContext();
    const state = useCart();
    const { settings, ready } = useShopSettings();
    const [open, setOpen] = useState(false);
    const count = cartCount(state);
    const needsTotals = count > 0 && (Boolean(node.settings.showSubtotal) || open);
    const calculation = useAsync(needsTotals ? JSON.stringify(cartInput(state)) : null, () => calculateCart(cartInput(state)));
    const openOn = pick(node.settings.openOn, ['click', 'hover', 'none'] as const, 'click');
    if (!ready || (node.settings.hideEmpty && count === 0 && mode === 'view')) return null;
    const subtotal = calculation.data ? formatPrice(calculation.data.totals.subtotal, settings, calculation.data.currency) : '';
    const label = `Cart, ${count} item${count === 1 ? '' : 's'}`;
    const content = (
      <>
        <span className="rwpb-menu-cart-icon"><Icon name="cart" size={22} />{node.settings.showCount !== false && <span className="rwpb-menu-cart-badge">{count}</span>}</span>
        {Boolean(node.settings.showSubtotal) && subtotal && <span className="rwpb-menu-cart-subtotal">{subtotal}</span>}
      </>
    );
    return (
      <div className={`rwpb-menu-cart${open ? ' is-open' : ''}`} onMouseEnter={() => openOn === 'hover' && setOpen(true)} onMouseLeave={() => openOn === 'hover' && setOpen(false)}>
        {openOn === 'none'
          ? <a className="rwpb-menu-cart-toggle" href="/cart" aria-label={label}>{content}</a>
          : <button type="button" className="rwpb-menu-cart-toggle" aria-label={label} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{content}</button>}
        {open && openOn !== 'none' && (
          <div className="rwpb-menu-cart-panel" role="dialog" aria-label="Mini cart" onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}>
            {count === 0 ? <p className="rwpb-menu-cart-empty">Your cart is empty.</p> : (
              <>
                {calculation.error && <p className="rwpb-menu-cart-empty">{calculation.error}</p>}
                <ul className="rwpb-menu-cart-items">
                  {(calculation.data?.items || []).map((item) => (
                    <li key={item.key}>
                      {item.image_url && <img src={item.image_url} alt="" />}
                      <span className="rwpb-menu-cart-line">
                        <a href={`/product/${item.slug}`}>{item.name}</a>
                        <span>{item.quantity} × {formatPrice(item.unit_price, settings, calculation.data?.currency)}</span>
                      </span>
                      <button type="button" aria-label={`Remove ${item.name}`} onClick={() => cart.remove(item.key)}>×</button>
                    </li>
                  ))}
                </ul>
                {subtotal && <p className="rwpb-menu-cart-total"><span>Subtotal</span><strong>{subtotal}</strong></p>}
                <div className="rwpb-menu-cart-actions">
                  <a className="rwpb-button rwpb-button-sm rwpb-button-ghost" href="/cart">View cart</a>
                  <a className="rwpb-button rwpb-button-sm" href="/checkout">Checkout</a>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  },
};

// Single product ---------------------------------------------------------------------------------------------------

const productTitle: WidgetDefinition = {
  type: 'shop-product-title',
  label: 'Product Title',
  icon: 'heading',
  category: 'shop',
  keywords: ['woocommerce', 'product name'],
  defaults: () => ({ settings: { product: '', tag: 'h1' } }),
  controls: [productControl(), { key: 'tag', label: 'HTML tag', type: 'select', options: headingTags }, { key: 'link', label: 'Link to the product page', type: 'toggle' }, alignControl(), ...textControls('title', 'Title')],
  css: (bag) => ({ '': alignCss(bag), ' .rwpb-product-title': textCss(bag, 'title') }),
  View: function ProductTitleView({ node }) {
    const Tag = headingTag(node.settings.tag, 'h2');
    return <ProductWidget settings={node.settings}>{(product) => <Tag className="rwpb-product-title">{node.settings.link ? <a href={`/product/${product.slug}`}>{product.name}</a> : product.name}</Tag>}</ProductWidget>;
  },
};

const productImages: WidgetDefinition = {
  type: 'shop-product-images',
  label: 'Product Images',
  icon: 'images',
  category: 'shop',
  keywords: ['woocommerce', 'product gallery', 'photos'],
  defaults: () => ({ settings: { product: '', showThumbs: true, lightbox: true, saleBadge: true } }),
  controls: [
    productControl(),
    { key: 'showThumbs', label: 'Thumbnails', type: 'toggle' },
    { key: 'lightbox', label: 'Open in a lightbox', type: 'toggle' },
    { key: 'saleBadge', label: 'Sale badge', type: 'toggle' },
    { key: 'imageRadius', label: 'Corner radius (px)', type: 'slider', tab: 'style', min: 0, max: 40 },
  ],
  css: (bag) => ({ ' .rwpb-product-images img': { 'border-radius': length(bag.imageRadius, 'px') } }),
  View: function ProductImagesView({ node }) {
    return <ProductWidget settings={node.settings}>{(product, shop) => <ProductImages product={product} shop={shop} settings={node.settings} />}</ProductWidget>;
  },
};

function ProductImages({ product, shop, settings }: { product: ProductDetail; shop: ShopSettings; settings: Record<string, unknown> }) {
  const images = useMemo(() => [product.image_url, ...(product.gallery || [])].filter((url): url is string => Boolean(url)), [product]);
  const [active, setActive] = useState(0);
  const lightbox = useGalleryLightbox(images.map((src) => ({ src, alt: product.name })));
  const main = images[active] || shop.placeholder_image;
  if (!main) return <EditorPlaceholder>This product has no images.</EditorPlaceholder>;
  return (
    <div className="rwpb-product-images">
      <div className="rwpb-product-images-main">
        {settings.saleBadge !== false && <SaleBadge product={product} />}
        {settings.lightbox !== false && images.length
          ? <button type="button" onClick={() => lightbox.open(active)} aria-label={`Enlarge image of ${product.name}`}><img src={main} alt={product.name} /></button>
          : <img src={main} alt={product.name} />}
      </div>
      {settings.showThumbs !== false && images.length > 1 && (
        <div className="rwpb-product-images-thumbs">
          {images.map((url, index) => (
            <button key={`${url}-${index}`} type="button" aria-label={`Show image ${index + 1}`} aria-pressed={index === active} onClick={() => setActive(index)}>
              <img src={url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {lightbox.element}
    </div>
  );
}

const productPrice: WidgetDefinition = {
  type: 'shop-product-price',
  label: 'Product Price',
  icon: 'dollar',
  category: 'shop',
  keywords: ['woocommerce', 'price'],
  defaults: () => ({ settings: { product: '' } }),
  controls: [productControl(), alignControl(), ...textControls('price', 'Price')],
  css: (bag) => ({ '': alignCss(bag), ' .rwpb-product-price': textCss(bag, 'price') }),
  View: function ProductPriceView({ node }) {
    return <ProductWidget settings={node.settings}>{(product, shop) => <div className="rwpb-product-price"><ProductPriceHtml product={product} settings={shop} /></div>}</ProductWidget>;
  },
};

const matchesVariation = (variation: Variation, chosen: Record<string, string>) =>
  Object.entries(variation.attributes).every(([name, value]) => !value || chosen[name] === value);

function StockText({ status, quantity, manage, shop }: { status: string; quantity: number | null; manage: boolean; shop: ShopSettings }) {
  if (status === 'outofstock') return <p className="rwpb-product-stock is-out">Out of stock</p>;
  if (status === 'onbackorder') return <p className="rwpb-product-stock">Available on backorder</p>;
  if (!manage || quantity === null || shop.stock_format === 'never' || (shop.stock_format === 'low' && quantity > shop.low_stock_amount)) return <p className="rwpb-product-stock">In stock</p>;
  return <p className="rwpb-product-stock">{quantity} in stock</p>;
}

/** The product page's add-to-cart form: variations, stock and quantity. */
function AddToCartForm({ product, shop, showQuantity, buttonText }: { product: ProductDetail; shop: ShopSettings; showQuantity: boolean; buttonText: string }) {
  const { mode } = useRenderContext();
  const [chosen, setChosen] = useState<Record<string, string>>(product.default_attributes || {});
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState('');
  const variationAttributes = product.attributes.filter((attribute) => attribute.variation);
  const allChosen = variationAttributes.every((attribute) => chosen[attribute.name]);
  const variation = product.type === 'variable' && allChosen ? product.variations.find((item) => matchesVariation(item, chosen)) || null : null;

  if (product.type === 'external') {
    return product.external_url ? <a className="rwpb-button rwpb-button-md" href={product.external_url} target="_blank" rel="noopener noreferrer">{product.button_text || 'Buy product'}</a> : null;
  }
  if (product.type === 'grouped') return <a className="rwpb-button rwpb-button-md" href={`/product/${product.slug}`}>View products</a>;

  const stockSource = variation && variation.manage_stock ? variation : product;
  const stockStatus = variation ? variation.stock_status : product.stock_status;
  const purchasable = product.type === 'simple'
    ? effectivePrice(product) !== null && product.stock_status !== 'outofstock'
    : Boolean(variation && effectivePrice(variation) !== null && variation.stock_status !== 'outofstock');
  const maxQuantity = product.sold_individually ? 1
    : stockSource.manage_stock && stockSource.backorders === 'no' && stockSource.stock_quantity !== null ? stockSource.stock_quantity : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'edit' || !purchasable) return;
    const attributes = variation ? Object.fromEntries(Object.entries(variation.attributes).filter(([, value]) => !value).map(([name]) => [name, chosen[name]])) : {};
    cart.add(product.id, quantity, variation?.id || null, attributes);
    if (shop.redirect_to_cart) { window.location.href = '/cart'; return; }
    setAdded(`“${product.name}” has been added to your cart.`);
  };

  return (
    <form className="rwpb-add-to-cart" onSubmit={submit}>
      {product.type === 'variable' && (
        <div className="rwpb-add-to-cart-variations">
          {variationAttributes.map((attribute) => (
            <label key={attribute.name} className="rwpb-form-field">
              <span className="rwpb-form-label">{attribute.name}</span>
              <select className="rwpb-form-control" value={chosen[attribute.name] || ''} onChange={(event) => setChosen((current) => ({ ...current, [attribute.name]: event.target.value }))}>
                <option value="">Choose an option</option>
                {attribute.options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          ))}
          {allChosen && !variation && <p className="rwpb-form-alert">Sorry, this combination is unavailable. Please choose a different one.</p>}
          {variation && <ProductPriceHtml product={product} variation={variation} settings={shop} />}
        </div>
      )}
      {(product.type === 'simple' || variation) && <StockText status={stockStatus} quantity={stockSource.stock_quantity} manage={stockSource.manage_stock && shop.manage_stock} shop={shop} />}
      <div className="rwpb-add-to-cart-row">
        {showQuantity && !product.sold_individually && (
          <input className="rwpb-form-control rwpb-add-to-cart-qty" type="number" min={1} max={maxQuantity} value={quantity} aria-label="Quantity"
            onChange={(event) => setQuantity(Math.max(Number(event.target.value) || 1, 1))} />
        )}
        <button type="submit" className="rwpb-button rwpb-button-md rwpb-add-to-cart-button" disabled={!purchasable && mode === 'view'}>
          {product.type === 'variable' && !variation ? 'Select options' : stockStatus === 'outofstock' ? 'Out of stock' : buttonText || 'Add to cart'}
        </button>
      </div>
      {added && <p className="rwpb-form-success" role="status">{added} <a href="/cart">View cart →</a></p>}
    </form>
  );
}

const addToCartControls: Control[] = [
  { key: 'showQuantity', label: 'Quantity field', type: 'toggle' },
  { key: 'buttonText', label: 'Button text', type: 'text', placeholder: 'Add to cart' },
  alignControl('align', 'Alignment'),
  colorControl('buttonColor', 'Button text colour'),
  colorControl('buttonBg', 'Button background'),
];

const addToCartCss = (bag: Record<string, unknown>) => ({
  ' .rwpb-add-to-cart-row': { 'justify-content': alignToFlex(bag.align) },
  ' .rwpb-add-to-cart-button': { color: color(bag.buttonColor), 'background-color': color(bag.buttonBg) },
});

const addToCart: WidgetDefinition = {
  type: 'shop-add-to-cart',
  label: 'Add to Cart',
  icon: 'basket',
  category: 'shop',
  keywords: ['woocommerce', 'buy', 'variations'],
  defaults: () => ({ settings: { product: '', showQuantity: true, buttonText: '' } }),
  controls: [productControl(), ...addToCartControls],
  css: addToCartCss,
  View: function AddToCartView({ node }) {
    return <ProductWidget settings={node.settings}>{(product, shop) => <AddToCartForm key={product.id} product={product} shop={shop} showQuantity={node.settings.showQuantity !== false} buttonText={str(node.settings.buttonText)} />}</ProductWidget>;
  },
};

const customAddToCart: WidgetDefinition = {
  ...addToCart,
  type: 'shop-custom-add-to-cart',
  label: 'Custom Add to Cart',
  icon: 'cart',
  keywords: ['woocommerce', 'buy button', 'add to cart button'],
  defaults: () => ({ settings: { product: '', showQuantity: false, buttonText: 'Buy now' } }),
  controls: [{ ...productControl(), placeholder: '— Choose a product —', help: 'Any product. Variable products show their options; grouped and external products link out.' }, ...addToCartControls],
};

const productRating: WidgetDefinition = {
  type: 'shop-product-rating',
  label: 'Product Rating',
  icon: 'star',
  category: 'shop',
  keywords: ['woocommerce', 'stars', 'reviews'],
  defaults: () => ({ settings: { product: '', showCount: true } }),
  controls: [productControl(), { key: 'showCount', label: 'Review count', type: 'toggle' }, alignControl(), colorControl('starColor', 'Star colour')],
  css: (bag) => ({ '': alignCss(bag), ' .rwpb-product-rating': { color: color(bag.starColor) } }),
  View: function ProductRatingView({ node }) {
    return (
      <ProductWidget settings={node.settings}>
        {(product) => (product.rating_count > 0
          ? <div className="rwpb-product-rating"><Stars rating={product.average_rating} />{Boolean(node.settings.showCount) && <span> ({product.rating_count} customer review{product.rating_count === 1 ? '' : 's'})</span>}</div>
          : <EditorPlaceholder>This product has no reviews yet.</EditorPlaceholder>)}
      </ProductWidget>
    );
  },
};

const productStock: WidgetDefinition = {
  type: 'shop-product-stock',
  label: 'Product Stock',
  icon: 'package-check',
  category: 'shop',
  keywords: ['woocommerce', 'inventory', 'in stock'],
  defaults: () => ({ settings: { product: '' } }),
  controls: [productControl(), ...textControls('stock', 'Text')],
  css: (bag) => ({ ' .rwpb-product-stock': textCss(bag, 'stock') }),
  View: function ProductStockView({ node }) {
    return (
      <ProductWidget settings={node.settings}>
        {(product, shop) => (product.type === 'simple' || product.type === 'variable'
          ? <StockText status={product.stock_status} quantity={product.stock_quantity} manage={product.manage_stock && shop.manage_stock} shop={shop} />
          : <EditorPlaceholder>Stock is shown for simple and variable products.</EditorPlaceholder>)}
      </ProductWidget>
    );
  },
};

const productMeta: WidgetDefinition = {
  type: 'shop-product-meta',
  label: 'Product Meta',
  icon: 'tag',
  category: 'shop',
  keywords: ['woocommerce', 'sku', 'categories', 'tags'],
  defaults: () => ({ settings: { product: '', showSku: true, showCategories: true, showTags: true, layout: 'stacked' } }),
  controls: [
    productControl(),
    { key: 'showSku', label: 'SKU', type: 'toggle' },
    { key: 'showCategories', label: 'Categories', type: 'toggle' },
    { key: 'showTags', label: 'Tags', type: 'toggle' },
    { key: 'layout', label: 'Layout', type: 'select', options: opts(['stacked', 'Stacked'], ['inline', 'Inline']) },
    ...textControls('meta', 'Text'),
    colorControl('linkColor', 'Link colour'),
  ],
  css: (bag) => ({ ' .rwpb-product-meta': textCss(bag, 'meta'), ' .rwpb-product-meta a': { color: color(bag.linkColor) } }),
  View: function ProductMetaView({ node }) {
    const settings = node.settings;
    return (
      <ProductWidget settings={settings}>
        {(product) => (
          <div className={`rwpb-product-meta rwpb-product-meta-${settings.layout === 'inline' ? 'inline' : 'stacked'}`}>
            {settings.showSku !== false && product.sku && <span>SKU: {product.sku}</span>}
            {settings.showCategories !== false && product.categories.length > 0 && (
              <span>Categor{product.categories.length === 1 ? 'y' : 'ies'}: {product.categories.map((category, index) => <span key={category.id}>{index > 0 && ', '}<a href={`/product-category/${category.slug}`}>{category.name}</a></span>)}</span>
            )}
            {settings.showTags !== false && product.tags.length > 0 && (
              <span>Tag{product.tags.length === 1 ? '' : 's'}: {product.tags.map((tag, index) => <span key={tag.id}>{index > 0 && ', '}<a href={`/product-tag/${tag.slug}`}>{tag.name}</a></span>)}</span>
            )}
          </div>
        )}
      </ProductWidget>
    );
  },
};

const shortDescription: WidgetDefinition = {
  type: 'shop-short-description',
  label: 'Short Description',
  icon: 'file-text',
  category: 'shop',
  keywords: ['woocommerce', 'summary', 'excerpt'],
  defaults: () => ({ settings: { product: '' } }),
  controls: [productControl(), alignControl(), ...textControls('text', 'Text')],
  css: (bag) => ({ '': alignCss(bag), ' .rwpb-product-short': textCss(bag, 'text') }),
  View: function ShortDescriptionView({ node }) {
    return <ProductWidget settings={node.settings}>{(product) => (product.short_description ? <ContentRenderer className="rwpb-product-short rwpb-text" html={product.short_description} /> : <EditorPlaceholder>This product has no short description.</EditorPlaceholder>)}</ProductWidget>;
  },
};

const productContent: WidgetDefinition = {
  type: 'shop-product-content',
  label: 'Product Content',
  icon: 'file-text',
  category: 'shop',
  keywords: ['woocommerce', 'description', 'long description'],
  defaults: () => ({ settings: { product: '' } }),
  controls: [productControl(), ...textControls('text', 'Text')],
  css: (bag) => ({ ' .rwpb-product-content': textCss(bag, 'text') }),
  View: function ProductContentView({ node }) {
    return <ProductWidget settings={node.settings}>{(product) => (product.description ? <ContentRenderer className="rwpb-product-content rwpb-text" html={product.description} /> : <EditorPlaceholder>This product has no description.</EditorPlaceholder>)}</ProductWidget>;
  },
};

function AdditionalInformation({ product, shop }: { product: ProductDetail; shop: ShopSettings }) {
  const rows: Array<[string, string]> = [];
  if (product.weight) rows.push(['Weight', `${product.weight} ${shop.weight_unit}`]);
  if (product.length || product.width || product.height) rows.push(['Dimensions', `${[product.length, product.width, product.height].map((value) => value ?? '–').join(' × ')} ${shop.dimension_unit}`]);
  product.attributes.filter((attribute) => attribute.visible).forEach((attribute) => rows.push([attribute.name, attribute.options.join(', ')]));
  if (!rows.length) return <EditorPlaceholder>This product has no weight, dimensions or visible attributes.</EditorPlaceholder>;
  return <table className="rwpb-product-attributes"><tbody>{rows.map(([name, value]) => <tr key={name}><th scope="row">{name}</th><td>{value}</td></tr>)}</tbody></table>;
}

const additionalInformation: WidgetDefinition = {
  type: 'shop-additional-information',
  label: 'Additional Information',
  icon: 'table',
  category: 'shop',
  keywords: ['woocommerce', 'attributes', 'specifications', 'dimensions'],
  defaults: () => ({ settings: { product: '' } }),
  controls: [productControl(), colorControl('borderColor', 'Border colour')],
  css: (bag) => ({ ' .rwpb-product-attributes th| .rwpb-product-attributes td': { 'border-color': color(bag.borderColor) } }),
  View: function AdditionalInformationView({ node }) {
    return <ProductWidget settings={node.settings}>{(product, shop) => <AdditionalInformation product={product} shop={shop} />}</ProductWidget>;
  },
};

function ProductTabs({ product, shop }: { product: ProductDetail; shop: ShopSettings }) {
  const [tab, setTab] = useState<'description' | 'additional' | 'reviews'>('description');
  const reviews = useAsync(tab === 'reviews' ? `reviews:${product.id}` : null, () => fetchApprovedReviews(product.id));
  const tabs: Array<[typeof tab, string]> = [['description', 'Description'], ['additional', 'Additional information'], ...(shop.enable_reviews ? [['reviews', `Reviews (${product.rating_count})`] as [typeof tab, string]] : [])];
  return (
    <div className="rwpb-tabs rwpb-tabs-horizontal rwpb-tabs-align-start">
      <div className="rwpb-tab-list" role="tablist">
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={`rwpb-tab${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <div className="rwpb-tab-panel" role="tabpanel">
        {tab === 'description' && (product.description ? <ContentRenderer className="rwpb-text" html={product.description} /> : <p className="rwpb-muted">No description.</p>)}
        {tab === 'additional' && <AdditionalInformation product={product} shop={shop} />}
        {tab === 'reviews' && (
          <div className="rwpb-product-reviews">
            {reviews.error && <p className="rwpb-muted">{reviews.error}</p>}
            {reviews.data?.length === 0 && <p className="rwpb-muted">There are no reviews yet.</p>}
            {reviews.data?.map((review) => (
              <div key={review.id} className="rwpb-product-review">
                {review.rating && <Stars rating={review.rating} />}
                <p><strong>{review.author_name}</strong> <span className="rwpb-muted">— {new Date(review.created_at).toLocaleDateString()}</span></p>
                <p>{review.content}</p>
              </div>
            ))}
            {product.reviews_allowed && <p><a href={`/product/${product.slug}`}>Write a review on the product page →</a></p>}
          </div>
        )}
      </div>
    </div>
  );
}

const productDataTabs: WidgetDefinition = {
  type: 'shop-product-data-tabs',
  label: 'Product Data Tabs',
  icon: 'panel-top',
  category: 'shop',
  keywords: ['woocommerce', 'description', 'reviews', 'tabs'],
  defaults: () => ({ settings: { product: '' } }),
  controls: [productControl(), colorControl('activeColor', 'Active tab colour')],
  css: (bag) => ({ ' .rwpb-tabs': { '--rwpb-tabs-active': color(bag.activeColor) } }),
  View: function ProductDataTabsView({ node }) {
    return <ProductWidget settings={node.settings}>{(product, shop) => <ProductTabs product={product} shop={shop} />}</ProductWidget>;
  },
};

const relatedGridControls: Control[] = [
  { key: 'limit', label: 'Number of products', type: 'number', min: 1, max: 12 },
  { key: 'heading', label: 'Heading', type: 'text' },
  { key: 'columns', label: 'Columns', type: 'slider', store: 'style', responsive: true, min: 1, max: 6 },
  { key: 'gap', label: 'Gap (px)', type: 'slider', tab: 'style', responsive: true, min: 0, max: 60 },
  ...textControls('heading', 'Heading'),
];

const productRelated: WidgetDefinition = {
  type: 'shop-product-related',
  label: 'Product Related',
  icon: 'layers',
  category: 'shop',
  keywords: ['woocommerce', 'related products', 'similar'],
  defaults: () => ({ settings: { product: '', limit: 4, heading: 'Related products' }, style: { columns: 4, gap: 20 } }),
  controls: [productControl(), ...relatedGridControls],
  css: (bag) => ({ ...productGridCss(bag), ' .rwpb-shop-heading': textCss(bag, 'heading') }),
  View: function ProductRelatedView({ node }) {
    const limit = clamp(Math.round(num(node.settings.limit, 4)), 1, 12);
    return (
      <ProductWidget settings={node.settings}>
        {(product) => {
          const category = product.categories[0]?.slug;
          if (!category) return <EditorPlaceholder>This product has no category, so there are no related products.</EditorPlaceholder>;
          return <RelatedProducts heading={str(node.settings.heading)} exclude={product.id} limit={limit} query={{ category, per_page: limit + 1, orderby: 'popularity' }} />;
        }}
      </ProductWidget>
    );
  },
};

function RelatedProducts({ heading, exclude, limit, query }: { heading: string; exclude: string; limit: number; query: Parameters<typeof fetchCatalog>[0] }) {
  const { settings, ready } = useShopSettings();
  const state = useAsync(JSON.stringify(query), () => fetchCatalog(query));
  if (state.error) return <WidgetError message={state.error} />;
  if (!state.data || !ready) return null;
  const items = state.data.products.filter((item) => item.id !== exclude).slice(0, limit);
  if (!items.length) return <EditorPlaceholder>No other products to show.</EditorPlaceholder>;
  return (
    <section className="rwpb-shop-section">
      {heading && <h2 className="rwpb-shop-heading">{heading}</h2>}
      <div className="rwpb-shop-grid">{items.map((item) => <ProductCard key={item.id} product={item} settings={settings} />)}</div>
    </section>
  );
}

const upsells: WidgetDefinition = {
  type: 'shop-upsells',
  label: 'Upsells',
  icon: 'trending-up',
  category: 'shop',
  keywords: ['woocommerce', 'you may also like', 'upsell'],
  defaults: () => ({ settings: { product: '', limit: 4, heading: 'You may also like…' }, style: { columns: 4, gap: 20 } }),
  controls: [productControl(), ...relatedGridControls],
  css: (bag) => ({ ...productGridCss(bag), ' .rwpb-shop-heading': textCss(bag, 'heading') }),
  View: function UpsellsView({ node }) {
    const limit = clamp(Math.round(num(node.settings.limit, 4)), 1, 12);
    return (
      <ProductWidget settings={node.settings}>
        {(product) => (product.upsell_ids.length
          ? <RelatedProducts heading={str(node.settings.heading)} exclude={product.id} limit={limit} query={{ ids: product.upsell_ids, per_page: limit }} />
          : <EditorPlaceholder>This product has no upsells (Shop → Products → Linked products).</EditorPlaceholder>)}
      </ProductWidget>
    );
  },
};

// Archive and shop pages -------------------------------------------------------------------------------------------

const archiveProducts: WidgetDefinition = {
  type: 'shop-archive-products',
  label: 'Archive Products',
  icon: 'store',
  category: 'shop',
  keywords: ['woocommerce', 'shop page', 'catalog', 'filters'],
  defaults: () => ({ settings: {} }),
  controls: [],
  View: function ArchiveProductsView() {
    // On /product-category/:slug and /product-tag/:slug the catalogue follows the archive being viewed.
    const route = useShopRoute();
    return <Embedded label="The full shop catalogue, with sorting, filters and pagination,"><ShopPage params={route?.params || {}} /></Embedded>;
  },
};

const archiveDescription: WidgetDefinition = {
  type: 'shop-archive-description',
  label: 'Archive Description',
  icon: 'text-quote',
  category: 'shop',
  keywords: ['woocommerce', 'shop description', 'category description'],
  defaults: () => ({ settings: { showTitle: false } }),
  controls: [{ key: 'showTitle', label: 'Show the shop page title too', type: 'toggle' }, alignControl(), ...textControls('text', 'Text')],
  css: (bag) => ({ '': alignCss(bag), ' .rwpb-shop-description': textCss(bag, 'text') }),
  View: function ArchiveDescriptionView({ node }) {
    const { settings, ready } = useShopSettings();
    const route = useShopRoute();
    const slug = route?.categorySlug || urlParam('product_category');
    const categories = useAsync(slug ? 'shop-categories' : null, fetchCategories);
    if (!ready) return null;
    const category = slug ? categories.data?.find((item) => item.slug === slug) : null;
    const text = category?.description || settings.shop_page_description;
    if (!text && !node.settings.showTitle) return <EditorPlaceholder>Add a shop description under Shop → Settings, or a category description.</EditorPlaceholder>;
    return (
      <div className="rwpb-shop-description">
        {Boolean(node.settings.showTitle) && <h1 className="rwpb-shop-heading">{category?.name || settings.shop_page_title}</h1>}
        {text && <ContentRenderer className="rwpb-text" html={text} />}
      </div>
    );
  },
};

const cartWidget: WidgetDefinition = {
  type: 'shop-cart', label: 'Cart', icon: 'cart', category: 'shop', keywords: ['woocommerce', 'basket', 'cart page'],
  defaults: () => ({ settings: {} }), controls: [],
  View: function CartWidgetView() { return <Embedded label="The cart"><CartPage /></Embedded>; },
};

const checkoutWidget: WidgetDefinition = {
  type: 'shop-checkout', label: 'Checkout', icon: 'credit-card', category: 'shop', keywords: ['woocommerce', 'payment', 'checkout page'],
  defaults: () => ({ settings: {} }), controls: [],
  View: function CheckoutWidgetView() { return <Embedded label="The checkout form"><CheckoutPage /></Embedded>; },
};

const myAccount: WidgetDefinition = {
  type: 'shop-my-account', label: 'My Account', icon: 'circle-user', category: 'shop', keywords: ['woocommerce', 'account', 'orders', 'addresses'],
  defaults: () => ({ settings: {} }), controls: [],
  View: function MyAccountView() {
    // On /my-account/* the embedded account follows the sub-page (orders, addresses…) in the URL.
    const route = useShopRoute();
    return <Embedded label="The customer account dashboard (orders, addresses, details)"><AccountPage params={{ '*': route?.params['*'] || '' }} /></Embedded>;
  },
};

const purchaseSummary: WidgetDefinition = {
  type: 'shop-purchase-summary',
  label: 'Purchase Summary',
  icon: 'receipt',
  category: 'shop',
  keywords: ['woocommerce', 'thank you', 'order received', 'confirmation'],
  defaults: () => ({ settings: {} }),
  controls: [],
  View: function PurchaseSummaryView() {
    const { mode } = useRenderContext();
    const orderId = urlParam('order');
    if (mode === 'edit') return <div className="rwpb-placeholder"><Icon name="receipt" size={16} /> The order summary appears here when this page is opened with ?order=ID&amp;key=ORDER_KEY (for a custom thank-you page).</div>;
    if (!/^\d+$/.test(orderId)) return null;
    return <Embedded label="The order summary"><OrderReceivedPage params={{ id: orderId }} /></Embedded>;
  },
};

const shopNotices: WidgetDefinition = {
  type: 'shop-notices',
  label: 'Shop Notices',
  icon: 'bell',
  category: 'shop',
  keywords: ['woocommerce notices', 'store notice', 'banner', 'announcement'],
  defaults: () => ({ settings: { message: 'Free shipping on orders over $50!', dismissible: true, showCartAdded: true } }),
  controls: [
    { key: 'message', label: 'Store notice', type: 'textarea', help: 'Leave empty to show only cart messages.' },
    { key: 'dismissible', label: 'Visitors can dismiss it', type: 'toggle', help: 'Remembered in the browser until the message text changes.' },
    { key: 'showCartAdded', label: 'Confirm when something is added to the cart', type: 'toggle' },
    colorControl('noticeBg', 'Background'),
    colorControl('noticeColor', 'Text colour'),
  ],
  css: (bag) => ({ ' .rwpb-shop-notice': { 'background-color': color(bag.noticeBg), color: color(bag.noticeColor) } }),
  View: function ShopNoticesView({ node }) {
    const { mode } = useRenderContext();
    const state = useCart();
    const message = str(node.settings.message).trim();
    const storageKey = `rwpb-notice-${message.length}-${Array.from(message).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0)}`;
    const [dismissed, setDismissed] = useState(() => {
      try { return isBrowser && localStorage.getItem(storageKey) === '1'; } catch { return false; }
    });
    const [lastCount, setLastCount] = useState(() => cartCount(state));
    const [added, setAdded] = useState(false);
    useEffect(() => {
      const count = cartCount(state);
      if (count > lastCount) { setAdded(true); window.setTimeout(() => setAdded(false), 6000); }
      setLastCount(count);
    }, [state, lastCount]);
    const showMessage = message && (mode === 'edit' || !dismissed);
    if (!showMessage && !(added && node.settings.showCartAdded !== false)) return mode === 'edit' ? <EditorPlaceholder>Add a store notice in the Content tab.</EditorPlaceholder> : null;
    return (
      <div className="rwpb-shop-notices" aria-live="polite">
        {added && node.settings.showCartAdded !== false && <div className="rwpb-shop-notice rwpb-shop-notice-success">Added to your cart. <a href="/cart">View cart →</a></div>}
        {showMessage && (
          <div className="rwpb-shop-notice">
            <span>{message}</span>
            {Boolean(node.settings.dismissible) && (
              <button type="button" aria-label="Dismiss this notice" onClick={() => {
                if (mode === 'edit') return;
                setDismissed(true);
                try { localStorage.setItem(storageKey, '1'); } catch { /* Not remembered when storage is blocked. */ }
              }}>×</button>
            )}
          </div>
        )}
      </div>
    );
  },
};

// Product Q&A, Make an Offer, price alerts, Frequently Bought Together, likes/saves ----------------------------------
// The same components as the product page (plugins/rwp-shop/components); the database does every check.

const productQA: WidgetDefinition = {
  type: 'shop-product-qa',
  label: 'Product Q&A',
  icon: 'help',
  category: 'shop',
  keywords: ['questions', 'answers', 'faq', 'ask'],
  defaults: () => ({ settings: { product: '', title: 'Questions & answers' } }),
  controls: [productControl(), { key: 'title', label: 'Heading', type: 'text' }, colorControl('accent', 'Answer accent colour')],
  css: (bag) => ({ ' .rwp-shop-qa': { '--rwp-shop-accent': color(bag.accent) } }),
  View: function ProductQAView({ node }) {
    const { mode } = useRenderContext();
    return (
      <ProductWidget settings={node.settings}>
        {(product, shop) => (shop.enable_qa
          ? <ProductQA product_id={product.id} title={str(node.settings.title) || 'Questions & answers'} />
          : mode === 'edit' ? <EditorPlaceholder>Product Q&amp;A is switched off (Shop → Questions).</EditorPlaceholder> : null)}
      </ProductWidget>
    );
  },
};

const makeOffer: WidgetDefinition = {
  type: 'shop-make-offer',
  label: 'Make an Offer',
  icon: 'dollar',
  category: 'shop',
  keywords: ['offer', 'haggle', 'best offer', 'negotiate', 'ebay'],
  defaults: () => ({ settings: { product: '' } }),
  controls: [productControl(), alignControl(), colorControl('buttonColor', 'Button text colour')],
  css: (bag) => ({ '': alignCss(bag), ' .rwp-shop-tool-button': { color: color(bag.buttonColor) } }),
  View: function MakeOfferView({ node }) {
    return (
      <ProductWidget settings={node.settings}>
        {(product, shop) => (product.type !== 'simple'
          ? <EditorPlaceholder>Offers are only possible on simple products.</EditorPlaceholder>
          : !shop.enable_offers ? <EditorPlaceholder>Offers are switched off (Shop → Offers).</EditorPlaceholder>
            : <MakeOfferModal product_id={product.id} original_price={effectivePrice(product)} product_type={product.type} />)}
      </ProductWidget>
    );
  },
};

const priceAlert: WidgetDefinition = {
  type: 'shop-price-alert',
  label: 'Price Drop Alert',
  icon: 'bell',
  category: 'shop',
  keywords: ['price alert', 'notify', 'watch price', 'bell'],
  defaults: () => ({ settings: { product: '' } }),
  controls: [productControl(), alignControl()],
  css: (bag) => ({ '': alignCss(bag) }),
  View: function PriceAlertView({ node }) {
    return (
      <ProductWidget settings={node.settings}>
        {(product, shop) => (shop.enable_price_alerts
          ? <PriceAlertButton product_id={product.id} current_price={product.type === 'simple' ? effectivePrice(product) : minVariationPrice(product)} />
          : <EditorPlaceholder>Price alerts are switched off (Shop → Price alerts).</EditorPlaceholder>)}
      </ProductWidget>
    );
  },
};

const minVariationPrice = (product: ProductDetail) => {
  const prices = product.variations.map((variation) => effectivePrice(variation)).filter((price): price is number => price !== null);
  return prices.length ? Math.min(...prices) : null;
};

const frequentlyBought: WidgetDefinition = {
  type: 'shop-frequently-bought',
  label: 'Frequently Bought Together',
  icon: 'boxes',
  category: 'shop',
  keywords: ['bundle', 'cross-sell', 'bought together', 'add all to cart'],
  defaults: () => ({ settings: { product: '', title: 'Frequently bought together' } }),
  controls: [productControl(), { key: 'title', label: 'Heading', type: 'text' }, colorControl('accent', 'Button colour'), colorControl('panelBg', 'Background')],
  css: (bag) => ({ ' .rwp-shop-fbt': { '--rwp-shop-accent': color(bag.accent), 'background-color': color(bag.panelBg) } }),
  View: function FrequentlyBoughtView({ node }) {
    const { mode } = useRenderContext();
    return (
      <ProductWidget settings={node.settings}>
        {(product) => (
          <>
            <FrequentlyBoughtTogether main_product_id={product.id} title={str(node.settings.title) || 'Frequently bought together'} />
            {mode === 'edit' && <EditorPlaceholder>If nothing shows, add suggestions for “{product.name}” under Shop → Bundles.</EditorPlaceholder>}
          </>
        )}
      </ProductWidget>
    );
  },
};

const productEngagement: WidgetDefinition = {
  type: 'shop-product-engagement',
  label: 'Product Like & Save',
  icon: 'heart',
  category: 'shop',
  keywords: ['like', 'wishlist', 'save', 'bookmark', 'views'],
  defaults: () => ({ settings: { product: '', showLike: true, showSave: true, showViews: true } }),
  controls: [
    productControl(),
    { key: 'showLike', label: 'Like button', type: 'toggle' },
    { key: 'showSave', label: 'Save button (wishlist)', type: 'toggle' },
    { key: 'showViews', label: 'View count', type: 'toggle' },
  ],
  View: function ProductEngagementView({ node }) {
    return (
      <ProductWidget settings={node.settings}>
        {(product) => (
          <EngagementBar targetType="product" targetId={product.id} compact showFollow={false}
            showLike={node.settings.showLike !== false} showSave={node.settings.showSave !== false} showViews={node.settings.showViews !== false} />
        )}
      </ProductWidget>
    );
  },
};

/** Panel order within the Shop group. */
export const shopWidgets: WidgetDefinition[] = [
  products, productCategories, menuCart, customAddToCart, productTitle, productImages, productPrice, addToCart, productRating,
  productStock, productMeta, shortDescription, productContent, productDataTabs, additionalInformation, productRelated, upsells,
  productEngagement, priceAlert, makeOffer, frequentlyBought, productQA,
  archiveProducts, archiveDescription, cartWidget, checkoutWidget, myAccount, purchaseSummary, shopNotices,
];

/** Called from the shop plugin's register(); the returned function removes the widgets again. */
export function registerShopWidgets(): () => void {
  const cleanups = shopWidgets.map((definition) => registerWidget(definition));
  return () => cleanups.forEach((cleanup) => cleanup());
}
