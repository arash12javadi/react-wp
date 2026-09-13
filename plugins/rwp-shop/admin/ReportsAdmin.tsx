import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';
import { explainShopError } from '../lib/api';
import { formatPrice } from '../lib/currencies';
import { useShopSettings } from '../lib/settings';
import { orderStatusLabels, type OrderStatus } from '../lib/types';
import { Feedback } from './common';
import styles from './admin.module.css';

interface Report {
  orders: number;
  gross_sales: number;
  net_sales: number;
  refunds: number;
  tax: number;
  shipping: number;
  discounts: number;
  items_sold: number;
  average_order: number;
  by_status: Record<string, number>;
  daily: Array<{ date: string; orders: number; sales: number }>;
  top_products: Array<{ product_id: string | null; name: string; quantity: number; sales: number }>;
  top_coupons: Array<{ code: string; uses: number; discount: number }>;
  low_stock: Array<{ id: string; name: string; stock_quantity: number }>;
}

const ranges: Array<[string, string, number]> = [
  ['7', 'Last 7 days', 7],
  ['30', 'Last 30 days', 30],
  ['90', 'Last 90 days', 90],
  ['365', 'Last 12 months', 365],
];

const useReport = (days: number, from?: string, to?: string) => {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const end = to ? new Date(`${to}T23:59:59`) : new Date();
    const start = from ? new Date(`${from}T00:00:00`) : new Date(Date.now() - days * 86_400_000);
    void getSupabaseClient().rpc('shop_report', { p_from: start.toISOString(), p_to: end.toISOString() })
      .then(({ data, error: loadError }) => {
        if (loadError) setError(explainShopError(loadError));
        else { setReport(data as Report); setError(''); }
      });
  }, [days, from, to]);
  return { report, error };
};

export default function ReportsAdmin() {
  const { settings } = useShopSettings();
  const [range, setRange] = useState('30');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const days = ranges.find(([id]) => id === range)?.[2] || 30;
  const { report, error } = useReport(days, range === 'custom' ? from : undefined, range === 'custom' ? to : undefined);
  const money = (value: number) => formatPrice(value, settings);
  const maxSales = Math.max(...(report?.daily || []).map((day) => Number(day.sales)), 1);

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.subTabs}>
          {ranges.map(([id, label]) => (
            <button key={id} type="button" className={range === id ? styles.subTabActive : styles.subTab} onClick={() => setRange(id)}>{label}</button>
          ))}
          <button type="button" className={range === 'custom' ? styles.subTabActive : styles.subTab} onClick={() => setRange('custom')}>Custom</button>
        </div>
        {range === 'custom' && (
          <div className={styles.toolbarGroup}>
            <input className={styles.input} type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From" />
            <input className={styles.input} type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To" />
          </div>
        )}
      </div>
      <Feedback error={error} />
      {!report ? <p className={styles.muted}>Loading report…</p> : (
        <>
          <div className={styles.cards}>
            <div className={styles.card}><span>Gross sales</span><strong>{money(report.gross_sales)}</strong></div>
            <div className={styles.card}><span>Net sales</span><strong>{money(report.net_sales)}</strong></div>
            <div className={styles.card}><span>Orders</span><strong>{report.orders}</strong></div>
            <div className={styles.card}><span>Average order</span><strong>{money(report.average_order)}</strong></div>
            <div className={styles.card}><span>Items sold</span><strong>{report.items_sold}</strong></div>
            <div className={styles.card}><span>Refunds</span><strong>{money(report.refunds)}</strong></div>
            <div className={styles.card}><span>Discounts</span><strong>{money(report.discounts)}</strong></div>
            <div className={styles.card}><span>Tax</span><strong>{money(report.tax)}</strong></div>
            <div className={styles.card}><span>Shipping</span><strong>{money(report.shipping)}</strong></div>
          </div>

          <div className={styles.panel}>
            <h2>Sales by day</h2>
            {report.daily.length === 0 ? <p className={styles.muted}>No sales in this period.</p> : (
              <>
                <div className={styles.chart} role="img" aria-label="Daily sales chart">
                  {report.daily.map((day) => (
                    <div key={day.date} className={styles.bar} style={{ height: `${Math.max((Number(day.sales) / maxSales) * 100, 2)}%` }}
                      title={`${new Date(day.date).toLocaleDateString()}: ${money(day.sales)} from ${day.orders} order${day.orders === 1 ? '' : 's'}`} />
                  ))}
                </div>
                <div className={styles.toolbar}>
                  <span className={styles.muted}>{new Date(report.daily[0].date).toLocaleDateString()}</span>
                  <span className={styles.muted}>{new Date(report.daily[report.daily.length - 1].date).toLocaleDateString()}</span>
                </div>
              </>
            )}
          </div>

          <div className={styles.grid2}>
            <div className={styles.panel}>
              <h2>Top sellers</h2>
              <table className={styles.table}>
                <thead><tr><th>Product</th><th>Qty</th><th>Sales</th></tr></thead>
                <tbody>
                  {report.top_products.length === 0 && <tr><td colSpan={3} className={styles.muted}>No data.</td></tr>}
                  {report.top_products.map((product) => (
                    <tr key={`${product.product_id}-${product.name}`}><td>{product.name}</td><td>{product.quantity}</td><td>{money(product.sales)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.panel}>
              <h2>Orders by status</h2>
              <table className={styles.table}>
                <tbody>
                  {Object.entries(report.by_status).map(([status, count]) => (
                    <tr key={status}><td>{orderStatusLabels[status as OrderStatus] || status}</td><td>{count}</td></tr>
                  ))}
                </tbody>
              </table>
              <h2>Coupons used</h2>
              <table className={styles.table}>
                <tbody>
                  {report.top_coupons.length === 0 && <tr><td className={styles.muted}>No coupons used.</td></tr>}
                  {report.top_coupons.map((coupon) => <tr key={coupon.code}><td>{coupon.code}</td><td>{coupon.uses}×</td><td>-{money(coupon.discount)}</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>

          {report.low_stock.length > 0 && (
            <div className={styles.panel}>
              <h2>Low stock</h2>
              <table className={styles.table}>
                <tbody>
                  {report.low_stock.map((product) => <tr key={product.id}><td>{product.name}</td><td>{product.stock_quantity} left</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Compact version for the admin dashboard. */
export function ShopDashboardWidget() {
  const { settings } = useShopSettings();
  const { report, error } = useReport(30);
  // Dashboard widgets show for every admin role; roles without manage_shop get an RPC error, so hide instead.
  if (error) return null;
  if (!report) return <p className={styles.muted}>Loading…</p>;
  return (
    <div className={styles.cards}>
      <div className={styles.card}><span>Sales (30 days)</span><strong>{formatPrice(report.net_sales, settings)}</strong></div>
      <div className={styles.card}><span>Orders</span><strong>{report.orders}</strong></div>
      <div className={styles.card}><span>Processing</span><strong>{report.by_status.processing || 0}</strong></div>
      <div className={styles.card}><span>Low stock</span><strong>{report.low_stock.length}</strong></div>
    </div>
  );
}
