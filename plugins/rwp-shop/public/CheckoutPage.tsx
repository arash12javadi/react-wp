import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';
import { usePublicChrome } from '../../../src/components/PublicChrome';
import {
  calculateCart, cartInput, explainShopError, notifyOrderEvent, placeOrder, startOnlinePayment,
} from '../lib/api';
import { cart, useCart } from '../lib/cart';
import { countries } from '../lib/countries';
import { formatPrice } from '../lib/currencies';
import { enabledGateways, useShopSettings, type ShopSettings } from '../lib/settings';
import type { Address, CartCalculation } from '../lib/types';
import { readDestination, saveDestination, TotalsTable } from './CartPage';
import { Breadcrumbs, Notices, PageShell } from './components';
import styles from './shop.module.css';

type Visibility = 'required' | 'optional' | 'hidden';

function AddressFields({ prefix, value, onChange, settings, withContact }: {
  prefix: string;
  value: Address;
  onChange: (next: Address) => void;
  settings: ShopSettings;
  withContact: boolean;
}) {
  const set = (field: keyof Address) => (event: { target: { value: string } }) => onChange({ ...value, [field]: event.target.value });
  const allowedCountries = settings.selling_locations === 'specific'
    ? countries.filter((country) => settings.selling_countries.includes(country.code))
    : settings.selling_locations === 'all_except'
      ? countries.filter((country) => !settings.except_countries.includes(country.code))
      : countries;
  const optionalField = (visibility: Visibility, field: keyof Address, label: string, type = 'text', autoComplete?: string) =>
    visibility === 'hidden' ? null : (
      <label className={styles.field}>
        {label} {visibility === 'required' ? <span className={styles.required}>*</span> : <span className={styles.muted}>(optional)</span>}
        <input className={styles.input} type={type} name={`${prefix}_${field}`} autoComplete={autoComplete}
          required={visibility === 'required'} value={value[field] || ''} onChange={set(field)} />
      </label>
    );

  return (
    <div className={styles.formGrid}>
      <label className={styles.field}>
        First name <span className={styles.required}>*</span>
        <input className={styles.input} name={`${prefix}_first_name`} autoComplete="given-name" required value={value.first_name || ''} onChange={set('first_name')} />
      </label>
      <label className={styles.field}>
        Last name <span className={styles.required}>*</span>
        <input className={styles.input} name={`${prefix}_last_name`} autoComplete="family-name" required value={value.last_name || ''} onChange={set('last_name')} />
      </label>
      <div className={styles.full}>{optionalField(settings.checkout_company, 'company', 'Company name', 'text', 'organization')}</div>
      <label className={`${styles.field} ${styles.full}`}>
        Country / Region <span className={styles.required}>*</span>
        <select className={styles.select} name={`${prefix}_country`} autoComplete="country" required value={value.country || ''} onChange={set('country')}>
          <option value="">Select a country / region…</option>
          {allowedCountries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
        </select>
      </label>
      <label className={`${styles.field} ${styles.full}`}>
        Street address <span className={styles.required}>*</span>
        <input className={styles.input} name={`${prefix}_address_1`} autoComplete="address-line1" placeholder="House number and street name" required value={value.address_1 || ''} onChange={set('address_1')} />
        <input className={styles.input} name={`${prefix}_address_2`} autoComplete="address-line2" placeholder="Apartment, suite, unit, etc. (optional)" value={value.address_2 || ''} onChange={set('address_2')} />
      </label>
      <label className={styles.field}>
        Town / City <span className={styles.required}>*</span>
        <input className={styles.input} name={`${prefix}_city`} autoComplete="address-level2" required value={value.city || ''} onChange={set('city')} />
      </label>
      <label className={styles.field}>
        State / County <span className={styles.muted}>(optional)</span>
        <input className={styles.input} name={`${prefix}_state`} autoComplete="address-level1" value={value.state || ''} onChange={set('state')} />
      </label>
      <label className={styles.field}>
        Postcode / ZIP <span className={styles.muted}>(optional)</span>
        <input className={styles.input} name={`${prefix}_postcode`} autoComplete="postal-code" value={value.postcode || ''} onChange={set('postcode')} />
      </label>
      {withContact && (
        <>
          <div>{optionalField(settings.checkout_phone, 'phone', 'Phone', 'tel', 'tel')}</div>
          <label className={`${styles.field} ${styles.full}`}>
            Email address <span className={styles.required}>*</span>
            <input className={styles.input} type="email" name={`${prefix}_email`} autoComplete="email" required value={value.email || ''} onChange={set('email')} />
          </label>
        </>
      )}
    </div>
  );
}

export default function CheckoutPage() {
  const { settings, ready } = useShopSettings();
  const chrome = usePublicChrome();
  const state = useCart();
  const [billing, setBilling] = useState<Address>(readDestination);
  const [shipping, setShipping] = useState<Address>({});
  const [shipDifferent, setShipDifferent] = useState(false);
  const [note, setNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [terms, setTerms] = useState(false);
  const [calculation, setCalculation] = useState<CartCalculation | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [placing, setPlacing] = useState(false);
  const loadedAccount = useRef(false);
  const gateways = enabledGateways(settings);

  useEffect(() => {
    document.title = 'Checkout';
  }, []);

  // Prefill from the signed-in customer's saved addresses.
  useEffect(() => {
    if (!chrome.ready || !chrome.userId || loadedAccount.current) return;
    loadedAccount.current = true;
    void getSupabaseClient().from('shop_customers').select('billing,shipping').eq('id', chrome.userId).maybeSingle()
      .then(({ data }) => {
        const saved = (data?.billing || {}) as Address;
        setBilling((current) => ({ ...current, ...saved, email: saved.email || current.email || chrome.email }));
        if (data?.shipping) setShipping(data.shipping as Address);
      });
  }, [chrome.ready, chrome.userId, chrome.email]);

  useEffect(() => {
    if (!paymentMethod && gateways.length) setPaymentMethod(gateways[0].id);
  }, [gateways, paymentMethod]);

  // Recalculate when anything that affects totals changes. Debounced so typing an address
  // does not send a request per keystroke.
  const destinationKey = JSON.stringify([billing.country, billing.state, billing.postcode, billing.city, billing.email,
    shipDifferent, shipping.country, shipping.state, shipping.postcode, shipping.city]);
  useEffect(() => {
    if (!state.items.length) return;
    let mounted = true;
    const timer = window.setTimeout(() => {
      calculateCart(cartInput(state, { billing, shipping, ship_to_different: shipDifferent }))
        .then((result) => { if (mounted) setCalculation(result); })
        .catch((calcError: unknown) => { if (mounted) setErrors([explainShopError(calcError)]); });
    }, 350);
    return () => { mounted = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, destinationKey]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setErrors([]);
    setPlacing(true);
    try {
      saveDestination(shipDifferent ? shipping : billing);
      const result = await placeOrder(cartInput(state, {
        billing,
        shipping: shipDifferent ? shipping : undefined,
        ship_to_different: shipDifferent,
        payment_method: paymentMethod,
        customer_note: note,
        terms_accepted: terms,
      }));
      if (!result.ok) {
        setErrors(result.errors);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      cart.clear();
      await notifyOrderEvent(result.order_id, result.order_key, 'placed');
      const received = `/checkout/order-received/${result.order_id}?key=${encodeURIComponent(result.order_key)}`;
      if (result.status === 'pending' && (result.payment_method === 'stripe' || result.payment_method === 'paypal')) {
        try {
          const { url } = await startOnlinePayment(result.payment_method, result.order_id, result.order_key);
          window.location.href = url;
        } catch (paymentError: unknown) {
          // The order exists; send the customer to the pay page to retry rather than losing it.
          const message = paymentError instanceof Error ? paymentError.message : 'The payment could not be started.';
          window.location.href = `/checkout/order-pay/${result.order_id}?key=${encodeURIComponent(result.order_key)}&error=${encodeURIComponent(message)}`;
        }
        return;
      }
      window.location.href = received;
    } catch (placeError: unknown) {
      setErrors([explainShopError(placeError)]);
    } finally {
      setPlacing(false);
    }
  };

  if (!ready || !chrome.ready) return <PageShell><p className={styles.muted}>Loading…</p></PageShell>;

  if (!state.items.length) {
    return (
      <PageShell narrow>
        <h1 className={styles.heading}>Checkout</h1>
        <div className={styles.notice}>Your cart is empty, so there is nothing to check out.</div>
        <a className={styles.button} href="/shop">Return to shop</a>
      </PageShell>
    );
  }

  if (!chrome.userId && !settings.guest_checkout) {
    return (
      <PageShell narrow>
        <h1 className={styles.heading}>Checkout</h1>
        <div className={styles.notice}>You must be logged in to check out.</div>
        <a className={styles.button} href="/login?redirect=%2Fcheckout">Log in</a>{' '}
        <a className={styles.buttonSecondary} href="/register?redirect=%2Fcheckout">Create an account</a>
      </PageShell>
    );
  }

  const total = Number(calculation?.totals.total || 0);

  return (
    <PageShell>
      <Breadcrumbs items={[{ label: 'Cart', href: '/cart' }, { label: 'Checkout' }]} />
      <h1 className={styles.heading}>Checkout</h1>
      {!chrome.userId && settings.login_reminder && (
        <div className={styles.notice}>Returning customer? <a href="/login?redirect=%2Fcheckout">Click here to log in</a></div>
      )}
      <Notices errors={errors} />
      {calculation && errors.length === 0 && <Notices errors={calculation.errors} notices={calculation.notices} />}

      <form onSubmit={submit} className={styles.cartLayout} noValidate={false}>
        <div>
          <fieldset className={styles.fieldset}>
            <legend>Billing details</legend>
            <AddressFields prefix="billing" value={billing} onChange={setBilling} settings={settings} withContact />
          </fieldset>

          {calculation?.needs_shipping && (
            <fieldset className={styles.fieldset}>
              <legend>
                <label className={styles.check} style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                  <input type="checkbox" checked={shipDifferent} onChange={(event) => setShipDifferent(event.target.checked)} />
                  Ship to a different address?
                </label>
              </legend>
              {shipDifferent && <AddressFields prefix="shipping" value={shipping} onChange={setShipping} settings={settings} withContact={false} />}
            </fieldset>
          )}

          <label className={styles.field}>
            Order notes <span className={styles.muted}>(optional)</span>
            <textarea className={styles.textarea} value={note} onChange={(event) => setNote(event.target.value)}
              placeholder="Notes about your order, e.g. special notes for delivery." />
          </label>
        </div>

        <aside className={styles.totals} aria-label="Your order">
          <h2>Your order</h2>
          {calculation ? (
            <>
              {calculation.items.map((item) => (
                <div key={item.key} className={styles.totalRow}>
                  <span>{item.name} <strong>× {item.quantity}</strong></span>
                  <strong>
                    {formatPrice(Number(item.subtotal) + (calculation.prices_include_tax ? Number(item.subtotal_tax) : 0), settings, calculation.currency)}
                  </strong>
                </div>
              ))}
              <TotalsTable calculation={calculation} settings={settings} onShippingChange={(id) => cart.setShippingMethod(id)} />
            </>
          ) : <p className={styles.muted}>Calculating…</p>}

          {total > 0 && (
            gateways.length ? (
              <ul className={styles.radioList}>
                {gateways.map((gateway) => (
                  <li key={gateway.id} className={styles.radioOption}>
                    <label>
                      <span>
                        <input type="radio" name="payment_method" value={gateway.id} checked={paymentMethod === gateway.id}
                          onChange={() => setPaymentMethod(gateway.id)} />{' '}
                        {gateway.title}
                      </span>
                    </label>
                    {paymentMethod === gateway.id && gateway.description && <p>{gateway.description}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.error}>Sorry, no payment methods are available. Please contact us if you need help placing your order.</div>
            )
          )}

          {settings.privacy_text && <p className={styles.muted}>{settings.privacy_text}</p>}
          {settings.terms_page_url && (
            <label className={styles.check}>
              <input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} required />
              <span>I have read and agree to the website <a href={settings.terms_page_url} target="_blank" rel="noopener noreferrer">terms and conditions</a> <span className={styles.required}>*</span></span>
            </label>
          )}

          <button type="submit" className={styles.button}
            disabled={placing || !calculation || calculation.errors.length > 0 || (total > 0 && !gateways.length)}>
            {placing ? 'Placing order…' : 'Place order'}
          </button>
        </aside>
      </form>
    </PageShell>
  );
}
