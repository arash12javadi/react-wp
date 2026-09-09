import { useEffect, useState, type FormEvent } from 'react';
import { getSupabaseClient } from '../lib/db';
import type { Post, PostInput } from '../lib/types';
import styles from './PostEditor.module.css';

interface PostEditorProps {
  post?: Post | null;
  onSaved: () => void;
  onCancel: () => void;
}

const emptyPost: PostInput = {
  title: '',
  slug: '',
  content: '',
  excerpt: '',
  status: 'draft',
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

export default function PostEditor({ post, onSaved, onCancel }: PostEditorProps) {
  const [form, setForm] = useState<PostInput>(emptyPost);
  const [slugTouched, setSlugTouched] = useState(Boolean(post));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(post ? {
      title: post.title,
      slug: post.slug,
      content: post.content || '',
      excerpt: post.excerpt || '',
      status: post.status === 'published' ? 'published' : 'draft',
    } : emptyPost);
    setSlugTouched(Boolean(post));
    setError('');
  }, [post]);

  const updateField = (field: keyof PostInput, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleTitleChange = (title: string) => {
    setForm((current) => ({
      ...current,
      title,
      slug: slugTouched ? current.slug : slugify(title),
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    const payload = {
      title: form.title.trim(),
      slug: slugify(form.slug),
      content: form.content,
      excerpt: form.excerpt.trim(),
      status: form.status,
      updated_at: new Date().toISOString(),
    };

    try {
      if (!payload.title || !payload.slug) {
        throw new Error('A title and slug are required.');
      }
      const supabase = getSupabaseClient();
      const result = post
        ? await supabase.from('posts').update(payload).eq('id', post.id)
        : await supabase.from('posts').insert(payload);
      if (result.error) {
        if (result.error.code === '23505') {
          throw new Error('That slug is already in use. Choose a different one.');
        }
        throw result.error;
      }
      onSaved();
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save this post.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={styles.container} aria-labelledby="post-editor-heading">
      <button type="button" className={styles.backButton} onClick={onCancel}>← Back to posts</button>
      <div className={styles.pageIntro}>
        <div>
          <h2 id="post-editor-heading">{post ? 'Edit post' : 'New post'}</h2>
          <p>{post ? 'Update your post and publish changes when ready.' : 'Create a new piece of content for your site.'}</p>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.formMain}>
          <label>
            Title
            <input
              type="text"
              value={form.title}
              onChange={(event) => handleTitleChange(event.target.value)}
              placeholder="An engaging post title"
              required
            />
          </label>
          <label>
            Content
            <textarea
              className={styles.contentInput}
              value={form.content}
              onChange={(event) => updateField('content', event.target.value)}
              placeholder="Start writing…"
              rows={15}
            />
          </label>
          <label>
            Excerpt
            <textarea
              value={form.excerpt}
              onChange={(event) => updateField('excerpt', event.target.value)}
              placeholder="A short summary (optional)"
              rows={4}
            />
          </label>
        </div>
        <aside className={styles.formAside}>
          <label>
            Slug
            <input
              type="text"
              value={form.slug}
              onChange={(event) => {
                setSlugTouched(true);
                updateField('slug', event.target.value);
              }}
              placeholder="post-url"
              required
            />
            <span className={styles.help}>Used in the post URL.</span>
          </label>
          <label>
            Status
            <select value={form.status} onChange={(event) => updateField('status', event.target.value)}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </label>
          <div className={styles.formActions}>
            <button type="button" className={styles.secondaryButton} onClick={onCancel}>Cancel</button>
            <button type="submit" className={styles.primaryButton} disabled={loading}>
              {loading ? 'Saving…' : post ? 'Save changes' : 'Create post'}
            </button>
          </div>
        </aside>
      </form>
    </section>
  );
}
