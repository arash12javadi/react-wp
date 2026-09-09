import { useEffect, useState, type FormEvent } from 'react';
import { getSupabaseClient, updateOption } from '../lib/db';
import styles from './SiteSettings.module.css';

interface SiteSettingsProps {
  onSiteTitleChange?: (title: string) => void;
}

interface SettingsForm {
  siteTitle: string;
  siteDescription: string;
  adminEmail: string;
}

const defaults: SettingsForm = {
  siteTitle: 'My React-WP Site',
  siteDescription: '',
  adminEmail: '',
};

export default function SiteSettings({ onSiteTitleChange }: SiteSettingsProps) {
  const [form, setForm] = useState<SettingsForm>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const loadSettings = async () => {
    setLoading(true);
    setError('');
    try {
      const supabase = getSupabaseClient();
      const { data, error: queryError } = await supabase
        .from('options')
        .select('option_name,option_value')
        .in('option_name', ['site_title', 'site_description', 'admin_email']);
      if (queryError) throw queryError;
      const values = (data || []).reduce<Record<string, string>>((result, item) => {
        result[item.option_name] = item.option_value;
        return result;
      }, {});
      setForm({
        siteTitle: values.site_title || defaults.siteTitle,
        siteDescription: values.site_description || defaults.siteDescription,
        adminEmail: values.admin_email || defaults.adminEmail,
      });
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load site settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setFeedback('');
    try {
      const title = form.siteTitle.trim();
      if (!title) throw new Error('Site title is required.');
      const [titleSaved, descriptionSaved, emailSaved] = await Promise.all([
        updateOption('site_title', title),
        updateOption('site_description', form.siteDescription.trim()),
        updateOption('admin_email', form.adminEmail.trim()),
      ]);
      if (!titleSaved || !descriptionSaved || !emailSaved) throw new Error('Settings could not be saved.');
      setForm((current) => ({ ...current, siteTitle: title }));
      onSiteTitleChange?.(title);
      setFeedback('Settings saved successfully.');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className={styles.loading} role="status">Loading settings…</div>;
  }

  return (
    <section className={styles.container} aria-labelledby="settings-heading">
      <div className={styles.pageIntro}>
        <h2 id="settings-heading">Site settings</h2>
        <p>Configure the basic information shown across your site.</p>
      </div>
      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void loadSettings()}>Retry</button>
        </div>
      )}
      {feedback && <div className={styles.success} role="status">{feedback}</div>}
      <form className={styles.form} onSubmit={saveSettings}>
        <label>
          Site title
          <input
            type="text"
            value={form.siteTitle}
            onChange={(event) => setForm((current) => ({ ...current, siteTitle: event.target.value }))}
            required
          />
          <span className={styles.help}>The name displayed in your admin navigation and site metadata.</span>
        </label>
        <label>
          Site description
          <textarea
            value={form.siteDescription}
            onChange={(event) => setForm((current) => ({ ...current, siteDescription: event.target.value }))}
            placeholder="A short description of your site"
            rows={5}
          />
        </label>
        <label>
          Admin email
          <input
            type="email"
            value={form.adminEmail}
            onChange={(event) => setForm((current) => ({ ...current, adminEmail: event.target.value }))}
            required
          />
        </label>
        <div className={styles.actions}>
          <button type="submit" className={styles.saveButton} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </section>
  );
}
