import { useEffect, useState, type DragEvent } from 'react';
import { getSupabaseClient, updateOption } from '../lib/db';
import type { Post } from '../lib/types';
import styles from './MenuManager.module.css';
import { rwp } from '../lib/rwp';

interface MenuItem {
  id: string;
  label: string;
  url: string;
  type: 'custom' | 'post';
}

interface MenuRecord {
  id: number;
  name: string;
  slug: string;
  location: string;
  items: MenuItem[];
}

const defaultItems: MenuItem[] = [
  { id: 'home', label: 'Home', url: '/', type: 'custom' },
  { id: 'sample-page', label: 'Sample Page', url: '/sample-page', type: 'custom' },
];

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-');

export default function MenuManager() {
  const [menus, setMenus] = useState<MenuRecord[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [posts, setPosts] = useState<Post[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const activeMenu = menus.find((menu) => menu.id === activeId) || null;

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = getSupabaseClient();
        const [{ data: menuData, error: menuError }, { data: postData, error: postError }] = await Promise.all([
          supabase.from('menus').select('id,name,slug,location,items').order('name'),
          supabase.from('posts').select('id,title,slug,content,excerpt,status,author_id,created_at,updated_at').eq('status', 'published').order('created_at', { ascending: false }),
        ]);
        if (menuError) throw menuError;
        if (postError) throw postError;
        const records = (menuData || []).map((menu) => ({ ...menu, items: Array.isArray(menu.items) ? menu.items : [] })) as MenuRecord[];
        setMenus(records);
        setActiveId(records[0]?.id || null);
        setPosts((postData || []) as Post[]);
      } catch (loadError: unknown) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load menus.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const createMenu = async () => {
    const cleanName = name.trim();
    if (!cleanName) return setError('Enter a menu name first.');
    setError('');
    const supabase = getSupabaseClient();
    const { data, error: createError } = await supabase.from('menus').insert({
      name: cleanName,
      slug: slugify(cleanName),
      location: 'primary',
      items: defaultItems,
    }).select('id,name,slug,location,items').single();
    if (createError) return setError(createError.message);
    const menu = { ...data, items: defaultItems } as MenuRecord;
    setMenus((current) => [...current, menu]);
    setActiveId(menu.id);
    setName('');
    rwp.actions.do('rwp_menu_saved', menu);
  };

  const updateActiveItems = (items: MenuItem[]) => {
    if (activeId === null) return;
    setMenus((current) => current.map((menu) => menu.id === activeId ? { ...menu, items } : menu));
  };

  const addItem = (item: MenuItem) => {
    if (!activeMenu) return setError('Create or select a menu first.');
    updateActiveItems([...activeMenu.items, item]);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetId: string) => {
    event.preventDefault();
    if (!draggedId || draggedId === targetId || !activeMenu) return;
    const items = [...activeMenu.items];
    const from = items.findIndex((item) => item.id === draggedId);
    const to = items.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    updateActiveItems(items);
    setDraggedId(null);
  };

  const saveMenu = async () => {
    if (!activeMenu) return;
    setSaving(true);
    setFeedback('');
    setError('');
    try {
      const supabase = getSupabaseClient();
      const { error: saveError } = await supabase.from('menus').update({ items: activeMenu.items }).eq('id', activeMenu.id);
      if (saveError) throw saveError;
      if (activeMenu.location === 'primary') {
        const saved = await updateOption('menu_links', activeMenu.items.map(({ label: itemLabel, url: itemUrl }) => ({ label: itemLabel, url: itemUrl })));
        if (!saved) throw new Error('Menu saved, but the public menu option could not be updated.');
      }
      setFeedback('Menu saved successfully.');
      rwp.actions.do('rwp_menu_saved', activeMenu);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save menu.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className={styles.loading} role="status">Loading menus…</div>;

  return (
    <section className={styles.container} aria-labelledby="menus-heading">
      <div className={styles.heading}>
        <div><h2 id="menus-heading">Menus</h2><p>Create and arrange the links shown on your public website.</p></div>
        <button type="button" className={styles.primary} onClick={() => void saveMenu()} disabled={!activeMenu || saving}>{saving ? 'Saving…' : 'Save Menu'}</button>
      </div>
      {feedback && <div className={styles.success} role="status">{feedback}</div>}
      {error && <div className={styles.error} role="alert">{error}</div>}
      <div className={styles.selector}>
        <label>Menu to edit
          <select value={activeId || ''} onChange={(event) => setActiveId(Number(event.target.value))}>
            {menus.map((menu) => <option key={menu.id} value={menu.id}>{menu.name} ({menu.location})</option>)}
          </select>
        </label>
        <label className={styles.newMenu}>Create menu
          <span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Primary Navigation" /><button type="button" onClick={() => void createMenu()}>Create</button></span>
        </label>
      </div>
      <div className={styles.builder}>
        <aside className={styles.panel}>
          <h3>Add menu items</h3>
          <details open><summary>Custom Links</summary>
            <label>Navigation Label<input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
            <label>URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" /></label>
            <button type="button" onClick={() => { if (label.trim() && url.trim()) { addItem({ id: `custom-${Date.now()}`, label: label.trim(), url: url.trim(), type: 'custom' }); setLabel(''); setUrl(''); } }}>Add to Menu</button>
          </details>
          <details><summary>Published Posts</summary>
            {posts.length === 0 ? <p className={styles.muted}>No published posts found.</p> : posts.map((post) => (
              <label className={styles.check} key={post.id}><input type="checkbox" checked={Boolean(activeMenu?.items.some((item) => item.url === `/posts/${post.slug}`))} onChange={() => {
                const exists = activeMenu?.items.some((item) => item.url === `/posts/${post.slug}`);
                if (exists) updateActiveItems(activeMenu!.items.filter((item) => item.url !== `/posts/${post.slug}`));
                else addItem({ id: `post-${post.id}`, label: post.title, url: `/posts/${post.slug}`, type: 'post' });
              }} />{post.title}</label>
            ))}
          </details>
        </aside>
        <div className={styles.structure}>
          <h3>{activeMenu?.name || 'Select a menu'}</h3>
          {!activeMenu ? <p className={styles.muted}>Create a menu to begin.</p> : activeMenu.items.length === 0 ? <p className={styles.muted}>Add items from the left panel.</p> : activeMenu.items.map((item) => (
            <div className={styles.item} key={item.id} draggable onDragStart={() => setDraggedId(item.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDrop(event, item.id)}>
              <span className={styles.handle} aria-hidden="true">⠿</span>
              <div className={styles.itemMain}><strong>{item.label}</strong><span>{item.type === 'post' ? 'Post' : 'Custom Link'} · {item.url}</span></div>
              <button type="button" onClick={() => setExpanded(expanded === item.id ? null : item.id)} aria-expanded={expanded === item.id}>Edit</button>
              <button type="button" onClick={() => updateActiveItems(activeMenu.items.filter((current) => current.id !== item.id))}>Remove</button>
              {expanded === item.id && <div className={styles.inlineEdit}><label>Label<input value={item.label} onChange={(event) => updateActiveItems(activeMenu.items.map((current) => current.id === item.id ? { ...current, label: event.target.value } : current))} /></label><label>URL<input value={item.url} onChange={(event) => updateActiveItems(activeMenu.items.map((current) => current.id === item.id ? { ...current, url: event.target.value } : current))} /></label></div>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
