import { useEffect, useState } from 'react';
import type { RwpRouteProps } from '../../../src/lib/plugin-api';
import {
  cancelOrder, confirmOnlinePayment, consumeDownload, explainShopError, getOrder, startOnlinePayment,
} from '../lib/api';
import { formatPrice } from '../lib/currencies';
import { enabledGateways, useShopSettings, type ShopSettings } from '../lib/settings';
import { orderStatusLabels, type Order } from '../lib/types';
import { Breadcrumbs, FormattedAddress, PageShell } from './components';
import styles from './shop.module.css';

export function StatusBadge({ status }: { status: Order['status'] }) {
  return <span className={`${styles.status} ${styles[`status_${status}`] || ''}`}>{orderStatusLabels[status] || status}</span>;
}

export function OrderSummary({ order, settings }: { order: Order; settings: ShopSettings }) {
  const [downloadError, setDownloadError] = useState('');
  const money = (amount: number) => formatPrice(amount, settings, order.currency);
  const withTax = order.prices_include_tax;
  const paid = ['processing', 'completed'].includes(order.status) && Boolean(order.paid_at);

  const download = async (itemId: number, downloadId: string) => {
    setDownloadError('');
    try {
      const url = await consumeDownload(order.id, order.order_key, itemId, downloadId);
      window.location.href = url;
    } catch (error: unknown) {
      setDownloadError(error instanceof Error ? error.message : 'The download could not be started.');
    }
  };

  return (
    <div>
      {order.payment_method === 'bacs' && order.status === 'on-hold' && (order.bank_accounts?.length || order.payment_instructions) && (
        <section className={styles.section} style={{ marginTop: 0 }}>
          <h2>Our bank details</h2>
          {order.payment_instructions && <p>{order.payment_instructions}</p>}
          {order.bank_accounts?.map((account) => (
            <ul key={`${account.account_number}-${account.iban}`} className={styles.orderDetails}>
              {account.bank_name && <li>Bank <strong>{account.bank_name}</strong></li>}
              {account.account_name && <li>Account name <strong>{account.account_name}</strong></li>}
              {account.account_number && <li>Account number <strong>{account.account_number}</strong></li>}
              {account.sort_code && <li>Sort code <strong>{account.sort_code}</strong></li>}
              {account.iban && <li>IBAN <strong>{account.iban}</strong></li>}
              {account.bic && <li>BIC / Swift <strong>{account.bic}</strong></li>}
              <li>Payment reference <strong>{order.id}</strong></li>
            </ul>
          ))}
        </section>
      )}
      {order.payment_method !== 'bacs' && order.payment_instructions && ['on-hold', 'processing'].includes(order.status) && (
        <div className={styles.notice}>{order.payment_instructions}</div>
      )}

      <h2>Order details</h2>
      {downloadError && <div className={styles.error} role="alert">{downloadError}</div>}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Product</th><th>Total</th></tr></thead>
          <tbody>
            {order.items?.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.slug ? <a href={`/product/${item.slug}`}>{item.name}</a> : item.name} <strong>× {item.quantity}</strong>
                  {item.refunded_quantity > 0 && <div className={styles.muted}>Refunded: {item.refunded_quantity}</div>}
                  {paid && item.meta?.purchase_note && <div className={styles.muted}>{item.meta.purchase_note}</div>}
                  {paid && item.downloads?.map((file) => (
                    <div key={file.id}>
                      <button type="button" className={styles.buttonLink} onClick={() => void download(item.id, file.id)}>⬇ {file.name}</button>
                      {file.downloads_remaining !== null && <span className={styles.muted}> ({file.downloads_remaining} left)</span>}
                      {file.expires_at && <span className={styles.muted}> — expires {new Date(file.expires_at).toLocaleDateString()}</span>}
                    </div>
                  ))}
                </td>
                <td>{money(Number(item.subtotal) + (withTax ? Number(item.subtotal_tax) : 0))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th>Subtotal</th><td>{money(Number(order.subtotal) + (withTax ? Number(order.subtotal_tax) : 0))}</td></tr>
            {Number(order.discount_total) > 0 && (
              <tr><th>Discount{order.coupon_lines.length ? ` (${order.coupon_lines.map((line) => line.code).join(', ')})` : ''}</th>
                <td>-{money(Number(order.discount_total) + (withTax ? Number(order.discount_tax) : 0))}</td></tr>
            )}
            {order.shipping_lines.map((line) => (
              <tr key={line.method_id}><th>Shipping</th><td>{Number(line.total) > 0 ? money(Number(line.total) + (withTax ? Number(line.tax) : 0)) : 'Free'} <span className={styles.muted}>via {line.title}</span></td></tr>
            ))}
            {!withTax && Number(order.total_tax) > 0 && order.tax_lines.map((line) => (
              <tr key={line.rate_id}><th>{line.label}</th><td>{money(Number(line.tax_total) + Number(line.shipping_tax_total))}</td></tr>
            ))}
            {order.payment_method_title && <tr><th>Payment method</th><td>{order.payment_method_title}</td></tr>}
            <tr><th>Total</th><td><strong>{money(Number(order.total))}</strong>
              {withTax && Number(order.total_tax) > 0 && <span className={styles.muted}> (includes {money(Number(order.total_tax))} tax)</span>}</td></tr>
            {Number(order.refunded_total) > 0 && (
              <tr><th>Refunded</th><td>-{money(Number(order.refunded_total))}</td></tr>
            )}
            {order.customer_note && <tr><th>Note</th><td>{order.customer_note}</td></tr>}
          </tfoot>
        </table>
      </div>

      {order.notes && order.notes.length > 0 && (
        <section className={styles.section}>
          <h2>Order updates</h2>
          {order.notes.map((note) => (
            <div key={note.id} className={styles.review}>
              <span className={styles.muted}>{new Date(note.created_at).toLocaleString()}</span>
              <p>{note.note}</p>
            </div>
          ))}
        </section>
      )}

      <div className={styles.addresses}>
        <div><h2>Billing address</h2><FormattedAddress address={order.billing} /></div>
        {order.shipping_lines.length > 0 && <div><h2>Shipping address</h2><FormattedAddress address={order.shipping} /></div>}
      </div>
    </div>
  );
}

const orderKeyFromUrl = () => new URLSearchParams(window.location.search).get('key') || '';

export function OrderReceivedPage({ params }: RwpRouteProps) {
  const { settings, ready } = useShopSettings();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const orderId = Number(params.id);

  useEffect(() => {
    document.title = 'Order received';
    let mounted = true;
    const query = new URLSearchParams(window.location.search);
    const key = orderKeyFromUrl();
    const load = async () => {
      try {
        // Returning from a payment page: confirm with the gateway before showing the order.
        const stripeSession = query.get('stripe_session');
        const paypalToken = query.get('token');
        if (stripeSession) await confirmOnlinePayment('stripe', orderId, key, stripeSession);
        else if (query.get('paypal') && paypalToken) await confirmOnlinePayment('paypal', orderId, key, paypalToken);
      } catch (confirmError: unknown) {
        if (mounted) setError(confirmError instanceof Error ? confirmError.message : 'Your payment could not be confirmed.');
      }
      try {
        const loaded = await getOrder(orderId, key);
        if (mounted) setOrder(loaded);
      } catch (loadError: unknown) {
        if (mounted) setError(explainShopError(loadError));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => { mounted = false; };
  }, [orderId]);

  if (loading || !ready) return <PageShell narrow><p className={styles.muted}>Loading your order…</p></PageShell>;
  if (!order) {
    return (
      <PageShell narrow>
        {error && <div className={styles.error} role="alert">{error}</div>}
        <h1 className={styles.heading}>Order not found</h1>
        <p>We could not find this order. If you have an account, <a href="/my-account/orders">view your orders</a>.</p>
      </PageShell>
    );
  }

  const awaitingPayment = ['pending', 'failed'].includes(order.status);

  return (
    <PageShell narrow>
      <Breadcrumbs items={[{ label: 'Checkout', href: '/checkout' }, { label: 'Order received' }]} />
      {error && <div className={styles.error} role="alert">{error}</div>}
      {awaitingPayment ? (
        <div className={styles.error}>
          This order is still awaiting payment.{' '}
          <a href={`/checkout/order-pay/${order.id}?key=${encodeURIComponent(order.order_key)}`}>Pay for this order</a>
        </div>
      ) : (
        <>
          <h1 className={styles.heading}>Thank you. Your order has been received.</h1>
        </>
      )}
      <ul className={styles.orderDetails}>
        <li>Order number <strong>{order.id}</strong></li>
        <li>Date <strong>{new Date(order.created_at).toLocaleDateString()}</strong></li>
        {order.billing.email && <li>Email <strong>{order.billing.email}</strong></li>}
        <li>Total <strong>{formatPrice(order.total, settings, order.currency)}</strong></li>
        {order.payment_method_title && <li>Payment method <strong>{order.payment_method_title}</strong></li>}
        <li>Status <strong><StatusBadge status={order.status} /></strong></li>
      </ul>
      <OrderSummary order={order} settings={settings} />
    </PageShell>
  );
}

export function OrderPayPage({ params }: RwpRouteProps) {
  const { settings, ready } = useShopSettings();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState(new URLSearchParams(window.location.search).get('error') || '');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const orderId = Number(params.id);
  const key = orderKeyFromUrl();

  useEffect(() => {
    document.title = 'Pay for order';
    getOrder(orderId, key)
      .then(setOrder)
      .catch((loadError: unknown) => setError(explainShopError(loadError)))
      .finally(() => setLoading(false));
  }, [orderId, key]);

  if (loading || !ready) return <PageShell narrow><p className={styles.muted}>Loading…</p></PageShell>;
  if (!order) return <PageShell narrow><div className={styles.error}>{error || 'Order not found.'}</div></PageShell>;

  const online = enabledGateways(settings).filter((gateway) => gateway.id === 'stripe' || gateway.id === 'paypal');
  const payable = ['pending', 'failed'].includes(order.status);

  const pay = async (gateway: 'stripe' | 'paypal') => {
    setBusy(gateway);
    setError('');
    try {
      const { url } = await startOnlinePayment(gateway, order.id, order.order_key);
      window.location.href = url;
    } catch (payError: unknown) {
      setError(payError instanceof Error ? payError.message : 'The payment could not be started.');
      setBusy('');
    }
  };

  const cancel = async () => {
    if (!window.confirm('Cancel this order?')) return;
    setBusy('cancel');
    try {
      const result = await cancelOrder(order.id, order.order_key);
      if (!result.ok) throw new Error(result.error || 'The order could not be cancelled.');
      setOrder(await getOrder(order.id, order.order_key));
    } catch (cancelError: unknown) {
      setError(cancelError instanceof Error ? cancelError.message : 'The order could not be cancelled.');
    } finally {
      setBusy('');
    }
  };

  return (
    <PageShell narrow>
      <h1 className={styles.heading}>Pay for order #{order.id}</h1>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {!payable ? (
        <div className={styles.notice}>
          This order’s status is “{orderStatusLabels[order.status]}” — it cannot be paid for.{' '}
          <a href={`/checkout/order-received/${order.id}?key=${encodeURIComponent(order.order_key)}`}>View order</a>
        </div>
      ) : (
        <div className={styles.addToCart} style={{ margin: '16px 0 28px' }}>
          {/* Only the order's own gateway: shop_mark_order_paid() rejects payment through a different one. */}
          {online.filter((gateway) => gateway.id === order.payment_method).map((gateway) => (
            <button key={gateway.id} type="button" className={styles.button} disabled={Boolean(busy)} onClick={() => void pay(gateway.id as 'stripe' | 'paypal')}>
              {busy === gateway.id ? 'Redirecting…' : `Pay ${formatPrice(order.total, settings, order.currency)} with ${gateway.title}`}
            </button>
          ))}
          {!online.some((gateway) => gateway.id === order.payment_method) && (
            <span className={styles.muted}>The payment method for this order ({order.payment_method_title}) is not available online. Please contact us.</span>
          )}
          <button type="button" className={styles.buttonSecondary} disabled={Boolean(busy)} onClick={() => void cancel()}>Cancel order</button>
        </div>
      )}
      <OrderSummary order={order} settings={settings} />
    </PageShell>
  );
}
