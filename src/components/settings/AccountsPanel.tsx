import { useEffect, useState, type FormEvent } from 'react';
import {
  adminToolbarLabels, defaultSettings, loadSettings, saveSettings, type AdminToolbarMode, type SiteSettings,
} from '../../lib/settings';
import { roleLabels } from '../../lib/roles';
import { getSupabaseClient } from '../../lib/db';
import { accountPages, isSafeUrl } from '../../lib/account';
import AccountPagePicker, { type PickerPage } from './AccountPagePicker';
import styles from '../SiteSettings.module.css';

// The profile and dashboard pages are chosen under Settings → Site, next to the home page.
const signInPages = accountPages.filter((page) => page.key === 'login' || page.key === 'register' || page.key === 'lost_password');
type SignInKey = 'login' | 'register' | 'lost_password';

const logoutPresets: Array<[string, string]> = [
  ['', 'Stay on the same page'],
  ['/', 'The home page'],
  ['/login', 'The log in page'],
];

const loginPresets: Array<[string, string]> = [
  ['', 'The admin for roles that can use it, the user dashboard for everyone else'],
  ['/dashboard', 'The user dashboard, for everyone'],
  ['/profile', 'The user profile page'],
  ['/', 'The home page'],
];

/** A preset choice, or "custom" with its own text box. */
function RedirectField({ label, value, presets, help, onChange }: {
  label: string; value: string; presets: Array<[string, string]>; help: string; onChange: (value: string) => void;
}) {
  const preset = presets.some(([path]) => path === value);
  const [custom, setCustom] = useState(!preset);
  return (
    <label>
      {label}
      <select value={custom ? 'custom' : value} onChange={(event) => {
        const next = event.target.value;
        setCustom(next === 'custom');
        if (next !== 'custom') onChange(next);
      }}>
        {presets.map(([path, text]) => <option key={path} value={path}>{text}</option>)}
        <option value="custom">Another address…</option>
      </select>
      {custom && <input value={value} placeholder="/welcome or https://…" onChange={(event) => onChange(event.target.value)} />}
      <span className={styles.help}>{help}</span>
    </label>
  );
}

// Administrator and super_admin are deliberately absent: auto-granting either to anyone who
// submits a signup form is a site-takeover vector. The database trigger rejects them too.
const assignableRoles = ['subscriber', 'contributor', 'author', 'editor'] as const;

export default function AccountsPanel() {
  const [form, setForm] = useState<SiteSettings>(defaultSettings);
  const [pages, setPages] = useState<PickerPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    Promise.all([
      loadSettings(),
      getSupabaseClient().from('pages').select('id,title,status').eq('is_post', false).or('status.is.null,status.neq.trash').order('title'),
    ])
      .then(([settings, { data }]) => {
        setForm(settings);
        setPages((data || []) as PickerPage[]);
      })
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
      const loginRedirect = form.login_redirect.trim();
      const logoutRedirect = form.logout_redirect.trim();
      for (const [name, value] of [['After signing in', loginRedirect], ['After signing out', logoutRedirect]]) {
        if (value && !isSafeUrl(value)) throw new Error(`${name}: "${value}" is not a path starting with / or an http(s) address.`);
      }
      await saveSettings({
        login_page_id: form.login_page_id,
        login_page_url: form.login_page_url.trim(),
        register_page_id: form.register_page_id,
        register_page_url: form.register_page_url.trim(),
        lost_password_page_id: form.lost_password_page_id,
        lost_password_page_url: form.lost_password_page_url.trim(),
        login_redirect: loginRedirect,
        logout_redirect: logoutRedirect,
        admin_toolbar: form.admin_toolbar,
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

        <fieldset className={styles.fieldset}>
          <legend>Sign-in pages</legend>
          {signInPages.map((definition) => {
            const key = definition.key as SignInKey;
            return (
              <AccountPagePicker
                key={key}
                definition={definition}
                pageId={form[`${key}_page_id`]}
                url={form[`${key}_page_url`]}
                pages={pages}
                onChange={(pageId, url) => setForm((current) => ({ ...current, [`${key}_page_id`]: pageId, [`${key}_page_url`]: url }))}
                onPageCreated={(page) => setPages((current) => [...current, page].sort((a, b) => a.title.localeCompare(b.title)))}
              />
            );
          })}
          <span className={styles.help}>
            A chosen page is edited like any other page: put the form where you want it with{' '}
            <code>[rwp_login_form]</code>, <code>[rwp_register_form]</code> or <code>[rwp_lost_password_form]</code>, and
            add text, images or a Page Builder layout around it. Each form takes <code>title</code>, <code>subtitle</code>,{' '}
            <code>button</code> and <code>redirect</code> attributes (Dashboard → Guide lists them all). If the chosen page is
            unpublished or deleted, the built-in screen is shown, so nobody is locked out of signing in.
          </span>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend>Redirects</legend>
          <RedirectField label="After signing in or registering" value={form.login_redirect} presets={loginPresets}
            onChange={(value) => field('login_redirect', value)}
            help="Only when the link did not ask for a page: “Log in” links remember the page they were on (?redirect=), and that always wins." />
          <RedirectField label="After signing out" value={form.logout_redirect} presets={logoutPresets}
            onChange={(value) => field('logout_redirect', value)}
            help="Applies to every Log out button: the admin toolbar, menus, [rwp_login], the user dashboard and the admin." />
        </fieldset>

        <label>
          Show the admin toolbar on the public site to
          <select value={form.admin_toolbar} onChange={(event) => field('admin_toolbar', event.target.value as AdminToolbarMode)}>
            {(Object.keys(adminToolbarLabels) as AdminToolbarMode[]).map((mode) => (
              <option key={mode} value={mode}>{adminToolbarLabels[mode]}</option>
            ))}
          </select>
          <span className={styles.help}>
            The dark bar across the top of the site with Dashboard, Edit page, Profile and Log out, as in WordPress. The admin
            itself always has it. Hiding it only removes the bar; menus and <code>[rwp_login]</code> still offer signing out.
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
            <li>
              Add <code>{`${window.location.origin}/lost-password`}</code> there too: password reset emails link to it.
              Without it Supabase sends people to the Site URL, and the site forwards them to /lost-password itself.
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
