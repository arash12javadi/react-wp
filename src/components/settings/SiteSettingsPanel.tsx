import { useEffect, useState, type FormEvent } from 'react';
import { getSupabaseClient } from '../../lib/db';
import {
  applySiteIcon, brandingFrom, brandParts, defaultSettings, headerDisplayLabels, loadSettings, saveSettings,
  type HeaderDisplay, type SiteBranding, type SiteSettings,
} from '../../lib/settings';
import { rwp } from '../../lib/rwp';
import { accountPages } from '../../lib/account';
import MediaManager from '../MediaManager';
import AccountPagePicker, { type PickerPage } from './AccountPagePicker';
import styles from '../SiteSettings.module.css';

type PageOption = PickerPage;

// Chosen here like the home page; the sign-in pages are under Settings → Accounts.
const memberPages = accountPages.filter((page) => page.key === 'profile' || page.key === 'dashboard');

export default function SiteSettingsPanel({ onBrandingChange }: { onBrandingChange?: (branding: SiteBranding) => void }) {
  const [form, setForm] = useState<SiteSettings>(defaultSettings);
  const [pages, setPages] = useState<PageOption[]>([]);
  const [picking, setPicking] = useState<'icon' | 'logo' | null>(null);
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
        getSupabaseClient().from('pages').select('id,title,status').eq('is_post', false).or('status.is.null,status.neq.trash').order('title'),
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
      const logoHeight = Math.round(Number(form.logo_height));
      if (!Number.isFinite(logoHeight) || logoHeight < 16 || logoHeight > 200) {
        throw new Error('Logo height must be a whole number from 16 to 200 pixels.');
      }
      const saved = {
        ...form,
        site_title: title,
        site_tagline: form.site_tagline.trim(),
        site_icon: form.site_icon.trim(),
        site_logo: form.site_logo.trim(),
        logo_height: logoHeight,
      };
      await saveSettings({
        site_title: saved.site_title,
        site_tagline: saved.site_tagline,
        site_icon: saved.site_icon,
        site_logo: saved.site_logo,
        header_display: saved.header_display,
        logo_height: saved.logo_height,
        home_page_id: form.home_page_id,
        posts_page_id: form.posts_page_id,
        posts_per_page: form.posts_per_page,
        home_layout: form.home_layout,
        profile_page_id: form.profile_page_id,
        profile_page_url: form.profile_page_url.trim(),
        dashboard_page_id: form.dashboard_page_id,
        dashboard_page_url: form.dashboard_page_url.trim(),
      });
      setForm(saved);
      applySiteIcon(saved.site_icon);
      onBrandingChange?.(brandingFrom(saved));
      rwp.actions.do('rwp_settings_saved', saved);
      setFeedback('Settings saved successfully.');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className={styles.loading} role="status">Loading settings…</div>;

  const preview = brandParts(form);

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
            <button type="button" className={styles.secondaryButton} onClick={() => setPicking('icon')}>
              Choose from Media Library
            </button>
          </span>
          <span className={styles.help}>Used as the browser favicon. A square image of at least 512×512 works best.</span>
        </label>

        <fieldset className={styles.fieldset}>
          <legend>Header logo</legend>
          <label>
            Logo
            <span className={styles.iconRow}>
              {form.site_logo && <img className={styles.logoPreview} src={form.site_logo} alt="" />}
              <input value={form.site_logo} onChange={(event) => field('site_logo', event.target.value)}
                placeholder="https://example.com/logo.png" />
              <button type="button" className={styles.secondaryButton} onClick={() => setPicking('logo')}>
                Choose from Media Library
              </button>
              {form.site_logo && (
                <button type="button" className={styles.secondaryButton} onClick={() => field('site_logo', '')}>Remove</button>
              )}
            </span>
            <span className={styles.help}>A wide PNG or SVG with a transparent background works best. It links to the home page.</span>
          </label>

          <label>
            Header shows
            <select value={form.header_display} onChange={(event) => field('header_display', event.target.value as HeaderDisplay)}>
              {(Object.keys(headerDisplayLabels) as HeaderDisplay[]).map((value) => (
                <option key={value} value={value}>{headerDisplayLabels[value]}</option>
              ))}
            </select>
            <span className={styles.help}>
              {form.header_display.startsWith('logo') && !form.site_logo
                ? 'No logo is set, so the header shows the site title and tagline until you add one.'
                : 'With a logo only, the site title is still used as the logo’s text for screen readers and search engines.'}
            </span>
          </label>

          <label>
            Logo height
            <span className={styles.unitRow}>
              <input type="number" min={16} max={200} value={form.logo_height}
                onChange={(event) => field('logo_height', Number(event.target.value))} />
              <span>px</span>
            </span>
          </label>

          <div className={styles.brandPreview}>
            <span className={styles.help}>Preview</span>
            <div>
              {preview.logo && <img src={form.site_logo} alt="" style={{ height: Math.min(200, Math.max(16, form.logo_height || 44)) }} />}
              {(preview.title || preview.tagline) && (
                <span>
                  {preview.title && <strong>{form.site_title || 'Site title'}</strong>}
                  {preview.tagline && <small>{form.site_tagline}</small>}
                </span>
              )}
            </div>
          </div>
        </fieldset>

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

        {memberPages.map((definition) => (
          <AccountPagePicker
            key={definition.key}
            definition={definition}
            pageId={form[`${definition.key}_page_id` as 'profile_page_id']}
            url={form[`${definition.key}_page_url` as 'profile_page_url']}
            pages={pages}
            onChange={(pageId, url) => setForm((current) => ({
              ...current, [`${definition.key}_page_id`]: pageId, [`${definition.key}_page_url`]: url,
            }))}
            onPageCreated={(page) => setPages((current) => [...current, page].sort((a, b) => a.title.localeCompare(b.title)))}
          />
        ))}

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


        <div className={styles.actions}>
          <button type="submit" className={styles.saveButton} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>

      {picking && (
        <MediaManager
          heading={picking === 'logo' ? 'Choose a logo' : 'Choose a site icon'}
          onClose={() => setPicking(null)}
          onSelect={(item) => {
            field(picking === 'logo' ? 'site_logo' : 'site_icon', item.url);
            setPicking(null);
          }}
        />
      )}
    </>
  );
}
