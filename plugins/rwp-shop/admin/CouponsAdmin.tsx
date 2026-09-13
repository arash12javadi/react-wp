import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';
import { explainShopError } from '../lib/api';
import { formatPrice } from '../lib/currencies';
import { useShopSettings } from '../lib/settings';
import type { Coupon, Taxonomy } from '../lib/types';
import { Feedback, Field, numberOrNull, TagInput } from './common';
import styles from './admin.module.css';

type Draft = Omit<Coupon, 'id' | 'usage_count'> & { id?: string; usage_count?: number };

const blank = (): Draft => ({
  code: '', description: '', discount_type: 'percent', amount: 0, free_shipping: false, expires_at: null,
  minimum_spend: null, maximum_spend: null, individual_use: false, exclude_sale_items: false, product_ids: [],
  excluded_product_ids: [], category_ids: [], excluded_category_ids: [], allowed_emails: [], usage_limit: null,
  usage_limit_per_user: null, limit_usage_to_x_items: null, active: true,
});

const typeLabels: Record<Coupon['discount_type'], string> = {
  percent: 'Percentage discount',
  fixed_cart: 'Fixed cart discount',
  fixed_product: 'Fixed product discount',
};

function MultiSelect({ options, value, onChange }: { options: Array<{ id: string; name: string }>; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <select className={styles.select} multiple size={Math.min(Math.max(options.length, 3), 6)} value={value}
      onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((option) => option.value))}>
      {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>
  );
}

export default function CouponsAdmin() {
  const { settings } = useShopSettings();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [categories, setCategories] = useState<Taxonomy[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    const { data, error: loadError } = await getSupabaseClient().from('shop_coupons').select('*').order('created_at', { ascending: false });
    if (loadError) return setError(explainShopError(loadError));
    setCoupons((data || []) as Coupon[]);
  }, []);

  useEffect(() => {
    void load();
    const supabase = getSupabaseClient();
    void supabase.from('shop_products').select('id,name').order('name').then(({ data }) => setProducts(data || []));
    void supabase.from('shop_categories').select('*').order('name').then(({ data }) => setCategories((data || []) as Taxonomy[]));
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setError('');
    setSuccess('');
    const code = draft.code.trim();
    if (!code) return setError('The coupon needs a code.');
    if (draft.discount_type === 'percent' && Number(draft.amount) > 100) return setError('A percentage discount cannot be more than 100.');
    const { id, usage_count: _count, ...fields } = draft;
    void _count;
    const row = { ...fields, code, updated_at: new Date().toISOString() };
    const supabase = getSupabaseClient();
    const { data, error: saveError } = id
      ? await supabase.from('shop_coupons').update(row).eq('id', id).select('id')
      : await supabase.from('shop_coupons').insert(row).select('id');
    if (saveError) return setError(saveError.code === '23505' ? `A coupon with the code "${code}" already exists.` : explainShopError(saveError));
    if (!data?.length) return setError('The coupon was not saved: the database refused the write. Your role needs the manage_shop capability.');
    setSuccess(`Coupon “${code}” saved.`);
    setDraft(null);
    void load();
  };

  const remove = async (coupon: Coupon) => {
    if (!window.confirm(`Delete coupon “${coupon.code}”?`)) return;
    const { data, error: deleteError } = await getSupabaseClient().from('shop_coupons').delete().eq('id', coupon.id).select('id');
    if (deleteError) return setError(explainShopError(deleteError));
    if (!data?.length) return setError('The coupon was not deleted: the database refused the delete.');
    void load();
  };

  if (draft) {
    const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });
    return (
      <div className={styles.wrap}>
        <button type="button" className={styles.buttonLink} onClick={() => setDraft(null)}>← All coupons</button>
        <Feedback error={error} success={success} />
        <div className={styles.panel}>
          <h2>{draft.id ? `Edit coupon “${draft.code}”` : 'Add new coupon'}</h2>
          <div className={styles.grid2}>
            <Field label="Coupon code">
              <div className={styles.toolbarGroup}>
                <input className={styles.input} style={{ flex: 1 }} value={draft.code} onChange={(event) => set('code', event.target.value)} />
                <button type="button" className={styles.buttonSecondary}
                  onClick={() => set('code', Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[byte % 32]).join(''))}>
                  Generate
                </button>
              </div>
            </Field>
            <Field label="Description (optional)"><input className={styles.input} value={draft.description} onChange={(event) => set('description', event.target.value)} /></Field>
          </div>

          <h3>General</h3>
          <div className={styles.grid3}>
            <Field label="Discount type">
              <select className={styles.select} value={draft.discount_type} onChange={(event) => set('discount_type', event.target.value as Coupon['discount_type'])}>
                {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label={draft.discount_type === 'percent' ? 'Coupon amount (%)' : `Coupon amount (${settings.currency})`}>
              <input className={styles.input} type="number" min="0" step="any" value={draft.amount} onChange={(event) => set('amount', Number(event.target.value) || 0)} />
            </Field>
            <Field label="Coupon expiry date">
              <input className={styles.input} type="date" value={draft.expires_at ? draft.expires_at.slice(0, 10) : ''}
                onChange={(event) => set('expires_at', event.target.value ? new Date(`${event.target.value}T23:59:59`).toISOString() : null)} />
            </Field>
            <label className={styles.check}><input type="checkbox" checked={draft.free_shipping} onChange={(event) => set('free_shipping', event.target.checked)} />Allow free shipping</label>
            <label className={styles.check}><input type="checkbox" checked={draft.active} onChange={(event) => set('active', event.target.checked)} />Active</label>
          </div>

          <h3>Usage restriction</h3>
          <div className={styles.grid2}>
            <Field label="Minimum spend"><input className={styles.input} type="number" min="0" step="any" value={draft.minimum_spend ?? ''} onChange={(event) => set('minimum_spend', numberOrNull(event.target.value))} placeholder="No minimum" /></Field>
            <Field label="Maximum spend"><input className={styles.input} type="number" min="0" step="any" value={draft.maximum_spend ?? ''} onChange={(event) => set('maximum_spend', numberOrNull(event.target.value))} placeholder="No maximum" /></Field>
            <label className={styles.check}><input type="checkbox" checked={draft.individual_use} onChange={(event) => set('individual_use', event.target.checked)} />Individual use only (cannot be combined with other coupons)</label>
            <label className={styles.check}><input type="checkbox" checked={draft.exclude_sale_items} onChange={(event) => set('exclude_sale_items', event.target.checked)} />Exclude sale items</label>
            <Field label="Products" hint="Only these products get the discount. Hold Ctrl/⌘ to select several."><MultiSelect options={products} value={draft.product_ids} onChange={(ids) => set('product_ids', ids)} /></Field>
            <Field label="Exclude products"><MultiSelect options={products} value={draft.excluded_product_ids} onChange={(ids) => set('excluded_product_ids', ids)} /></Field>
            <Field label="Product categories"><MultiSelect options={categories} value={draft.category_ids} onChange={(ids) => set('category_ids', ids)} /></Field>
            <Field label="Exclude categories"><MultiSelect options={categories} value={draft.excluded_category_ids} onChange={(ids) => set('excluded_category_ids', ids)} /></Field>
            <Field label="Allowed emails" full hint="Billing emails allowed to use this coupon. Use * as a wildcard, e.g. *@example.com.">
              <TagInput value={draft.allowed_emails} onChange={(emails) => set('allowed_emails', emails.map((email) => email.toLowerCase()))} placeholder="No restrictions" />
            </Field>
          </div>

          <h3>Usage limits</h3>
          <div className={styles.grid3}>
            <Field label="Usage limit per coupon"><input className={styles.input} type="number" min="0" value={draft.usage_limit ?? ''} onChange={(event) => set('usage_limit', numberOrNull(event.target.value))} placeholder="Unlimited" /></Field>
            <Field label="Limit usage to X items"><input className={styles.input} type="number" min="0" value={draft.limit_usage_to_x_items ?? ''} onChange={(event) => set('limit_usage_to_x_items', numberOrNull(event.target.value))} placeholder="Apply to all qualifying items" /></Field>
            <Field label="Usage limit per user"><input className={styles.input} type="number" min="0" value={draft.usage_limit_per_user ?? ''} onChange={(event) => set('usage_limit_per_user', numberOrNull(event.target.value))} placeholder="Unlimited" /></Field>
          </div>
          <div><button type="button" className={styles.button} onClick={() => void save()}>Save coupon</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <p className={styles.muted}>{settings.enable_coupons ? 'Coupons are enabled at checkout.' : 'Coupons are currently disabled in Shop → Settings → General.'}</p>
        <button type="button" className={styles.button} onClick={() => setDraft(blank())}>Add coupon</button>
      </div>
      <Feedback error={error} success={success} />
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Code</th><th>Type</th><th>Amount</th><th>Description</th><th>Usage / Limit</th><th>Expiry</th><th /></tr></thead>
          <tbody>
            {coupons.length === 0 && <tr><td colSpan={7} className={styles.muted}>No coupons yet.</td></tr>}
            {coupons.map((coupon) => (
              <tr key={coupon.id}>
                <td><strong>{coupon.code}</strong>{!coupon.active && <span className={styles.muted}> (inactive)</span>}</td>
                <td>{typeLabels[coupon.discount_type]}</td>
                <td>{coupon.discount_type === 'percent' ? `${Number(coupon.amount)}%` : formatPrice(coupon.amount, settings)}</td>
                <td>{coupon.description || '—'}</td>
                <td>{coupon.usage_count} / {coupon.usage_limit ?? '∞'}</td>
                <td>{coupon.expires_at ? new Date(coupon.expires_at).toLocaleDateString() : '—'}</td>
                <td>
                  <div className={styles.rowActions}>
                    <button type="button" className={styles.buttonLink} onClick={() => setDraft({ ...coupon })}>Edit</button>
                    <button type="button" className={styles.buttonLink} style={{ color: '#b91c1c' }} onClick={() => void remove(coupon)}>Delete</button>
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
