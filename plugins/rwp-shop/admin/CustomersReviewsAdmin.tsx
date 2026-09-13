import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';
import { explainShopError } from '../lib/api';
import { countryName } from '../lib/countries';
import { formatPrice } from '../lib/currencies';
import { useShopSettings } from '../lib/settings';
import type { Review } from '../lib/types';
import { Feedback } from './common';
import styles from './admin.module.css';

interface CustomerSummary {
  customer_id: string | null;
  email: string;
  name: string;
  country: string;
  city: string;
  orders: number;
  total_spent: number;
  last_order: string;
}

export function CustomersAdmin() {
  const { settings } = useShopSettings();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void getSupabaseClient().rpc('shop_customer_summary').then(({ data, error: loadError }) => {
      if (loadError) setError(explainShopError(loadError));
      else setCustomers((data || []) as CustomerSummary[]);
    });
  }, []);

  const term = search.trim().toLowerCase();
  const visible = term ? customers.filter((customer) => `${customer.name} ${customer.email}`.toLowerCase().includes(term)) : customers;

  const exportCsv = () => {
    const rows = [['Name', 'Email', 'Account', 'Country', 'City', 'Orders', 'Total spent', 'Last order'],
      ...visible.map((customer) => [customer.name, customer.email, customer.customer_id ? 'Registered' : 'Guest', customer.country, customer.city,
        String(customer.orders), String(customer.total_spent), customer.last_order])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = 'customers.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <input className={styles.input} style={{ width: 280 }} type="search" placeholder="Search customers" value={search} onChange={(event) => setSearch(event.target.value)} />
        <button type="button" className={styles.buttonSecondary} onClick={exportCsv} disabled={!visible.length}>Download CSV</button>
      </div>
      <Feedback error={error} />
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Name</th><th>Email</th><th>Account</th><th>Location</th><th>Orders</th><th>Total spent</th><th>Last order</th></tr></thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={7} className={styles.muted}>No customers yet. Customers appear here after their first order.</td></tr>}
            {visible.map((customer) => (
              <tr key={`${customer.customer_id}-${customer.email}`}>
                <td><strong>{customer.name || '—'}</strong></td>
                <td><a href={`mailto:${customer.email}`}>{customer.email}</a></td>
                <td>{customer.customer_id ? 'Registered' : 'Guest'}</td>
                <td>{[customer.city, countryName(customer.country)].filter(Boolean).join(', ') || '—'}</td>
                <td>{customer.orders}</td>
                <td>{formatPrice(customer.total_spent, settings)}</td>
                <td>{customer.last_order ? new Date(customer.last_order).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ReviewsAdmin() {
  const [reviews, setReviews] = useState<Array<Review & { shop_products: { name: string; slug: string } | null }>>([]);
  const [status, setStatus] = useState<'' | Review['status']>('pending');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    let query = getSupabaseClient().from('shop_reviews').select('*, shop_products(name,slug)').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error: loadError } = await query;
    if (loadError) return setError(explainShopError(loadError));
    setReviews((data || []) as typeof reviews);
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const moderate = async (review: Review, next: Review['status']) => {
    const { data, error: updateError } = await getSupabaseClient().from('shop_reviews').update({ status: next }).eq('id', review.id).select('id');
    if (updateError) return setError(explainShopError(updateError));
    if (!data?.length) return setError('The review was not updated: the database refused the write. Your role needs the manage_shop capability.');
    void load();
  };

  const remove = async (review: Review) => {
    if (!window.confirm('Delete this review permanently?')) return;
    const { error: deleteError } = await getSupabaseClient().from('shop_reviews').delete().eq('id', review.id);
    if (deleteError) return setError(explainShopError(deleteError));
    void load();
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.subTabs}>
        {([['pending', 'Pending'], ['approved', 'Approved'], ['spam', 'Spam'], ['', 'All']] as Array<['' | Review['status'], string]>).map(([value, label]) => (
          <button key={label} type="button" className={status === value ? styles.subTabActive : styles.subTab} onClick={() => setStatus(value)}>{label}</button>
        ))}
      </div>
      <Feedback error={error} />
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Author</th><th>Rating</th><th>Review</th><th>Product</th><th>Submitted</th><th /></tr></thead>
          <tbody>
            {reviews.length === 0 && <tr><td colSpan={6} className={styles.muted}>No reviews here.</td></tr>}
            {reviews.map((review) => (
              <tr key={review.id}>
                <td><strong>{review.author_name}</strong>{review.verified && <div className={styles.muted}>✓ Verified owner</div>}</td>
                <td>{review.rating ? '★'.repeat(review.rating) : '—'}</td>
                <td style={{ maxWidth: 360 }}>{review.content}</td>
                <td>{review.shop_products ? <a href={`/product/${review.shop_products.slug}`} target="_blank" rel="noreferrer">{review.shop_products.name}</a> : '—'}</td>
                <td>{new Date(review.created_at).toLocaleString()}</td>
                <td>
                  <div className={styles.rowActions}>
                    {review.status !== 'approved' && <button type="button" className={styles.buttonLink} onClick={() => void moderate(review, 'approved')}>Approve</button>}
                    {review.status === 'approved' && <button type="button" className={styles.buttonLink} onClick={() => void moderate(review, 'pending')}>Unapprove</button>}
                    {review.status !== 'spam' && <button type="button" className={styles.buttonLink} onClick={() => void moderate(review, 'spam')}>Spam</button>}
                    <button type="button" className={styles.buttonLink} style={{ color: '#b91c1c' }} onClick={() => void remove(review)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
