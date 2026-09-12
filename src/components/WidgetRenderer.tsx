import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../lib/db';
import type { Category } from '../lib/types';
import type { Widget } from '../lib/widgets';
import LoginButton from './LoginButton';
import ContentRenderer from './ContentRenderer';
import styles from './PublicHome.module.css';

interface MenuItemRow {
  label: string;
  url: string;
}

function SearchWidget({ widget }: { widget: Widget }) {
  const [term, setTerm] = useState('');
  return (
    <form onSubmit={(event) => { event.preventDefault(); if (term.trim()) window.location.href = `/?s=${encodeURIComponent(term.trim())}`; }}>
      <label className={styles.srOnly} htmlFor={`search-${widget.id}`}>Search posts</label>
      <input
        id={`search-${widget.id}`}
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={String(widget.settings.placeholder || 'Search posts…')}
      />
    </form>
  );
}

function RecentPostsWidget({ widget }: { widget: Widget }) {
  const [posts, setPosts] = useState<Array<{ id: number; title: string; slug: string }>>([]);
  useEffect(() => {
    getSupabaseClient()
      .from('pages')
      .select('id,title,slug')
      .eq('status', 'published')
      .eq('is_post', true)
      .order('created_at', { ascending: false })
      .limit(Number(widget.settings.count) || 5)
      .then(({ data }) => setPosts((data || []) as Array<{ id: number; title: string; slug: string }>));
  }, [widget.settings.count]);

  if (posts.length === 0) return <p className={styles.muted}>No posts yet.</p>;
  return <ul>{posts.map((post) => <li key={post.id}><a href={`/${post.slug}`}>{post.title}</a></li>)}</ul>;
}

function CategoriesWidget({ widget }: { widget: Widget }) {
  const [categories, setCategories] = useState<Array<Category & { count: number }>>([]);
  useEffect(() => {
    const load = async () => {
      const supabase = getSupabaseClient();
      const [{ data: cats }, { data: pages }] = await Promise.all([
        supabase.from('categories').select('id,name,slug').order('name'),
        supabase.from('pages').select('category_id').eq('status', 'published'),
      ]);
      const counts = new Map<string, number>();
      (pages || []).forEach((page: { category_id: string | null }) => {
        if (page.category_id) counts.set(page.category_id, (counts.get(page.category_id) || 0) + 1);
      });
      setCategories(((cats || []) as Category[]).map((category) => ({ ...category, count: counts.get(category.id) || 0 })));
    };
    void load();
  }, []);

  if (categories.length === 0) return <p className={styles.muted}>No categories yet.</p>;
  return (
    <ul>
      {categories.map((category) => (
        <li key={category.id}>
          <a href={`/?category=${category.slug}`}>{category.name}</a>
          {widget.settings.showCounts ? ` (${category.count})` : ''}
        </li>
      ))}
    </ul>
  );
}

function MenuWidget({ widget }: { widget: Widget }) {
  const [items, setItems] = useState<MenuItemRow[]>([]);
  useEffect(() => {
    const menuId = String(widget.settings.menuId || '');
    if (!menuId) return;
    getSupabaseClient()
      .from('menus')
      .select('items')
      .eq('id', menuId)
      .maybeSingle()
      .then(({ data }) => setItems(Array.isArray(data?.items) ? data.items as MenuItemRow[] : []));
  }, [widget.settings.menuId]);

  if (items.length === 0) return <p className={styles.muted}>No menu selected.</p>;
  return (
    <ul>
      {items.map((item) => (
        <li key={`${item.label}-${item.url}`}><a href={item.url}>{item.label}</a></li>
      ))}
    </ul>
  );
}

export default function WidgetRenderer({ widget }: { widget: Widget }) {
  const body = (() => {
    switch (widget.type) {
      case 'search': return <SearchWidget widget={widget} />;
      case 'recent-posts': return <RecentPostsWidget widget={widget} />;
      case 'categories': return <CategoriesWidget widget={widget} />;
      case 'menu': return <MenuWidget widget={widget} />;
      case 'text': return <ContentRenderer html={String(widget.settings.content || '')} />;
      case 'login': return (
        <LoginButton
          label={String(widget.settings.label || '')}
          variant={widget.settings.style === 'link' ? 'link' : 'button'}
        />
      );
      default: return null;
    }
  })();

  return (
    <div className={styles.widget}>
      {widget.title && <h2>{widget.title}</h2>}
      {body}
    </div>
  );
}
