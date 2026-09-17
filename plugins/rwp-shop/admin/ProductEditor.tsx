import { useEffect, useMemo, useState } from 'react';
import ClassicEditor from '../../../src/components/ClassicEditor';
import { getSupabaseClient } from '../../../src/lib/db';
import { explainShopError } from '../lib/api';
import { useShopSettings } from '../lib/settings';
import type { Product, ProductAttribute, Taxonomy, Variation } from '../lib/types';
import { Feedback, Field, GalleryPicker, ImagePicker, numberOrNull, slugify, TagInput, Tabs } from './common';
import styles from './admin.module.css';

type DataTab = 'general' | 'inventory' | 'shipping' | 'linked' | 'attributes' | 'variations' | 'downloads' | 'advanced' | 'seo';

type DraftVariation = Omit<Variation, 'id' | 'product_id'> & { id?: string; _key: string };
interface DraftDownload { id?: string; name: string; url: string; variation_id: string | null }

const blankProduct = (): Omit<Product, 'id' | 'created_at' | 'updated_at'> => ({
  name: '', slug: '', type: 'simple', status: 'draft', featured: false, catalog_visibility: 'visible',
  description: '', short_description: '', sku: null, regular_price: null, sale_price: null, sale_from: null, sale_to: null,
  tax_status: 'taxable', tax_class: 'standard', manage_stock: false, stock_quantity: null, stock_status: 'instock',
  backorders: 'no', low_stock_amount: null, sold_individually: false, weight: null, length: null, width: null, height: null,
  shipping_class_id: null, virtual: false, downloadable: false, download_limit: null, download_expiry_days: null,
  external_url: null, button_text: null, grouped_ids: [], upsell_ids: [], cross_sell_ids: [], attributes: [],
  default_attributes: {}, image_url: null, gallery: [], purchase_note: null, reviews_allowed: true, menu_order: 0,
  total_sales: 0, average_rating: 0, rating_count: 0, seo_title: null, meta_description: null,
});

const blankVariation = (attributes: Record<string, string>): DraftVariation => ({
  _key: Math.random().toString(36).slice(2), attributes, sku: null, regular_price: null, sale_price: null,
  sale_from: null, sale_to: null, manage_stock: false, stock_quantity: null, stock_status: 'instock', backorders: 'no',
  weight: null, length: null, width: null, height: null, shipping_class_id: null, tax_class: null, virtual: false,
  downloadable: false, image_url: null, description: '', enabled: true, menu_order: 0,
});

const toDateInput = (value: string | null) => (value ? value.slice(0, 10) : '');
const fromDateInput = (value: string, endOfDay = false) => (value ? new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}`).toISOString() : null);

function ProductPicker({ value, onChange, excludeId }: { value: string[]; onChange: (ids: string[]) => void; excludeId?: string }) {
  const [options, setOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [search, setSearch] = useState('');
  useEffect(() => {
    void getSupabaseClient().from('shop_products').select('id,name').order('name').limit(1000)
      .then(({ data }) => setOptions((data || []).filter((row) => row.id !== excludeId)));
  }, [excludeId]);
  const selected = options.filter((option) => value.includes(option.id));
  const matches = search.trim() ? options.filter((option) => !value.includes(option.id) && option.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8) : [];
  return (
    <div className={styles.boxed} style={{ padding: 8 }}>
      <div className={styles.pillList}>
        {selected.map((option) => (
          <span key={option.id} className={styles.pill}>{option.name}
            <button type="button" aria-label={`Remove ${option.name}`} onClick={() => onChange(value.filter((id) => id !== option.id))}>×</button>
          </span>
        ))}
      </div>
      <input className={styles.input} placeholder="Search for a product…" value={search} onChange={(event) => setSearch(event.target.value)} />
      {matches.map((option) => (
        <button key={option.id} type="button" className={styles.buttonLink} style={{ justifyContent: 'flex-start' }}
          onClick={() => { onChange([...value, option.id]); setSearch(''); }}>+ {option.name}</button>
      ))}
    </div>
  );
}

export default function ProductEditor({ productId, onClose, onSaved }: { productId: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { settings } = useShopSettings();
  const [product, setProduct] = useState(blankProduct());
  const [slugTouched, setSlugTouched] = useState(false);
  const [categories, setCategories] = useState<Taxonomy[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [globalAttributes, setGlobalAttributes] = useState<Array<{ id: string; name: string; shop_attribute_terms: Array<{ name: string }> }>>([]);
  const [shippingClasses, setShippingClasses] = useState<Taxonomy[]>([]);
  const [variations, setVariations] = useState<DraftVariation[]>([]);
  const [removedVariationIds, setRemovedVariationIds] = useState<string[]>([]);
  const [downloads, setDownloads] = useState<DraftDownload[]>([]);
  const [removedDownloadIds, setRemovedDownloadIds] = useState<string[]>([]);
  const [tab, setTab] = useState<DataTab>('general');
  const [loading, setLoading] = useState(Boolean(productId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const set = <K extends keyof typeof product>(key: K, value: (typeof product)[K]) => setProduct((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    const supabase = getSupabaseClient();
    void Promise.all([
      supabase.from('shop_categories').select('*').order('name'),
      supabase.from('shop_attributes').select('id,name,shop_attribute_terms(name)').order('name'),
      supabase.from('shop_shipping_classes').select('*').order('name'),
    ]).then(([categoryResult, attributeResult, classResult]) => {
      setCategories((categoryResult.data || []) as Taxonomy[]);
      setGlobalAttributes((attributeResult.data || []) as typeof globalAttributes);
      setShippingClasses((classResult.data || []) as Taxonomy[]);
    });
  }, []);

  useEffect(() => {
    if (!productId) return;
    let mounted = true;
    const supabase = getSupabaseClient();
    void Promise.all([
      supabase.from('shop_products').select('*, shop_product_categories(category_id), shop_product_tags(shop_tags(name))').eq('id', productId).single(),
      supabase.from('shop_variations').select('*').eq('product_id', productId).order('menu_order'),
      supabase.from('shop_product_downloads').select('*').eq('product_id', productId).order('created_at'),
    ]).then(([productResult, variationResult, downloadResult]) => {
      if (!mounted) return;
      if (productResult.error) {
        setError(explainShopError(productResult.error));
      } else {
        const { shop_product_categories: links, shop_product_tags: tags, ...row } = productResult.data as Product & {
          shop_product_categories: Array<{ category_id: string }>;
          shop_product_tags: Array<{ shop_tags: { name: string } | null }>;
        };
        setProduct({ ...blankProduct(), ...row });
        setSlugTouched(true);
        setCategoryIds(links.map((link) => link.category_id));
        setTagNames(tags.map((link) => link.shop_tags?.name).filter((name): name is string => Boolean(name)));
      }
      setVariations(((variationResult.data || []) as Variation[]).map((variation) => ({ ...variation, _key: variation.id })));
      setDownloads((downloadResult.data || []) as DraftDownload[]);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [productId]);

  const variationAttributes = useMemo(() => product.attributes.filter((attribute) => attribute.variation && attribute.options.length), [product.attributes]);

  const updateAttribute = (index: number, changes: Partial<ProductAttribute>) =>
    set('attributes', product.attributes.map((attribute, i) => (i === index ? { ...attribute, ...changes } : attribute)));

  const generateVariations = () => {
    const combos = variationAttributes.reduce<Array<Record<string, string>>>(
      (acc, attribute) => acc.flatMap((combo) => attribute.options.map((option) => ({ ...combo, [attribute.name]: option }))),
      [{}],
    );
    const existing = new Set(variations.map((variation) => JSON.stringify(variation.attributes, Object.keys(variation.attributes).sort())));
    const created = combos
      .filter((combo) => !existing.has(JSON.stringify(combo, Object.keys(combo).sort())))
      .map((combo) => blankVariation(combo));
    if (created.length > 100 && !window.confirm(`This creates ${created.length} variations. Continue?`)) return;
    setVariations([...variations, ...created]);
    setSuccess(created.length ? `${created.length} variation${created.length === 1 ? '' : 's'} added. Set their prices, then save.` : 'Every combination already has a variation.');
  };

  const updateVariation = (key: string, changes: Partial<DraftVariation>) =>
    setVariations((current) => current.map((variation) => (variation._key === key ? { ...variation, ...changes } : variation)));

  const save = async (nextStatus?: Product['status']) => {
    setError('');
    setSuccess('');
    if (!product.name.trim()) return setError('The product needs a name.');
    const slug = slugify(product.slug || product.name);
    if (!slug) return setError('The product needs a URL slug made of letters or numbers.');
    if (product.sale_price !== null && product.regular_price !== null && Number(product.sale_price) >= Number(product.regular_price)) {
      return setError('The sale price must be lower than the regular price.');
    }
    if (product.type === 'external' && !product.external_url) return setError('External products need a product URL.');

    setSaving(true);
    const supabase = getSupabaseClient();
    try {
      // Counters are maintained by the database (sales on payment, ratings on review approval);
      // sending the values loaded into this form would overwrite newer ones.
      const {
        total_sales: _sales, average_rating: _rating, rating_count: _ratingCount, ...editable
      } = product as typeof product & { id?: string; created_at?: string; updated_at?: string };
      void _sales; void _rating; void _ratingCount;
      const { id: _id, created_at: _created, updated_at: _updated, ...fields } = editable as typeof editable & { id?: string; created_at?: string; updated_at?: string };
      void _id; void _created; void _updated;
      const payload = { ...fields, slug, status: nextStatus || product.status, sku: product.sku?.trim() || null };
      const { data: saved, error: saveError } = productId
        ? await supabase.from('shop_products').update(payload).eq('id', productId).select('id').maybeSingle()
        : await supabase.from('shop_products').insert(payload).select('id').maybeSingle();
      if (saveError) {
        if (saveError.code === '23505') throw new Error(saveError.message.includes('sku') ? 'Another product already uses this SKU.' : 'Another product already uses this URL slug.');
        throw new Error(explainShopError(saveError));
      }
      if (!saved) throw new Error('The database saved nothing: row level security blocked the write. Your role needs the manage_shop capability.');
      const id = saved.id as string;

      // Categories
      await supabase.from('shop_product_categories').delete().eq('product_id', id);
      if (categoryIds.length) {
        const { error: categoryError } = await supabase.from('shop_product_categories').insert(categoryIds.map((categoryId) => ({ product_id: id, category_id: categoryId })));
        if (categoryError) throw new Error(`Product saved, but its categories were not: ${explainShopError(categoryError)}`);
      }

      // Tags: create any that do not exist yet.
      await supabase.from('shop_product_tags').delete().eq('product_id', id);
      if (tagNames.length) {
        const wanted = tagNames.map((name) => ({ name, slug: slugify(name) })).filter((tag) => tag.slug);
        const { data: existingTags } = await supabase.from('shop_tags').select('id,slug').in('slug', wanted.map((tag) => tag.slug));
        const missing = wanted.filter((tag) => !(existingTags || []).some((existing) => existing.slug === tag.slug));
        let created: Array<{ id: string; slug: string }> = [];
        if (missing.length) {
          const { data: inserted, error: tagError } = await supabase.from('shop_tags').insert(missing).select('id,slug');
          if (tagError) throw new Error(`Product saved, but its tags were not: ${explainShopError(tagError)}`);
          created = inserted || [];
        }
        const allTags = [...(existingTags || []), ...created];
        await supabase.from('shop_product_tags').insert(allTags.map((tag) => ({ product_id: id, tag_id: tag.id })));
      }

      // Variations
      if (removedVariationIds.length) await supabase.from('shop_variations').delete().in('id', removedVariationIds);
      if (product.type === 'variable') {
        for (const [index, draft] of variations.entries()) {
          const { _key, id: variationId, ...fields } = draft;
          void _key;
          const row = { ...fields, product_id: id, menu_order: index, sku: fields.sku?.trim() || null };
          const result = variationId
            ? await supabase.from('shop_variations').update(row).eq('id', variationId).select('id').maybeSingle()
            : await supabase.from('shop_variations').insert(row).select('id').maybeSingle();
          if (result.error) throw new Error(`Product saved, but variation ${index + 1} was not: ${explainShopError(result.error)}`);
        }
      }

      // Downloads
      if (removedDownloadIds.length) await supabase.from('shop_product_downloads').delete().in('id', removedDownloadIds);
      for (const file of downloads.filter((item) => item.name.trim() && item.url.trim())) {
        const row = { product_id: id, name: file.name.trim(), url: file.url.trim(), variation_id: file.variation_id };
        const result = file.id
          ? await supabase.from('shop_product_downloads').update(row).eq('id', file.id)
          : await supabase.from('shop_product_downloads').insert(row);
        if (result.error) throw new Error(`Product saved, but a download file was not: ${explainShopError(result.error)}`);
      }

      setRemovedVariationIds([]);
      setRemovedDownloadIds([]);
      setSuccess(`Product ${nextStatus === 'publish' ? 'published' : 'saved'}.`);
      if (nextStatus) set('status', nextStatus);
      onSaved(id);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'The product could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className={styles.muted}>Loading product…</p>;

  const dataTabs: Array<[DataTab, string]> = [
    ['general', 'General'],
    ...(product.type === 'simple' || product.type === 'variable' ? [['inventory', 'Inventory'] as [DataTab, string]] : []),
    ...(!product.virtual && product.type !== 'grouped' && product.type !== 'external' ? [['shipping', 'Shipping'] as [DataTab, string]] : []),
    ['linked', 'Linked products'],
    ['attributes', 'Attributes'],
    ...(product.type === 'variable' ? [['variations', `Variations (${variations.length})`] as [DataTab, string]] : []),
    ...(product.downloadable ? [['downloads', 'Downloads'] as [DataTab, string]] : []),
    ['advanced', 'Advanced'],
    ['seo', 'SEO'],
  ];

  const taxClasses = ['standard', ...settings.tax_classes];

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.buttonLink} onClick={onClose}>← All products</button>
        {productId && <a className={styles.buttonSecondary} href={`/product/${product.slug}`} target="_blank" rel="noreferrer">View product</a>}
      </div>
      <Feedback error={error} success={success} />

      <div className={styles.editorLayout}>
        <div className={styles.wrap}>
          <div className={styles.panel}>
            <Field label="Product name">
              <input className={styles.input} style={{ fontSize: '1.1rem' }} value={product.name}
                onChange={(event) => setProduct((current) => ({ ...current, name: event.target.value, slug: slugTouched ? current.slug : slugify(event.target.value) }))} />
            </Field>
            <Field label="URL slug" hint={`/product/${product.slug || 'your-product'}`}>
              <input className={styles.input} value={product.slug} onChange={(event) => { setSlugTouched(true); set('slug', event.target.value); }} />
            </Field>
            <div className={styles.field}>Description</div>
            <ClassicEditor value={product.description} onChange={(value) => set('description', value)} />
          </div>

          <div className={styles.panel}>
            <div className={styles.toolbar}>
              <h2>Product data</h2>
              <div className={styles.toolbarGroup}>
                <select className={styles.select} style={{ width: 190 }} value={product.type} aria-label="Product type"
                  onChange={(event) => set('type', event.target.value as Product['type'])}>
                  <option value="simple">Simple product</option>
                  <option value="variable">Variable product</option>
                  <option value="grouped">Grouped product</option>
                  <option value="external">External/Affiliate product</option>
                </select>
                {(product.type === 'simple' || product.type === 'variable') && (
                  <>
                    <label className={styles.check}><input type="checkbox" checked={product.virtual} onChange={(event) => set('virtual', event.target.checked)} />Virtual</label>
                    <label className={styles.check}><input type="checkbox" checked={product.downloadable} onChange={(event) => set('downloadable', event.target.checked)} />Downloadable</label>
                  </>
                )}
              </div>
            </div>
            <Tabs<DataTab> tabs={dataTabs} active={dataTabs.some(([id]) => id === tab) ? tab : 'general'} onChange={setTab} variant="pills" />

            {tab === 'general' && (
              <div className={styles.grid2}>
                {product.type === 'external' && (
                  <>
                    <Field label="Product URL"><input className={styles.input} type="url" value={product.external_url || ''} onChange={(event) => set('external_url', event.target.value || null)} /></Field>
                    <Field label="Button text"><input className={styles.input} value={product.button_text || ''} placeholder="Buy product" onChange={(event) => set('button_text', event.target.value || null)} /></Field>
                  </>
                )}
                {(product.type === 'simple' || product.type === 'external') && (
                  <>
                    <Field label={`Regular price (${settings.currency})`}><input className={styles.input} type="number" min="0" step="any" value={product.regular_price ?? ''} onChange={(event) => set('regular_price', numberOrNull(event.target.value))} /></Field>
                    <Field label={`Sale price (${settings.currency})`}><input className={styles.input} type="number" min="0" step="any" value={product.sale_price ?? ''} onChange={(event) => set('sale_price', numberOrNull(event.target.value))} /></Field>
                    <Field label="Sale starts" hint="Leave empty to start now"><input className={styles.input} type="date" value={toDateInput(product.sale_from)} onChange={(event) => set('sale_from', fromDateInput(event.target.value))} /></Field>
                    <Field label="Sale ends" hint="Leave empty for no end"><input className={styles.input} type="date" value={toDateInput(product.sale_to)} onChange={(event) => set('sale_to', fromDateInput(event.target.value, true))} /></Field>
                  </>
                )}
                {product.type === 'variable' && <p className={`${styles.muted} ${styles.full}`}>Prices for variable products are set on each variation.</p>}
                {product.type === 'grouped' && <p className={`${styles.muted} ${styles.full}`}>Choose the products in this group under Linked products.</p>}
                {settings.enable_taxes && product.type !== 'grouped' && (
                  <>
                    <Field label="Tax status">
                      <select className={styles.select} value={product.tax_status} onChange={(event) => set('tax_status', event.target.value as Product['tax_status'])}>
                        <option value="taxable">Taxable</option>
                        <option value="shipping">Shipping only</option>
                        <option value="none">None</option>
                      </select>
                    </Field>
                    <Field label="Tax class">
                      <select className={styles.select} value={product.tax_class} onChange={(event) => set('tax_class', event.target.value)}>
                        {taxClasses.map((taxClass) => <option key={taxClass} value={taxClass}>{taxClass}</option>)}
                      </select>
                    </Field>
                  </>
                )}
                {!settings.enable_taxes && <p className={`${styles.muted} ${styles.full}`}>Taxes are disabled in Shop → Settings → Tax.</p>}
              </div>
            )}

            {tab === 'inventory' && (
              <div className={styles.grid2}>
                <Field label="SKU" hint="Unique stock keeping unit"><input className={styles.input} value={product.sku || ''} onChange={(event) => set('sku', event.target.value)} /></Field>
                <div />
                <label className={`${styles.check} ${styles.full}`}>
                  <input type="checkbox" checked={product.manage_stock} onChange={(event) => set('manage_stock', event.target.checked)} />
                  Track stock quantity for this product
                </label>
                {product.manage_stock ? (
                  <>
                    <Field label="Quantity"><input className={styles.input} type="number" step="1" value={product.stock_quantity ?? ''} onChange={(event) => set('stock_quantity', numberOrNull(event.target.value))} /></Field>
                    <Field label="Allow backorders?">
                      <select className={styles.select} value={product.backorders} onChange={(event) => set('backorders', event.target.value as Product['backorders'])}>
                        <option value="no">Do not allow</option>
                        <option value="notify">Allow, but notify customer</option>
                        <option value="yes">Allow</option>
                      </select>
                    </Field>
                    <Field label="Low stock threshold" hint={`Store-wide default: ${settings.low_stock_amount}`}><input className={styles.input} type="number" value={product.low_stock_amount ?? ''} onChange={(event) => set('low_stock_amount', numberOrNull(event.target.value))} /></Field>
                  </>
                ) : (
                  <Field label="Stock status">
                    <select className={styles.select} value={product.stock_status} onChange={(event) => set('stock_status', event.target.value as Product['stock_status'])}>
                      <option value="instock">In stock</option>
                      <option value="outofstock">Out of stock</option>
                      <option value="onbackorder">On backorder</option>
                    </select>
                  </Field>
                )}
                <label className={`${styles.check} ${styles.full}`}>
                  <input type="checkbox" checked={product.sold_individually} onChange={(event) => set('sold_individually', event.target.checked)} />
                  Limit purchases to 1 item per order
                </label>
              </div>
            )}

            {tab === 'shipping' && (
              <div className={styles.grid4}>
                <Field label={`Weight (${settings.weight_unit})`}><input className={styles.input} type="number" step="any" value={product.weight ?? ''} onChange={(event) => set('weight', numberOrNull(event.target.value))} /></Field>
                <Field label={`Length (${settings.dimension_unit})`}><input className={styles.input} type="number" step="any" value={product.length ?? ''} onChange={(event) => set('length', numberOrNull(event.target.value))} /></Field>
                <Field label={`Width (${settings.dimension_unit})`}><input className={styles.input} type="number" step="any" value={product.width ?? ''} onChange={(event) => set('width', numberOrNull(event.target.value))} /></Field>
                <Field label={`Height (${settings.dimension_unit})`}><input className={styles.input} type="number" step="any" value={product.height ?? ''} onChange={(event) => set('height', numberOrNull(event.target.value))} /></Field>
                <Field label="Shipping class" full hint="Shipping classes are managed in Shop → Settings → Shipping.">
                  <select className={styles.select} value={product.shipping_class_id || ''} onChange={(event) => set('shipping_class_id', event.target.value || null)}>
                    <option value="">No shipping class</option>
                    {shippingClasses.map((shippingClass) => <option key={shippingClass.id} value={shippingClass.id}>{shippingClass.name}</option>)}
                  </select>
                </Field>
              </div>
            )}

            {tab === 'linked' && (
              <div className={styles.wrap}>
                {product.type === 'grouped' && <Field label="Grouped products"><ProductPicker value={product.grouped_ids} onChange={(ids) => set('grouped_ids', ids)} excludeId={productId || undefined} /></Field>}
                <Field label="Upsells" hint="Shown on this product's page."><ProductPicker value={product.upsell_ids} onChange={(ids) => set('upsell_ids', ids)} excludeId={productId || undefined} /></Field>
                <Field label="Cross-sells" hint="Shown in the cart when this product is in it."><ProductPicker value={product.cross_sell_ids} onChange={(ids) => set('cross_sell_ids', ids)} excludeId={productId || undefined} /></Field>
              </div>
            )}

            {tab === 'attributes' && (
              <div className={styles.wrap}>
                {product.attributes.map((attribute, index) => (
                  <div key={index} className={styles.boxed}>
                    <div className={styles.grid2}>
                      <Field label="Name">
                        <input className={styles.input} value={attribute.name} onChange={(event) => updateAttribute(index, { name: event.target.value })} disabled={Boolean(attribute.attribute_id)} />
                      </Field>
                      <Field label="Values" hint={attribute.attribute_id ? 'Choose from the global terms, or type new ones.' : 'Type a value and press Enter.'}>
                        <TagInput value={attribute.options} onChange={(options) => updateAttribute(index, { options })} />
                      </Field>
                    </div>
                    {attribute.attribute_id && (
                      <div className={styles.pillList}>
                        {globalAttributes.find((global) => global.id === attribute.attribute_id)?.shop_attribute_terms
                          .filter((term) => !attribute.options.includes(term.name))
                          .map((term) => (
                            <button key={term.name} type="button" className={styles.subTab} onClick={() => updateAttribute(index, { options: [...attribute.options, term.name] })}>+ {term.name}</button>
                          ))}
                      </div>
                    )}
                    <div className={styles.toolbarGroup}>
                      <label className={styles.check}><input type="checkbox" checked={attribute.visible} onChange={(event) => updateAttribute(index, { visible: event.target.checked })} />Visible on the product page</label>
                      {product.type === 'variable' && (
                        <label className={styles.check}><input type="checkbox" checked={attribute.variation} onChange={(event) => updateAttribute(index, { variation: event.target.checked })} />Used for variations</label>
                      )}
                      <button type="button" className={styles.buttonDanger} onClick={() => set('attributes', product.attributes.filter((_, i) => i !== index))}>Remove</button>
                    </div>
                  </div>
                ))}
                <div className={styles.toolbarGroup}>
                  <button type="button" className={styles.buttonSecondary}
                    onClick={() => set('attributes', [...product.attributes, { name: '', attribute_id: null, options: [], visible: true, variation: product.type === 'variable' }])}>
                    Add custom attribute
                  </button>
                  {globalAttributes.filter((global) => !product.attributes.some((attribute) => attribute.attribute_id === global.id)).map((global) => (
                    <button key={global.id} type="button" className={styles.buttonSecondary}
                      onClick={() => set('attributes', [...product.attributes, { name: global.name, attribute_id: global.id, options: [], visible: true, variation: product.type === 'variable' }])}>
                      Add “{global.name}”
                    </button>
                  ))}
                </div>
                {product.type === 'variable' && variationAttributes.length > 0 && (
                  <Field label="Default form values">
                    <div className={styles.grid3}>
                      {variationAttributes.map((attribute) => (
                        <select key={attribute.name} className={styles.select} value={product.default_attributes[attribute.name] || ''}
                          onChange={(event) => set('default_attributes', { ...product.default_attributes, [attribute.name]: event.target.value })}>
                          <option value="">No default {attribute.name}…</option>
                          {attribute.options.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      ))}
                    </div>
                  </Field>
                )}
              </div>
            )}

            {tab === 'variations' && (
              <div className={styles.wrap}>
                {variationAttributes.length === 0 ? (
                  <div className={styles.notice}>Add at least one attribute with “Used for variations” ticked, then come back here.</div>
                ) : (
                  <div className={styles.toolbarGroup}>
                    <button type="button" className={styles.buttonSecondary} onClick={generateVariations}>Generate variations</button>
                    <button type="button" className={styles.buttonSecondary} onClick={() => setVariations([...variations, blankVariation(Object.fromEntries(variationAttributes.map((attribute) => [attribute.name, ''])))])}>Add manually</button>
                  </div>
                )}
                {variations.map((variation, index) => (
                  <details key={variation._key} className={`${styles.boxed} ${styles.details}`}>
                    <summary>
                      #{index + 1} — {variationAttributes.map((attribute) => variation.attributes[attribute.name] || `Any ${attribute.name}`).join(', ')}
                      {variation.regular_price === null && <span className={styles.muted}> (no price — cannot be bought)</span>}
                    </summary>
                    <div className={styles.grid3} style={{ marginTop: 10 }}>
                      {variationAttributes.map((attribute) => (
                        <Field key={attribute.name} label={attribute.name}>
                          <select className={styles.select} value={variation.attributes[attribute.name] || ''}
                            onChange={(event) => updateVariation(variation._key, { attributes: { ...variation.attributes, [attribute.name]: event.target.value } })}>
                            <option value="">Any {attribute.name}…</option>
                            {attribute.options.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </Field>
                      ))}
                      <Field label="SKU"><input className={styles.input} value={variation.sku || ''} onChange={(event) => updateVariation(variation._key, { sku: event.target.value })} /></Field>
                      <Field label="Regular price"><input className={styles.input} type="number" min="0" step="any" value={variation.regular_price ?? ''} onChange={(event) => updateVariation(variation._key, { regular_price: numberOrNull(event.target.value) })} /></Field>
                      <Field label="Sale price"><input className={styles.input} type="number" min="0" step="any" value={variation.sale_price ?? ''} onChange={(event) => updateVariation(variation._key, { sale_price: numberOrNull(event.target.value) })} /></Field>
                      <Field label="Sale starts"><input className={styles.input} type="date" value={toDateInput(variation.sale_from)} onChange={(event) => updateVariation(variation._key, { sale_from: fromDateInput(event.target.value) })} /></Field>
                      <Field label="Sale ends"><input className={styles.input} type="date" value={toDateInput(variation.sale_to)} onChange={(event) => updateVariation(variation._key, { sale_to: fromDateInput(event.target.value, true) })} /></Field>
                      <Field label="Stock status">
                        <select className={styles.select} value={variation.stock_status} disabled={variation.manage_stock} onChange={(event) => updateVariation(variation._key, { stock_status: event.target.value as Variation['stock_status'] })}>
                          <option value="instock">In stock</option>
                          <option value="outofstock">Out of stock</option>
                          <option value="onbackorder">On backorder</option>
                        </select>
                      </Field>
                      <label className={styles.check}><input type="checkbox" checked={variation.enabled} onChange={(event) => updateVariation(variation._key, { enabled: event.target.checked })} />Enabled</label>
                      <label className={styles.check}><input type="checkbox" checked={variation.manage_stock} onChange={(event) => updateVariation(variation._key, { manage_stock: event.target.checked })} />Manage stock</label>
                      <label className={styles.check}><input type="checkbox" checked={variation.virtual} onChange={(event) => updateVariation(variation._key, { virtual: event.target.checked })} />Virtual</label>
                      {variation.manage_stock && (
                        <>
                          <Field label="Stock quantity"><input className={styles.input} type="number" value={variation.stock_quantity ?? ''} onChange={(event) => updateVariation(variation._key, { stock_quantity: numberOrNull(event.target.value) })} /></Field>
                          <Field label="Backorders">
                            <select className={styles.select} value={variation.backorders} onChange={(event) => updateVariation(variation._key, { backorders: event.target.value as Variation['backorders'] })}>
                              <option value="no">Do not allow</option>
                              <option value="notify">Allow, but notify</option>
                              <option value="yes">Allow</option>
                            </select>
                          </Field>
                        </>
                      )}
                      <Field label={`Weight (${settings.weight_unit})`}><input className={styles.input} type="number" step="any" value={variation.weight ?? ''} onChange={(event) => updateVariation(variation._key, { weight: numberOrNull(event.target.value) })} /></Field>
                      <Field label="Shipping class">
                        <select className={styles.select} value={variation.shipping_class_id || ''} onChange={(event) => updateVariation(variation._key, { shipping_class_id: event.target.value || null })}>
                          <option value="">Same as parent</option>
                          {shippingClasses.map((shippingClass) => <option key={shippingClass.id} value={shippingClass.id}>{shippingClass.name}</option>)}
                        </select>
                      </Field>
                      {settings.enable_taxes && (
                        <Field label="Tax class">
                          <select className={styles.select} value={variation.tax_class || ''} onChange={(event) => updateVariation(variation._key, { tax_class: event.target.value || null })}>
                            <option value="">Same as parent</option>
                            {taxClasses.map((taxClass) => <option key={taxClass} value={taxClass}>{taxClass}</option>)}
                          </select>
                        </Field>
                      )}
                      <div className={styles.full}><ImagePicker value={variation.image_url} onChange={(url) => updateVariation(variation._key, { image_url: url })} label="Set variation image" /></div>
                      <Field label="Description" full><textarea className={styles.textarea} value={variation.description} onChange={(event) => updateVariation(variation._key, { description: event.target.value })} /></Field>
                    </div>
                    <button type="button" className={styles.buttonDanger} onClick={() => {
                      if (variation.id) setRemovedVariationIds((current) => [...current, variation.id as string]);
                      setVariations((current) => current.filter((item) => item._key !== variation._key));
                    }}>Remove variation</button>
                  </details>
                ))}
              </div>
            )}

            {tab === 'downloads' && (
              <div className={styles.wrap}>
                <p className={styles.muted}>Buyers receive these files after payment. URLs are never shown in the catalogue; each download is checked against the order, the limit and the expiry.</p>
                {downloads.map((file, index) => (
                  <div key={file.id || index} className={styles.grid3}>
                    <Field label="File name"><input className={styles.input} value={file.name} onChange={(event) => setDownloads(downloads.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))} /></Field>
                    <Field label="File URL"><input className={styles.input} type="url" value={file.url} onChange={(event) => setDownloads(downloads.map((item, i) => (i === index ? { ...item, url: event.target.value } : item)))} /></Field>
                    <div style={{ alignSelf: 'end' }}>
                      <button type="button" className={styles.buttonDanger} onClick={() => {
                        if (file.id) setRemovedDownloadIds((current) => [...current, file.id as string]);
                        setDownloads(downloads.filter((_, i) => i !== index));
                      }}>Remove</button>
                    </div>
                  </div>
                ))}
                <div><button type="button" className={styles.buttonSecondary} onClick={() => setDownloads([...downloads, { name: '', url: '', variation_id: null }])}>Add file</button></div>
                <div className={styles.grid2}>
                  <Field label="Download limit" hint="Leave blank for unlimited downloads."><input className={styles.input} type="number" min="0" value={product.download_limit ?? ''} onChange={(event) => set('download_limit', numberOrNull(event.target.value))} /></Field>
                  <Field label="Download expiry (days)" hint="Leave blank for downloads that never expire."><input className={styles.input} type="number" min="0" value={product.download_expiry_days ?? ''} onChange={(event) => set('download_expiry_days', numberOrNull(event.target.value))} /></Field>
                </div>
              </div>
            )}

            {tab === 'advanced' && (
              <div className={styles.grid2}>
                <Field label="Purchase note" full hint="Shown to the customer after purchase."><textarea className={styles.textarea} value={product.purchase_note || ''} onChange={(event) => set('purchase_note', event.target.value || null)} /></Field>
                <Field label="Menu order" hint="Custom ordering position in the shop."><input className={styles.input} type="number" value={product.menu_order} onChange={(event) => set('menu_order', Number(event.target.value) || 0)} /></Field>
                <label className={styles.check}><input type="checkbox" checked={product.reviews_allowed} onChange={(event) => set('reviews_allowed', event.target.checked)} />Enable reviews</label>
              </div>
            )}

            {tab === 'seo' && (
              <div className={styles.wrap}>
                <Field label="SEO title" hint={`${(product.seo_title || product.name).length} / 60 characters`}><input className={styles.input} value={product.seo_title || ''} placeholder={product.name} onChange={(event) => set('seo_title', event.target.value || null)} /></Field>
                <Field label="Meta description" hint={`${(product.meta_description || '').length} / 160 characters`}><textarea className={styles.textarea} value={product.meta_description || ''} onChange={(event) => set('meta_description', event.target.value || null)} /></Field>
              </div>
            )}
          </div>

          <div className={styles.panel}>
            <h2>Product short description</h2>
            <ClassicEditor value={product.short_description} onChange={(value) => set('short_description', value)} />
          </div>
        </div>

        <aside className={styles.side}>
          <div className={styles.panel}>
            <h3>Publish</h3>
            <Field label="Status">
              <select className={styles.select} value={product.status} onChange={(event) => set('status', event.target.value as Product['status'])}>
                <option value="draft">Draft</option>
                <option value="pending">Pending review</option>
                <option value="private">Private</option>
                <option value="publish">Published</option>
                {product.status === 'trash' && <option value="trash">Trash</option>}
              </select>
            </Field>
            <Field label="Catalog visibility">
              <select className={styles.select} value={product.catalog_visibility} onChange={(event) => set('catalog_visibility', event.target.value as Product['catalog_visibility'])}>
                <option value="visible">Shop and search results</option>
                <option value="catalog">Shop only</option>
                <option value="search">Search results only</option>
                <option value="hidden">Hidden</option>
              </select>
            </Field>
            <label className={styles.check}><input type="checkbox" checked={product.featured} onChange={(event) => set('featured', event.target.checked)} />This is a featured product</label>
            <div className={styles.toolbarGroup}>
              <button type="button" className={styles.buttonSecondary} disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
              {product.status !== 'publish' && <button type="button" className={styles.button} disabled={saving} onClick={() => void save('publish')}>Publish</button>}
            </div>
          </div>

          <div className={styles.panel}>
            <h3>Product categories</h3>
            {categories.length === 0 && <p className={styles.muted}>No categories yet. Add them under Products → Categories.</p>}
            <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
              {categories.map((category) => (
                <label key={category.id} className={styles.check} style={{ paddingLeft: category.parent_id ? 16 : 0 }}>
                  <input type="checkbox" checked={categoryIds.includes(category.id)}
                    onChange={(event) => setCategoryIds(event.target.checked ? [...categoryIds, category.id] : categoryIds.filter((id) => id !== category.id))} />
                  {category.name}
                </label>
              ))}
            </div>
          </div>

          <div className={styles.panel}>
            <h3>Product tags</h3>
            <TagInput value={tagNames} onChange={setTagNames} placeholder="Add tags, separated by commas" />
          </div>

          <div className={styles.panel}>
            <h3>Product image</h3>
            <ImagePicker value={product.image_url} onChange={(url) => set('image_url', url)} label="Set product image" />
          </div>

          <div className={styles.panel}>
            <h3>Product gallery</h3>
            <GalleryPicker value={product.gallery || []} onChange={(urls) => set('gallery', urls)} />
          </div>
        </aside>
      </div>
    </div>
  );
}
