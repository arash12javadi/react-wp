import { useEffect, useState, type FormEvent } from 'react';
import { defaultSettings, loadSettings, saveSettings, type SiteSettings } from '../lib/settings';
import { canManageSettings, type UserRole } from '../lib/roles';
import MediaManager from './MediaManager';
import styles from './SiteSettings.module.css';

export default function MediaLibrary({ role }: { role: UserRole }) {
  const [form, setForm] = useState<SiteSettings>(defaultSettings);
  const [showConfig, setShowConfig] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    loadSettings().then(setForm).catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load media settings.');
    });
  }, []);

  const field = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setFeedback('');
    try {
      await saveSettings({
        cloudinary_cloud_name: form.cloudinary_cloud_name.trim(),
        cloudinary_upload_preset: form.cloudinary_upload_preset.trim(),
        imagekit_public_key: form.imagekit_public_key.trim(),
        imagekit_url_endpoint: form.imagekit_url_endpoint.trim(),
      });
      setFeedback('Upload settings saved.');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save upload settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.container} aria-labelledby="media-heading">
      <div className={styles.pageIntro}>
        <h2 id="media-heading">Media</h2>
        <p>Upload images to Cloudinary or ImageKit, or add them by URL, then reuse them anywhere.</p>
      </div>

      {error && <div className={styles.error} role="alert"><span>{error}</span></div>}
      {feedback && <div className={styles.success} role="status">{feedback}</div>}

      {canManageSettings(role) && (
        <div className={styles.configToggleRow}>
          <button type="button" className={styles.secondaryButton} onClick={() => setShowConfig((open) => !open)}>
            {showConfig ? 'Hide upload settings' : 'Upload settings (Cloudinary & ImageKit)'}
          </button>
        </div>
      )}

      {showConfig && canManageSettings(role) && (
        <form className={styles.form} onSubmit={submit}>
          <label>
            Cloudinary cloud name
            <input value={form.cloudinary_cloud_name} onChange={(event) => field('cloudinary_cloud_name', event.target.value)}
              placeholder="your-cloud-name" />
          </label>
          <label>
            Cloudinary unsigned upload preset
            <input value={form.cloudinary_upload_preset} onChange={(event) => field('cloudinary_upload_preset', event.target.value)}
              placeholder="unsigned_preset" />
            <span className={styles.help}>
              In Cloudinary, go to Settings → Upload → Upload presets → Add upload preset, and set Signing Mode to
              Unsigned. Uploading needs nothing else. Deleting files needs <code>CLOUDINARY_API_KEY</code> and
              <code>CLOUDINARY_API_SECRET</code> in the server environment, because Cloudinary&rsquo;s delete API
              cannot be called from a browser.
            </span>
          </label>
          <label>
            ImageKit public key
            <input value={form.imagekit_public_key} onChange={(event) => field('imagekit_public_key', event.target.value)}
              placeholder="public_xxxxxxxx" />
          </label>
          <label>
            ImageKit URL endpoint
            <input value={form.imagekit_url_endpoint} onChange={(event) => field('imagekit_url_endpoint', event.target.value)}
              placeholder="https://ik.imagekit.io/your_id" />
            <span className={styles.help}>
              ImageKit signs both uploads and deletes on the server, so <code>IMAGEKIT_PRIVATE_KEY</code> must be set in
              the environment. Never paste a private key or API secret into this screen — these fields are public.
            </span>
          </label>
          <div className={styles.actions}>
            <button type="submit" className={styles.saveButton} disabled={saving}>
              {saving ? 'Saving…' : 'Save upload settings'}
            </button>
          </div>
        </form>
      )}

      <MediaManager heading="Media Library" />
    </section>
  );
}
