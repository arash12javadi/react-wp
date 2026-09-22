import { useEffect, useState } from 'react';
import { fetchBundle, type BundleView } from '../lib/commerce';
import { cart } from '../lib/cart';
import { formatPrice } from '../lib/currencies';
import { useShopSettings } from '../lib/settings';
import type { CatalogProduct } from '../lib/types';
import './commerce.css';

/** Only simple, in-stock products can go into the cart without choosing options. */
const addable = (product: CatalogProduct) => product.type === 'simple' && product.in_stock && product.price_min !== null;

/**
 * <FrequentlyBoughtTogether main_product_id={id} />: the products set up under Shop → Offers & Q&A →
 * Bundles, with their bundle discount and an "Add all to cart" button. The prices shown are a preview:
 * the cart recomputes everything in shop_calculate, which is where the bundle discount is applied.
 */
export default function FrequentlyBoughtTogether({ main_product_id: mainProductId, title = 'Frequently bought together' }: { main_product_id: string; title?: string }) {
  const { settings, ready } = useShopSettings();
  const [bundle, setBundle] = useState<BundleView | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!mainProductId) return;
    let active = true;
    fetchBundle(mainProductId)
      .then((loaded) => {
        if (!active) return;
        setBundle(loaded);
        setChosen(Object.fromEntries(loaded.items.map((item) => [item.product.id, addable(item.product)])));
      })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : 'The bundle could not be loaded.'); });
    return () => { active = false; };
  }, [mainProductId]);

  if (!ready || !mainProductId) return null;
  if (error) return <p className="rwp-shop-error" role="alert">{error}</p>;
  if (!bundle?.main || !bundle.items.length) return null;

  const main = bundle.main;
  const money = (value: number) => formatPrice(value, settings);
  const picked = bundle.items.filter((item) => chosen[item.product.id] && addable(item.product));
  const mainPrice = Number(main.price_min || 0);
  const total = mainPrice + picked.reduce((sum, item) => sum + Number(item.product.price_min || 0) * (1 - item.discount / 100), 0);
  const regular = mainPrice + picked.reduce((sum, item) => sum + Number(item.product.price_min || 0), 0);
  const mainAddable = addable(main);

  const addAll = () => {
    if (!mainAddable) return;
    cart.add(main.id, 1);
    picked.forEach((item) => cart.add(item.product.id, 1));
    if (settings.redirect_to_cart) window.location.href = '/cart';
    else setAdded(true);
  };

  return (
    <section className="rwp-shop-fbt" aria-labelledby={`rwp-fbt-${main.id}`}>
      <h2 id={`rwp-fbt-${main.id}`}>{title}</h2>
      <ul className="rwp-shop-fbt-list">
        <li className="rwp-shop-fbt-item">
          <input type="checkbox" checked disabled aria-label={`${main.name} (this product)`} />
          {main.image_url ? <img src={main.image_url} alt="" loading="lazy" /> : <span className="rwp-shop-fbt-thumb" />}
          <span className="rwp-shop-fbt-name"><strong>This item:</strong> {main.name}</span>
          <span className="rwp-shop-fbt-price">{money(mainPrice)}</span>
        </li>
        {bundle.items.map(({ product, discount }) => {
          const price = Number(product.price_min || 0);
          const canAdd = addable(product);
          return (
            <li key={product.id} className="rwp-shop-fbt-item">
              <input type="checkbox" checked={Boolean(chosen[product.id]) && canAdd} disabled={!canAdd}
                aria-label={`Add ${product.name}`} onChange={(event) => setChosen((current) => ({ ...current, [product.id]: event.target.checked }))} />
              {product.image_url ? <img src={product.image_url} alt="" loading="lazy" /> : <span className="rwp-shop-fbt-thumb" />}
              <span className="rwp-shop-fbt-name">
                <a href={`/product/${product.slug}`}>{product.name}</a>
                {discount > 0 && <span className="rwp-shop-fbt-badge">−{discount}% together</span>}
                {!canAdd && <span className="rwp-shop-note"> · {product.in_stock ? 'choose options on its page' : 'out of stock'}</span>}
              </span>
              <span className="rwp-shop-fbt-price">
                {discount > 0 && canAdd ? <><del>{money(price)}</del>{money(price * (1 - discount / 100))}</> : money(price)}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="rwp-shop-fbt-total">
        <span>
          Total for {picked.length + 1} item{picked.length ? 's' : ''}: <strong>{money(total)}</strong>
          {regular > total && <> <del className="rwp-shop-note">{money(regular)}</del></>}
        </span>
        <button type="button" className="rwp-shop-tool-button is-primary" disabled={!mainAddable} onClick={addAll}>
          Add {picked.length ? 'all' : 'it'} to cart
        </button>
      </div>
      {!mainAddable && <p className="rwp-shop-note">Choose this product&rsquo;s options above and add it to the cart first; the suggestions can be added from their own pages.</p>}
      {added && <p className="rwp-shop-success" role="status">Added to your cart. <a href="/cart">View cart →</a> The bundle discount is applied in the cart.</p>}
      <p className="rwp-shop-note">Prices before tax and shipping; the cart shows the final amount.</p>
    </section>
  );
}
