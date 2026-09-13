import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { RwpRouteProps } from '../../../src/lib/plugin-api';
import ContentRenderer from '../../../src/components/ContentRenderer';
import { usePublicChrome } from '../../../src/components/PublicChrome';
import {
  explainShopError, fetchApprovedReviews, fetchCatalog, fetchProductBySlug, submitReview, type ProductDetail,
} from '../lib/api';
import { cart } from '../lib/cart';
import { useShopSettings, type ShopSettings } from '../lib/settings';
import { effectivePrice } from '../lib/pricing';
import type { CatalogProduct, Review, Variation } from '../lib/types';
import { Breadcrumbs, PageShell, PriceHtml, ProductCard, ProductPriceHtml, SaleBadge, Stars } from './components';
import styles from './shop.module.css';

type Tab = 'description' | 'additional' | 'reviews';

const matchesVariation = (variation: Variation, chosen: Record<string, string>) =>
  Object.entries(variation.attributes).every(([name, value]) => !value || chosen[name] === value);

function StockLine({ status, quantity, manage, settings }: { status: string; quantity: number | null; manage: boolean; settings: ShopSettings }) {
  if (status === 'outofstock') return <p className={`${styles.stock} ${styles.outOfStock}`}>Out of stock</p>;
  if (status === 'onbackorder') return <p className={`${styles.stock} ${styles.inStock}`}>Available on backorder</p>;
  if (!manage || quantity === null || settings.stock_format === 'never') return <p className={`${styles.stock} ${styles.inStock}`}>In stock</p>;
  if (settings.stock_format === 'low' && quantity > settings.low_stock_amount) return <p className={`${styles.stock} ${styles.inStock}`}>In stock</p>;
  return <p className={`${styles.stock} ${styles.inStock}`}>{quantity} in stock</p>;
}

function ReviewsPanel({ product, settings }: { product: ProductDetail; settings: ShopSettings }) {
  const { userId, ready } = usePublicChrome();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [rating, setRating] = useState(0);
  const [content, setContent] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchApprovedReviews(product.id).then(setReviews).catch((loadError: unknown) => setError(explainShopError(loadError)));
  }, [product.id]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (settings.review_rating_required && !rating) {
      setError('Please select a rating.');
      return;
    }
    setSaving(true);
    try {
      await submitReview(product.id, rating || null, content.trim());
      setContent('');
      setRating(0);
      setMessage(settings.reviews_require_approval
        ? 'Thank you! Your review is awaiting approval.'
        : 'Thank you for your review!');
      if (!settings.reviews_require_approval) setReviews(await fetchApprovedReviews(product.id));
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : 'Your review could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2>{reviews.length ? `${reviews.length} review${reviews.length === 1 ? '' : 's'} for “${product.name}”` : 'Reviews'}</h2>
      {reviews.length === 0 && <p className={styles.muted}>There are no reviews yet.</p>}
      {reviews.map((review) => (
        <div key={review.id} className={styles.review}>
          {review.rating && <Stars rating={review.rating} />}
          <div>
            <strong>{review.author_name}</strong>
            {settings.show_verified_label && review.verified && <span className={styles.verified}>✓ Verified owner</span>}
            <span className={styles.muted}> — {new Date(review.created_at).toLocaleDateString()}</span>
          </div>
          <p>{review.content}</p>
        </div>
      ))}

      {product.reviews_allowed && (
        <div style={{ marginTop: 28 }}>
          <h3>Add a review</h3>
          {!ready ? null : !userId ? (
            <p>
              You must be <a href={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}>logged in</a> to post a review.
            </p>
          ) : (
            <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
              {message && <div className={styles.success} role="status">{message}</div>}
              {error && <div className={styles.error} role="alert">{error}</div>}
              <fieldset className={styles.fieldset} style={{ margin: 0 }}>
                <legend className={styles.field}>Your rating {settings.review_rating_required && <span className={styles.required}>*</span>}</legend>
                <div role="radiogroup" aria-label="Rating">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} star${value > 1 ? 's' : ''}`}
                      onClick={() => setRating(value)}
                      style={{ border: 0, background: 'none', fontSize: '1.6rem', cursor: 'pointer', color: value <= rating ? '#f59e0b' : '#d1d5db' }}>
                      ★
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className={styles.field}>
                Your review <span className={styles.required}>*</span>
                <textarea className={styles.textarea} required value={content} onChange={(event) => setContent(event.target.value)} />
              </label>
              <div><button type="submit" className={styles.button} disabled={saving}>{saving ? 'Submitting…' : 'Submit'}</button></div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function GroupedChildren({ product, settings }: { product: ProductDetail; settings: ShopSettings }) {
  const [children, setChildren] = useState<CatalogProduct[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!product.grouped_ids.length) return;
    fetchCatalog({ ids: product.grouped_ids, per_page: 100 }).then((result) => setChildren(result.products)).catch(() => setChildren([]));
  }, [product.grouped_ids]);

  const addAll = () => {
    const entries = Object.entries(quantities).filter(([, quantity]) => quantity > 0);
    entries.forEach(([id, quantity]) => cart.add(id, quantity));
    if (entries.length) {
      if (settings.redirect_to_cart) window.location.href = '/cart';
      else setAdded(true);
    }
  };

  return (
    <div>
      <table className={styles.table}>
        <tbody>
          {children.map((child) => (
            <tr key={child.id}>
              <td style={{ width: 90 }}>
                {child.type === 'simple' && child.in_stock ? (
                  <input className={`${styles.input} ${styles.qty}`} type="number" min="0" value={quantities[child.id] || 0}
                    aria-label={`Quantity of ${child.name}`}
                    onChange={(event) => setQuantities((current) => ({ ...current, [child.id]: Math.max(Number(event.target.value) || 0, 0) }))} />
                ) : <a className={styles.buttonLink} href={`/product/${child.slug}`}>View</a>}
              </td>
              <td><a href={`/product/${child.slug}`}>{child.name}</a></td>
              <td><PriceHtml regular={child.regular_price} current={child.price_min} settings={settings} suffix={false} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.addToCart} style={{ marginTop: 12 }}>
        <button type="button" className={styles.button} onClick={addAll}>Add to cart</button>
        {added && <a className={styles.buttonLink} href="/cart">View cart →</a>}
      </div>
    </div>
  );
}

export default function ProductPage({ params }: RwpRouteProps) {
  const { settings, ready } = useShopSettings();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState('');
  const [tab, setTab] = useState<Tab>('description');
  const [added, setAdded] = useState('');
  const [related, setRelated] = useState<CatalogProduct[]>([]);
  const [upsells, setUpsells] = useState<CatalogProduct[]>([]);

  useEffect(() => {
    let mounted = true;
    fetchProductBySlug(params.slug)
      .then((loaded) => {
        if (!mounted) return;
        setProduct(loaded);
        if (loaded) {
          setChosen(loaded.default_attributes || {});
          document.title = loaded.seo_title || loaded.name;
          const description = document.querySelector('meta[name="description"]');
          if (description && (loaded.meta_description || loaded.short_description)) {
            description.setAttribute('content', (loaded.meta_description || loaded.short_description).replace(/<[^>]+>/g, '').slice(0, 160));
          }
        }
      })
      .catch((loadError: unknown) => { if (mounted) setError(explainShopError(loadError)); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [params.slug]);

  useEffect(() => {
    if (!product) return;
    const firstCategory = product.categories[0]?.slug;
    if (firstCategory) {
      fetchCatalog({ category: firstCategory, per_page: 5, orderby: 'popularity' })
        .then((result) => setRelated(result.products.filter((item) => item.id !== product.id).slice(0, 4)))
        .catch(() => setRelated([]));
    }
    if (product.upsell_ids.length) {
      fetchCatalog({ ids: product.upsell_ids, per_page: 4 }).then((result) => setUpsells(result.products)).catch(() => setUpsells([]));
    }
  }, [product]);

  const variationAttributes = useMemo(() => product?.attributes.filter((attribute) => attribute.variation) || [], [product]);
  const allChosen = variationAttributes.every((attribute) => chosen[attribute.name]);
  const variation = useMemo(() => {
    if (!product || product.type !== 'variable' || !allChosen) return null;
    return product.variations.find((item) => matchesVariation(item, chosen)) || null;
  }, [product, chosen, allChosen]);

  if (loading || !ready) return <PageShell><p className={styles.muted}>Loading…</p></PageShell>;
  if (error) return <PageShell><div className={styles.error} role="alert">{error}</div></PageShell>;
  if (!product) {
    return (
      <PageShell>
        <h1 className={styles.heading}>Product not found</h1>
        <p>This product does not exist or is not available. <a href="/shop">Return to the shop</a>.</p>
      </PageShell>
    );
  }

  const images = [product.image_url, ...(product.gallery || [])].filter((url): url is string => Boolean(url));
  const mainImage = variation?.image_url || activeImage || images[0] || settings.placeholder_image;
  const stockSource = variation && variation.manage_stock ? variation : product;
  const stockStatus = variation ? variation.stock_status : product.stock_status;
  const purchasable = product.type === 'simple'
    ? effectivePrice(product) !== null && product.stock_status !== 'outofstock'
    : product.type === 'variable'
      ? Boolean(variation && effectivePrice(variation) !== null && variation.stock_status !== 'outofstock')
      : false;
  const maxQuantity = product.sold_individually ? 1
    : stockSource.manage_stock && stockSource.backorders === 'no' && stockSource.stock_quantity !== null ? stockSource.stock_quantity : undefined;
  const hasAdditional = Boolean(product.weight || product.length || product.width || product.height)
    || product.attributes.some((attribute) => attribute.visible);

  const addToCart = (event: FormEvent) => {
    event.preventDefault();
    if (!purchasable) return;
    const attributes = variation
      ? Object.fromEntries(Object.entries(variation.attributes).filter(([, value]) => !value).map(([name]) => [name, chosen[name]]))
      : {};
    cart.add(product.id, quantity, variation?.id || null, attributes);
    if (settings.redirect_to_cart) {
      window.location.href = '/cart';
      return;
    }
    setAdded(`“${product.name}” has been added to your cart.`);
  };

  const primaryCategory = product.categories[0];

  return (
    <PageShell>
      <Breadcrumbs items={[
        { label: settings.shop_page_title, href: '/shop' },
        ...(primaryCategory ? [{ label: primaryCategory.name, href: `/product-category/${primaryCategory.slug}` }] : []),
        { label: product.name },
      ]} />
      {added && (
        <div className={styles.success} role="status">
          {added} <a className={styles.buttonLink} href="/cart">View cart →</a>
        </div>
      )}

      <div className={styles.productLayout}>
        <div className={styles.gallery}>
          <div className={styles.galleryMain} style={{ position: 'relative' }}>
            <SaleBadge product={variation || product} />
            {mainImage && <img src={mainImage} alt={product.name} />}
          </div>
          {images.length > 1 && (
            <div className={styles.thumbs}>
              {images.map((url) => (
                <button key={url} type="button" className={url === mainImage ? styles.thumbActive : styles.thumb}
                  onClick={() => setActiveImage(url)} aria-label="Show image">
                  <img src={url} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.summary}>
          <h1 className={styles.heading}>{product.name}</h1>
          {product.rating_count > 0 && (
            <button type="button" className={styles.buttonLink} onClick={() => setTab('reviews')}>
              <Stars rating={product.average_rating} /> ({product.rating_count} customer review{product.rating_count === 1 ? '' : 's'})
            </button>
          )}
          <ProductPriceHtml product={product} variation={variation} settings={settings} />
          {product.short_description && <ContentRenderer html={product.short_description} />}

          {product.type === 'external' && product.external_url && (
            <div><a className={styles.button} href={product.external_url} target="_blank" rel="noopener noreferrer">{product.button_text || 'Buy product'}</a></div>
          )}

          {product.type === 'grouped' && <GroupedChildren product={product} settings={settings} />}

          {(product.type === 'simple' || product.type === 'variable') && (
            <form onSubmit={addToCart} className={styles.summary}>
              {product.type === 'variable' && (
                <div className={styles.variations}>
                  {variationAttributes.map((attribute) => (
                    <label key={attribute.name} className={styles.field}>
                      {attribute.name}
                      <select className={styles.select} value={chosen[attribute.name] || ''}
                        onChange={(event) => setChosen((current) => ({ ...current, [attribute.name]: event.target.value }))}>
                        <option value="">Choose an option</option>
                        {attribute.options.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                  ))}
                  {Object.keys(chosen).length > 0 && (
                    <div><button type="button" className={styles.buttonLink} onClick={() => setChosen({})}>Clear</button></div>
                  )}
                  {allChosen && !variation && <div className={styles.notice}>Sorry, this combination is unavailable. Please choose a different one.</div>}
                  {variation?.description && <ContentRenderer html={variation.description} />}
                </div>
              )}

              {(product.type === 'simple' || variation) && (
                <StockLine status={stockStatus} quantity={stockSource.stock_quantity} manage={stockSource.manage_stock && settings.manage_stock} settings={settings} />
              )}

              <div className={styles.addToCart}>
                {!product.sold_individually && (
                  <input className={`${styles.input} ${styles.qty}`} type="number" min={1} max={maxQuantity} value={quantity}
                    aria-label="Quantity" onChange={(event) => setQuantity(Math.max(Number(event.target.value) || 1, 1))} />
                )}
                <button type="submit" className={styles.button} disabled={!purchasable}>
                  {product.type === 'variable' && !variation ? 'Select options' : stockStatus === 'outofstock' ? 'Out of stock' : 'Add to cart'}
                </button>
              </div>
            </form>
          )}

          <div className={styles.meta}>
            {(variation?.sku || product.sku) && <span>SKU: {variation?.sku || product.sku}</span>}
            {product.categories.length > 0 && (
              <span>
                Categor{product.categories.length === 1 ? 'y' : 'ies'}:{' '}
                {product.categories.map((category, index) => (
                  <span key={category.id}>{index > 0 && ', '}<a href={`/product-category/${category.slug}`}>{category.name}</a></span>
                ))}
              </span>
            )}
            {product.tags.length > 0 && (
              <span>
                Tag{product.tags.length === 1 ? '' : 's'}:{' '}
                {product.tags.map((tag, index) => (
                  <span key={tag.id}>{index > 0 && ', '}<a href={`/product-tag/${tag.slug}`}>{tag.name}</a></span>
                ))}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className={styles.tabs}>
        <div className={styles.tabList} role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'description'} className={tab === 'description' ? styles.tabActive : styles.tab} onClick={() => setTab('description')}>Description</button>
          {hasAdditional && <button type="button" role="tab" aria-selected={tab === 'additional'} className={tab === 'additional' ? styles.tabActive : styles.tab} onClick={() => setTab('additional')}>Additional information</button>}
          {settings.enable_reviews && <button type="button" role="tab" aria-selected={tab === 'reviews'} className={tab === 'reviews' ? styles.tabActive : styles.tab} onClick={() => setTab('reviews')}>Reviews ({product.rating_count})</button>}
        </div>
        <div className={styles.tabPanel} role="tabpanel">
          {tab === 'description' && (product.description ? <ContentRenderer html={product.description} /> : <p className={styles.muted}>No description.</p>)}
          {tab === 'additional' && (
            <table className={styles.table}>
              <tbody>
                {product.weight && <tr><th>Weight</th><td>{product.weight} {settings.weight_unit}</td></tr>}
                {(product.length || product.width || product.height) && (
                  <tr><th>Dimensions</th><td>{[product.length, product.width, product.height].map((value) => value ?? '–').join(' × ')} {settings.dimension_unit}</td></tr>
                )}
                {product.attributes.filter((attribute) => attribute.visible).map((attribute) => (
                  <tr key={attribute.name}><th>{attribute.name}</th><td>{attribute.options.join(', ')}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'reviews' && settings.enable_reviews && <ReviewsPanel product={product} settings={settings} />}
        </div>
      </div>

      {upsells.length > 0 && (
        <section className={styles.section}>
          <h2>You may also like…</h2>
          <div className={styles.grid}>{upsells.map((item) => <ProductCard key={item.id} product={item} settings={settings} />)}</div>
        </section>
      )}
      {related.length > 0 && (
        <section className={styles.section}>
          <h2>Related products</h2>
          <div className={styles.grid}>{related.map((item) => <ProductCard key={item.id} product={item} settings={settings} />)}</div>
        </section>
      )}
    </PageShell>
  );
}
