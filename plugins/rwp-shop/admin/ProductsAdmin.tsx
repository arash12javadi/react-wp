import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';
import { explainShopError } from '../lib/api';
import { formatPrice } from '../lib/currencies';
import { useShopSettings } from '../lib/settings';
import { effectivePrice } from '../lib/pricing';
import type { Product } from '../lib/types';
import { Feedback, Tabs } from './common';
import ProductEditor from './ProductEditor';
import TaxonomyAdmin, { AttributesAdmin } from './TaxonomyAdmin';
import styles from './admin.module.css';

type Section = 'products' | 'categories' | 'tags' | 'attributes';

interface ProductRow extends Product {
  shop_product_categories: Array<{ shop_categories: { name: string } | null }>;
  shop_variations: Array<{ regular_price: number | null; sale_price: number | null; sale_from: string | null; sale_to: string | null; stock_quantity: number | null; manage_stock: boolean }>;
}

function ProductList({ onEdit }: { onEdit: (id: string | null) => void }) {
  const { settings } = useShopSettings();
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let query = getSupabaseClient()
      .from('shop_products')
      .select('*, shop_product_categories(shop_categories(name)), shop_variations(regular_price,sale_price,sale_from,sale_to,stock_quantity,manage_stock)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (status) query = query.eq('status', status);
    if (type) query = query.eq('type', type);
    if (search.trim()) query = query.or(`name.ilike.%${search.trim().replace(/[,()]/g, ' ')}%,sku.ilike.%${search.trim().replace(/[,()]/g, ' ')}%`);
    const { data, error: loadError } = await query;
    if (loadError) setError(explainShopError(loadError));
    else setRows((data || []) as ProductRow[]);
    setLoading(false);
  }, [search, status, type]);

  useEffect(() => { void load(); }, [load]);

  const remove = async (product: ProductRow) => {
    if (!window.confirm(`Delete "${product.name}" permanently? Existing orders keep their line items.`)) return;
    const { data, error: deleteError } = await getSupabaseClient().from('shop_products').delete().eq('id', product.id).select('id');
    if (deleteError) return setError(explainShopError(deleteError));
    if (!data?.length) return setError('Nothing was deleted: the database refused the delete. Your role needs the manage_shop capability.');
    setSuccess(`"${product.name}" was deleted.`);
    setRows((current) => current.filter((row) => row.id !== product.id));
  };

  const duplicate = async (product: ProductRow) => {
    setError('');
    const supabase = getSupabaseClient();
    const { data: full, error: loadError } = await supabase.from('shop_products')
      .select('*, shop_product_categories(category_id), shop_product_tags(tag_id), shop_variations(*)').eq('id', product.id).single();
    if (loadError) return setError(explainShopError(loadError));
    const { shop_product_categories: categoryLinks, shop_product_tags: tagLinks, shop_variations: variations, id: _id, created_at: _created, updated_at: _updated, ...fields } = full as Product & {
      shop_product_categories: Array<{ category_id: string }>;
      shop_product_tags: Array<{ tag_id: string }>;
      shop_variations: Array<Record<string, unknown>>;
    };
    void _id; void _created; void _updated;
    const { data: copy, error: insertError } = await supabase.from('shop_products')
      .insert({ ...fields, name: `${fields.name} (Copy)`, slug: `${fields.slug}-copy-${Date.now().toString(36)}`, sku: null, status: 'draft', total_sales: 0, average_rating: 0, rating_count: 0 })
      .select('id').single();
    if (insertError) return setError(explainShopError(insertError));
    if (categoryLinks.length) await supabase.from('shop_product_categories').insert(categoryLinks.map((link) => ({ product_id: copy.id, category_id: link.category_id })));
    if (tagLinks.length) await supabase.from('shop_product_tags').insert(tagLinks.map((link) => ({ product_id: copy.id, tag_id: link.tag_id })));
    if (variations.length) {
      await supabase.from('shop_variations').insert(variations.map(({ id: _variationId, created_at: _c, updated_at: _u, ...variation }) => {
        void _variationId; void _c; void _u;
        return { ...variation, product_id: copy.id, sku: null };
      }));
    }
    onEdit(copy.id);
  };

  const priceLabel = (row: ProductRow) => {
    if (row.type === 'variable') {
      const prices = row.shop_variations.map(effectivePrice).filter((price): price is number => price !== null);
      if (!prices.length) return '—';
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      return min === max ? formatPrice(min, settings) : `${formatPrice(min, settings)} – ${formatPrice(max, settings)}`;
    }
    const price = effectivePrice(row);
    return price === null ? '—' : formatPrice(price, settings);
  };

  const stockLabel = (row: ProductRow) => {
    if (row.manage_stock) return `${row.stock_status === 'outofstock' ? 'Out of stock' : 'In stock'} (${row.stock_quantity ?? 0})`;
    return { instock: 'In stock', outofstock: 'Out of stock', onbackorder: 'On backorder' }[row.stock_status];
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup}>
          <input className={styles.input} style={{ width: 220 }} type="search" placeholder="Search name or SKU" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select className={styles.select} style={{ width: 150 }} value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="publish">Published</option>
            <option value="draft">Draft</option>
            <option value="pending">Pending review</option>
            <option value="private">Private</option>
          </select>
          <select className={styles.select} style={{ width: 150 }} value={type} onChange={(event) => setType(event.target.value)} aria-label="Product type">
            <option value="">All types</option>
            <option value="simple">Simple</option>
            <option value="variable">Variable</option>
            <option value="grouped">Grouped</option>
            <option value="external">External/Affiliate</option>
          </select>
        </div>
        <button type="button" className={styles.button} onClick={() => onEdit(null)}>Add new product</button>
      </div>
      <Feedback error={error} success={success} />
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th /><th>Name</th><th>SKU</th><th>Stock</th><th>Price</th><th>Categories</th><th>Sales</th><th>Status</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} className={styles.muted}>Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={8} className={styles.muted}>No products found. Add your first product to start selling.</td></tr>}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.image_url ? <img className={styles.thumb} src={row.image_url} alt="" /> : <span className={styles.thumb} style={{ display: 'inline-block' }} />}</td>
                <td>
                  <button type="button" className={styles.buttonLink} onClick={() => onEdit(row.id)}>{row.name}</button>
                  {row.featured && <span title="Featured"> ★</span>}
                  <div className={styles.rowActions}>
                    <button type="button" className={styles.buttonLink} onClick={() => onEdit(row.id)}>Edit</button>
                    <button type="button" className={styles.buttonLink} onClick={() => void duplicate(row)}>Duplicate</button>
                    <a className={styles.buttonLink} href={`/product/${row.slug}`} target="_blank" rel="noreferrer">View</a>
                    <button type="button" className={styles.buttonLink} style={{ color: '#b91c1c' }} onClick={() => void remove(row)}>Delete</button>
                  </div>
                </td>
                <td>{row.sku || '—'}</td>
                <td>{stockLabel(row)}</td>
                <td>{priceLabel(row)}</td>
                <td>{row.shop_product_categories.map((link) => link.shop_categories?.name).filter(Boolean).join(', ') || '—'}</td>
                <td>{row.total_sales}</td>
                <td><span className={`${styles.status} ${styles[`status_${row.status}`] || ''}`}>{row.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ProductsAdmin() {
  const [section, setSection] = useState<Section>('products');
  const [editing, setEditing] = useState<string | null | undefined>(undefined);

  return (
    <div className={styles.wrap}>
      <Tabs<Section>
        tabs={[['products', 'All products'], ['categories', 'Categories'], ['tags', 'Tags'], ['attributes', 'Attributes']]}
        active={section}
        onChange={(next) => { setSection(next); setEditing(undefined); }}
      />
      {section === 'products' && (editing === undefined
        ? <ProductList onEdit={setEditing} />
        : <ProductEditor productId={editing} onClose={() => setEditing(undefined)} onSaved={(id) => setEditing(id)} />)}
      {section === 'categories' && <TaxonomyAdmin kind="categories" />}
      {section === 'tags' && <TaxonomyAdmin kind="tags" />}
      {section === 'attributes' && <AttributesAdmin />}
    </div>
  );
}
