import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { RwpRouteProps } from '../../../src/lib/plugin-api';
import { getSupabaseClient } from '../../../src/lib/db';
import { explainShopError, fetchCatalog, fetchCategories } from '../lib/api';
import { useShopSettings } from '../lib/settings';
import type { CatalogResult, Taxonomy } from '../lib/types';
import { Breadcrumbs, PageShell, ProductCard } from './components';
import styles from './shop.module.css';

const sortOptions: Array<[string, string]> = [
  ['menu_order', 'Default sorting'],
  ['popularity', 'Sort by popularity'],
  ['rating', 'Sort by average rating'],
  ['date', 'Sort by latest'],
  ['price', 'Sort by price: low to high'],
  ['price-desc', 'Sort by price: high to low'],
];

interface AttributeWithTerms {
  id: string;
  name: string;
  shop_attribute_terms: Array<{ name: string; slug: string; menu_order: number }>;
}

/** Shared by /shop, /product-category/:slug and /product-tag/:slug. */
export default function ShopPage({ params }: RwpRouteProps) {
  const { settings, ready } = useShopSettings();
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const path = window.location.pathname;
  const categorySlug = path.startsWith('/product-category/') ? params.slug : '';
  const tagSlug = path.startsWith('/product-tag/') ? params.slug : '';

  const [result, setResult] = useState<CatalogResult | null>(null);
  const [categories, setCategories] = useState<Taxonomy[]>([]);
  const [tagName, setTagName] = useState('');
  const [attributes, setAttributes] = useState<AttributeWithTerms[]>([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(query.get('s') || '');
  const [minPrice, setMinPrice] = useState(query.get('min_price') || '');
  const [maxPrice, setMaxPrice] = useState(query.get('max_price') || '');

  const page = Math.max(Number(query.get('page')) || 1, 1);
  const orderby = query.get('orderby') || '';
  const selectedAttributes = useMemo(() => {
    const selected: Record<string, string[]> = {};
    query.forEach((value, key) => {
      if (key.startsWith('filter_') && value) selected[key.slice(7)] = value.split(',');
    });
    return selected;
  }, [query]);

  useEffect(() => {
    if (!ready) return;
    let mounted = true;
    Promise.all([
      fetchCatalog({
        search: query.get('s') || undefined,
        category: categorySlug || undefined,
        tag: tagSlug || undefined,
        attributes: selectedAttributes,
        min_price: query.get('min_price') ? Number(query.get('min_price')) : null,
        max_price: query.get('max_price') ? Number(query.get('max_price')) : null,
        on_sale: query.get('on_sale') === '1',
        orderby: orderby || settings.default_orderby,
        page,
        per_page: settings.products_per_page,
      }),
      fetchCategories(),
      getSupabaseClient().from('shop_attributes').select('id,name,shop_attribute_terms(name,slug,menu_order)').order('name'),
      tagSlug ? getSupabaseClient().from('shop_tags').select('name').eq('slug', tagSlug).maybeSingle() : Promise.resolve({ data: null }),
    ])
      .then(([catalog, loadedCategories, attributeResult, tagResult]) => {
        if (!mounted) return;
        setResult(catalog);
        setCategories(loadedCategories);
        setAttributes((attributeResult.data || []) as AttributeWithTerms[]);
        setTagName((tagResult.data as { name?: string } | null)?.name || tagSlug);
      })
      .catch((loadError: unknown) => { if (mounted) setError(explainShopError(loadError)); });
    return () => { mounted = false; };
  }, [ready, settings, query, categorySlug, tagSlug, page, orderby, selectedAttributes]);

  const category = categories.find((item) => item.slug === categorySlug);
  const title = category?.name || (tagSlug ? `Products tagged “${tagName}”` : query.get('s') ? `Search results: “${query.get('s')}”` : settings.shop_page_title);

  useEffect(() => {
    document.title = title;
  }, [title]);

  const navigate = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(window.location.search);
    Object.entries(changes).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)));
    if (!('page' in changes)) next.delete('page');
    window.location.search = next.toString();
  };

  const submitFilters = (event: FormEvent) => {
    event.preventDefault();
    navigate({ s: search.trim() || null, min_price: minPrice || null, max_price: maxPrice || null });
  };

  const toggleTerm = (attribute: string, term: string) => {
    const current = selectedAttributes[attribute] || [];
    const next = current.includes(term) ? current.filter((value) => value !== term) : [...current, term];
    navigate({ [`filter_${attribute}`]: next.join(',') || null });
  };

  const totalPages = result ? Math.max(Math.ceil(result.total / result.per_page), 1) : 1;
  const topLevel = categories.filter((item) => !item.parent_id);

  return (
    <PageShell>
      <Breadcrumbs items={category || tagSlug ? [{ label: settings.shop_page_title, href: '/shop' }, { label: title }] : [{ label: title }]} />
      <h1 className={styles.heading}>{title}</h1>
      {(category?.description || (!categorySlug && !tagSlug && settings.shop_page_description)) && (
        <p className={styles.lead}>{category?.description || settings.shop_page_description}</p>
      )}
      {error && <div className={styles.error} role="alert">{error}</div>}

      <div className={styles.archiveLayout}>
        <aside className={styles.filters} aria-label="Product filters">
          <form className={styles.filterGroup} onSubmit={submitFilters}>
            <h3>Search products</h3>
            <input className={styles.input} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products…" aria-label="Search products" />
            <h3 style={{ marginTop: 18 }}>Filter by price</h3>
            <div className={styles.priceRange}>
              <input className={styles.input} type="number" min="0" inputMode="decimal" value={minPrice} onChange={(event) => setMinPrice(event.target.value)}
                placeholder={result?.price_bounds.min !== null && result ? String(Math.floor(Number(result.price_bounds.min))) : 'Min'} aria-label="Minimum price" />
              <input className={styles.input} type="number" min="0" inputMode="decimal" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)}
                placeholder={result?.price_bounds.max !== null && result ? String(Math.ceil(Number(result.price_bounds.max))) : 'Max'} aria-label="Maximum price" />
            </div>
            <button type="submit" className={styles.buttonSecondary} style={{ marginTop: 10, width: '100%' }}>Filter</button>
          </form>

          {topLevel.length > 0 && (
            <div className={styles.filterGroup}>
              <h3>Product categories</h3>
              <ul>
                {topLevel.map((item) => (
                  <li key={item.id}>
                    <a href={`/product-category/${item.slug}`} aria-current={item.slug === categorySlug ? 'page' : undefined}>{item.name}</a>
                    {categories.some((child) => child.parent_id === item.id) && (
                      <ul style={{ paddingLeft: 12, marginTop: 6 }}>
                        {categories.filter((child) => child.parent_id === item.id).map((child) => (
                          <li key={child.id}>
                            <a href={`/product-category/${child.slug}`} aria-current={child.slug === categorySlug ? 'page' : undefined}>{child.name}</a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {attributes.filter((attribute) => attribute.shop_attribute_terms.length).map((attribute) => (
            <div key={attribute.id} className={styles.filterGroup}>
              <h3>Filter by {attribute.name}</h3>
              <ul>
                {[...attribute.shop_attribute_terms].sort((a, b) => a.menu_order - b.menu_order).map((term) => (
                  <li key={term.slug}>
                    <label className={styles.check}>
                      <input type="checkbox" checked={(selectedAttributes[attribute.name] || []).includes(term.name)}
                        onChange={() => toggleTerm(attribute.name, term.name)} />
                      {term.name}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className={styles.filterGroup}>
            <label className={styles.check}>
              <input type="checkbox" checked={query.get('on_sale') === '1'} onChange={(event) => navigate({ on_sale: event.target.checked ? '1' : null })} />
              On sale only
            </label>
          </div>
        </aside>

        <section aria-live="polite">
          <div className={styles.toolbar}>
            <span className={styles.muted}>
              {result ? (result.total === 0 ? 'No products found' : `Showing ${(page - 1) * result.per_page + 1}–${Math.min(page * result.per_page, result.total)} of ${result.total} results`) : 'Loading products…'}
            </span>
            <select className={styles.select} value={orderby || settings.default_orderby} onChange={(event) => navigate({ orderby: event.target.value })} aria-label="Sort products">
              {sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>

          {result && result.products.length === 0 && (
            <div className={styles.notice}>No products were found matching your selection.</div>
          )}
          <div className={styles.grid}>
            {result?.products.map((product) => <ProductCard key={product.id} product={product} settings={settings} />)}
          </div>

          {totalPages > 1 && (
            <nav className={styles.pagination} aria-label="Pagination">
              {Array.from({ length: totalPages }, (_, index) => index + 1).map((number) => (
                number === page
                  ? <span key={number} aria-current="page">{number}</span>
                  : <a key={number} href={`?${new URLSearchParams({ ...Object.fromEntries(query), page: String(number) })}`}>{number}</a>
              ))}
            </nav>
          )}
        </section>
      </div>
    </PageShell>
  );
}
