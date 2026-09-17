import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';
import {
  BulkBar, BulkInline, RowCheckbox, SelectAllCheckbox, describeBulkResult, downloadCsv, useBulkSelection,
} from '../../../src/components/BulkActions';
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

const trashMigration = 'supabase/migrations/20260926_bulk_actions_trash.sql';
const refusedByRls = 'the database skipped them under row level security. Managing products needs the manage_shop capability (Administrator or Shop Manager).';

const statusLabels: Record<string, string> = { publish: 'Published', draft: 'Draft', pending: 'Pending review', private: 'Private', trash: 'Trash' };
const stockLabels: Record<string, string> = { instock: 'In stock', outofstock: 'Out of stock', onbackorder: 'On backorder' };
const visibilityLabels: Record<string, string> = { visible: 'Shop and search results', catalog: 'Shop only', search: 'Search results only', hidden: 'Hidden' };

/** Bulk writes name the migration when the database does not know the "trash" status yet. */
const explainBulkError = (error: unknown) => {
  const message = explainShopError(error);
  return /shop_products_status_check|violates check constraint.*status/i.test(message)
    ? `The database does not accept the "trash" product status yet. Run ${trashMigration} in the Supabase SQL Editor, then reload. Re-running it is safe.`
    : message;
};

function ProductList({ onEdit }: { onEdit: (id: string | null) => void }) {
  const { settings } = useShopSettings();
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [trashCount, setTrashCount] = useState(0);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [moreAction, setMoreAction] = useState('');
  const inTrash = status === 'trash';

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    let query = supabase
      .from('shop_products')
      .select('*, shop_product_categories(shop_categories(name)), shop_variations(regular_price,sale_price,sale_from,sale_to,stock_quantity,manage_stock)')
      .order('created_at', { ascending: false })
      .limit(500);
    // Trashed products only show in the Trash view.
    if (status) query = query.eq('status', status);
    else query = query.neq('status', 'trash');
    if (type) query = query.eq('type', type);
    if (search.trim()) query = query.or(`name.ilike.%${search.trim().replace(/[,()]/g, ' ')}%,sku.ilike.%${search.trim().replace(/[,()]/g, ' ')}%`);
    const [{ data, error: loadError }, { count }] = await Promise.all([
      query,
      supabase.from('shop_products').select('id', { count: 'exact', head: true }).eq('status', 'trash'),
    ]);
    if (loadError) setError(explainShopError(loadError));
    else setRows((data || []) as ProductRow[]);
    setTrashCount(count || 0);
    setLoading(false);
  }, [search, status, type]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void getSupabaseClient().from('shop_categories').select('id,name').order('name')
      .then(({ data }) => setCategories((data || []) as Array<{ id: string; name: string }>));
  }, []);

  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const selection = useBulkSelection(rowIds);

  /** Reports how many of the requested products a write actually changed (RLS skips rows silently). */
  const report = (verb: string, requested: number, changed: number, extra = '') => {
    const result = describeBulkResult(verb, requested, changed, requested === 1 ? 'product' : 'products', refusedByRls);
    setSuccess(result.success ? `${result.success}${extra}` : '');
    setError(result.error);
  };

  const updateProducts = async (ids: string[], changes: Partial<Product>, verb: string, extra = '') => {
    const { data, error: updateError } = await getSupabaseClient().from('shop_products').update(changes).in('id', ids).select('id');
    if (updateError) throw updateError;
    report(verb, ids.length, (data || []).length, extra);
  };

  const runBulk = async (action: string, ids: string[]) => {
    const targets = rows.filter((row) => ids.includes(row.id));
    if (!targets.length) return;
    const targetIds = targets.map((row) => row.id);
    if (action === 'export') return exportProducts(targets);
    if (action === 'delete' && !window.confirm(`Permanently delete ${targets.length === 1 ? `"${targets[0].name}"` : `${targets.length} products`}? Existing orders keep their line items. This cannot be undone.`)) return;
    setError(''); setSuccess(''); setBusy(action);
    try {
      const [kind, value] = action.split(':');
      if (action === 'publish') await updateProducts(targetIds, { status: 'publish' }, 'Published');
      else if (action === 'draft' || action === 'restore') await updateProducts(targetIds, { status: 'draft' }, action === 'restore' ? 'Restored as draft' : 'Moved to draft');
      else if (action === 'trash') await updateProducts(targetIds, { status: 'trash' as Product['status'] }, 'Moved to Trash');
      else if (action === 'feature') await updateProducts(targetIds, { featured: true }, 'Marked as featured:');
      else if (action === 'unfeature') await updateProducts(targetIds, { featured: false }, 'Removed featured from');
      else if (kind === 'status') await updateProducts(targetIds, { status: value as Product['status'] }, `Set to ${statusLabels[value]}:`);
      else if (kind === 'visibility') await updateProducts(targetIds, { catalog_visibility: value as Product['catalog_visibility'] }, `Catalog visibility set to “${visibilityLabels[value]}” for`);
      else if (kind === 'stock') {
        const managed = targets.filter((row) => row.manage_stock && row.stock_quantity !== null).length;
        // shop_stock_guard recalculates stock_status from the quantity for managed-stock products.
        await updateProducts(targetIds, { stock_status: value as Product['stock_status'] }, `Stock status set to ${stockLabels[value]} for`,
          managed ? ` ${managed} of them track stock quantity, so their status still follows the quantity.` : '');
      } else if (kind === 'addcat' || kind === 'removecat') {
        const supabase = getSupabaseClient();
        const categoryName = categories.find((category) => category.id === value)?.name || 'the category';
        if (kind === 'addcat') {
          const { data, error: linkError } = await supabase.from('shop_product_categories')
            .upsert(targetIds.map((id) => ({ product_id: id, category_id: value })), { onConflict: 'product_id,category_id', ignoreDuplicates: true })
            .select('product_id');
          if (linkError) throw linkError;
          const alreadyIn = targets.length - (data || []).length;
          setSuccess(`Added ${(data || []).length} product(s) to “${categoryName}”.${alreadyIn ? ` ${alreadyIn} were already in it.` : ''}`);
        } else {
          const { data, error: unlinkError } = await supabase.from('shop_product_categories')
            .delete().eq('category_id', value).in('product_id', targetIds).select('product_id');
          if (unlinkError) throw unlinkError;
          setSuccess(`Removed ${(data || []).length} product(s) from “${categoryName}”.`);
        }
      } else if (action === 'delete') {
        const { data, error: deleteError } = await getSupabaseClient().from('shop_products').delete().in('id', targetIds).select('id');
        if (deleteError) throw deleteError;
        report('Permanently deleted', targetIds.length, (data || []).length);
      }
      selection.clear();
      setMoreAction('');
      await load();
    } catch (bulkError) {
      setError(explainBulkError(bulkError));
    } finally {
      setBusy('');
    }
  };

  const emptyTrash = async () => {
    if (!window.confirm(`Permanently delete all ${trashCount} product(s) in the Trash? Existing orders keep their line items. This cannot be undone.`)) return;
    setError(''); setSuccess(''); setBusy('empty');
    const { data, error: deleteError } = await getSupabaseClient().from('shop_products').delete().eq('status', 'trash').select('id');
    if (deleteError) setError(explainBulkError(deleteError));
    else report('Permanently deleted', trashCount, (data || []).length);
    setBusy('');
    selection.clear();
    await load();
  };

  const exportProducts = (targets: ProductRow[]) => {
    downloadCsv(`products-${new Date().toISOString().slice(0, 10)}.csv`,
      ['ID', 'Name', 'SKU', 'Type', 'Status', 'Featured', 'Regular price', 'Sale price', 'Stock status', 'Stock quantity', 'Categories', 'Total sales', 'URL'],
      targets.map((row) => [
        row.id, row.name, row.sku, row.type, statusLabels[row.status] || row.status, row.featured ? 'yes' : 'no',
        row.regular_price, row.sale_price, stockLabels[row.stock_status] || row.stock_status, row.manage_stock ? row.stock_quantity : '',
        row.shop_product_categories.map((link) => link.shop_categories?.name).filter(Boolean).join(', '), row.total_sales,
        `${window.location.origin}/product/${row.slug}`,
      ]));
    setSuccess(`Exported ${targets.length} product(s) to CSV.`);
  };

  const remove = (product: ProductRow) => void runBulk('delete', [product.id]);

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
            <option value="trash">Trash ({trashCount})</option>
          </select>
          <select className={styles.select} style={{ width: 150 }} value={type} onChange={(event) => setType(event.target.value)} aria-label="Product type">
            <option value="">All types</option>
            <option value="simple">Simple</option>
            <option value="variable">Variable</option>
            <option value="grouped">Grouped</option>
            <option value="external">External/Affiliate</option>
          </select>
          {inTrash && trashCount > 0 && (
            <button type="button" className={styles.buttonDanger} disabled={Boolean(busy)} onClick={() => void emptyTrash()}>
              {busy === 'empty' ? 'Emptying…' : 'Empty Trash'}
            </button>
          )}
        </div>
        <button type="button" className={styles.button} onClick={() => onEdit(null)}>Add new product</button>
      </div>
      <Feedback error={error} success={success} />
      {!loading && (
        <BulkBar selection={selection} total={rows.length} noun="products" busy={busy} onAction={(id, ids) => void runBulk(id, ids)}
          actions={inTrash
            ? [{ id: 'restore', label: 'Restore', tone: 'primary' }, { id: 'delete', label: 'Delete permanently', tone: 'danger' }]
            : [
              { id: 'publish', label: 'Publish', tone: 'primary', hidden: status === 'publish' },
              { id: 'draft', label: 'Move to draft', hidden: status === 'draft' },
              { id: 'export', label: 'Export CSV' },
              { id: 'trash', label: 'Move to Trash', tone: 'danger' },
            ]}>
          {!inTrash && (
            <BulkInline>
              <select value={moreAction} onChange={(event) => setMoreAction(event.target.value)} aria-label="More bulk actions">
                <option value="">More actions…</option>
                <optgroup label="Status">
                  <option value="status:pending">Set to Pending review</option>
                  <option value="status:private">Set to Private</option>
                </optgroup>
                <optgroup label="Featured">
                  <option value="feature">Mark as featured</option>
                  <option value="unfeature">Remove featured</option>
                </optgroup>
                <optgroup label="Stock status">
                  {Object.entries(stockLabels).map(([value, label]) => <option key={value} value={`stock:${value}`}>{label}</option>)}
                </optgroup>
                <optgroup label="Catalog visibility">
                  {Object.entries(visibilityLabels).map(([value, label]) => <option key={value} value={`visibility:${value}`}>{label}</option>)}
                </optgroup>
                {categories.length > 0 && (
                  <optgroup label="Add to category">
                    {categories.map((category) => <option key={category.id} value={`addcat:${category.id}`}>+ {category.name}</option>)}
                  </optgroup>
                )}
                {categories.length > 0 && (
                  <optgroup label="Remove from category">
                    {categories.map((category) => <option key={category.id} value={`removecat:${category.id}`}>− {category.name}</option>)}
                  </optgroup>
                )}
              </select>
              <button type="button" className={styles.buttonSecondary} disabled={!moreAction || Boolean(busy)}
                onClick={() => void runBulk(moreAction, selection.selected)}>
                {busy && busy === moreAction ? 'Applying…' : 'Apply'}
              </button>
            </BulkInline>
          )}
        </BulkBar>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th style={{ width: 1 }}><SelectAllCheckbox selection={selection} total={rows.length} /></th><th /><th>Name</th><th>SKU</th><th>Stock</th><th>Price</th><th>Categories</th><th>Sales</th><th>Status</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className={styles.muted}>Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={9} className={styles.muted}>{inTrash ? 'The Trash is empty.' : 'No products found. Add your first product to start selling.'}</td></tr>}
            {rows.map((row) => (
              <tr key={row.id} style={selection.isSelected(row.id) ? { background: '#eef2ff' } : undefined}>
                <td><RowCheckbox selection={selection} id={row.id} label={row.name} /></td>
                <td>{row.image_url ? <img className={styles.thumb} src={row.image_url} alt="" /> : <span className={styles.thumb} style={{ display: 'inline-block' }} />}</td>
                <td>
                  <button type="button" className={styles.buttonLink} onClick={() => onEdit(row.id)}>{row.name}</button>
                  {row.featured && <span title="Featured"> ★</span>}
                  {row.status === 'trash' ? (
                    <div className={styles.rowActions}>
                      <button type="button" className={styles.buttonLink} disabled={Boolean(busy)} onClick={() => void runBulk('restore', [row.id])}>Restore</button>
                      <button type="button" className={styles.buttonLink} style={{ color: '#b91c1c' }} disabled={Boolean(busy)} onClick={() => remove(row)}>Delete permanently</button>
                    </div>
                  ) : (
                  <div className={styles.rowActions}>
                    <button type="button" className={styles.buttonLink} onClick={() => onEdit(row.id)}>Edit</button>
                    <button type="button" className={styles.buttonLink} onClick={() => void duplicate(row)}>Duplicate</button>
                    <a className={styles.buttonLink} href={`/product/${row.slug}`} target="_blank" rel="noreferrer">View</a>
                    <button type="button" className={styles.buttonLink} title={`[rwp_add_to_cart id="${row.id}"]`}
                      onClick={() => {
                        const code = `[rwp_add_to_cart id="${row.id}"]`;
                        void navigator.clipboard?.writeText(code).then(() => window.alert(`Copied ${code}`), () => window.prompt('Copy this shortcode', code));
                      }}>Copy shortcode</button>
                    <button type="button" className={styles.buttonLink} style={{ color: '#b91c1c' }} disabled={Boolean(busy)} onClick={() => void runBulk('trash', [row.id])}>Trash</button>
                  </div>
                  )}
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
