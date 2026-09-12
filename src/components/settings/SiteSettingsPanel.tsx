import { useEffect, useState, type FormEvent } from 'react';
import { getSupabaseClient } from '../../lib/db';
import { applySiteIcon, defaultSettings, loadSettings, saveSettings, type SiteSettings } from '../../lib/settings';
import { rwp } from '../../lib/rwp';
import MediaManager from '../MediaManager';
import styles from '../SiteSettings.module.css';

interface PageOption {
  id: number;
  title: string;
}

export default function SiteSettingsPanel({ onSiteTitleChange }: { onSiteTitleChange?: (title: string) => void }) {
  const [form, setForm] = useState<SiteSettings>(defaultSettings);
  const [pages, setPages] = useState<PageOption[]>([]);
  const [pickingIcon, setPickingIcon] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [settings, { data }] = await Promise.all([
        loadSettings(),
        getSupabaseClient().from('pages').select('id,title').eq('is_post', false).order('title'),
      ]);
      setForm(settings);
      setPages((data || []) as PageOption[]);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load site settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const field = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setFeedback('');
    try {
      const title = form.site_title.trim();
      if (!title) throw new Error('Site title is required.');
      await saveSettings({
        site_title: title,
        site_tagline: form.site_tagline.trim(),
        site_icon: form.site_icon.trim(),
        home_page_id: form.home_page_id,
        posts_page_id: form.posts_page_id,
        posts_per_page: form.posts_per_page,
        excerpt_length: form.excerpt_length,
        home_layout: form.home_layout,
      });
      applySiteIcon(form.site_icon.trim());
      onSiteTitleChange?.(title);
      rwp.actions.do('rwp_settings_saved', { ...form, site_title: title });
      setFeedback('Settings saved successfully.');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className={styles.loading} role="status">Loading settings…</div>;

  return (
    <>
      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {feedback && <div className={styles.success} role="status">{feedback}</div>}

      <form className={styles.form} onSubmit={submit}>
        <label>
          Site title
          <input value={form.site_title} onChange={(event) => field('site_title', event.target.value)} required />
          <span className={styles.help}>Shown in the admin sidebar, the public header, and site metadata.</span>
        </label>

        <label>
          Tagline
          <input value={form.site_tagline} onChange={(event) => field('site_tagline', event.target.value)}
            placeholder="In a few words, explain what this site is about" />
        </label>

        <label>
          Site icon
          <span className={styles.iconRow}>
            {form.site_icon && <img className={styles.iconPreview} src={form.site_icon} alt="" />}
            <input value={form.site_icon} onChange={(event) => field('site_icon', event.target.value)}
              placeholder="https://example.com/icon.png" />
            <button type="button" className={styles.secondaryButton} onClick={() => setPickingIcon(true)}>
              Choose from Media Library
            </button>
          </span>
          <span className={styles.help}>Used as the browser favicon. A square image of at least 512×512 works best.</span>
        </label>

        <label>
          Home page
          <select value={form.home_page_id} onChange={(event) => field('home_page_id', event.target.value)}>
            <option value="">Latest posts</option>
            {pages.map((page) => <option key={page.id} value={String(page.id)}>{page.title}</option>)}
          </select>
          <span className={styles.help}>Choose a static page for the front page, or show the blog feed.</span>
        </label>

        <label>
          Posts page
          <select value={form.posts_page_id} onChange={(event) => field('posts_page_id', event.target.value)}
            disabled={!form.home_page_id}>
            <option value="">Not set</option>
            {pages.map((page) => <option key={page.id} value={String(page.id)}>{page.title}</option>)}
          </select>
          <span className={styles.help}>
            {form.home_page_id
              ? 'The page whose URL shows the blog feed. Without this, the feed has no home.'
              : 'Only needed when the front page is a static page.'}
          </span>
        </label>

        <label>
          Home and archive width
          <select value={form.home_layout} onChange={(event) => field('home_layout', event.target.value)}>
            <option value="boxed">Boxed</option>
            <option value="wide">Wide</option>
            <option value="full">Full width</option>
          </select>
          <span className={styles.help}>
            Individual pages set their own width in the editor. This applies to the blog feed and archives.
          </span>
        </label>

        <label>
          Number of recent posts shown on archive pages
          <input type="number" min={1} max={100} value={form.posts_per_page}
            onChange={(event) => field('posts_per_page', Number(event.target.value))} />
        </label>

        <label>
          Excerpt length (words)
          <input type="number" min={5} max={300} value={form.excerpt_length}
            onChange={(event) => field('excerpt_length', Number(event.target.value))} />
          <span className={styles.help}>
            Used when a post has no excerpt of its own. WordPress defaults to 55 words.
          </span>
        </label>

        <div className={styles.actions}>
          <button type="submit" className={styles.saveButton} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>

      {pickingIcon && (
        <MediaManager
          heading="Choose a site icon"
          onClose={() => setPickingIcon(false)}
          onSelect={(item) => {
            field('site_icon', item.url);
            setPickingIcon(false);
          }}
        />
      )}
    </>
  );
}
