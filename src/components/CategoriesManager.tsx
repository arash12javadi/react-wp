import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getSupabaseClient } from '../lib/db';
import type { Category } from '../lib/types';
import styles from './CategoriesManager.module.css';

interface CategoryRow extends Category {
  postCount: number;
}

const slugify = (value: string) =>
  value.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

export default function CategoriesManager() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const supabase = getSupabaseClient();
      const [{ data, error: categoryError }, { data: pages, error: pagesError }] = await Promise.all([
        supabase.from('categories').select('id,name,slug,description').order('name'),
        supabase.from('pages').select('category_id'),
      ]);
      if (categoryError) throw categoryError;
      if (pagesError && !pagesError.message.includes('public.pages')) throw pagesError;
      const counts = new Map<string, number>();
      (pages || []).forEach((page) => {
        if (page.category_id) counts.set(page.category_id, (counts.get(page.category_id) || 0) + 1);
      });
      setCategories(((data || []) as Category[]).map((category) => ({ ...category, postCount: counts.get(category.id) || 0 })));
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load categories.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const resetForm = () => {
    setEditing(null);
    setName('');
    setSlug('');
    setDescription('');
    setSlugTouched(false);
  };

  const editCategory = (category: Category) => {
    setEditing(category);
    setName(category.name);
    setSlug(category.slug);
    setDescription(category.description || '');
    setSlugTouched(true);
    setFeedback('');
    setError('');
  };

  const saveCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setFeedback('');
    const cleanName = name.trim();
    const cleanSlug = slugify(slug);
    try {
      if (!cleanName || !cleanSlug) throw new Error('Category name and slug are required.');
      const supabase = getSupabaseClient();
      const payload = { name: cleanName, slug: cleanSlug, description: description.trim() || null };
      const result = editing
        ? await supabase.from('categories').update(payload).eq('id', editing.id)
        : await supabase.from('categories').insert(payload);
      if (result.error) {
        if (result.error.code === '23505') throw new Error('That category slug is already in use.');
        throw result.error;
      }
      setFeedback(editing ? 'Category updated successfully.' : 'Category created successfully.');
      resetForm();
      await loadCategories();
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save category.');
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (category: CategoryRow) => {
    if (!window.confirm(`Delete "${category.name}"? Content will lose its category.`)) return;
    setError('');
    setFeedback('');
    try {
      const { error: deleteError } = await getSupabaseClient().from('categories').delete().eq('id', category.id);
      if (deleteError) throw deleteError;
      setFeedback('Category deleted successfully.');
      if (editing?.id === category.id) resetForm();
      await loadCategories();
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete category.');
    }
  };

  return (
    <section className={styles.container} aria-labelledby="categories-heading">
      <div className={styles.intro}>
        <div>
          <h2 id="categories-heading">Categories</h2>
          <p>Create and organize categories for blog posts.</p>
        </div>
        <button type="button" className={styles.secondaryButton} onClick={resetForm}>＋ New category</button>
      </div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {feedback && <div className={styles.feedback} role="status">{feedback}</div>}
      <div className={styles.layout}>
        <form className={styles.form} onSubmit={saveCategory}>
          <h3>{editing ? 'Edit category' : 'Add category'}</h3>
          <label>Name<input value={name} required onChange={(event) => { const value = event.target.value; setName(value); if (!slugTouched) setSlug(slugify(value)); }} placeholder="Technology" /></label>
          <label>Slug<input value={slug} required onChange={(event) => { setSlugTouched(true); setSlug(event.target.value); }} placeholder="technology" /><span>Lowercase letters, numbers, and hyphens.</span></label>
          <label>Description<textarea value={description} rows={4} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" /></label>
          <div className={styles.actions}><button type="button" className={styles.cancelButton} onClick={resetForm}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={saving}>{saving ? 'Saving…' : editing ? 'Update category' : 'Add category'}</button></div>
        </form>
        <div className={styles.tableCard}>
          {loading ? <div className={styles.empty}>Loading categories…</div> : categories.length === 0 ? <div className={styles.empty}>No categories yet. Create your first category.</div> : (
            <div className={styles.tableScroller}>
              <table>
                <thead><tr><th>Name</th><th>Slug</th><th>Posts</th><th>Actions</th></tr></thead>
                <tbody>{categories.map((category) => <tr key={category.id}><td><strong>{category.name}</strong>{category.description && <span>{category.description}</span>}</td><td>{category.slug}</td><td>{category.postCount}</td><td><button type="button" className={styles.linkButton} onClick={() => editCategory(category)}>Edit</button><button type="button" className={styles.deleteButton} onClick={() => void deleteCategory(category)}>Delete</button></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
