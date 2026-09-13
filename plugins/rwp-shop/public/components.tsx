import type { ReactNode } from 'react';
import { formatPrice } from '../lib/currencies';
import type { ShopSettings } from '../lib/settings';
import type { Address, CatalogProduct, Product, Variation } from '../lib/types';
import { cart, cartCount, useCart } from '../lib/cart';
import { countryName } from '../lib/countries';
import { effectivePrice, isOnSale } from '../lib/pricing';
import styles from './shop.module.css';

export function Price({ amount, settings, currency }: { amount: number | null | undefined; settings: ShopSettings; currency?: string }) {
  return <>{formatPrice(amount, settings, currency)}</>;
}

export function PriceHtml({ regular, current, settings, suffix = true }: {
  regular: number | null;
  current: number | null;
  settings: ShopSettings;
  suffix?: boolean;
}) {
  if (current === null || current === undefined) return <span className={styles.price} />;
  const onSale = regular !== null && regular !== undefined && Number(current) < Number(regular);
  return (
    <span className={styles.price}>
      {onSale && <del aria-label="Original price">{formatPrice(regular, settings)}</del>}
      {onSale ? <ins aria-label="Sale price">{formatPrice(current, settings)}</ins> : formatPrice(current, settings)}
      {suffix && settings.price_suffix && <small className={styles.priceSuffix}>{settings.price_suffix}</small>}
    </span>
  );
}

export function CatalogPrice({ product, settings }: { product: CatalogProduct; settings: ShopSettings }) {
  if (product.price_min === null) return null;
  if (product.type === 'variable' || product.type === 'grouped') {
    if (Number(product.price_min) !== Number(product.price_max)) {
      return (
        <span className={styles.price}>
          {formatPrice(product.price_min, settings)} – {formatPrice(product.price_max, settings)}
          {settings.price_suffix && <small className={styles.priceSuffix}>{settings.price_suffix}</small>}
        </span>
      );
    }
    return <PriceHtml regular={null} current={product.price_min} settings={settings} />;
  }
  return <PriceHtml regular={product.regular_price} current={product.price_min} settings={settings} />;
}

export function ProductPriceHtml({ product, variation, settings }: { product: Product & { variations?: Variation[] }; variation?: Variation | null; settings: ShopSettings }) {
  if (variation) {
    return <PriceHtml regular={variation.regular_price} current={effectivePrice(variation)} settings={settings} />;
  }
  if (product.type === 'variable' && product.variations?.length) {
    const prices = product.variations.map(effectivePrice).filter((price): price is number => price !== null);
    if (!prices.length) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max
      ? <PriceHtml regular={null} current={min} settings={settings} />
      : <span className={styles.price}>{formatPrice(min, settings)} – {formatPrice(max, settings)}</span>;
  }
  return <PriceHtml regular={product.regular_price} current={effectivePrice(product)} settings={settings} />;
}

export function Stars({ rating, count }: { rating: number; count?: number }) {
  const rounded = Math.round(Number(rating));
  return (
    <span className={styles.stars} role="img" aria-label={`Rated ${Number(rating).toFixed(1)} out of 5`}>
      {'★'.repeat(rounded)}{'☆'.repeat(5 - rounded)}
      {count !== undefined && <span className={styles.muted}> ({count})</span>}
    </span>
  );
}

export function SaleBadge({ product }: { product: Pick<Product, 'regular_price' | 'sale_price' | 'sale_from' | 'sale_to'> & { on_sale?: boolean } }) {
  const onSale = product.on_sale ?? isOnSale(product);
  return onSale ? <span className={styles.badge}>Sale!</span> : null;
}

export function ProductCard({ product, settings }: { product: CatalogProduct; settings: ShopSettings }) {
  const image = product.image_url || settings.placeholder_image;
  const simple = product.type === 'simple' && product.in_stock;
  return (
    <article className={styles.card}>
      <a className={styles.cardImage} href={`/product/${product.slug}`}>
        {product.on_sale && <span className={styles.badge}>Sale!</span>}
        {!product.in_stock && <span className={styles.badgeMuted}>Out of stock</span>}
        {image ? <img src={image} alt={product.name} loading="lazy" /> : null}
      </a>
      <h3 className={styles.cardTitle}><a href={`/product/${product.slug}`}>{product.name}</a></h3>
      {product.rating_count > 0 && <Stars rating={product.average_rating} />}
      <CatalogPrice product={product} settings={settings} />
      <div>
        {product.type === 'external' && product.external_url ? (
          <a className={styles.buttonSecondary} href={product.external_url} target="_blank" rel="noopener noreferrer">
            {product.button_text || 'Buy product'}
          </a>
        ) : simple ? (
          <AddToCartButton productId={product.id} settings={settings} />
        ) : (
          <a className={styles.buttonSecondary} href={`/product/${product.slug}`}>
            {product.in_stock ? (product.type === 'variable' ? 'Select options' : 'View products') : 'Read more'}
          </a>
        )}
      </div>
    </article>
  );
}

function AddToCartButton({ productId, settings }: { productId: string; settings: ShopSettings }) {
  const state = useCart();
  const inCart = state.items.filter((item) => item.product_id === productId).reduce((total, item) => total + item.quantity, 0);
  return (
    <span className={styles.addToCart}>
      <button
        type="button"
        className={styles.buttonSecondary}
        onClick={() => {
          cart.add(productId, 1);
          if (settings.redirect_to_cart) window.location.href = '/cart';
        }}
      >
        Add to cart
      </button>
      {inCart > 0 && <a className={styles.buttonLink} href="/cart">View cart ({inCart})</a>}
    </span>
  );
}

export function CartHeaderLink() {
  const state = useCart();
  const count = cartCount(state);
  return (
    <a className={styles.headerCart} href="/cart" aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}>
      <span aria-hidden="true">🛒</span>
      <span className={styles.headerCount}>{count}</span>
    </a>
  );
}

export function Notices({ errors = [], notices = [] }: { errors?: string[]; notices?: string[] }) {
  return (
    <>
      {errors.length > 0 && (
        <div className={styles.error} role="alert">
          {errors.length === 1 ? errors[0] : <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
        </div>
      )}
      {notices.length > 0 && (
        <div className={styles.notice} role="status">
          {notices.length === 1 ? notices[0] : <ul>{notices.map((notice) => <li key={notice}>{notice}</li>)}</ul>}
        </div>
      )}
    </>
  );
}

export function FormattedAddress({ address }: { address: Address }) {
  const lines = [
    [address.first_name, address.last_name].filter(Boolean).join(' '),
    address.company,
    address.address_1,
    address.address_2,
    [address.city, address.state, address.postcode].filter(Boolean).join(', '),
    countryName(address.country),
  ].filter(Boolean);
  return (
    <address>
      {lines.map((line) => <div key={line}>{line}</div>)}
      {address.phone && <div>{address.phone}</div>}
      {address.email && <div>{address.email}</div>}
    </address>
  );
}

export function PageShell({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <main className={`${styles.page} ${narrow ? styles.narrow : ''}`}>{children}</main>;
}

export function Breadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
      <a href="/">Home</a>
      {items.map((item) => (
        <span key={`${item.label}-${item.href || ''}`}>
          {' / '}
          {item.href ? <a href={item.href}>{item.label}</a> : <span aria-current="page">{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}
