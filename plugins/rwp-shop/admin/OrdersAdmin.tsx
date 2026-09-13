import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';
import { callShopServer, explainShopError, getOrder, notifyOrderEvent, placeOrder } from '../lib/api';
import { countries } from '../lib/countries';
import { formatPrice } from '../lib/currencies';
import { useShopSettings, type ShopSettings } from '../lib/settings';
import { orderStatusLabels, type Address, type Order, type OrderStatus } from '../lib/types';
import { Feedback, Field, OrderStatusBadge } from './common';
import styles from './admin.module.css';

const statuses = Object.keys(orderStatusLabels) as OrderStatus[];

function OrderList({ onOpen, onCreate }: { onOpen: (id: number) => void; onCreate: () => void }) {
  const { settings } = useShopSettings();
  const [orders, setOrders] = useState<Order[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<'' | OrderStatus>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const perPage = 25;

  const load = useCallback(async () => {
    const supabase = getSupabaseClient();
    let query = supabase.from('shop_orders').select('*', { count: 'exact' }).order('created_at', { ascending: false })
      .range(page * perPage, (page + 1) * perPage - 1);
    if (status) query = query.eq('status', status);
    const term = search.trim().replace(/[,()]/g, ' ');
    if (term) {
      query = /^\d+$/.test(term)
        ? query.eq('id', Number(term))
        : query.or(`billing->>email.ilike.%${term}%,billing->>first_name.ilike.%${term}%,billing->>last_name.ilike.%${term}%`);
    }
    const [{ data, error: loadError, count }, statusRows] = await Promise.all([
      query,
      supabase.from('shop_orders').select('status'),
    ]);
    if (loadError) return setError(explainShopError(loadError));
    setOrders((data || []) as Order[]);
    setTotal(count || 0);
    setCounts((statusRows.data || []).reduce<Record<string, number>>((result, row) => {
      result[row.status] = (result[row.status] || 0) + 1;
      return result;
    }, {}));
  }, [page, search, status]);

  useEffect(() => { void load(); }, [load]);

  const bulkUpdate = async (next: OrderStatus) => {
    if (!selected.length) return;
    setError('');
    const supabase = getSupabaseClient();
    const { data, error: updateError } = await supabase.from('shop_orders').update({ status: next }).in('id', selected).select('id,order_key');
    if (updateError) return setError(explainShopError(updateError));
    if (!data?.length) return setError('No orders were changed: the database refused the update. Your role needs the manage_shop capability.');
    await Promise.all(data.map((row) => notifyOrderEvent(row.id, row.order_key, `status:${next}`)));
    setSuccess(`${data.length} order${data.length === 1 ? '' : 's'} marked ${orderStatusLabels[next].toLowerCase()}.`);
    setSelected([]);
    void load();
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.subTabs}>
          <button type="button" className={status === '' ? styles.subTabActive : styles.subTab} onClick={() => { setStatus(''); setPage(0); }}>
            All ({Object.values(counts).reduce((sum, value) => sum + value, 0)})
          </button>
          {statuses.filter((item) => counts[item]).map((item) => (
            <button key={item} type="button" className={status === item ? styles.subTabActive : styles.subTab} onClick={() => { setStatus(item); setPage(0); }}>
              {orderStatusLabels[item]} ({counts[item]})
            </button>
          ))}
        </div>
        <button type="button" className={styles.button} onClick={onCreate}>Add order</button>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup}>
          <select className={styles.select} style={{ width: 200 }} value="" disabled={!selected.length} aria-label="Bulk actions"
            onChange={(event) => { if (event.target.value) void bulkUpdate(event.target.value as OrderStatus); }}>
            <option value="">Bulk actions ({selected.length})</option>
            <option value="processing">Change status to processing</option>
            <option value="on-hold">Change status to on-hold</option>
            <option value="completed">Change status to completed</option>
            <option value="cancelled">Change status to cancelled</option>
          </select>
        </div>
        <input className={styles.input} style={{ width: 260 }} type="search" placeholder="Search order #, name or email" value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
      </div>
      <Feedback error={error} success={success} />
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Select all" checked={orders.length > 0 && selected.length === orders.length}
                onChange={(event) => setSelected(event.target.checked ? orders.map((order) => order.id) : [])} /></th>
              <th>Order</th><th>Date</th><th>Status</th><th>Ship to</th><th>Total</th><th>Payment</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && <tr><td colSpan={7} className={styles.muted}>No orders found.</td></tr>}
            {orders.map((order) => (
              <tr key={order.id}>
                <td><input type="checkbox" aria-label={`Select order ${order.id}`} checked={selected.includes(order.id)}
                  onChange={(event) => setSelected(event.target.checked ? [...selected, order.id] : selected.filter((id) => id !== order.id))} /></td>
                <td>
                  <button type="button" className={styles.buttonLink} onClick={() => onOpen(order.id)}>
                    #{order.id} {[order.billing.first_name, order.billing.last_name].filter(Boolean).join(' ')}
                  </button>
                  <div className={styles.muted}>{order.billing.email}</div>
                </td>
                <td>{new Date(order.created_at).toLocaleString()}</td>
                <td><OrderStatusBadge status={order.status} /></td>
                <td>{order.shipping_lines.length ? [order.shipping.city, order.shipping.country].filter(Boolean).join(', ') : '—'}</td>
                <td>
                  {formatPrice(order.total, settings, order.currency)}
                  {Number(order.refunded_total) > 0 && <div className={styles.muted}>Refunded {formatPrice(order.refunded_total, settings, order.currency)}</div>}
                </td>
                <td>{order.payment_method_title}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > perPage && (
        <div className={styles.toolbarGroup}>
          <button type="button" className={styles.buttonSecondary} disabled={page === 0} onClick={() => setPage(page - 1)}>← Newer</button>
          <span className={styles.muted}>Page {page + 1} of {Math.ceil(total / perPage)}</span>
          <button type="button" className={styles.buttonSecondary} disabled={(page + 1) * perPage >= total} onClick={() => setPage(page + 1)}>Older →</button>
        </div>
      )}
    </div>
  );
}

function AddressEditor({ value, onChange, withContact }: { value: Address; onChange: (next: Address) => void; withContact: boolean }) {
  const field = (key: keyof Address, label: string) => (
    <Field label={label}><input className={styles.input} value={value[key] || ''} onChange={(event) => onChange({ ...value, [key]: event.target.value })} /></Field>
  );
  return (
    <div className={styles.grid2}>
      {field('first_name', 'First name')}
      {field('last_name', 'Last name')}
      {field('company', 'Company')}
      <Field label="Country">
        <select className={styles.select} value={value.country || ''} onChange={(event) => onChange({ ...value, country: event.target.value })}>
          <option value="">Select…</option>
          {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
        </select>
      </Field>
      {field('address_1', 'Address line 1')}
      {field('address_2', 'Address line 2')}
      {field('city', 'City')}
      {field('state', 'State / County')}
      {field('postcode', 'Postcode / ZIP')}
      {withContact && field('phone', 'Phone')}
      {withContact && field('email', 'Email address')}
    </div>
  );
}

function RefundPanel({ order, settings, onDone }: { order: Order; settings: ShopSettings; onDone: () => void }) {
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [restock, setRestock] = useState(true);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refundable = Number(order.total) - Number(order.refunded_total);
  const canUseGateway = ['stripe', 'paypal'].includes(order.payment_method) && Boolean(order.transaction_id);

  // Suggest an amount from the selected quantities, including their share of tax.
  useEffect(() => {
    const suggested = (order.items || []).reduce((sum, item) => {
      const qty = quantities[item.id] || 0;
      return sum + (qty ? ((Number(item.total) + Number(item.total_tax)) / item.quantity) * qty : 0);
    }, 0);
    if (suggested > 0) setAmount(suggested.toFixed(settings.decimals));
  }, [quantities, order.items, settings.decimals]);

  const refund = async (viaGateway: boolean) => {
    setError('');
    const value = Number(amount);
    if (!(value > 0) || value > refundable + 0.00001) {
      return setError(`Enter an amount greater than zero and no more than ${formatPrice(refundable, settings, order.currency)}.`);
    }
    if (!window.confirm(`Refund ${formatPrice(value, settings, order.currency)}${viaGateway ? ` through ${order.payment_method_title}` : ' manually'}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const items = Object.entries(quantities).filter(([, qty]) => qty > 0).map(([itemId, qty]) => ({ item_id: Number(itemId), quantity: qty, restock }));
      if (viaGateway) {
        // The server refunds at the gateway first and records the refund only if that succeeds.
        await callShopServer('refunds/create', { order_id: order.id, amount: value, reason, items });
      } else {
        const { error: refundError } = await getSupabaseClient().rpc('shop_create_refund', {
          p_order_id: order.id, p_amount: value, p_reason: reason, p_items: items, p_refunded_payment: false, p_gateway_refund_id: null,
        });
        if (refundError) throw new Error(explainShopError(refundError));
        await notifyOrderEvent(order.id, order.order_key, 'refunded', { amount: value });
      }
      onDone();
    } catch (refundError: unknown) {
      setError(refundError instanceof Error ? refundError.message : 'The refund failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.boxed}>
      <h3>Refund</h3>
      <Feedback error={error} />
      <table className={styles.table}>
        <thead><tr><th>Item</th><th>Qty to refund</th></tr></thead>
        <tbody>
          {(order.items || []).map((item) => (
            <tr key={item.id}>
              <td>{item.name} <span className={styles.muted}>× {item.quantity}{item.refunded_quantity ? ` (${item.refunded_quantity} refunded)` : ''}</span></td>
              <td><input className={styles.input} style={{ width: 80 }} type="number" min={0} max={item.quantity - item.refunded_quantity}
                value={quantities[item.id] || 0} onChange={(event) => setQuantities({ ...quantities, [item.id]: Math.min(Math.max(Number(event.target.value) || 0, 0), item.quantity - item.refunded_quantity) })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className={styles.check}><input type="checkbox" checked={restock} onChange={(event) => setRestock(event.target.checked)} />Restock refunded items</label>
      <div className={styles.grid2}>
        <Field label={`Refund amount (max ${formatPrice(refundable, settings, order.currency)})`}>
          <input className={styles.input} type="number" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>
        <Field label="Reason for refund (optional)"><input className={styles.input} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
      </div>
      <div className={styles.toolbarGroup}>
        {canUseGateway && (
          <button type="button" className={styles.button} disabled={busy} onClick={() => void refund(true)}>
            Refund {amount ? formatPrice(Number(amount), settings, order.currency) : ''} via {order.payment_method_title}
          </button>
        )}
        <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => void refund(false)}>
          Refund {amount ? formatPrice(Number(amount), settings, order.currency) : ''} manually
        </button>
      </div>
      <p className={styles.muted}>A manual refund only records the refund in the shop. Send the money back yourself.</p>
    </div>
  );
}

function OrderEditor({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const { settings } = useShopSettings();
  const [order, setOrder] = useState<Order | null>(null);
  const [status, setStatus] = useState<OrderStatus>('pending');
  const [billing, setBilling] = useState<Address>({});
  const [shipping, setShipping] = useState<Address>({});
  const [note, setNote] = useState('');
  const [noteForCustomer, setNoteForCustomer] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const loaded = await getOrder(orderId, '');
      if (!loaded) throw new Error(`Order #${orderId} was not found, or your role cannot read it.`);
      setOrder(loaded);
      setStatus(loaded.status);
      setBilling(loaded.billing);
      setShipping(loaded.shipping);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'The order could not be loaded.');
    }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  if (!order) return error ? <Feedback error={error} /> : <p className={styles.muted}>Loading order…</p>;

  const money = (amount: number) => formatPrice(amount, settings, order.currency);

  const save = async () => {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const { data, error: saveError } = await getSupabaseClient().from('shop_orders')
        .update({ status, billing, shipping }).eq('id', order.id).select('id');
      if (saveError) throw new Error(explainShopError(saveError));
      if (!data?.length) throw new Error('The order was not updated: the database refused the write. Your role needs the manage_shop capability.');
      let emailNote = '';
      if (status !== order.status) {
        const result = await notifyOrderEvent(order.id, order.order_key, `status:${status}`);
        emailNote = result.sent.length ? ` Emails sent: ${result.sent.join(', ')}.` : result.skipped ? ` No email sent: ${result.skipped}` : '';
      }
      setSuccess(`Order updated.${emailNote}`);
      await load();
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'The order could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setError('');
    const supabase = getSupabaseClient();
    const { data: userData } = await supabase.auth.getUser();
    const { error: noteError } = await supabase.from('shop_order_notes').insert({
      order_id: order.id, note: note.trim(), is_customer_note: noteForCustomer,
      author_name: userData.user?.email || 'Shop manager', created_by: userData.user?.id,
    });
    if (noteError) return setError(explainShopError(noteError));
    if (noteForCustomer) {
      const result = await notifyOrderEvent(order.id, order.order_key, 'customer_note', { note: note.trim() });
      setSuccess(result.sent.length ? 'Note added and emailed to the customer.' : `Note added. ${result.skipped ? `Not emailed: ${result.skipped}` : ''}`);
    }
    setNote('');
    void load();
  };

  const resend = async (event: string) => {
    const result = await notifyOrderEvent(order.id, order.order_key, event, { force: true });
    if (result.sent.length) setSuccess(`Sent: ${result.sent.join(', ')}.`);
    else setError(result.skipped || 'Nothing was sent.');
  };

  const deleteOrder = async () => {
    if (!window.confirm(`Delete order #${order.id} permanently? Stock is not restored; cancel the order first if you need that.`)) return;
    const { data, error: deleteError } = await getSupabaseClient().from('shop_orders').delete().eq('id', order.id).select('id');
    if (deleteError) return setError(explainShopError(deleteError));
    if (!data?.length) return setError('The order was not deleted: the database refused the delete.');
    onClose();
  };

  const withTax = order.prices_include_tax;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.buttonLink} onClick={onClose}>← All orders</button>
        <div className={styles.toolbarGroup}>
          <a className={styles.buttonSecondary} href={`/checkout/order-received/${order.id}?key=${encodeURIComponent(order.order_key)}`} target="_blank" rel="noreferrer">Customer view</a>
          <button type="button" className={styles.buttonDanger} onClick={() => void deleteOrder()}>Delete</button>
        </div>
      </div>
      <Feedback error={error} success={success} />

      <div className={styles.editorLayout}>
        <div className={styles.wrap}>
          <div className={styles.panel}>
            <h2>Order #{order.id} details</h2>
            <p className={styles.muted}>
              {order.payment_method_title ? `Payment via ${order.payment_method_title}` : 'No payment method'}
              {order.transaction_id ? ` (${order.transaction_id})` : ''}.
              {order.paid_at ? ` Paid on ${new Date(order.paid_at).toLocaleString()}.` : ' Not paid.'}
              {order.created_via === 'admin' ? ' Created manually.' : ''}
            </p>
            <div className={styles.grid3}>
              <Field label="Date created"><input className={styles.input} value={new Date(order.created_at).toLocaleString()} disabled /></Field>
              <Field label="Status">
                <select className={styles.select} value={status} onChange={(event) => setStatus(event.target.value as OrderStatus)}>
                  {statuses.map((item) => <option key={item} value={item}>{orderStatusLabels[item]}</option>)}
                </select>
              </Field>
              <Field label="Customer"><input className={styles.input} value={order.customer_id ? `Registered (${order.billing.email})` : `Guest (${order.billing.email})`} disabled /></Field>
            </div>
            <div className={styles.grid2}>
              <div className={styles.boxed}><h3>Billing</h3><AddressEditor value={billing} onChange={setBilling} withContact /></div>
              <div className={styles.boxed}><h3>Shipping</h3><AddressEditor value={shipping} onChange={setShipping} withContact={false} /></div>
            </div>
            {order.customer_note && <div className={styles.notice}><strong>Customer provided note:</strong> {order.customer_note}</div>}
            <div><button type="button" className={styles.button} disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Update order'}</button></div>
          </div>

          <div className={styles.panel}>
            <h2>Items</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Item</th><th>Cost</th><th>Qty</th><th>Total</th>{order.total_tax > 0 && <th>Tax</th>}</tr></thead>
                <tbody>
                  {(order.items || []).map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                        {item.sku && <div className={styles.muted}>SKU: {item.sku}</div>}
                        {item.refunded_quantity > 0 && <div className={styles.muted} style={{ color: '#b91c1c' }}>Refunded ×{item.refunded_quantity}</div>}
                      </td>
                      <td>{money(item.price)}</td>
                      <td>× {item.quantity}</td>
                      <td>
                        {money(item.total)}
                        {Number(item.subtotal) !== Number(item.total) && <div className={styles.muted}>{money(Number(item.subtotal) - Number(item.total))} discount</div>}
                      </td>
                      {order.total_tax > 0 && <td>{money(item.total_tax)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <table className={styles.table} style={{ maxWidth: 380, marginLeft: 'auto' }}>
              <tbody>
                <tr><th>Items subtotal</th><td>{money(Number(order.subtotal) + (withTax ? Number(order.subtotal_tax) : 0))}</td></tr>
                {order.coupon_lines.length > 0 && <tr><th>Coupons ({order.coupon_lines.map((line) => line.code).join(', ')})</th><td>-{money(Number(order.discount_total) + (withTax ? Number(order.discount_tax) : 0))}</td></tr>}
                {order.shipping_lines.map((line) => <tr key={line.method_id}><th>Shipping ({line.title})</th><td>{money(line.total)}</td></tr>)}
                {order.tax_lines.map((line) => <tr key={line.rate_id}><th>{line.label}</th><td>{money(Number(line.tax_total) + Number(line.shipping_tax_total))}</td></tr>)}
                <tr><th>Order total</th><td><strong>{money(order.total)}</strong></td></tr>
                {(order.refunds || []).map((refund) => (
                  <tr key={refund.id}><th style={{ color: '#b91c1c' }}>Refund #{refund.id}{refund.reason ? ` — ${refund.reason}` : ''}{refund.refunded_payment ? ' (via gateway)' : ''}</th><td style={{ color: '#b91c1c' }}>-{money(refund.amount)}</td></tr>
                ))}
                {Number(order.refunded_total) > 0 && <tr><th>Net payment</th><td>{money(Number(order.total) - Number(order.refunded_total))}</td></tr>}
              </tbody>
            </table>
            {Number(order.total) - Number(order.refunded_total) > 0 && !['pending', 'cancelled', 'failed'].includes(order.status) && (
              showRefund
                ? <RefundPanel order={order} settings={settings} onDone={() => { setShowRefund(false); setSuccess('Refund recorded.'); void load(); }} />
                : <div><button type="button" className={styles.buttonSecondary} onClick={() => setShowRefund(true)}>Refund</button></div>
            )}
          </div>
        </div>

        <aside className={styles.side}>
          <div className={styles.panel}>
            <h3>Order actions</h3>
            <select className={styles.select} value="" onChange={(event) => { if (event.target.value) void resend(event.target.value); }}>
              <option value="">Choose an action…</option>
              <option value="resend:new_order">Resend new order notification</option>
              <option value="resend:customer">Email order details to customer</option>
            </select>
          </div>
          <div className={styles.panel}>
            <h3>Order notes</h3>
            <div style={{ display: 'grid', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
              {(order.notes || []).map((item) => (
                <div key={item.id} className={`${styles.note} ${item.is_customer_note ? styles.noteCustomer : ''}`}>
                  <span>{item.note}</span>
                  <span className={styles.muted}>{new Date(item.created_at).toLocaleString()} by {item.author_name}{item.is_customer_note ? ' · to customer' : ''}</span>
                </div>
              ))}
            </div>
            <textarea className={styles.textarea} placeholder="Add note" value={note} onChange={(event) => setNote(event.target.value)} />
            <div className={styles.toolbarGroup}>
              <select className={styles.select} style={{ width: 'auto' }} value={noteForCustomer ? 'customer' : 'private'} onChange={(event) => setNoteForCustomer(event.target.value === 'customer')}>
                <option value="private">Private note</option>
                <option value="customer">Note to customer</option>
              </select>
              <button type="button" className={styles.buttonSecondary} onClick={() => void addNote()}>Add</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function NewOrder({ onCreated, onCancel }: { onCreated: (id: number) => void; onCancel: () => void }) {
  const [products, setProducts] = useState<Array<{ id: string; name: string; type: string; shop_variations: Array<{ id: string; attributes: Record<string, string> }> }>>([]);
  const [lines, setLines] = useState<Array<{ product_id: string; variation_id: string | null; quantity: number }>>([]);
  const [billing, setBilling] = useState<Address>({});
  const [status, setStatus] = useState<OrderStatus>('pending');
  const [coupon, setCoupon] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customers, setCustomers] = useState<Array<{ id: string; email: string | null }>>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    void supabase.from('shop_products').select('id,name,type,shop_variations(id,attributes)').in('type', ['simple', 'variable']).order('name')
      .then(({ data }) => setProducts((data || []) as typeof products));
    void supabase.from('profiles').select('id,email').order('email').then(({ data }) => setCustomers(data || []));
  }, []);

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  const create = async () => {
    setErrors([]);
    setBusy(true);
    try {
      const result = await placeOrder({
        admin: true,
        status,
        customer_id: customerId || null,
        items: lines.filter((line) => line.product_id),
        coupons: coupon ? [coupon] : [],
        billing,
        payment_method: 'manual',
      });
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      onCreated(result.order_id);
    } catch (createError: unknown) {
      setErrors([createError instanceof Error ? createError.message : 'The order could not be created.']);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.buttonLink} onClick={onCancel}>← All orders</button>
      {errors.length > 0 && <div className={styles.error}>{errors.map((item) => <div key={item}>{item}</div>)}</div>}
      <div className={styles.panel}>
        <h2>Add new order</h2>
        <p className={styles.muted}>Prices, tax and shipping are calculated by the shop exactly as at checkout. The order is created with the payment method “manual”.</p>
        <div className={styles.grid3}>
          <Field label="Status">
            <select className={styles.select} value={status} onChange={(event) => setStatus(event.target.value as OrderStatus)}>
              {statuses.map((item) => <option key={item} value={item}>{orderStatusLabels[item]}</option>)}
            </select>
          </Field>
          <Field label="Customer account (optional)">
            <select className={styles.select} value={customerId} onChange={(event) => {
              setCustomerId(event.target.value);
              const email = customers.find((customer) => customer.id === event.target.value)?.email;
              if (email && !billing.email) setBilling({ ...billing, email });
            }}>
              <option value="">Guest</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.email}</option>)}
            </select>
          </Field>
          <Field label="Coupon (optional)"><input className={styles.input} value={coupon} onChange={(event) => setCoupon(event.target.value)} /></Field>
        </div>
        <h3>Items</h3>
        {lines.map((line, index) => {
          const product = productById.get(line.product_id);
          return (
            <div key={index} className={styles.grid4}>
              <select className={styles.select} value={line.product_id} aria-label="Product"
                onChange={(event) => setLines(lines.map((item, i) => (i === index ? { ...item, product_id: event.target.value, variation_id: null } : item)))}>
                <option value="">Choose a product…</option>
                {products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              {product?.type === 'variable' ? (
                <select className={styles.select} value={line.variation_id || ''} aria-label="Variation"
                  onChange={(event) => setLines(lines.map((item, i) => (i === index ? { ...item, variation_id: event.target.value || null } : item)))}>
                  <option value="">Choose a variation…</option>
                  {product.shop_variations.map((variation) => (
                    <option key={variation.id} value={variation.id}>{Object.entries(variation.attributes).map(([name, value]) => `${name}: ${value || 'any'}`).join(', ')}</option>
                  ))}
                </select>
              ) : <span />}
              <input className={styles.input} type="number" min={1} value={line.quantity} aria-label="Quantity"
                onChange={(event) => setLines(lines.map((item, i) => (i === index ? { ...item, quantity: Math.max(Number(event.target.value) || 1, 1) } : item)))} />
              <button type="button" className={styles.buttonDanger} onClick={() => setLines(lines.filter((_, i) => i !== index))}>Remove</button>
            </div>
          );
        })}
        <div><button type="button" className={styles.buttonSecondary} onClick={() => setLines([...lines, { product_id: '', variation_id: null, quantity: 1 }])}>Add item</button></div>
        <h3>Billing address</h3>
        <AddressEditor value={billing} onChange={setBilling} withContact />
        <div><button type="button" className={styles.button} disabled={busy || !lines.length} onClick={() => void create()}>{busy ? 'Creating…' : 'Create order'}</button></div>
      </div>
    </div>
  );
}

export default function OrdersAdmin() {
  const [view, setView] = useState<{ mode: 'list' } | { mode: 'edit'; id: number } | { mode: 'new' }>(() => {
    const id = Number(new URLSearchParams(window.location.search).get('order'));
    return id ? { mode: 'edit', id } : { mode: 'list' };
  });
  if (view.mode === 'edit') return <OrderEditor orderId={view.id} onClose={() => setView({ mode: 'list' })} />;
  if (view.mode === 'new') return <NewOrder onCreated={(id) => setView({ mode: 'edit', id })} onCancel={() => setView({ mode: 'list' })} />;
  return <OrderList onOpen={(id) => setView({ mode: 'edit', id })} onCreate={() => setView({ mode: 'new' })} />;
}
