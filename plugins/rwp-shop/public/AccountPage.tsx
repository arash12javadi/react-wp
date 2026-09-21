import { useEffect, useState, type FormEvent } from 'react';
import type { RwpRouteProps } from '../../../src/lib/plugin-api';
import { describeDbError, getSupabaseClient } from '../../../src/lib/db';
import { signOutAndRedirect } from '../../../src/lib/account';
import { usePublicChrome } from '../../../src/components/PublicChrome';
import { claimGuestOrders, consumeDownload, explainShopError, getOrder } from '../lib/api';
import { cart } from '../lib/cart';
import { countries } from '../lib/countries';
import { formatPrice } from '../lib/currencies';
import { useShopSettings, type ShopSettings } from '../lib/settings';
import type { Address, Order } from '../lib/types';
import { FormattedAddress, PageShell } from './components';
import { OrderSummary, StatusBadge } from './OrderViews';
import styles from './shop.module.css';

const sections: Array<[string, string]> = [
  ['', 'Dashboard'],
  ['orders', 'Orders'],
  ['downloads', 'Downloads'],
  ['edit-address', 'Addresses'],
  ['edit-account', 'Account details'],
];

function OrdersList({ settings }: { settings: ShopSettings }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void getSupabaseClient().from('shop_orders').select('*').order('created_at', { ascending: false })
      .then(({ data, error: loadError }) => {
        if (loadError) setError(explainShopError(loadError));
        else setOrders((data || []) as Order[]);
      });
  }, []);

  if (error) return <div className={styles.error}>{error}</div>;
  if (!orders) return <p className={styles.muted}>Loading orders…</p>;
  if (!orders.length) return <div className={styles.notice}>No order has been made yet. <a href="/shop">Browse products</a></div>;

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Total</th><th>Actions</th></tr></thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td><a href={`/my-account/view-order/${order.id}`}>#{order.id}</a></td>
              <td>{new Date(order.created_at).toLocaleDateString()}</td>
              <td><StatusBadge status={order.status} /></td>
              <td>{formatPrice(order.total, settings, order.currency)}</td>
              <td>
                <a className={styles.buttonLink} href={`/my-account/view-order/${order.id}`}>View</a>
                {['pending', 'failed'].includes(order.status) && (
                  <> · <a className={styles.buttonLink} href={`/checkout/order-pay/${order.id}?key=${encodeURIComponent(order.order_key)}`}>Pay</a></>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ViewOrder({ id, settings }: { id: number; settings: ShopSettings }) {
  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => {
    // The key is not needed for the customer's own orders; shop_get_order checks customer_id.
    getOrder(id, '').then(setOrder).catch((loadError: unknown) => setError(explainShopError(loadError)));
  }, [id]);
  if (error) return <div className={styles.error}>{error}</div>;
  if (order === undefined) return <p className={styles.muted}>Loading…</p>;
  if (!order) return <div className={styles.error}>Order #{id} was not found in your account.</div>;
  return (
    <div>
      <p>
        Order <mark>#{order.id}</mark> was placed on <mark>{new Date(order.created_at).toLocaleDateString()}</mark> and is currently <StatusBadge status={order.status} />.
      </p>
      <OrderSummary order={order} settings={settings} />
    </div>
  );
}

interface DownloadRow {
  orderId: number;
  orderKey: string;
  itemId: number;
  product: string;
  file: { id: string; name: string; downloads_remaining: number | null; expires_at: string | null };
}

function Downloads() {
  const [rows, setRows] = useState<DownloadRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      const { data, error: loadError } = await getSupabaseClient().from('shop_orders').select('id,order_key')
        .in('status', ['processing', 'completed']).order('created_at', { ascending: false });
      if (loadError) throw loadError;
      const orders = await Promise.all((data || []).map((row) => getOrder(row.id, row.order_key)));
      return orders.flatMap((order) => (order?.items || []).flatMap((item) => (item.downloads || []).map((file) => ({
        orderId: order!.id, orderKey: order!.order_key, itemId: item.id, product: item.name, file,
      }))));
    };
    load().then(setRows).catch((loadError: unknown) => setError(explainShopError(loadError)));
  }, []);

  const start = async (row: DownloadRow) => {
    setError('');
    try {
      window.location.href = await consumeDownload(row.orderId, row.orderKey, row.itemId, row.file.id);
    } catch (downloadError: unknown) {
      setError(downloadError instanceof Error ? downloadError.message : 'The download could not be started.');
    }
  };

  if (!rows) return error ? <div className={styles.error}>{error}</div> : <p className={styles.muted}>Loading…</p>;
  if (!rows.length) return <div className={styles.notice}>No downloads available yet.</div>;
  return (
    <>
      {error && <div className={styles.error}>{error}</div>}
      <table className={styles.table}>
        <thead><tr><th>Product</th><th>Downloads remaining</th><th>Expires</th><th>Download</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.itemId}-${row.file.id}`}>
              <td>{row.product}</td>
              <td>{row.file.downloads_remaining ?? '∞'}</td>
              <td>{row.file.expires_at ? new Date(row.file.expires_at).toLocaleDateString() : 'Never'}</td>
              <td><button type="button" className={styles.buttonLink} onClick={() => void start(row)}>{row.file.name}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function AddressForm({ title, value, onSave }: { title: string; value: Address; onSave: (address: Address) => Promise<void> }) {
  const [draft, setDraft] = useState<Address>(value);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => setDraft(value), [value]);
  const set = (field: keyof Address) => (event: { target: { value: string } }) => setDraft({ ...draft, [field]: event.target.value });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      await onSave(draft);
      setMessage('Address changed successfully.');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'The address could not be saved.');
    }
  };

  return (
    <form onSubmit={submit} className={styles.fieldset} style={{ display: 'grid', gap: 12 }}>
      <h2>{title}</h2>
      {message && <div className={styles.success}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.formGrid}>
        <label className={styles.field}>First name<input className={styles.input} value={draft.first_name || ''} onChange={set('first_name')} /></label>
        <label className={styles.field}>Last name<input className={styles.input} value={draft.last_name || ''} onChange={set('last_name')} /></label>
        <label className={`${styles.field} ${styles.full}`}>Company<input className={styles.input} value={draft.company || ''} onChange={set('company')} /></label>
        <label className={`${styles.field} ${styles.full}`}>Country / Region
          <select className={styles.select} value={draft.country || ''} onChange={set('country')}>
            <option value="">Select a country…</option>
            {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
          </select>
        </label>
        <label className={`${styles.field} ${styles.full}`}>Street address
          <input className={styles.input} value={draft.address_1 || ''} onChange={set('address_1')} />
          <input className={styles.input} value={draft.address_2 || ''} onChange={set('address_2')} placeholder="Apartment, suite, etc." />
        </label>
        <label className={styles.field}>Town / City<input className={styles.input} value={draft.city || ''} onChange={set('city')} /></label>
        <label className={styles.field}>State / County<input className={styles.input} value={draft.state || ''} onChange={set('state')} /></label>
        <label className={styles.field}>Postcode / ZIP<input className={styles.input} value={draft.postcode || ''} onChange={set('postcode')} /></label>
        {'email' in value || title.startsWith('Billing') ? (
          <>
            <label className={styles.field}>Phone<input className={styles.input} type="tel" value={draft.phone || ''} onChange={set('phone')} /></label>
            <label className={`${styles.field} ${styles.full}`}>Email<input className={styles.input} type="email" value={draft.email || ''} onChange={set('email')} /></label>
          </>
        ) : null}
      </div>
      <div><button type="submit" className={styles.button}>Save address</button></div>
    </form>
  );
}

function Addresses({ userId }: { userId: string }) {
  const [billing, setBilling] = useState<Address>({});
  const [shipping, setShipping] = useState<Address>({});
  const [editing, setEditing] = useState<'billing' | 'shipping' | ''>('');

  useEffect(() => {
    void getSupabaseClient().from('shop_customers').select('billing,shipping').eq('id', userId).maybeSingle().then(({ data }) => {
      setBilling((data?.billing || {}) as Address);
      setShipping((data?.shipping || {}) as Address);
    });
  }, [userId]);

  const save = (kind: 'billing' | 'shipping') => async (address: Address) => {
    const { data, error } = await getSupabaseClient().from('shop_customers')
      .upsert({ id: userId, [kind]: address, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('id');
    if (error) throw new Error(explainShopError(error));
    if (!data?.length) throw new Error('The database did not save your address. Please sign in again and retry.');
    if (kind === 'billing') setBilling(address);
    else setShipping(address);
  };

  if (editing === 'billing') return <><AddressForm title="Billing address" value={billing} onSave={save('billing')} /><button type="button" className={styles.buttonLink} onClick={() => setEditing('')}>← Back</button></>;
  if (editing === 'shipping') return <><AddressForm title="Shipping address" value={shipping} onSave={save('shipping')} /><button type="button" className={styles.buttonLink} onClick={() => setEditing('')}>← Back</button></>;

  return (
    <div>
      <p>The following addresses will be used on the checkout page by default.</p>
      <div className={styles.addresses}>
        <div>
          <h2>Billing address <button type="button" className={styles.buttonLink} onClick={() => setEditing('billing')}>Edit</button></h2>
          {billing.address_1 ? <FormattedAddress address={billing} /> : <p className={styles.muted}>You have not set up this address yet.</p>}
        </div>
        <div>
          <h2>Shipping address <button type="button" className={styles.buttonLink} onClick={() => setEditing('shipping')}>Edit</button></h2>
          {shipping.address_1 ? <FormattedAddress address={shipping} /> : <p className={styles.muted}>You have not set up this address yet.</p>}
        </div>
      </div>
    </div>
  );
}

function AccountDetails({ userId, email }: { userId: string; email: string }) {
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void getSupabaseClient().from('profiles').select('display_name').eq('id', userId).maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name || ''));
  }, [userId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      const supabase = getSupabaseClient();
      const { data, error: updateError } = await supabase.from('profiles').update({ display_name: displayName }).eq('id', userId).select('id');
      if (updateError) throw new Error(describeDbError(updateError));
      if (!data?.length) throw new Error('Your display name was not saved: the database matched no profile row for your account.');
      if (password) {
        if (password !== confirmPassword) throw new Error('The new passwords do not match.');
        const { error: passwordError } = await supabase.auth.updateUser({ password });
        if (passwordError) throw new Error(passwordError.message);
        setPassword('');
        setConfirmPassword('');
      }
      setMessage('Account details changed successfully.');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Your details could not be saved.');
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 14, maxWidth: 520 }}>
      {message && <div className={styles.success}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}
      <label className={styles.field}>Display name<input className={styles.input} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label className={styles.field}>Email address<input className={styles.input} value={email} disabled /></label>
      <fieldset className={styles.fieldset}>
        <legend style={{ fontSize: '1rem' }}>Password change</legend>
        <div style={{ display: 'grid', gap: 10 }}>
          <label className={styles.field}>New password (leave blank to leave unchanged)
            <input className={styles.input} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label className={styles.field}>Confirm new password
            <input className={styles.input} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </label>
        </div>
      </fieldset>
      <div><button type="submit" className={styles.button}>Save changes</button></div>
    </form>
  );
}

export default function AccountPage({ params }: RwpRouteProps) {
  const { settings, ready } = useShopSettings();
  const chrome = usePublicChrome();
  const [claimed, setClaimed] = useState(0);
  const [section, ...rest] = (params['*'] || '').split('/');

  useEffect(() => {
    document.title = 'My account';
  }, []);

  useEffect(() => {
    if (!chrome.userId) return;
    claimGuestOrders().then(setClaimed).catch(() => setClaimed(0));
    void cart.restoreFromAccount();
  }, [chrome.userId]);

  if (!ready || !chrome.ready) return <PageShell><p className={styles.muted}>Loading…</p></PageShell>;

  if (!chrome.userId) {
    return (
      <PageShell narrow>
        <h1 className={styles.heading}>My account</h1>
        <p>Log in to see your orders, downloads and saved addresses.</p>
        <a className={styles.button} href="/login?redirect=%2Fmy-account">Log in</a>{' '}
        <a className={styles.buttonSecondary} href="/register?redirect=%2Fmy-account">Create an account</a>
      </PageShell>
    );
  }

  // Settings → Accounts → After signing out decides where this goes.
  const logout = () => signOutAndRedirect();

  let content;
  if (section === 'orders') content = <OrdersList settings={settings} />;
  else if (section === 'view-order' && rest[0]) content = <ViewOrder id={Number(rest[0])} settings={settings} />;
  else if (section === 'downloads') content = <Downloads />;
  else if (section === 'edit-address') content = <Addresses userId={chrome.userId} />;
  else if (section === 'edit-account') content = <AccountDetails userId={chrome.userId} email={chrome.email} />;
  else {
    content = (
      <div>
        <p>Hello <strong>{chrome.email}</strong> (not you? <button type="button" className={styles.buttonLink} onClick={() => void logout()}>Log out</button>)</p>
        <p>
          From your account dashboard you can view your <a href="/my-account/orders">recent orders</a>, manage your{' '}
          <a href="/my-account/edit-address">shipping and billing addresses</a>, and{' '}
          <a href="/my-account/edit-account">edit your password and account details</a>.
        </p>
        {claimed > 0 && <div className={styles.success}>{claimed} earlier order{claimed === 1 ? ' was' : 's were'} placed with your email and {claimed === 1 ? 'has' : 'have'} been added to your account.</div>}
      </div>
    );
  }

  const current = section === 'view-order' ? 'orders' : section;

  return (
    <PageShell>
      <h1 className={styles.heading}>My account</h1>
      <div className={styles.accountLayout}>
        <nav className={styles.accountNav} aria-label="Account">
          {sections.map(([slug, label]) => (
            <a key={slug} href={`/my-account${slug ? `/${slug}` : ''}`} aria-current={current === slug ? 'page' : undefined}>{label}</a>
          ))}
          <button type="button" className={styles.buttonLink} style={{ justifyContent: 'flex-start', padding: '9px 12px' }} onClick={() => void logout()}>Log out</button>
        </nav>
        <section>{content}</section>
      </div>
    </PageShell>
  );
}
