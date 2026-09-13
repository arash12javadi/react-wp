import { useEffect, useState, type FormEvent } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';
import { calculateCart, cartInput, explainShopError, fetchCatalog } from '../lib/api';
import { cart, useCart } from '../lib/cart';
import { countries } from '../lib/countries';
import { formatPrice } from '../lib/currencies';
import { useShopSettings, type ShopSettings } from '../lib/settings';
import type { Address, CartCalculation, CatalogProduct } from '../lib/types';
import { Breadcrumbs, Notices, PageShell, ProductCard } from './components';
import styles from './shop.module.css';

const estimateKey = 'rwp_shop_destination';

export const readDestination = (): Address => {
  try {
    return JSON.parse(localStorage.getItem(estimateKey) || '{}') as Address;
  } catch {
    return {};
  }
};

export const saveDestination = (address: Address) => {
  try {
    localStorage.setItem(estimateKey, JSON.stringify({
      country: address.country, state: address.state, postcode: address.postcode, city: address.city,
    }));
  } catch {
    // Not critical: the estimate is only a convenience.
  }
};

export function TotalsTable({ calculation, settings, onShippingChange }: {
  calculation: CartCalculation;
  settings: ShopSettings;
  onShippingChange?: (id: string) => void;
}) {
  const { totals } = calculation;
  const money = (amount: number) => formatPrice(amount, settings, calculation.currency);
  // Show amounts the way prices were entered: including tax when the shop enters prices with tax.
  const withTax = calculation.prices_include_tax;
  const subtotal = withTax ? Number(totals.subtotal) + Number(totals.subtotal_tax) : Number(totals.subtotal);

  return (
    <>
      <div className={styles.totalRow}><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
      {calculation.coupons.map((coupon) => (
        <div key={coupon.code} className={styles.totalRow}>
          <span>
            Coupon: <span className={styles.chip}>{coupon.code}
              <button type="button" aria-label={`Remove coupon ${coupon.code}`} onClick={() => cart.removeCoupon(coupon.code)}>×</button>
            </span>
          </span>
          <strong>-{money(Number(coupon.discount))}{coupon.free_shipping ? ' + free shipping' : ''}</strong>
        </div>
      ))}
      {calculation.needs_shipping && (
        <div>
          <div className={styles.totalRow}><span>Shipping</span></div>
          {calculation.shipping_methods.length > 0 ? (
            <ul className={styles.radioList} style={{ marginTop: 8 }}>
              {calculation.shipping_methods.map((method) => (
                <li key={method.id} className={styles.radioOption}>
                  <label>
                    <span>
                      <input type="radio" name="shipping_method" checked={calculation.chosen_shipping_method?.id === method.id}
                        onChange={() => onShippingChange?.(method.id)} disabled={!onShippingChange} />{' '}
                      {method.title}
                    </span>
                    <span>{Number(method.cost) > 0 ? money(Number(method.cost) + (withTax ? Number(method.tax) : 0)) : 'Free'}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : <p className={styles.muted}>Shipping options will be shown once you enter your address.</p>}
        </div>
      )}
      {calculation.taxes_enabled && !withTax && (
        settings.tax_total_display === 'itemized' && calculation.tax_lines.length > 0
          ? calculation.tax_lines.map((line) => (
            <div key={line.rate_id} className={styles.totalRow}>
              <span>{line.label}</span>
              <strong>{money(Number(line.tax_total) + Number(line.shipping_tax_total))}</strong>
            </div>
          ))
          : <div className={styles.totalRow}><span>Tax</span><strong>{money(Number(totals.total_tax))}</strong></div>
      )}
      <div className={`${styles.totalRow} ${styles.grand}`}>
        <span>Total</span>
        <span>
          {money(Number(totals.total))}
          {calculation.taxes_enabled && withTax && Number(totals.total_tax) > 0 && (
            <small className={styles.priceSuffix}> (includes {money(Number(totals.total_tax))} tax)</small>
          )}
        </span>
      </div>
    </>
  );
}

export default function CartPage() {
  const { settings, ready } = useShopSettings();
  const state = useCart();
  const [calculation, setCalculation] = useState<CartCalculation | null>(null);
  const [error, setError] = useState('');
  const [coupon, setCoupon] = useState('');
  const [destination, setDestination] = useState<Address>(readDestination);
  const [showEstimate, setShowEstimate] = useState(false);
  const [crossSells, setCrossSells] = useState<CatalogProduct[]>([]);

  useEffect(() => {
    document.title = 'Cart';
  }, []);

  useEffect(() => {
    if (!state.items.length) {
      setCalculation(null);
      return;
    }
    let mounted = true;
    calculateCart(cartInput(state, { billing: destination }))
      .then((result) => { if (mounted) { setCalculation(result); setError(''); } })
      .catch((calcError: unknown) => { if (mounted) setError(explainShopError(calcError)); });
    return () => { mounted = false; };
  }, [state, destination]);

  useEffect(() => {
    const ids = [...new Set(state.items.map((item) => item.product_id))];
    if (!ids.length) {
      setCrossSells([]);
      return;
    }
    void getSupabaseClient().from('shop_products').select('cross_sell_ids').in('id', ids).then(({ data }) => {
      const crossIds = [...new Set((data || []).flatMap((row) => row.cross_sell_ids as string[]))].filter((id) => !ids.includes(id));
      if (!crossIds.length) {
        setCrossSells([]);
        return;
      }
      fetchCatalog({ ids: crossIds, per_page: 4 }).then((result) => setCrossSells(result.products)).catch(() => setCrossSells([]));
    });
  }, [state.items]);

  const applyCoupon = (event: FormEvent) => {
    event.preventDefault();
    cart.applyCoupon(coupon);
    setCoupon('');
  };

  if (!ready) return <PageShell><p className={styles.muted}>Loading…</p></PageShell>;

  if (!state.items.length) {
    return (
      <PageShell narrow>
        <h1 className={styles.heading}>Cart</h1>
        <div className={styles.notice}>Your cart is currently empty.</div>
        <a className={styles.button} href="/shop">Return to shop</a>
      </PageShell>
    );
  }

  const calculatedByKey = new Map((calculation?.items || []).map((item) => [item.key, item]));
  const withTax = calculation?.prices_include_tax;

  return (
    <PageShell>
      <Breadcrumbs items={[{ label: 'Cart' }]} />
      <h1 className={styles.heading}>Cart</h1>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {calculation && <Notices errors={calculation.errors} notices={calculation.notices} />}

      <div className={styles.cartLayout}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th><span className="sr-only">Remove</span></th><th>Product</th><th>Price</th><th>Quantity</th><th>Subtotal</th></tr>
            </thead>
            <tbody>
              {state.items.map((item) => {
                const line = calculatedByKey.get(item.key);
                const lineTotal = line ? Number(line.subtotal) + (withTax ? Number(line.subtotal_tax) : 0) : null;
                return (
                  <tr key={item.key}>
                    <td><button type="button" className={styles.remove} aria-label="Remove item" onClick={() => cart.remove(item.key)}>×</button></td>
                    <td>
                      <div className={styles.lineItem}>
                        {line?.image_url ? <img src={line.image_url} alt="" /> : <span />}
                        <div>
                          {line ? <a href={`/product/${line.slug}`}>{line.name}</a> : <span className={styles.muted}>Unavailable product</span>}
                          {line?.sku && <div className={styles.muted}>SKU: {line.sku}</div>}
                        </div>
                      </div>
                    </td>
                    <td>{line ? formatPrice(line.unit_price, settings, calculation?.currency) : '—'}</td>
                    <td>
                      <input className={`${styles.input} ${styles.qty}`} type="number" min={0} max={line?.max_quantity ?? undefined}
                        value={item.quantity} aria-label="Quantity"
                        onChange={(event) => cart.setQuantity(item.key, Math.max(Number(event.target.value) || 0, 0))} />
                    </td>
                    <td>{lineTotal !== null ? formatPrice(lineTotal, settings, calculation?.currency) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {settings.enable_coupons && (
            <form className={styles.couponForm} onSubmit={applyCoupon} style={{ marginTop: 18, maxWidth: 420 }}>
              <input className={styles.input} value={coupon} onChange={(event) => setCoupon(event.target.value)} placeholder="Coupon code" aria-label="Coupon code" />
              <button type="submit" className={styles.buttonSecondary} disabled={!coupon.trim()}>Apply coupon</button>
            </form>
          )}
        </div>

        <aside className={styles.totals} aria-label="Cart totals">
          <h2>Cart totals</h2>
          {calculation ? (
            <TotalsTable calculation={calculation} settings={settings} onShippingChange={(id) => cart.setShippingMethod(id)} />
          ) : <p className={styles.muted}>Calculating…</p>}

          {calculation?.needs_shipping && (
            <div>
              <button type="button" className={styles.buttonLink} onClick={() => setShowEstimate((open) => !open)}>
                {destination.country ? 'Change address' : 'Calculate shipping'}
              </button>
              {showEstimate && (
                <form style={{ display: 'grid', gap: 8, marginTop: 8 }} onSubmit={(event) => { event.preventDefault(); setShowEstimate(false); }}>
                  <select className={styles.select} value={destination.country || ''} aria-label="Country"
                    onChange={(event) => { const next = { ...destination, country: event.target.value }; setDestination(next); saveDestination(next); }}>
                    <option value="">Select a country…</option>
                    {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
                  </select>
                  <input className={styles.input} placeholder="State / county" value={destination.state || ''}
                    onChange={(event) => { const next = { ...destination, state: event.target.value }; setDestination(next); saveDestination(next); }} />
                  <input className={styles.input} placeholder="Town / City" value={destination.city || ''}
                    onChange={(event) => { const next = { ...destination, city: event.target.value }; setDestination(next); saveDestination(next); }} />
                  <input className={styles.input} placeholder="Postcode / ZIP" value={destination.postcode || ''}
                    onChange={(event) => { const next = { ...destination, postcode: event.target.value }; setDestination(next); saveDestination(next); }} />
                  <button type="submit" className={styles.buttonSecondary}>Update</button>
                </form>
              )}
            </div>
          )}

          <a className={styles.button} href="/checkout" aria-disabled={Boolean(calculation?.errors.length)}
            onClick={(event) => { if (calculation?.errors.length) event.preventDefault(); }}>
            Proceed to checkout
          </a>
        </aside>
      </div>

      {crossSells.length > 0 && (
        <section className={styles.section}>
          <h2>You may be interested in…</h2>
          <div className={styles.grid}>{crossSells.map((item) => <ProductCard key={item.id} product={item} settings={settings} />)}</div>
        </section>
      )}
    </PageShell>
  );
}
