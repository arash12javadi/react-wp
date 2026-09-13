import { useEffect, useState } from 'react';
import { defineRwpPlugin } from '../../src/lib/plugin-api';
import manifest from './manifest.json';
import ShopAdmin from './admin/ShopAdmin';
import ProductsAdmin from './admin/ProductsAdmin';
import { ShopDashboardWidget } from './admin/ReportsAdmin';
import ShopPage from './public/ShopPage';
import ProductPage from './public/ProductPage';
import CartPage from './public/CartPage';
import CheckoutPage from './public/CheckoutPage';
import AccountPage from './public/AccountPage';
import { OrderPayPage, OrderReceivedPage } from './public/OrderViews';
import { CartHeaderLink, ProductCard } from './public/components';
import { fetchCatalog } from './lib/api';
import { cart } from './lib/cart';
import { loadShopSettings, useShopSettings } from './lib/settings';
import type { CatalogProduct } from './lib/types';
import styles from './public/shop.module.css';

function HeaderCart() {
  const { settings, ready } = useShopSettings();
  if (!ready || !settings.show_cart_in_header) return null;
  return <CartHeaderLink />;
}

/** [rwp_products limit="4" category="shirts" tag="" featured="1" on_sale="1" orderby="popularity" ids="uuid,uuid"] */
function ProductsShortcode({ attributes }: { attributes: Record<string, string> }) {
  const { settings, ready } = useShopSettings();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const key = JSON.stringify(attributes);
  useEffect(() => {
    const parsed = JSON.parse(key) as Record<string, string>;
    fetchCatalog({
      per_page: Number(parsed.limit) || 4,
      category: parsed.category || undefined,
      tag: parsed.tag || undefined,
      featured: parsed.featured === '1' || parsed.featured === 'true',
      on_sale: parsed.on_sale === '1' || parsed.on_sale === 'true',
      orderby: parsed.orderby || undefined,
      ids: parsed.ids ? parsed.ids.split(',').map((id) => id.trim()) : undefined,
    }).then((result) => setProducts(result.products)).catch(() => setProducts([]));
  }, [key]);
  if (!ready) return null;
  return <div className={styles.grid}>{products.map((product) => <ProductCard key={product.id} product={product} settings={settings} />)}</div>;
}

/** [rwp_add_to_cart id="product-uuid" label="Buy now"] — simple products only. */
function AddToCartShortcode({ attributes }: { attributes: Record<string, string> }) {
  const [added, setAdded] = useState(false);
  return (
    <span className={styles.addToCart}>
      <button type="button" className={styles.button} onClick={() => { cart.add(attributes.id, Number(attributes.quantity) || 1); setAdded(true); }}>
        {attributes.label || 'Add to cart'}
      </button>
      {added && <a className={styles.buttonLink} href="/cart">View cart →</a>}
    </span>
  );
}

export const shopPluginCleanup = defineRwpPlugin(manifest, ({ admin, routes, header, shortcodes, actions }) => {
  const cleanups = [
    admin.registerPage({ id: 'rwp-shop', label: 'Shop', icon: '🛒', capability: 'manage_shop', component: ShopAdmin }),
    admin.registerPage({ id: 'rwp-shop-products', label: 'Products', icon: '📦', capability: 'manage_shop', component: ProductsAdmin }),
    admin.registerDashboardWidget({ id: 'rwp-shop-summary', title: 'Shop at a glance', component: ShopDashboardWidget }),

    routes.register({ path: '/shop', component: ShopPage }),
    routes.register({ path: '/product-category/:slug', component: ShopPage }),
    routes.register({ path: '/product-tag/:slug', component: ShopPage }),
    routes.register({ path: '/product/:slug', component: ProductPage }),
    routes.register({ path: '/cart', component: CartPage }),
    routes.register({ path: '/checkout', component: CheckoutPage }),
    routes.register({ path: '/checkout/order-received/:id', component: OrderReceivedPage }),
    routes.register({ path: '/checkout/order-pay/:id', component: OrderPayPage }),
    routes.register({ path: '/my-account/*', component: AccountPage }),

    header.register({ id: 'rwp-shop-cart', component: HeaderCart }),

    shortcodes.register({ name: 'rwp_products', render: (attributes) => <ProductsShortcode attributes={attributes} /> }),
    shortcodes.register({ name: 'rwp_add_to_cart', render: (attributes) => <AddToCartShortcode attributes={attributes} /> }),
    shortcodes.register({ name: 'rwp_cart_link', render: () => <CartHeaderLink /> }),

    // Carry a saved cart across devices once the customer signs in.
    actions.add('rwp_user_logged_in', () => { void cart.restoreFromAccount(); }),
    actions.add('rwp_settings_saved', () => { void loadShopSettings(true); }),
  ];
  return () => cleanups.forEach((cleanup) => cleanup());
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    shopPluginCleanup();
  });
}
