import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  appSettingsMigration, defaultAppSettings, deleteQuotaOverride, fetchDiskUsageReport, fetchQuotaOverrides,
  loadAppSettings, quotaRoles, saveAppSettings, saveQuotaOverride,
  type AppSettings as AppSettingsValue, type DiskUsageRow, type QuotaOverride,
} from '../lib/appSettings';
import { menuPlaceholders } from '../lib/dynamicMenu';
import { capabilityGrantDefinitions, capabilityLabels, roleLabels, type CapabilityGrants } from '../lib/roles';
import { defaultSettings, loadSettings, saveSettings, type SiteSettings } from '../lib/settings';
import { formatBytes } from '../lib/uploads';
import { sanitizeTrackingHtml } from '../lib/scriptSanitizer.js';
import { rwp } from '../lib/rwp';
import settingsStyles from './SiteSettings.module.css';
import styles from './AppSettings.module.css';

type Tab = 'general' | 'uploads' | 'seo' | 'roles';

const tabs: Array<[Tab, string, string]> = [
  ['general', 'General', 'What the public site shows, whose media each role sees, excerpts, and menu profile links.'],
  ['uploads', 'Uploads', 'File size and image dimension rules, and how much storage each role or person may use.'],
  ['seo', 'SEO', 'Meta keywords in the page editor, and tracking scripts such as Google Tag Manager.'],
  ['roles', 'Roles', 'Extra capabilities for Subscribers and Contributors.'],
];

const grantHelp: Record<keyof CapabilityGrants, string> = {
  subscriber_upload_files: 'Subscribers can open the admin Media screen and upload, within their disk quota.',
  subscriber_edit_posts: 'Subscribers can write posts and delete their own. Drafts only: publishing still needs an Author or above.',
  contributor_upload_files: 'Contributors can upload media, within their disk quota.',
  contributor_publish_posts: 'Contributors can publish their own posts without review.',
};

type Setter = <S extends keyof AppSettingsValue, K extends keyof AppSettingsValue[S]>(
  section: S, key: K, value: AppSettingsValue[S][K],
) => void;

/** Empty input means "no limit" (null). */
function LimitInput({ label, value, unit, onChange }: { label: string; value: number | null; unit: string; onChange: (value: number | null) => void }) {
  return (
    <label>
      {label}
      <span className={styles.unitRow}>
        <input type="number" min={0} step={1} value={value ?? ''} placeholder="No limit"
          onChange={(event) => onChange(event.target.value === '' ? null : Math.max(0, Math.floor(Number(event.target.value))))} />
        <span>{unit}</span>
      </span>
    </label>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label className={settingsStyles.checkboxRow}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {children}
    </label>
  );
}

function SanitizeReport({ source }: { source: string }) {
  const { removed } = useMemo(() => sanitizeTrackingHtml(source), [source]);
  if (!source.trim() || removed.length === 0) return null;
  return (
    <div className={settingsStyles.warning} role="status">
      These parts are not allowed and will be removed when you save:
      <ul>{removed.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </div>
  );
}

function QuotaOverrides() {
  const [overrides, setOverrides] = useState<QuotaOverride[]>([]);
  const [usage, setUsage] = useState<DiskUsageRow[]>([]);
  const [email, setEmail] = useState('');
  const [megabytes, setMegabytes] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [loadedOverrides, report] = await Promise.all([fetchQuotaOverrides(), fetchDiskUsageReport()]);
      setOverrides(loadedOverrides);
      setUsage(report);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load quota overrides.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const usageFor = (address: string) => usage.find((row) => row.email === address);

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (megabytes.trim() === '') throw new Error('Enter a quota in MB. Use 0 to block uploads for this person.');
      await saveQuotaOverride(email, Number(megabytes));
      setEmail('');
      setMegabytes('');
      await load();
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the override.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (address: string) => {
    setBusy(true);
    setError('');
    try {
      await deleteQuotaOverride(address);
      await load();
    } catch (removeError: unknown) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove the override.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className={settingsStyles.fieldset}>
      <legend>Per-user overrides</legend>
      <span className={settingsStyles.help}>
        An override replaces the role quota for one email address, including Administrators, and can be set before
        the person signs up. Overrides are saved immediately and are only readable by administrators.
      </span>
      {error && <div className={settingsStyles.error} role="alert"><span>{error}</span></div>}

      <form className={styles.inlineForm} onSubmit={add}>
        <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)}
          placeholder="person@example.com" list="rwp-quota-emails" aria-label="Email address" />
        <datalist id="rwp-quota-emails">{usage.map((row) => <option key={row.email} value={row.email} />)}</datalist>
        <input type="number" min={0} step={1} required value={megabytes} onChange={(event) => setMegabytes(event.target.value)}
          placeholder="MB" aria-label="Quota in MB" />
        <button type="submit" className={settingsStyles.secondaryButton} disabled={busy}>Save override</button>
      </form>

      {loading ? <p className={settingsStyles.help}>Loading overrides…</p> : overrides.length === 0 ? (
        <p className={settingsStyles.help}>No overrides yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Email</th><th>Quota</th><th>Used</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead>
            <tbody>
              {overrides.map((override) => {
                const row = usageFor(override.email);
                return (
                  <tr key={override.email}>
                    <td>{override.email}{!row && <small> · no account yet</small>}</td>
                    <td>{override.quota_mb === 0 ? 'No uploads' : `${override.quota_mb} MB`}</td>
                    <td>{row ? formatBytes(row.used_bytes) : '—'}</td>
                    <td><button type="button" className={styles.linkButton} disabled={busy} onClick={() => void remove(override.email)}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {usage.length > 0 && (
        <details>
          <summary className={styles.summary}>Disk usage by account</summary>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Account</th><th>Role</th><th>Used</th><th>Quota</th></tr></thead>
              <tbody>
                {usage.map((row) => (
                  <tr key={row.email}>
                    <td>{row.display_name || row.email}<small>{row.display_name ? ` · ${row.email}` : ''}</small></td>
                    <td>{roleLabels[row.role] || row.role}</td>
                    <td>{formatBytes(row.used_bytes) === '—' ? '0 B' : formatBytes(row.used_bytes)}</td>
                    <td>{row.quota_bytes === null ? 'Unlimited' : row.quota_bytes === 0 ? 'No uploads' : formatBytes(row.quota_bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </fieldset>
  );
}

export default function AppSettings() {
  const [tab, setTab] = useState<Tab>('general');
  const [form, setForm] = useState<AppSettingsValue>(defaultAppSettings);
  const [excerpt, setExcerpt] = useState<Pick<SiteSettings, 'excerpt_length' | 'excerpt_unit'>>({
    excerpt_length: defaultSettings.excerpt_length, excerpt_unit: defaultSettings.excerpt_unit,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const active = tabs.find(([id]) => id === tab) || tabs[0];

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [app, site] = await Promise.all([loadAppSettings(true), loadSettings()]);
      setForm(app);
      setExcerpt({ excerpt_length: site.excerpt_length, excerpt_unit: site.excerpt_unit });
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load App Settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const set: Setter = (section, key, value) =>
    setForm((current) => ({ ...current, [section]: { ...current[section], [key]: value } }));

  const setQuota = (role: (typeof quotaRoles)[number], value: number | null) =>
    setForm((current) => ({
      ...current,
      uploads: { ...current.uploads, quota_mb: { ...current.uploads.quota_mb, [role]: value } },
    }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setFeedback('');
    try {
      const { uploads } = form;
      if (uploads.min_width !== null && uploads.max_width !== null && uploads.min_width > uploads.max_width) {
        throw new Error(`The minimum image width (${uploads.min_width} px) is larger than the maximum (${uploads.max_width} px), so no image could be uploaded.`);
      }
      if (uploads.min_height !== null && uploads.max_height !== null && uploads.min_height > uploads.max_height) {
        throw new Error(`The minimum image height (${uploads.min_height} px) is larger than the maximum (${uploads.max_height} px), so no image could be uploaded.`);
      }
      const maxLength = excerpt.excerpt_unit === 'characters' ? 2000 : 300;
      if (!Number.isInteger(excerpt.excerpt_length) || excerpt.excerpt_length < 5 || excerpt.excerpt_length > maxLength) {
        throw new Error(`Excerpt length must be a whole number from 5 to ${maxLength} ${excerpt.excerpt_unit}.`);
      }
      const saved = await saveAppSettings(form);
      await saveSettings({ excerpt_length: excerpt.excerpt_length, excerpt_unit: excerpt.excerpt_unit });
      setForm(saved);
      rwp.actions.do('rwp_settings_saved', { app_settings: saved, ...excerpt });
      setFeedback('App Settings saved.');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save App Settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={settingsStyles.container} aria-labelledby="app-settings-heading">
      <div className={settingsStyles.pageIntro}>
        <h2 id="app-settings-heading">App Settings</h2>
        <p>{active[2]}</p>
      </div>

      <div className={settingsStyles.tabs} role="tablist" aria-label="App Settings sections">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            className={tab === id ? settingsStyles.tabActive : settingsStyles.tab} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className={settingsStyles.error} role="alert">
          <span>{error}</span>
          {loading || <button type="button" onClick={() => void load()}>Reload</button>}
        </div>
      )}
      {feedback && <div className={settingsStyles.success} role="status">{feedback}</div>}

      {loading ? <div className={settingsStyles.loading} role="status">Loading App Settings…</div> : (
        <>
          <form className={settingsStyles.form} onSubmit={submit}>
            {tab === 'general' && (
              <>
                <fieldset className={settingsStyles.fieldset}>
                  <legend>Display</legend>
                  <Toggle checked={form.general.show_page_titles} onChange={(value) => set('general', 'show_page_titles', value)}>
                    Show titles on pages
                  </Toggle>
                  <Toggle checked={form.general.show_post_titles} onChange={(value) => set('general', 'show_post_titles', value)}>
                    Show titles on posts and in the blog feed
                  </Toggle>
                  <Toggle checked={form.general.show_post_dates} onChange={(value) => set('general', 'show_post_dates', value)}>
                    Show publish dates on posts and in the blog feed
                  </Toggle>
                  <span className={settingsStyles.help}>
                    A hidden title stays in the page for screen readers and search engines. Pages drawn with the page
                    builder use their own Heading and Post Meta widgets instead.
                  </span>
                </fieldset>

                <fieldset className={settingsStyles.fieldset}>
                  <legend>Content access</legend>
                  <Toggle checked={form.general.scope_media_to_owner} onChange={(value) => set('general', 'scope_media_to_owner', value)}>
                    Authors, Contributors and Subscribers see and manage only media they uploaded
                  </Toggle>
                  <span className={settingsStyles.help}>
                    Enforced by the database: editing or deleting someone else&rsquo;s file is refused, including at
                    Cloudinary and ImageKit. Editors and above keep access to everything. Posts and comments are already
                    limited this way for every site — those roles only list their own posts, and only moderators (Editor
                    and above) can open Comments.
                  </span>
                </fieldset>

                <fieldset className={settingsStyles.fieldset}>
                  <legend>Excerpts</legend>
                  <div className={styles.twoColumns}>
                    <label>
                      Default excerpt length
                      <input type="number" min={5} max={excerpt.excerpt_unit === 'characters' ? 2000 : 300} value={excerpt.excerpt_length}
                        onChange={(event) => setExcerpt((current) => ({ ...current, excerpt_length: Number(event.target.value) }))} />
                    </label>
                    <label>
                      Measured in
                      <select value={excerpt.excerpt_unit}
                        onChange={(event) => setExcerpt((current) => ({ ...current, excerpt_unit: event.target.value as SiteSettings['excerpt_unit'] }))}>
                        <option value="words">Words</option>
                        <option value="characters">Characters</option>
                      </select>
                    </label>
                  </div>
                  <span className={settingsStyles.help}>
                    Used when a post has no excerpt of its own. WordPress defaults to 55 words. Character excerpts end
                    at the last whole word.
                  </span>
                </fieldset>

                <fieldset className={settingsStyles.fieldset}>
                  <legend>Menu profile links</legend>
                  <label>
                    Profile page URL
                    <input value={form.menu.profile_url} onChange={(event) => set('menu', 'profile_url', event.target.value)}
                      placeholder={defaultAppSettings.menu.profile_url} />
                    <span className={settingsStyles.help}>
                      Where <code>#profile_url#</code> in a menu item links to. <code>{'{id}'}</code> is replaced with the
                      visitor&rsquo;s user id, e.g. <code>/author/{'{id}'}</code> for a plugin route. The admin Profile screen
                      only opens for roles that can use the admin; point Subscribers at a public page instead.
                    </span>
                  </label>
                  <ul className={settingsStyles.steps}>
                    {menuPlaceholders.map((placeholder) => (
                      <li key={placeholder.token}><code>{placeholder.token}</code> in the {placeholder.where}: {placeholder.description}</li>
                    ))}
                  </ul>
                  <span className={settingsStyles.help}>
                    Add these under <strong>Menus</strong>, where each item also chooses what logged-out visitors see.
                  </span>
                </fieldset>
              </>
            )}

            {tab === 'uploads' && (
              <>
                <fieldset className={settingsStyles.fieldset}>
                  <legend>File rules</legend>
                  <LimitInput label="Maximum upload size" unit="KB" value={form.uploads.max_upload_kb}
                    onChange={(value) => set('uploads', 'max_upload_kb', value)} />
                  <div className={styles.twoColumns}>
                    <LimitInput label="Minimum image width" unit="px" value={form.uploads.min_width} onChange={(value) => set('uploads', 'min_width', value)} />
                    <LimitInput label="Minimum image height" unit="px" value={form.uploads.min_height} onChange={(value) => set('uploads', 'min_height', value)} />
                    <LimitInput label="Maximum image width" unit="px" value={form.uploads.max_width} onChange={(value) => set('uploads', 'max_width', value)} />
                    <LimitInput label="Maximum image height" unit="px" value={form.uploads.max_height} onChange={(value) => set('uploads', 'max_height', value)} />
                  </div>
                  <span className={settingsStyles.help}>
                    Leave a field empty for no limit. Files are checked in the browser before they are sent, and again by
                    the database when they are added to the library. Because files go straight from the browser to
                    Cloudinary or ImageKit, the database relies on the size the browser reports: these rules stop normal
                    use, not someone calling the provider directly. For a hard limit, also restrict your Cloudinary
                    upload preset.
                  </span>
                </fieldset>

                <fieldset className={settingsStyles.fieldset}>
                  <legend>Disk quota by role</legend>
                  <div className={styles.twoColumns}>
                    {quotaRoles.map((role) => (
                      <LimitInput key={role} label={roleLabels[role]} unit="MB" value={form.uploads.quota_mb[role]}
                        onChange={(value) => setQuota(role, value)} />
                    ))}
                  </div>
                  <span className={settingsStyles.help}>
                    Total size of everything a person has uploaded. Empty means unlimited; 0 means no uploads. Shop
                    Managers use the Editor quota; Administrators are unlimited unless given an override below. External
                    URLs do not count. Subscribers and Contributors can only upload when allowed under Roles.
                  </span>
                </fieldset>
              </>
            )}

            {tab === 'seo' && (
              <>
                <fieldset className={settingsStyles.fieldset}>
                  <legend>Meta fields</legend>
                  <Toggle checked={form.seo.meta_keywords_enabled} onChange={(value) => set('seo', 'meta_keywords_enabled', value)}>
                    Add a Meta keywords field to the page editor and output it as <code>&lt;meta name="keywords"&gt;</code>
                  </Toggle>
                  <span className={settingsStyles.help}>
                    The meta description field is always available in the editor&rsquo;s SEO panel. Google ignores meta
                    keywords; turn this on only if another search engine or tool you use reads them. Needs the{' '}
                    <code>{appSettingsMigration}</code> migration.
                  </span>
                </fieldset>

                <fieldset className={settingsStyles.fieldset}>
                  <legend>Tracking scripts</legend>
                  <label>
                    Header scripts
                    <textarea rows={7} className={styles.code} spellCheck={false} value={form.seo.header_script}
                      onChange={(event) => set('seo', 'header_script', event.target.value)}
                      placeholder={'<!-- Google Tag Manager -->\n<script>(function(w,d,s,l,i){…})(window,document,\'script\',\'dataLayer\',\'GTM-XXXX\');</script>'} />
                    <span className={settingsStyles.help}>Placed at the end of <code>&lt;head&gt;</code> on every public page.</span>
                  </label>
                  <SanitizeReport source={form.seo.header_script} />
                  <label>
                    Body scripts
                    <textarea rows={5} className={styles.code} spellCheck={false} value={form.seo.body_script}
                      onChange={(event) => set('seo', 'body_script', event.target.value)}
                      placeholder={'<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXX" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>'} />
                    <span className={settingsStyles.help}>Placed right after <code>&lt;body&gt;</code>, where GTM&rsquo;s noscript tag belongs.</span>
                  </label>
                  <SanitizeReport source={form.seo.body_script} />
                  <span className={settingsStyles.help}>
                    Only <code>&lt;script&gt;</code>, <code>&lt;noscript&gt;</code> (with an iframe or image inside),{' '}
                    <code>&lt;link&gt;</code> and <code>&lt;meta&gt;</code> are kept, and external URLs must use https. The
                    scripts run for every visitor, so paste only code from a provider you trust. They are not added to the
                    admin or the page builder. With <code>npm start</code> the server writes them into the page; elsewhere
                    (Vercel, <code>npm run dev</code>) the browser adds them after loading.
                  </span>
                </fieldset>
              </>
            )}

            {tab === 'roles' && (
              <fieldset className={settingsStyles.fieldset}>
                <legend>Extra capabilities</legend>
                {(Object.keys(capabilityGrantDefinitions) as Array<keyof CapabilityGrants>).map((key) => {
                  const { role, capabilities } = capabilityGrantDefinitions[key];
                  return (
                    <div key={key} className={styles.grant}>
                      <Toggle checked={form.roles[key]} onChange={(value) => set('roles', key, value)}>
                        {roleLabels[role]}: {capabilities.map((capability) => capabilityLabels[capability]).join(' and ')}
                      </Toggle>
                      <span className={settingsStyles.help}>{grantHelp[key]}</span>
                    </div>
                  );
                })}
                <span className={settingsStyles.help}>
                  Enforced by the database (<code>user_has_cap</code>), not just this screen. Only these four can be
                  granted here; anything beyond them means changing the person&rsquo;s role under <strong>Users</strong>.
                  People who are signed in pick up a change the next time they load a page.
                </span>
              </fieldset>
            )}

            <div className={settingsStyles.actions}>
              <button type="submit" className={settingsStyles.saveButton} disabled={saving}>
                {saving ? 'Saving…' : 'Save App Settings'}
              </button>
            </div>
          </form>

          {tab === 'uploads' && <div className={styles.overrides}><QuotaOverrides /></div>}
        </>
      )}
    </section>
  );
}
