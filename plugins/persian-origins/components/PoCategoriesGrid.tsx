import { useEffect, useState } from 'react';
import { describeDbError, getSupabaseClient } from '../../../src/lib/db';
import { translateTerm } from '../../../src/lib/translations';
import { useBilingual } from '../BilingualContext';

/**
 * [po_categories taxonomy="category" columns="3" include="" exclude="" hide_empty="false"
 *  number="" orderby="name" order="ASC" show_description="yes" show_count="no" image="yes"]
 *
 * A responsive card grid. Names and descriptions go through core's translation keys
 * (category.<slug>.name / .description, edited under Persian Origins → Categories or Settings →
 * Translations), so the grid, core's Categories widget and the archive title always agree.
 * Images come from po_category_meta; a category without one gets a lettered tile.
 */

export interface PoCategoriesGridProps {
  taxonomy?: string;
  columns?: number;
  include?: string[];
  exclude?: string[];
  hideEmpty?: boolean;
  number?: number;
  orderby?: 'name' | 'count' | 'slug' | 'id' | 'order';
  order?: 'ASC' | 'DESC';
  showDescription?: boolean;
  showCount?: boolean;
  showImage?: boolean;
  className?: string;
}

interface CategoryCard {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  count: number;
  image: string | null;
  sort: number;
}

/** Categories plus their post counts and plugin meta. Exported for tests. */
export async function loadCategoryCards(): Promise<CategoryCard[]> {
  const supabase = getSupabaseClient();
  const [categories, pages, meta] = await Promise.all([
    supabase.from('categories').select('id,name,slug,description'),
    supabase.from('pages').select('category_id').eq('status', 'published').eq('is_post', true).not('category_id', 'is', null),
    supabase.from('po_category_meta').select('category_id,image_url,sort_order'),
  ]);
  if (categories.error) throw new Error(describeDbError(categories.error));
  const counts = new Map<string, number>();
  (pages.data || []).forEach((row: { category_id: string }) => counts.set(row.category_id, (counts.get(row.category_id) || 0) + 1));
  // Meta is optional: before the plugin schema is installed the grid still works, without images.
  const metaById = new Map((meta.error ? [] : meta.data || []).map((row: { category_id: string; image_url: string | null; sort_order: number }) => [row.category_id, row]));
  return (categories.data || []).map((category: { id: string; name: string; slug: string; description: string | null }) => ({
    ...category,
    count: counts.get(category.id) || 0,
    image: metaById.get(category.id)?.image_url || null,
    sort: metaById.get(category.id)?.sort_order || 0,
  }));
}

const matches = (card: CategoryCard, list: string[]) => list.includes(card.slug) || list.includes(card.id);

export function arrangeCards(cards: CategoryCard[], props: PoCategoriesGridProps): CategoryCard[] {
  const { include = [], exclude = [], hideEmpty = false, number, orderby = 'name', order = 'ASC' } = props;
  const sorted = cards
    .filter((card) => !include.length || matches(card, include))
    .filter((card) => !matches(card, exclude))
    .filter((card) => !hideEmpty || card.count > 0)
    .sort((a, b) => {
      const byField = orderby === 'count' ? a.count - b.count
        : orderby === 'order' ? a.sort - b.sort
          : orderby === 'slug' ? a.slug.localeCompare(b.slug)
            : orderby === 'id' ? a.id.localeCompare(b.id)
              : a.name.localeCompare(b.name);
      return (order === 'DESC' ? -byField : byField) || a.name.localeCompare(b.name);
    });
  // include="…" keeps the order it was written in, like WordPress's orderby="include".
  const ordered = include.length && orderby === 'name' && !props.order
    ? include.map((wanted) => sorted.find((card) => card.slug === wanted || card.id === wanted)).filter((card): card is CategoryCard => Boolean(card))
    : sorted;
  return number && number > 0 ? ordered.slice(0, number) : ordered;
}

export default function PoCategoriesGrid(props: PoCategoriesGridProps) {
  const { taxonomy = 'category', columns = 3, showDescription = true, showCount = false, showImage = true, className = '' } = props;
  const { t, lang } = useBilingual();
  const [cards, setCards] = useState<CategoryCard[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (taxonomy !== 'category') return;
    let active = true;
    loadCategoryCards()
      .then((loaded) => { if (active) setCards(loaded); })
      .catch((loadError: unknown) => {
        if (!active) return;
        console.warn(`[po_categories] ${loadError instanceof Error ? loadError.message : String(loadError)}`);
        setError(t('po.categories.error', 'The categories could not be loaded.'));
      });
    return () => { active = false; };
  }, [taxonomy, t]);

  if (taxonomy !== 'category') {
    // Categories are the only taxonomy this CMS has; say so where the author will look.
    console.warn(`[po_categories] taxonomy="${taxonomy}" is not supported; this site only has "category".`);
    return null;
  }
  if (error) return <p className="po-cat-grid__message">{error}</p>;
  if (!cards) return <div className={`po-cat-grid cols-${columns} is-loading ${className}`.trim()} aria-busy="true" />;

  const visible = arrangeCards(cards, props);
  if (!visible.length) return <p className="po-cat-grid__message">{t('po.categories.empty', 'No categories yet.')}</p>;

  const safeColumns = Math.min(6, Math.max(1, Math.round(columns) || 3));
  return (
    <div className={`po-cat-grid cols-${safeColumns} ${className}`.trim()} style={{ ['--po-columns' as string]: safeColumns }}>
      {visible.map((card) => {
        // Re-resolved on every render; the component re-renders on a language switch.
        const name = translateTerm('category', card) || card.name;
        const description = showDescription ? translateTerm('category', card, 'description') : '';
        return (
          <a key={card.id} className="po-cat-card" href={`/category/${encodeURIComponent(card.slug)}`} lang={lang}>
            {showImage && (
              <span className="po-cat-card__media">
                {card.image
                  ? <img src={card.image} alt="" loading="lazy" decoding="async" />
                  : <span className="po-cat-card__placeholder" aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>}
              </span>
            )}
            <span className="po-cat-card__body">
              <span className="po-cat-title">{name}</span>
              {description && <span className="po-cat-desc">{description}</span>}
              {showCount && <span className="po-cat-count">{t('po.categories.posts', '{count} posts', { count: card.count })}</span>}
            </span>
          </a>
        );
      })}
    </div>
  );
}
