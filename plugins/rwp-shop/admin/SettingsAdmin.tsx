import { useEffect, useState, type ReactNode } from 'react';
import { callShopServer } from '../lib/api';
import { countries } from '../lib/countries';
import { currencies, findCurrency, formatPrice } from '../lib/currencies';
import {
  defaultShopSettings, loadShopSettings, saveShopSettings, type EmailEvent, type GatewaySettings, type ShopSettings,
} from '../lib/settings';
import { Feedback, Field, TagInput, Tabs } from './common';
import { ShippingEditor, TaxRatesEditor } from './ShippingTaxAdmin';
import styles from './admin.module.css';

type Section = 'general' | 'products' | 'tax' | 'shipping' | 'payments' | 'accounts' | 'emails' | 'status';

interface ServerStatus {
  service_key: boolean;
  stripe: boolean;
  stripe_webhook: boolean;
  stripe_mode: string;
  paypal: boolean;
  paypal_mode: string;
  smtp: boolean;
  site_url: string;
  webhook_url: string;
}

const emailLabels: Record<EmailEvent, [string, string]> = {
  new_order: ['New order', 'Sent to the shop when an order is placed.'],
  cancelled_order: ['Cancelled order', 'Sent to the shop when an order is cancelled.'],
  failed_order: ['Failed order', 'Sent to the shop when a payment fails.'],
  customer_on_hold: ['Order on-hold', 'Sent to customers with order details after an order is put on hold.'],
  customer_processing: ['Processing order', 'Sent to customers after payment, with order details.'],
  customer_completed: ['Completed order', 'Sent to customers when their order is marked completed.'],
  customer_refunded: ['Refunded order', 'Sent to customers when their order is refunded.'],
  customer_note: ['Customer note', 'Sent when you add a note to the customer on an order.'],
  low_stock: ['Low / no stock', 'Sent to the shop when stock drops to the low stock threshold.'],
};

function CountryPicker({ value, onChange }: { value: string[]; onChange: (codes: string[]) => void }) {
  return (
    <select className={styles.select} multiple size={8} value={value}
      onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((option) => option.value))}>
      {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
    </select>
  );
}

function GatewayFields({ gateway, onChange, children }: { gateway: GatewaySettings; onChange: (next: GatewaySettings) => void; children?: ReactNode }) {
  return (
    <div className={styles.grid2}>
      <label className={`${styles.check} ${styles.full}`}><input type="checkbox" checked={gateway.enabled} onChange={(event) => onChange({ ...gateway, enabled: event.target.checked })} />Enable this payment method</label>
      <Field label="Title" hint="What the customer sees at checkout."><input className={styles.input} value={gateway.title} onChange={(event) => onChange({ ...gateway, title: event.target.value })} /></Field>
      <Field label="Description"><input className={styles.input} value={gateway.description} onChange={(event) => onChange({ ...gateway, description: event.target.value })} /></Field>
      <Field label="Instructions" full hint="Shown on the order-received page and in order emails.">
        <textarea className={styles.textarea} value={gateway.instructions} onChange={(event) => onChange({ ...gateway, instructions: event.target.value })} />
      </Field>
      {children}
    </div>
  );
}

export default function SettingsAdmin() {
  const [section, setSection] = useState<Section>('general');
  const [settings, setSettings] = useState<ShopSettings>(defaultShopSettings);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [testEmail, setTestEmail] = useState('');

  useEffect(() => {
    loadShopSettings(true)
      .then(setSettings)
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Shop settings could not be loaded.'))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (section !== 'status' && section !== 'payments' && section !== 'emails') return;
    callShopServer<ServerStatus>('status', {})
      .then((result) => { setStatus(result); setStatusError(''); })
      .catch((serverError: unknown) => setStatusError(serverError instanceof Error ? serverError.message : 'The server status could not be read.'));
  }, [section]);

  const set = <K extends keyof ShopSettings>(key: K, value: ShopSettings[K]) => setSettings((current) => ({ ...current, [key]: value }));
  const setGateway = <K extends keyof ShopSettings['gateways']>(key: K, value: ShopSettings['gateways'][K]) =>
    setSettings((current) => ({ ...current, gateways: { ...current.gateways, [key]: value } }));

  const save = async () => {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await saveShopSettings(settings);
      setSuccess('Your settings have been saved.');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setError('');
    setSuccess('');
    try {
      await callShopServer('emails/test', { to: testEmail });
      setSuccess(`A test email was sent to ${testEmail}.`);
    } catch (sendError: unknown) {
      setError(sendError instanceof Error ? sendError.message : 'The test email failed.');
    }
  };

  if (!loaded) return <p className={styles.muted}>Loading settings…</p>;

  const saveBar = (
    <div className={styles.toolbarGroup}>
      <button type="button" className={styles.button} disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</button>
    </div>
  );

  return (
    <div className={styles.wrap}>
      <Tabs<Section>
        variant="pills"
        tabs={[['general', 'General'], ['products', 'Products'], ['tax', 'Tax'], ['shipping', 'Shipping'], ['payments', 'Payments'],
          ['accounts', 'Accounts & Privacy'], ['emails', 'Emails'], ['status', 'Status']]}
        active={section}
        onChange={setSection}
      />
      <Feedback error={error} success={success} />

      {section === 'general' && (
        <>
          <div className={styles.panel}>
            <h2>Store address</h2>
            <p className={styles.muted}>Where your business is located. Used as the default location for tax and shipping.</p>
            <div className={styles.grid2}>
              <Field label="Address line 1"><input className={styles.input} value={settings.store_address} onChange={(event) => set('store_address', event.target.value)} /></Field>
              <Field label="Address line 2"><input className={styles.input} value={settings.store_address_2} onChange={(event) => set('store_address_2', event.target.value)} /></Field>
              <Field label="City"><input className={styles.input} value={settings.store_city} onChange={(event) => set('store_city', event.target.value)} /></Field>
              <Field label="Country / State">
                <select className={styles.select} value={settings.store_country} onChange={(event) => set('store_country', event.target.value)}>
                  <option value="">Select…</option>
                  {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
                </select>
              </Field>
              <Field label="State / County code"><input className={styles.input} value={settings.store_state} onChange={(event) => set('store_state', event.target.value)} /></Field>
              <Field label="Postcode / ZIP"><input className={styles.input} value={settings.store_postcode} onChange={(event) => set('store_postcode', event.target.value)} /></Field>
            </div>
          </div>

          <div className={styles.panel}>
            <h2>General options</h2>
            <div className={styles.grid2}>
              <Field label="Selling location(s)">
                <select className={styles.select} value={settings.selling_locations} onChange={(event) => set('selling_locations', event.target.value as ShopSettings['selling_locations'])}>
                  <option value="all">Sell to all countries</option>
                  <option value="all_except">Sell to all countries, except for…</option>
                  <option value="specific">Sell to specific countries</option>
                </select>
              </Field>
              {settings.selling_locations === 'specific' && <Field label="Sell to specific countries"><CountryPicker value={settings.selling_countries} onChange={(codes) => set('selling_countries', codes)} /></Field>}
              {settings.selling_locations === 'all_except' && <Field label="Sell to all countries, except for…"><CountryPicker value={settings.except_countries} onChange={(codes) => set('except_countries', codes)} /></Field>}
              <Field label="Shipping location(s)">
                <select className={styles.select} value={settings.shipping_locations} onChange={(event) => set('shipping_locations', event.target.value as ShopSettings['shipping_locations'])}>
                  <option value="selling">Ship to all countries you sell to</option>
                  <option value="all">Ship to all countries</option>
                  <option value="specific">Ship to specific countries only</option>
                </select>
              </Field>
              {settings.shipping_locations === 'specific' && <Field label="Ship to specific countries"><CountryPicker value={settings.shipping_countries} onChange={(codes) => set('shipping_countries', codes)} /></Field>}
              <Field label="Default customer location">
                <select className={styles.select} value={settings.default_customer_location} onChange={(event) => set('default_customer_location', event.target.value as ShopSettings['default_customer_location'])}>
                  <option value="base">Shop country/region</option>
                  <option value="none">No location by default</option>
                </select>
              </Field>
              <label className={styles.check}><input type="checkbox" checked={settings.enable_taxes} onChange={(event) => set('enable_taxes', event.target.checked)} />Enable tax rates and calculations</label>
              <label className={styles.check}><input type="checkbox" checked={settings.enable_coupons} onChange={(event) => set('enable_coupons', event.target.checked)} />Enable the use of coupon codes</label>
              <label className={styles.check}><input type="checkbox" checked={settings.calc_discounts_sequentially} onChange={(event) => set('calc_discounts_sequentially', event.target.checked)} />Calculate coupon discounts sequentially</label>
            </div>
          </div>

          <div className={styles.panel}>
            <h2>Currency options</h2>
            <div className={styles.grid3}>
              <Field label="Currency" hint="Changing currency does not convert existing prices.">
                <select className={styles.select} value={settings.currency}
                  onChange={(event) => setSettings((current) => ({ ...current, currency: event.target.value, decimals: findCurrency(event.target.value).decimals }))}>
                  {currencies.map((currency) => <option key={currency.code} value={currency.code}>{currency.name} ({currency.symbol}) — {currency.code}</option>)}
                </select>
              </Field>
              <Field label="Currency position">
                <select className={styles.select} value={settings.currency_position} onChange={(event) => set('currency_position', event.target.value as ShopSettings['currency_position'])}>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="left_space">Left with space</option>
                  <option value="right_space">Right with space</option>
                </select>
              </Field>
              <Field label="Number of decimals"><input className={styles.input} type="number" min={0} max={4} value={settings.decimals} onChange={(event) => set('decimals', Math.min(Math.max(Number(event.target.value) || 0, 0), 4))} /></Field>
              <Field label="Thousand separator"><input className={styles.input} value={settings.thousand_separator} onChange={(event) => set('thousand_separator', event.target.value)} /></Field>
              <Field label="Decimal separator"><input className={styles.input} value={settings.decimal_separator} onChange={(event) => set('decimal_separator', event.target.value)} /></Field>
              <Field label="Preview"><input className={styles.input} value={formatPrice(1234.5678, settings)} disabled /></Field>
            </div>
          </div>
          {saveBar}
        </>
      )}

      {section === 'products' && (
        <>
          <div className={styles.panel}>
            <h2>Shop pages</h2>
            <div className={styles.grid2}>
              <Field label="Shop page title"><input className={styles.input} value={settings.shop_page_title} onChange={(event) => set('shop_page_title', event.target.value)} /></Field>
              <Field label="Products per page"><input className={styles.input} type="number" min={1} max={100} value={settings.products_per_page} onChange={(event) => set('products_per_page', Math.min(Math.max(Number(event.target.value) || 12, 1), 100))} /></Field>
              <Field label="Shop page description" full><textarea className={styles.textarea} value={settings.shop_page_description} onChange={(event) => set('shop_page_description', event.target.value)} /></Field>
              <Field label="Default product sorting">
                <select className={styles.select} value={settings.default_orderby} onChange={(event) => set('default_orderby', event.target.value)}>
                  <option value="menu_order">Default sorting (custom ordering + name)</option>
                  <option value="popularity">Popularity (sales)</option>
                  <option value="rating">Average rating</option>
                  <option value="date">Sort by most recent</option>
                  <option value="price">Sort by price (asc)</option>
                  <option value="price-desc">Sort by price (desc)</option>
                </select>
              </Field>
              <Field label="Placeholder image URL"><input className={styles.input} value={settings.placeholder_image} onChange={(event) => set('placeholder_image', event.target.value)} /></Field>
              <Field label="Price suffix" hint="e.g. “incl. VAT”, shown after prices."><input className={styles.input} value={settings.price_suffix} onChange={(event) => set('price_suffix', event.target.value)} /></Field>
              <label className={styles.check}><input type="checkbox" checked={settings.redirect_to_cart} onChange={(event) => set('redirect_to_cart', event.target.checked)} />Redirect to the cart page after successful addition</label>
              <label className={styles.check}><input type="checkbox" checked={settings.show_cart_in_header} onChange={(event) => set('show_cart_in_header', event.target.checked)} />Show a cart link in the site header</label>
            </div>
          </div>
          <div className={styles.panel}>
            <h2>Measurements</h2>
            <div className={styles.grid2}>
              <Field label="Weight unit">
                <select className={styles.select} value={settings.weight_unit} onChange={(event) => set('weight_unit', event.target.value)}>
                  {['kg', 'g', 'lbs', 'oz'].map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </Field>
              <Field label="Dimensions unit">
                <select className={styles.select} value={settings.dimension_unit} onChange={(event) => set('dimension_unit', event.target.value)}>
                  {['m', 'cm', 'mm', 'in', 'yd'].map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </Field>
            </div>
          </div>
          <div className={styles.panel}>
            <h2>Reviews</h2>
            <div className={styles.grid2}>
              <label className={styles.check}><input type="checkbox" checked={settings.enable_reviews} onChange={(event) => set('enable_reviews', event.target.checked)} />Enable product reviews</label>
              <label className={styles.check}><input type="checkbox" checked={settings.reviews_require_approval} onChange={(event) => set('reviews_require_approval', event.target.checked)} />Reviews must be approved before they appear</label>
              <label className={styles.check}><input type="checkbox" checked={settings.show_verified_label} onChange={(event) => set('show_verified_label', event.target.checked)} />Show “verified owner” label on customer reviews</label>
              <label className={styles.check}><input type="checkbox" checked={settings.verified_owners_only} onChange={(event) => set('verified_owners_only', event.target.checked)} />Reviews can only be left by “verified owners”</label>
              <label className={styles.check}><input type="checkbox" checked={settings.review_rating_required} onChange={(event) => set('review_rating_required', event.target.checked)} />Star ratings should be required, not optional</label>
            </div>
          </div>
          <div className={styles.panel}>
            <h2>Inventory</h2>
            <div className={styles.grid2}>
              <label className={styles.check}><input type="checkbox" checked={settings.manage_stock} onChange={(event) => set('manage_stock', event.target.checked)} />Enable stock management</label>
              <Field label="Hold stock (minutes)" hint="Hold stock for unpaid online orders for this long, then cancel them. 0 disables."><input className={styles.input} type="number" min={0} value={settings.hold_stock_minutes} onChange={(event) => set('hold_stock_minutes', Math.max(Number(event.target.value) || 0, 0))} /></Field>
              <label className={styles.check}><input type="checkbox" checked={settings.notify_low_stock} onChange={(event) => set('notify_low_stock', event.target.checked)} />Enable low stock notifications</label>
              <label className={styles.check}><input type="checkbox" checked={settings.notify_no_stock} onChange={(event) => set('notify_no_stock', event.target.checked)} />Enable out of stock notifications</label>
              <Field label="Notification recipient(s)" hint="Defaults to the admin email under Emails."><input className={styles.input} value={settings.stock_email_recipient} onChange={(event) => set('stock_email_recipient', event.target.value)} /></Field>
              <Field label="Low stock threshold"><input className={styles.input} type="number" min={0} value={settings.low_stock_amount} onChange={(event) => set('low_stock_amount', Math.max(Number(event.target.value) || 0, 0))} /></Field>
              <Field label="Out of stock threshold"><input className={styles.input} type="number" min={0} value={settings.out_of_stock_amount} onChange={(event) => set('out_of_stock_amount', Math.max(Number(event.target.value) || 0, 0))} /></Field>
              <label className={styles.check}><input type="checkbox" checked={settings.hide_out_of_stock} onChange={(event) => set('hide_out_of_stock', event.target.checked)} />Hide out of stock items from the catalog</label>
              <Field label="Stock display format">
                <select className={styles.select} value={settings.stock_format} onChange={(event) => set('stock_format', event.target.value as ShopSettings['stock_format'])}>
                  <option value="always">Always show quantity remaining in stock</option>
                  <option value="low">Only show quantity remaining when low</option>
                  <option value="never">Never show quantity remaining</option>
                </select>
              </Field>
            </div>
          </div>
          {saveBar}
        </>
      )}

      {section === 'tax' && (
        <>
          <div className={styles.panel}>
            <h2>Tax options</h2>
            {!settings.enable_taxes && <div className={styles.warning}>Taxes are disabled. Enable them under General before these options take effect.</div>}
            <div className={styles.grid2}>
              <Field label="Prices entered with tax">
                <select className={styles.select} value={settings.prices_include_tax ? 'yes' : 'no'} onChange={(event) => set('prices_include_tax', event.target.value === 'yes')}>
                  <option value="yes">Yes, I will enter prices inclusive of tax</option>
                  <option value="no">No, I will enter prices exclusive of tax</option>
                </select>
              </Field>
              <Field label="Calculate tax based on">
                <select className={styles.select} value={settings.tax_based_on} onChange={(event) => set('tax_based_on', event.target.value as ShopSettings['tax_based_on'])}>
                  <option value="shipping">Customer shipping address</option>
                  <option value="billing">Customer billing address</option>
                  <option value="base">Shop base address</option>
                </select>
              </Field>
              <Field label="Shipping tax class">
                <select className={styles.select} value={settings.shipping_tax_class} onChange={(event) => set('shipping_tax_class', event.target.value)}>
                  <option value="inherit">Shipping tax class based on cart items</option>
                  {['standard', ...settings.tax_classes].map((taxClass) => <option key={taxClass} value={taxClass}>{taxClass}</option>)}
                </select>
              </Field>
              <Field label="Display tax totals">
                <select className={styles.select} value={settings.tax_total_display} onChange={(event) => set('tax_total_display', event.target.value as ShopSettings['tax_total_display'])}>
                  <option value="itemized">Itemized</option>
                  <option value="single">As a single total</option>
                </select>
              </Field>
              <Field label="Additional tax classes" full hint="Add classes such as “reduced” or “zero”, then define their rates below.">
                <TagInput value={settings.tax_classes} onChange={(classes) => set('tax_classes', classes.map((item) => item.toLowerCase()).filter((item) => item !== 'standard'))} />
              </Field>
            </div>
            {saveBar}
          </div>
          <TaxRatesEditor settings={settings} />
        </>
      )}

      {section === 'shipping' && (
        <>
          <div className={styles.panel}>
            <h2>Shipping options</h2>
            <label className={styles.check}><input type="checkbox" checked={settings.enable_shipping} onChange={(event) => set('enable_shipping', event.target.checked)} />Enable shipping and the shipping calculator</label>
            {saveBar}
          </div>
          <ShippingEditor />
        </>
      )}

      {section === 'payments' && (
        <>
          {statusError && <div className={styles.warning}>{statusError}</div>}
          <div className={styles.panel}>
            <h2>Stripe (cards, Apple Pay, Google Pay)</h2>
            {status && !status.stripe && <div className={styles.warning}>STRIPE_SECRET_KEY is not set on the server, so Stripe payments will fail. Add it to .env.local (or your host's environment variables) and restart.</div>}
            {status && status.stripe && !status.service_key && <div className={styles.warning}>SUPABASE_SECRET_KEY is not set on the server, so paid orders cannot be marked as paid.</div>}
            {status?.stripe && <p className={styles.muted}>Mode: {status.stripe_mode}. Webhook endpoint (add in Stripe → Developers → Webhooks, event <code>checkout.session.completed</code>): <code>{status.webhook_url}</code>{!status.stripe_webhook && ' — STRIPE_WEBHOOK_SECRET is not set, so the webhook is disabled; payments are still confirmed when the customer returns to the site.'}</p>}
            <GatewayFields gateway={settings.gateways.stripe} onChange={(next) => setGateway('stripe', next)} />
          </div>
          <div className={styles.panel}>
            <h2>PayPal</h2>
            {status && !status.paypal && <div className={styles.warning}>PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not set on the server, so PayPal payments will fail.</div>}
            {status?.paypal && <p className={styles.muted}>Mode: {status.paypal_mode} (set PAYPAL_MODE=live on the server for real payments).</p>}
            <GatewayFields gateway={settings.gateways.paypal} onChange={(next) => setGateway('paypal', { ...settings.gateways.paypal, ...next })} />
          </div>
          <div className={styles.panel}>
            <h2>Direct bank transfer</h2>
            <GatewayFields gateway={settings.gateways.bacs} onChange={(next) => setGateway('bacs', { ...settings.gateways.bacs, ...next })}>
              <div className={styles.full}>
                <h3>Account details</h3>
                {settings.gateways.bacs.accounts.map((account, index) => (
                  <div key={index} className={styles.grid3} style={{ marginTop: 8 }}>
                    {(['account_name', 'account_number', 'bank_name', 'sort_code', 'iban', 'bic'] as const).map((key) => (
                      <Field key={key} label={{ account_name: 'Account name', account_number: 'Account number', bank_name: 'Bank name', sort_code: 'Sort code', iban: 'IBAN', bic: 'BIC / Swift' }[key]}>
                        <input className={styles.input} value={account[key]} onChange={(event) => setGateway('bacs', {
                          ...settings.gateways.bacs,
                          accounts: settings.gateways.bacs.accounts.map((item, i) => (i === index ? { ...item, [key]: event.target.value } : item)),
                        })} />
                      </Field>
                    ))}
                    <div><button type="button" className={styles.buttonDanger} onClick={() => setGateway('bacs', { ...settings.gateways.bacs, accounts: settings.gateways.bacs.accounts.filter((_, i) => i !== index) })}>Remove account</button></div>
                  </div>
                ))}
                <button type="button" className={styles.buttonSecondary} style={{ marginTop: 8 }} onClick={() => setGateway('bacs', {
                  ...settings.gateways.bacs,
                  accounts: [...settings.gateways.bacs.accounts, { account_name: '', account_number: '', bank_name: '', sort_code: '', iban: '', bic: '' }],
                })}>Add account</button>
              </div>
            </GatewayFields>
          </div>
          <div className={styles.panel}>
            <h2>Check payments</h2>
            <GatewayFields gateway={settings.gateways.cheque} onChange={(next) => setGateway('cheque', next)} />
          </div>
          <div className={styles.panel}>
            <h2>Cash on delivery</h2>
            <GatewayFields gateway={settings.gateways.cod} onChange={(next) => setGateway('cod', next)} />
          </div>
          <div className={styles.panel}>
            <h2>Checkout order</h2>
            <p className={styles.muted}>The order payment methods appear in at checkout.</p>
            {settings.gateway_order.map((id, index) => (
              <div key={id} className={styles.toolbarGroup}>
                <span style={{ width: 160 }}>{settings.gateways[id as keyof ShopSettings['gateways']]?.title || id}</span>
                <button type="button" className={styles.buttonSecondary} disabled={index === 0} onClick={() => {
                  const next = [...settings.gateway_order];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  set('gateway_order', next);
                }}>↑</button>
                <button type="button" className={styles.buttonSecondary} disabled={index === settings.gateway_order.length - 1} onClick={() => {
                  const next = [...settings.gateway_order];
                  [next[index + 1], next[index]] = [next[index], next[index + 1]];
                  set('gateway_order', next);
                }}>↓</button>
              </div>
            ))}
          </div>
          {saveBar}
        </>
      )}

      {section === 'accounts' && (
        <>
          <div className={styles.panel}>
            <h2>Guest checkout &amp; accounts</h2>
            <div className={styles.grid2}>
              <label className={styles.check}><input type="checkbox" checked={settings.guest_checkout} onChange={(event) => set('guest_checkout', event.target.checked)} />Allow customers to place orders without an account</label>
              <label className={styles.check}><input type="checkbox" checked={settings.login_reminder} onChange={(event) => set('login_reminder', event.target.checked)} />Allow customers to log into an existing account during checkout</label>
              <p className={`${styles.muted} ${styles.full}`}>Customer registration uses the site's own sign-up page. New accounts get the role set under Settings → Accounts.</p>
            </div>
          </div>
          <div className={styles.panel}>
            <h2>Checkout fields</h2>
            <div className={styles.grid2}>
              <Field label="Company name field">
                <select className={styles.select} value={settings.checkout_company} onChange={(event) => set('checkout_company', event.target.value as ShopSettings['checkout_company'])}>
                  <option value="hidden">Hidden</option><option value="optional">Optional</option><option value="required">Required</option>
                </select>
              </Field>
              <Field label="Phone field">
                <select className={styles.select} value={settings.checkout_phone} onChange={(event) => set('checkout_phone', event.target.value as ShopSettings['checkout_phone'])}>
                  <option value="hidden">Hidden</option><option value="optional">Optional</option><option value="required">Required</option>
                </select>
              </Field>
            </div>
          </div>
          <div className={styles.panel}>
            <h2>Privacy &amp; terms</h2>
            <div className={styles.grid2}>
              <Field label="Terms and conditions page URL" hint="When set, customers must accept the terms to place an order."><input className={styles.input} value={settings.terms_page_url} placeholder="/terms" onChange={(event) => set('terms_page_url', event.target.value)} /></Field>
              <Field label="Checkout privacy policy text"><textarea className={styles.textarea} value={settings.privacy_text} onChange={(event) => set('privacy_text', event.target.value)} /></Field>
            </div>
          </div>
          {saveBar}
        </>
      )}

      {section === 'emails' && (
        <>
          {status && !status.smtp && <div className={styles.warning}>SMTP is not configured on the server (SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM), so no emails are sent. Orders still work.</div>}
          {status && status.smtp && !status.service_key && <div className={styles.warning}>SUPABASE_SECRET_KEY is not set, so emails for orders placed by guests are not sent. Emails triggered from this admin still work.</div>}
          <div className={styles.panel}>
            <h2>Email notifications</h2>
            <table className={styles.table}>
              <tbody>
                {(Object.keys(emailLabels) as EmailEvent[]).map((event) => (
                  <tr key={event}>
                    <td style={{ width: 40 }}><input type="checkbox" aria-label={`Enable ${emailLabels[event][0]}`} checked={settings.emails.enabled[event]}
                      onChange={(changeEvent) => set('emails', { ...settings.emails, enabled: { ...settings.emails.enabled, [event]: changeEvent.target.checked } })} /></td>
                    <td><strong>{emailLabels[event][0]}</strong><div className={styles.muted}>{emailLabels[event][1]}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.panel}>
            <h2>Email sender options</h2>
            <div className={styles.grid2}>
              <Field label="“From” name"><input className={styles.input} value={settings.emails.from_name} onChange={(event) => set('emails', { ...settings.emails, from_name: event.target.value })} /></Field>
              <Field label="Shop notification recipient(s)" hint="Comma-separated. Defaults to the site's admin email."><input className={styles.input} value={settings.emails.admin_recipient} onChange={(event) => set('emails', { ...settings.emails, admin_recipient: event.target.value })} /></Field>
              <Field label="Base colour"><input className={styles.input} type="color" value={settings.emails.base_color} onChange={(event) => set('emails', { ...settings.emails, base_color: event.target.value })} /></Field>
              <Field label="Footer text"><input className={styles.input} value={settings.emails.footer_text} onChange={(event) => set('emails', { ...settings.emails, footer_text: event.target.value })} /></Field>
            </div>
            <p className={styles.muted}>The “From” address itself is SMTP_FROM on the server, because most mail providers only accept a verified sender.</p>
          </div>
          {saveBar}
          <div className={styles.panel}>
            <h2>Send a test email</h2>
            <div className={styles.toolbarGroup}>
              <input className={styles.input} style={{ width: 280 }} type="email" placeholder="you@example.com" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} />
              <button type="button" className={styles.buttonSecondary} disabled={!testEmail} onClick={() => void sendTest()}>Send test</button>
            </div>
          </div>
        </>
      )}

      {section === 'status' && (
        <div className={styles.panel}>
          <h2>Server configuration</h2>
          <p className={styles.muted}>These are environment variables on the server (.env.local for npm start, or your host's settings). Values are never shown here, only whether they are set.</p>
          {statusError && <div className={styles.error}>{statusError}</div>}
          {status && (
            <table className={styles.table}>
              <tbody>
                <tr><td>SUPABASE_SECRET_KEY</td><td>{status.service_key ? '✅ Set' : '❌ Missing — required to mark online payments as paid and to email guests'}</td></tr>
                <tr><td>STRIPE_SECRET_KEY</td><td>{status.stripe ? `✅ Set (${status.stripe_mode})` : '— Not set (Stripe disabled)'}</td></tr>
                <tr><td>STRIPE_WEBHOOK_SECRET</td><td>{status.stripe_webhook ? '✅ Set' : '— Not set (optional; payments are confirmed on return)'}</td></tr>
                <tr><td>PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET</td><td>{status.paypal ? `✅ Set (${status.paypal_mode})` : '— Not set (PayPal disabled)'}</td></tr>
                <tr><td>SMTP_HOST / SMTP_USER / SMTP_PASS / SMTP_FROM</td><td>{status.smtp ? '✅ Set' : '— Not set (emails disabled)'}</td></tr>
                <tr><td>Site URL used in payment redirects and emails</td><td><code>{status.site_url}</code> (override with SITE_URL)</td></tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
