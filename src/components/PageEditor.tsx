import { useEffect, useState, type FormEvent } from 'react';
import { getSupabaseClient } from '../lib/db';
import type { Category, Page } from '../lib/types';
import { canManageAllPosts, canPublishPosts, type UserRole } from '../lib/roles';
import { rwp } from '../lib/rwp';
import ClassicEditor from './ClassicEditor';
import styles from './PostEditor.module.css';

interface PageEditorProps {
  page?: Page | null;
  initialIsPost?: boolean;
  onSaved: () => void;
  onCancel: () => void;
  role: UserRole;
}

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
const empty = { title: '', slug: '', content: '', excerpt: '', status: 'draft', is_post: false, category_id: '', featured_category_id: '', posts_limit: 6, display_layout: 'grid' };

export default function PageEditor({ page, initialIsPost = false, onSaved, onCancel, role }: PageEditorProps) {
  const [form, setForm] = useState({ ...empty });
  const [categories, setCategories] = useState<Category[]>([]);
  const [slugTouched, setSlugTouched] = useState(Boolean(page));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(page ? {
      title: page.title, slug: page.slug, content: page.content || '', excerpt: page.excerpt || '',
      status: page.status === 'published' ? 'published' : 'draft', is_post: page.is_post,
      category_id: page.category_id || '', featured_category_id: page.featured_category_id || '',
      posts_limit: page.posts_limit || 6, display_layout: page.display_layout || 'grid',
    } : { ...empty, is_post: initialIsPost });
    setSlugTouched(Boolean(page));
    const supabase = getSupabaseClient();
    void supabase.from('categories').select('*').order('name').then(({ data, error: queryError }) => {
      if (queryError) {
        setError(
          queryError.message.includes('public.categories') || queryError.message.includes('relation "categories"')
            ? 'The categories table is missing. Run supabase/migrations/20260911_create_pages_categories.sql in the Supabase SQL Editor, then reload this page.'
            : queryError.message,
        );
      }
      else setCategories((data || []) as Category[]);
    });
  }, [initialIsPost, page]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true); setError('');
    try {
      const title = form.title.trim();
      const slug = slugify(form.slug);
      if (!title || !slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('A valid title and slug are required.');
      if (form.status === 'published' && !canPublishPosts(role)) throw new Error('Your role cannot publish content.');
      const supabase = getSupabaseClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('You must be signed in to save content.');
      const payload = { ...form, title, slug, content: form.content, excerpt: form.excerpt.trim(), category_id: form.is_post ? form.category_id || null : null, featured_category_id: form.featured_category_id || null, posts_limit: Math.max(1, Number(form.posts_limit) || 6), updated_at: new Date().toISOString(), author_id: userData.user.id };
      const result = page
        ? await supabase.from('pages').update(payload).eq('id', page.id)
        : await supabase.from('pages').insert(payload);
      if (result.error) {
        if (result.error.message.includes('public.pages') || result.error.message.includes('relation "pages"')) {
          throw new Error('The pages table is missing. Run supabase/migrations/20260911_create_pages_categories.sql in the Supabase SQL Editor, then reload this page.');
        }
        throw new Error(result.error.code === '23505' ? 'That slug is already in use.' : result.error.message);
      }
      const action = page
        ? (form.is_post ? 'rwp_post_updated' : 'rwp_page_updated')
        : (form.is_post ? 'rwp_post_created' : 'rwp_page_created');
      rwp.actions.do(action, { ...payload, id: page?.id, is_post: form.is_post });
      onSaved();
    } catch (saveError: unknown) { setError(saveError instanceof Error ? saveError.message : 'Unable to save content.'); }
    finally { setLoading(false); }
  };

  const field = (key: keyof typeof form, value: string | boolean | number) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <section className={styles.container} aria-labelledby="page-editor-heading">
      <button type="button" className={styles.backButton} onClick={onCancel}>← Back to content</button>
      <div className={styles.pageIntro}><h2 id="page-editor-heading">{page ? 'Edit content' : 'New content'}</h2><p>Create a static page or blog post from the same editor.</p></div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.formMain}>
          <label>Title<input value={form.title} required onChange={(e) => setForm((c) => ({ ...c, title: e.target.value, slug: slugTouched ? c.slug : slugify(e.target.value) }))} /></label>
          <label>Content<ClassicEditor value={form.content} onChange={(content) => field('content', content)} placeholder="Start writing your content…" /></label>
          <label>Excerpt<textarea rows={4} value={form.excerpt} onChange={(e) => field('excerpt', e.target.value)} /></label>
        </div>
        <aside className={styles.formAside}>
          <label>Slug<input value={form.slug} required onChange={(e) => { setSlugTouched(true); field('slug', e.target.value); }} /><span className={styles.help}>Lowercase letters, numbers, and hyphens.</span></label>
          <label><span>Content type</span><span><input type="checkbox" checked={form.is_post} onChange={(e) => field('is_post', e.target.checked)} /> Treat as blog post</span></label>
          <label>Category<select value={form.category_id} onChange={(e) => { field('category_id', e.target.value); if (e.target.value) field('is_post', true); }}><option value="">No category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          {!form.is_post && <details open><summary>Embed post feed on this page</summary><label>Featured category<select value={form.featured_category_id} onChange={(e) => field('featured_category_id', e.target.value)}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Posts limit<input type="number" min="1" value={form.posts_limit} onChange={(e) => field('posts_limit', Number(e.target.value))} /></label><label>Layout<select value={form.display_layout} onChange={(e) => field('display_layout', e.target.value)}><option value="grid">Grid</option><option value="list">List</option></select></label></details>}
          <label>Status<select value={form.status} disabled={!canPublishPosts(role)} onChange={(e) => field('status', e.target.value)}><option value="draft">Draft</option><option value="published">Published</option></select></label>
          <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={onCancel}>Cancel</button><button className={styles.primaryButton} disabled={loading}>{loading ? 'Saving…' : 'Save content'}</button></div>
        </aside>
      </form>
    </section>
  );
}
