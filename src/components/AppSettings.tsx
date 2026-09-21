import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  appSettingsMigration, defaultAppSettings, deleteQuotaOverride, fetchDiskUsageReport, fetchQuotaOverrides,
  loadAppSettings, quotaRoles, saveAppSettings, saveQuotaOverride,
  type AppSettings as AppSettingsValue, type DiskUsageRow, type QuotaOverride,
} from '../lib/appSettings';
import { menuPlaceholders } from '../lib/dynamicMenu';
import { roleLabels } from '../lib/roles';
import { defaultSettings, loadSettings, saveSettings, type SiteSettings } from '../lib/settings';
import { formatBytes } from '../lib/uploads';
import { sanitizeTrackingHtml } from '../lib/scriptSanitizer.js';
import {
  builtinLocales, defaultI18nSettings, i18nMigration, loadI18nSettings, localeDefinition,
  saveI18nSettings, type I18nSettings,
} from '../lib/i18n';
import LanguageSwitcher from './LanguageSwitcher';
import { rwp } from '../lib/rwp';
import settingsStyles from './SiteSettings.module.css';
import styles from './AppSettings.module.css';

// Roles has its own screen (settings/RolesPanel): its changes save one at a time, not with this form.
type Tab = 'general' | 'uploads' | 'seo' | 'languages';

export const isAppSettingsTab = (value: string): value is Tab =>
  ['general', 'uploads', 'seo', 'languages'].includes(value);

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

/**
 * Settings → Languages. Unlike the rest of this screen these are four plain rows in the public
 * `options` table, not keys inside rwp_app_settings, because the public site reads them before
 * anything else loads (see src/lib/i18n.ts).
 */
function LanguageFields({ value, onChange }: { value: I18nSettings; onChange: (next: I18nSettings) => void }) {
  const [customCode, setCustomCode] = useState('');
  const set = <K extends keyof I18nSettings>(key: K, next: I18nSettings[K]) => onChange({ ...value, [key]: next });

  const toggleSupported = (code: string, enabled: boolean) => {
    const next = enabled
      ? [...new Set([...value.supported_languages, code])]
      : value.supported_languages.filter((entry) => entry !== code);
    // The two defaults are what visitors fall back to, so they can never be switched off.
    if (!enabled && (code === value.default_site_language || code === value.default_admin_language)) return;
    set('supported_languages', next.length ? next : [value.default_site_language]);
  };

  const addCustom = () => {
    const code = customCode.trim().toLowerCase();
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(code)) return;
    set('supported_languages', [...new Set([...value.supported_languages, code])]);
    setCustomCode('');
  };

  // Offered in the two default pickers: only languages the site actually publishes.
  const choices = value.supported_languages.map(localeDefinition);
  const known = Object.keys(builtinLocales);
  const extra = value.supported_languages.filter((code) => !known.includes(code));

  return (
    <>
      <fieldset className={settingsStyles.fieldset}>
        <legend>Languages this site offers</legend>
        <div className={styles.twoColumns}>
          {[...known, ...extra].map((code) => {
            const definition = localeDefinition(code);
            const locked = code === value.default_site_language || code === value.default_admin_language;
            return (
              <Toggle key={code} checked={value.supported_languages.includes(code)}
                onChange={(enabled) => toggleSupported(code, enabled)}>
                <span lang={code}>{definition.nativeName}</span>
                {' '}
                <small>({definition.name} · {code} · {definition.dir.toUpperCase()}){locked ? ' · default' : ''}</small>
              </Toggle>
            );
          })}
        </div>
        <div className={styles.inlineForm}>
          <input value={customCode} onChange={(event) => setCustomCode(event.target.value)}
            placeholder="Another code, e.g. tr or pt-br" aria-label="Add a language code" />
          <button type="button" className={settingsStyles.secondaryButton} onClick={addCustom}>Add language</button>
        </div>
        <span className={settingsStyles.help}>
          A language added here appears in the switcher and gives pages built with the Page Builder their own layout.
          Codes outside this list get right-to-left treatment automatically for the usual RTL scripts (Arabic, Persian,
          Hebrew, Urdu) and left-to-right otherwise, but no bundled font or translated interface strings.
        </span>
      </fieldset>

      <fieldset className={settingsStyles.fieldset}>
        <legend>Defaults</legend>
        <div className={styles.twoColumns}>
          <label>
            Public site language
            <select value={value.default_site_language} onChange={(event) => set('default_site_language', event.target.value)}>
              {choices.map((locale) => <option key={locale.code} value={locale.code}>{locale.name} ({locale.code})</option>)}
            </select>
          </label>
          <label>
            Admin dashboard language
            <select value={value.default_admin_language} onChange={(event) => set('default_admin_language', event.target.value)}>
              {choices.map((locale) => <option key={locale.code} value={locale.code}>{locale.name} ({locale.code})</option>)}
            </select>
          </label>
        </div>
        <span className={settingsStyles.help}>
          A visitor who has never chosen a language gets the first of their browser languages this site offers, and the
          public default when none of them match. Someone who uses the switcher keeps their choice in this browser.
          The admin has its own stored choice, so you can work in English on a Persian site.
        </span>
      </fieldset>

      <fieldset className={settingsStyles.fieldset}>
        <legend>Language switcher</legend>
        <Toggle checked={value.show_header_language_switcher} onChange={(next) => set('show_header_language_switcher', next)}>
          Show the language switcher on the public site
        </Toggle>
        <span className={settingsStyles.help}>
          It sits in the header&rsquo;s action buttons and is hidden automatically while the site offers one language.
          Appearance → Theme Editor → Header action buttons can hide it for one layout without turning it off here.
          Needs the <code>{i18nMigration}</code> migration.
        </span>
        <div className={styles.grant}>
          <span className={settingsStyles.help}>Preview — these buttons switch this admin screen&rsquo;s language:</span>
          <LanguageSwitcher variant="inline" force showFlags />
        </div>
      </fieldset>
    </>
  );
}

/** Settings → General, Uploads, SEO and Languages. The sidebar picks the section. */
export default function AppSettings({ tab }: { tab: Tab }) {
  const [form, setForm] = useState<AppSettingsValue>(defaultAppSettings);
  const [excerpt, setExcerpt] = useState<Pick<SiteSettings, 'excerpt_length' | 'excerpt_unit'>>({
    excerpt_length: defaultSettings.excerpt_length, excerpt_unit: defaultSettings.excerpt_unit,
  });
  const [languages, setLanguages] = useState<I18nSettings>(defaultI18nSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [app, site, i18n] = await Promise.all([
        loadAppSettings(true), loadSettings(),
        // A site that has not run the i18n migration has no such rows; the defaults stand in and
        // the screen stays usable, it just has nothing saved yet.
        loadI18nSettings(true).catch(() => defaultI18nSettings),
      ]);
      setForm(app);
      setLanguages(i18n);
      setExcerpt({ excerpt_length: site.excerpt_length, excerpt_unit: site.excerpt_unit });
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load settings.');
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
      if (!languages.supported_languages.length) {
        throw new Error('Choose at least one language for the site.');
      }
      const saved = await saveAppSettings(form);
      await saveSettings({ excerpt_length: excerpt.excerpt_length, excerpt_unit: excerpt.excerpt_unit });
      const savedLanguages = await saveI18nSettings(languages);
      setForm(saved);
      setLanguages(savedLanguages);
      rwp.actions.do('rwp_settings_saved', { app_settings: saved, i18n: savedLanguages, ...excerpt });
      setFeedback('Settings saved (General, Uploads, SEO and Languages are saved together).');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={settingsStyles.container}>
      {error && (
        <div className={settingsStyles.error} role="alert">
          <span>{error}</span>
          {loading || <button type="button" onClick={() => void load()}>Reload</button>}
        </div>
      )}
      {feedback && <div className={settingsStyles.success} role="status">{feedback}</div>}

      {loading ? <div className={settingsStyles.loading} role="status">Loading settings…</div> : (
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
                      visitor&rsquo;s user id, e.g. <code>/author/{'{id}'}</code> for a plugin route. The default,{' '}
                      <code>/profile</code>, shows the User profile page chosen under <strong>Settings → Site</strong> and
                      works for every role.
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

            {tab === 'languages' && <LanguageFields value={languages} onChange={setLanguages} />}

            <div className={settingsStyles.actions}>
              <button type="submit" className={settingsStyles.saveButton} disabled={saving}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </form>

          {tab === 'uploads' && <div className={styles.overrides}><QuotaOverrides /></div>}
        </>
      )}
    </div>
  );
}
