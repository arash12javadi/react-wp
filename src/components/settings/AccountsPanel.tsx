import { useEffect, useState, type FormEvent } from 'react';
import { defaultSettings, loadSettings, saveSettings, type SiteSettings } from '../../lib/settings';
import { roleLabels } from '../../lib/roles';
import styles from '../SiteSettings.module.css';

// Administrator and super_admin are deliberately absent: auto-granting either to anyone who
// submits a signup form is a site-takeover vector. The database trigger rejects them too.
const assignableRoles = ['subscriber', 'contributor', 'author', 'editor'] as const;

export default function AccountsPanel() {
  const [form, setForm] = useState<SiteSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    loadSettings()
      .then(setForm)
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Unable to load account settings.'))
      .finally(() => setLoading(false));
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
        users_can_register: form.users_can_register,
        default_user_role: form.default_user_role,
        show_auth_links: form.show_auth_links,
        auth_google_enabled: form.auth_google_enabled,
        auth_facebook_enabled: form.auth_facebook_enabled,
        comments_enabled: form.comments_enabled,
        comment_moderation: form.comment_moderation,
        comment_max_depth: form.comment_max_depth,
      });
      setFeedback('Account settings saved.');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save account settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className={styles.loading} role="status">Loading account settings…</div>;

  return (
    <>
      {error && <div className={styles.error} role="alert"><span>{error}</span></div>}
      {feedback && <div className={styles.success} role="status">{feedback}</div>}

      <form className={styles.form} onSubmit={submit}>
        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={form.users_can_register}
            onChange={(event) => field('users_can_register', event.target.checked)} />
          Anyone can register
        </label>

        <label>
          New user default role
          <select value={form.default_user_role} onChange={(event) => field('default_user_role', event.target.value)}>
            {assignableRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
          </select>
          <span className={styles.help}>
            Applied by the database when an account is created, so it cannot be overridden by the sign-up request.
            Administrator and Super Admin are not offered here on purpose — granting either automatically would let
            anyone who registers take over the site. Promote those accounts by hand under <strong>Users</strong>.
          </span>
        </label>

        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={form.show_auth_links}
            onChange={(event) => field('show_auth_links', event.target.checked)} />
          Show login and register links in the site navigation
        </label>
        <span className={styles.help}>
          The <code>[rwp_login]</code> shortcode keeps working either way. Add <code>[rwp_login]</code> to any page or
          post to place a login/logout button there, optionally with <code>label="Sign in"</code> or
          <code>style="link"</code>.
        </span>

        <fieldset className={styles.fieldset}>
          <legend>Social sign-in</legend>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={form.auth_google_enabled}
              onChange={(event) => field('auth_google_enabled', event.target.checked)} />
            Show the Google button
          </label>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={form.auth_facebook_enabled}
              onChange={(event) => field('auth_facebook_enabled', event.target.checked)} />
            Show the Facebook button
          </label>
          <span className={styles.help}>
            These toggles only control whether the buttons appear. The sign-in itself is performed by Supabase, so each
            provider must also be configured there or the button will return an error:
          </span>
          <ol className={styles.steps}>
            <li>
              In Supabase, open <strong>Authentication → Providers</strong>, enable the provider, and paste in the
              client ID and secret from Google Cloud Console or Meta for Developers.
            </li>
            <li>
              Open <strong>Authentication → URL Configuration</strong> and add <code>{`${window.location.origin}/login`}</code>
              {' '}to <strong>Redirect URLs</strong>. A missing entry here is what causes a redirect mismatch error.
            </li>
          </ol>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend>Comments</legend>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={form.comments_enabled}
              onChange={(event) => field('comments_enabled', event.target.checked)} />
            Enable comments across the site
          </label>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={form.comment_moderation}
              onChange={(event) => field('comment_moderation', event.target.checked)} />
            Hold new comments for approval
          </label>
          <label>
            Maximum reply depth
            <input type="number" min={1} max={10} value={form.comment_max_depth}
              onChange={(event) => field('comment_max_depth', Number(event.target.value))} />
            <span className={styles.help}>
              Replies nest without limit in the database; this only caps how far they are indented when displayed,
              since deeper threads become unreadable on a phone. Commenting requires an account — individual pages can
              close comments in the editor.
            </span>
          </label>
        </fieldset>

        <div className={styles.actions}>
          <button type="submit" className={styles.saveButton} disabled={saving}>
            {saving ? 'Saving…' : 'Save account settings'}
          </button>
        </div>
      </form>
    </>
  );
}
