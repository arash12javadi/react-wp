import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  antiBotProviderLabels, defaultSecuritySettings, fetchServerSecurityStatus, loadSecretStatus,
  loadSecuritySettings, purgePageCache, refreshServerSecurity, revokeUserSessions, sameSiteLabels,
  saveAntiBotSecret, saveSecuritySettings, securityMigration,
  type SameSitePolicy, type SecuritySettings, type SecretStatus, type ServerSecurityStatus,
} from '../../lib/security';
import { antiBotFormLabels, antiBotForms, forgetAntiBotConfig, type AntiBotForm, type AntiBotProvider } from '../../lib/antiBot';
import { isEndpointUnavailable } from '../../lib/pluginSchema';
import { getSupabaseClient } from '../../lib/db';
import { formatBytes } from '../../lib/uploads';
import styles from '../SiteSettings.module.css';

/**
 * Settings → Security, in four sections chosen from the admin sidebar. One component for all four
 * so unsaved changes survive switching between them, exactly as AppSettings does.
 *
 * Everything on this screen is read by server.mjs, not by the browser, so the server's own view of
 * it is shown alongside: what it last read, when, and whether it could read it at all. A settings
 * screen that shows what was typed rather than what is in force is how a site ends up with a rate
 * limit nobody is applying.
 */

export type SecurityTab = 'security' | 'anti-bot' | 'performance' | 'indexing';

const securityTabs: SecurityTab[] = ['security', 'anti-bot', 'performance', 'indexing'];

export const isSecurityTab = (value: string): value is SecurityTab =>
  (securityTabs as string[]).includes(value);

interface Person {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
}

function NumberField({ label, value, unit, min, max, help, onChange }: {
  label: string; value: number; unit: string; min: number; max: number; help?: ReactNode; onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <span className={styles.unitRow}>
        <input type="number" min={min} max={max} step={1} value={value}
          onChange={(event) => onChange(Math.min(max, Math.max(min, Math.floor(Number(event.target.value) || 0))))} />
        <span>{unit}</span>
      </span>
      {help && <span className={styles.help}>{help}</span>}
    </label>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label className={styles.checkboxRow}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {children}
    </label>
  );
}

/** What the server is actually running on, next to what the form says. */
function ServerState({ status, error, onRefresh, busy }: {
  status: ServerSecurityStatus | null; error: string; onRefresh: () => void; busy: boolean;
}) {
  if (error) {
    return (
      <div className={styles.warning} role="status">
        <strong>The server could not be asked what it is running.</strong>
        <p className={styles.cardText}>{error}</p>
      </div>
    );
  }
  if (!status) return <p className={styles.help}>Asking the server what it is running…</p>;
  return (
    <div className={styles.backupSummary}>
      <p>
        The server last read these settings{' '}
        {status.refreshed_at ? <strong>{new Date(status.refreshed_at).toLocaleString()}</strong> : <strong>never</strong>}
        {' '}and re-reads them every {status.refresh_interval_seconds} seconds.
        {status.stale && <> Its last attempt failed: <code>{status.error || 'unknown error'}</code>, so it is still applying the previous values.</>}
      </p>
      <p>
        Rate limiter: <code>{status.rate_limits?.keys ?? 0}</code> live counters.{' '}
        Page cache: <code>{status.cache?.entries ?? 0}</code> pages, <code>{formatBytes(status.cache?.bytes ?? null)}</code>,{' '}
        <code>{status.cache?.hits ?? 0}</code> hits / <code>{status.cache?.misses ?? 0}</code> misses.{' '}
        Flagged addresses: <code>{status.anti_bot?.flagged_addresses ?? 0}</code>.
      </p>
      {status.settings?.cache_enable_compression && status.cache && (
        <p>
          Compression: <code>{status.cache.compressed_entries ?? 0}</code> of <code>{status.cache.entries ?? 0}</code>{' '}
          cached page(s) have a precomputed Brotli/gzip copy ({formatBytes(status.cache.stored_bytes ?? null)} held in
          memory for all of them together); <code>{status.cache.cached_assets ?? 0}</code> built asset(s) compressed
          and reused.
          {status.cache.compressed_entries === undefined && (
            // The running server process predates this field: it has not been restarted since the
            // last update. Said plainly, because "undefined" numbers here are otherwise a silent bug.
            <> <em>(The server appears to be running an older build — restart it to see these numbers.)</em></>
          )}
        </p>
      )}
      <button type="button" className={styles.secondaryButton} disabled={busy} onClick={onRefresh}>
        {busy ? 'Refreshing…' : 'Make the server re-read now'}
      </button>
    </div>
  );
}

export default function SecurityPanel({ tab }: { tab: SecurityTab }) {
  const [form, setForm] = useState<SecuritySettings>(defaultSecuritySettings);
  const [secret, setSecret] = useState<SecretStatus | null>(null);
  const [secretInput, setSecretInput] = useState('');
  const [status, setStatus] = useState<ServerSecurityStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [revokeId, setRevokeId] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [migrationMissing, setMigrationMissing] = useState(false);

  const loadStatus = async () => {
    try {
      setStatus(await fetchServerSecurityStatus());
      setStatusError('');
    } catch (statusFailure: unknown) {
      setStatus(null);
      setStatusError(isEndpointUnavailable(statusFailure)
        ? `${statusFailure.message} The settings below are still saved, and take effect wherever the Node server does run.`
        : statusFailure instanceof Error ? statusFailure.message : 'Unknown error.');
    }
  };

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const settings = await loadSecuritySettings();
        if (mounted) setForm(settings);
      } catch (loadError: unknown) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'Unable to load the security settings.');
      }
      // The secret table only exists after the migration; its absence is a prompt, not an error.
      // Anything else (a permission refusal, a network failure) is a real error and is shown as one.
      try {
        const loaded = await loadSecretStatus();
        if (mounted) setSecret(loaded);
      } catch (secretError: unknown) {
        const message = secretError instanceof Error ? secretError.message : 'Unknown error.';
        if (!mounted) return;
        if (/PGRST202|Could not find the function/i.test(message)) setMigrationMissing(true);
        else setError(message);
      }
      const { data } = await getSupabaseClient()
        .from('profiles').select('id,email,display_name,role').order('email').limit(500);
      if (mounted) setPeople((data || []) as Person[]);
      await loadStatus();
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const field = <K extends keyof SecuritySettings>(key: K, value: SecuritySettings[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const toggleForm = (name: AntiBotForm, on: boolean) =>
    field('anti_bot_forms', on
      ? [...form.anti_bot_forms.filter((entry) => entry !== name), name]
      : form.anti_bot_forms.filter((entry) => entry !== name));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setFeedback('');
    try {
      if (form.anti_bot_provider !== 'none' && !form.anti_bot_site_key.trim()) {
        throw new Error(`${antiBotProviderLabels[form.anti_bot_provider]} needs a site key. Paste it in, or set the provider back to "None".`);
      }
      await saveSecuritySettings({ ...form, anti_bot_site_key: form.anti_bot_site_key.trim() });
      if (secretInput.trim()) {
        setSecret(await saveAntiBotSecret(secretInput.trim()));
        setSecretInput('');
      }
      // The browser's cached copy of /api/security/config and the server's own snapshot are both
      // now out of date; a save that needs a restart or a wait is a save people stop trusting.
      forgetAntiBotConfig();
      try {
        setStatus(await refreshServerSecurity());
        setStatusError('');
      } catch {
        // A static host has no server to refresh. The rows are saved either way.
      }
      setFeedback('Security settings saved and applied.');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save the security settings.');
    } finally {
      setSaving(false);
    }
  };

  const run = async (name: string, work: () => Promise<string>) => {
    setBusy(name);
    setError('');
    setFeedback('');
    try {
      setFeedback(await work());
      await loadStatus();
    } catch (actionError: unknown) {
      setError(actionError instanceof Error ? actionError.message : 'That did not work.');
    } finally {
      setBusy('');
    }
  };

  const chosenPerson = useMemo(() => people.find((person) => person.id === revokeId), [people, revokeId]);

  if (loading) return <div className={styles.loading} role="status">Loading the security settings…</div>;

  return (
    <>
      {migrationMissing && (
        <div className={styles.warning} role="status">
          <strong>This site has not run the security migration yet.</strong>
          <p className={styles.cardText}>
            Run <code>{securityMigration}</code> in the Supabase SQL Editor. Until then the settings below fall back to
            their defaults and the CAPTCHA secret has nowhere to be stored.
          </p>
        </div>
      )}
      {error && <div className={styles.error} role="alert"><span>{error}</span></div>}
      {feedback && <div className={styles.success} role="status">{feedback}</div>}

      <form className={styles.form} onSubmit={submit}>
        {tab === 'security' && (
          <>
            <fieldset className={styles.fieldset}>
              <legend>Session lifetime</legend>
              <p className={styles.help}>
                How long someone stays signed in on this site. Supabase owns the token's own expiry
                (Authentication → Sessions in its dashboard); this is the policy the site applies on top of it, and it
                is enforced by an HttpOnly cookie no script on the page can read.
              </p>
              <NumberField label="Ordinary session" value={form.session_max_age_hours} unit="hours" min={1} max={8760}
                help="Applied when the visitor did not ask to be remembered."
                onChange={(value) => field('session_max_age_hours', value)} />
              <NumberField label="“Remember me” session" value={form.session_remember_me_days} unit="days" min={1} max={365}
                onChange={(value) => field('session_remember_me_days', value)} />
              <label>
                Cookie SameSite policy
                <select value={form.session_cookie_samesite}
                  onChange={(event) => field('session_cookie_samesite', event.target.value as SameSitePolicy)}>
                  {(Object.keys(sameSiteLabels) as SameSitePolicy[]).map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
                <span className={styles.help}>{sameSiteLabels[form.session_cookie_samesite]}</span>
              </label>
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend>Sign someone out everywhere</legend>
              <p className={styles.help}>
                Deletes the account's refresh tokens, so every device it is signed in on is signed out at its next
                refresh. An access token already issued keeps working until it expires — Supabase tokens are stateless
                and cannot be recalled, so shorten their lifetime in the Supabase dashboard if that matters.
                {status && !status.database_connection && (
                  <> This server has no database connection configured, so it will ask for the database password.</>
                )}
              </p>
              <label>
                Account
                <select value={revokeId} onChange={(event) => setRevokeId(event.target.value)}>
                  <option value="">Choose someone…</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.display_name || person.email || person.id}{person.email ? ` — ${person.email}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {status && !status.database_connection && (
                <label>
                  Database password
                  <input type="password" value={dbPassword} autoComplete="off"
                    onChange={(event) => setDbPassword(event.target.value)} />
                  <span className={styles.help}>Only needed because SUPABASE_DB_URL is not set on this server.</span>
                </label>
              )}
              <div className={styles.actions}>
                <button type="button" className={styles.dangerButton} disabled={!revokeId || busy === 'revoke'}
                  onClick={() => void run('revoke', async () => {
                    const who = chosenPerson?.email || chosenPerson?.display_name || revokeId;
                    const result = await revokeUserSessions(revokeId, dbPassword ? { dbPassword } : {});
                    setDbPassword('');
                    return `${who} was signed out: ${result.sessions} session(s) and ${result.refresh_tokens} refresh token(s) revoked. ${result.note}`;
                  })}>
                  {busy === 'revoke' ? 'Signing out…' : 'Sign this account out everywhere'}
                </button>
              </div>
            </fieldset>
          </>
        )}

        {tab === 'anti-bot' && (
          <>
            <fieldset className={styles.fieldset}>
              <legend>Honeypot</legend>
              <Toggle checked={form.anti_bot_honeypot} onChange={(value) => field('anti_bot_honeypot', value)}>
                Add an invisible field to public forms and refuse any submission that fills it in
              </Toggle>
              <p className={styles.help}>
                Costs nothing, needs no third party, and catches the majority of form spam. A submission sent faster
                than a person could type is refused too, but only a filled trap flags the address.
              </p>
              <NumberField label="Keep a flagged address paused for" value={form.anti_bot_flag_minutes} unit="minutes"
                min={1} max={10080} onChange={(value) => field('anti_bot_flag_minutes', value)}
                help="Flags are held in the server's memory and are cleared by a restart. Nothing about a visitor is written to the database." />
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend>CAPTCHA</legend>
              <label>
                Provider
                <select value={form.anti_bot_provider}
                  onChange={(event) => field('anti_bot_provider', event.target.value as AntiBotProvider)}>
                  {(Object.keys(antiBotProviderLabels) as AntiBotProvider[]).map((value) => (
                    <option key={value} value={value}>{antiBotProviderLabels[value]}</option>
                  ))}
                </select>
              </label>
              {form.anti_bot_provider !== 'none' && (
                <>
                  <label>
                    Site key
                    <input value={form.anti_bot_site_key} autoComplete="off" spellCheck={false}
                      onChange={(event) => field('anti_bot_site_key', event.target.value)} />
                    <span className={styles.help}>Public by design: it is rendered into the widget on every protected form.</span>
                  </label>
                  <label>
                    Secret key
                    <input type="password" value={secretInput} autoComplete="off" spellCheck={false}
                      placeholder={secret?.anti_bot_secret_key ? 'Stored — type a new one to replace it' : 'Not set'}
                      onChange={(event) => setSecretInput(event.target.value)} />
                    <span className={styles.help}>
                      Stored in <code>rwp_security_secrets</code>, which no visitor can read — never in the options
                      table, which is public. It is never shown again after saving.
                      {status && ` The server reports the secret is ${status.anti_bot_secret_configured ? `set (from the ${status.anti_bot_secret_source})` : 'not set'}.`}
                      {' '}Setting <code>ANTI_BOT_SECRET_KEY</code> in <code>.env.local</code> overrides this field.
                    </span>
                  </label>
                </>
              )}
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend>Which forms are checked</legend>
              <p className={styles.help}>
                Sign-in, registration and comments talk to Supabase directly, so the check there runs in the browser
                before the request: it stops bots that drive a real page, and Supabase's own auth rate limits and the
                comment policies stop the rest. Forms that post to this server — the builder's form widget, the chat,
                uploads — have their ticket verified on the server and cannot be bypassed.
              </p>
              {antiBotForms.map((name) => (
                <Toggle key={name} checked={form.anti_bot_forms.includes(name)}
                  onChange={(value) => toggleForm(name, value)}>
                  {antiBotFormLabels[name]}
                </Toggle>
              ))}
            </fieldset>
          </>
        )}

        {tab === 'performance' && (
          <>
            <fieldset className={styles.fieldset}>
              <legend>Rate limiting</legend>
              <p className={styles.help}>
                Applied to every <code>/api</code> request this server handles, counted per address and per account —
                whichever is closer to its ceiling decides. Page views and static files are not counted.
              </p>
              <NumberField label="Window" value={form.rate_limit_window_minutes} unit="minutes" min={1} max={1440}
                onChange={(value) => field('rate_limit_window_minutes', value)} />
              <NumberField label="Authentication and admin endpoints" value={form.rate_limit_auth_max} unit="requests per window"
                min={0} max={100000} onChange={(value) => field('rate_limit_auth_max', value)}
                help="Sign-in verification, CAPTCHA checks, plugin installs, uploads authorisation, the site reset." />
              <NumberField label="Everything else under /api" value={form.rate_limit_api_max} unit="requests per window"
                min={0} max={1000000} onChange={(value) => field('rate_limit_api_max', value)} />
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend>Page cache</legend>
              <Toggle checked={form.cache_enabled} onChange={(value) => field('cache_enabled', value)}>
                Cache rendered pages in the server's memory
              </Toggle>
              <p className={styles.help}>
                Only anonymous GET requests are cached — never a signed-in visitor, the admin, the page builder or a
                request with a query string. The admin purges it after every content and settings save; the lifetime
                below is the backstop.
              </p>
              <NumberField label="Fresh for" value={form.cache_ttl_seconds} unit="seconds" min={1} max={2592000}
                onChange={(value) => field('cache_ttl_seconds', value)} />
              <NumberField label="Then serve stale while re-rendering, for" value={form.cache_stale_while_revalidate_seconds}
                unit="seconds" min={0} max={31536000}
                help="A page past its lifetime is still served immediately while the next render replaces it, so a purge never makes anyone wait."
                onChange={(value) => field('cache_stale_while_revalidate_seconds', value)} />
              <NumberField label="Fingerprinted assets may be cached by browsers for" value={form.cache_static_max_age_seconds}
                unit="seconds" min={0} max={34560000}
                help="Only files under /assets/ whose name carries a content hash. Everything else gets five minutes and a revalidation."
                onChange={(value) => field('cache_static_max_age_seconds', value)} />
              <Toggle checked={form.cache_auto_purge_on_save} onChange={(value) => field('cache_auto_purge_on_save', value)}>
                Purge automatically when a page, post or setting is saved
              </Toggle>
              <p className={styles.help}>
                Switching this off means an edit will not be visible until the lifetime above runs out — the "Purge
                the whole page cache" button below always works regardless of this toggle.
              </p>
              <div className={styles.actions}>
                <button type="button" className={styles.secondaryButton} disabled={busy === 'purge'}
                  onClick={() => void run('purge', async () => {
                    const result = await purgePageCache(undefined, 'manual');
                    return `Page cache emptied: ${result.removed} page(s) removed. The sitemap will be rebuilt on the next request.`;
                  })}>
                  {busy === 'purge' ? 'Purging…' : 'Purge the whole page cache'}
                </button>
              </div>
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend>Response compression</legend>
              <Toggle checked={form.cache_enable_compression} onChange={(value) => field('cache_enable_compression', value)}>
                Compress HTML, JSON and JavaScript/CSS responses with Brotli or gzip
              </Toggle>
              <p className={styles.help}>
                Independent of the page cache above: it applies to every text response this server sends, whether or
                not that page is cached, and never to images, fonts or video — compressing an already-compressed
                format wastes CPU for no gain. Cached pages are compressed once, when stored, so a cache hit pays no
                compression cost at all; a built JavaScript or CSS file is compressed the first time it is requested
                and reused for the rest of this process's life. Safe to leave on.
              </p>
            </fieldset>
          </>
        )}

        {tab === 'indexing' && (
          <>
            <fieldset className={styles.fieldset}>
              <legend>Sitemap</legend>
              <Toggle checked={form.sitemap_enabled} onChange={(value) => field('sitemap_enabled', value)}>
                Serve <code>/sitemap.xml</code>
              </Toggle>
              <p className={styles.help}>
                Generated on request from published pages, posts and categories, read with the public key — so it
                contains exactly what a visitor can see, and no draft can leak into it. Pages marked “noindex” in the
                page editor are left out. Held for the page cache lifetime above.
              </p>
              <div className={styles.actions}>
                <a className={styles.secondaryButton} href="/sitemap.xml" target="_blank" rel="noreferrer noopener">
                  Open the sitemap
                </a>
                <a className={styles.secondaryButton} href="/robots.txt" target="_blank" rel="noreferrer noopener">
                  Open robots.txt
                </a>
              </div>
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend>robots.txt</legend>
              <label>
                Contents
                <textarea rows={12} value={form.robots_txt_content} spellCheck={false}
                  placeholder={'Leave empty to serve the generated default:\n\nUser-agent: *\nDisallow: /admin\nDisallow: /builder/\nDisallow: /api/\nAllow: /\n\nSitemap: https://your-site/sitemap.xml'}
                  onChange={(event) => field('robots_txt_content', event.target.value)} />
                <span className={styles.help}>
                  Empty means “serve the generated default”, not “serve an empty file” — clearing this box by accident
                  must not start inviting crawlers into the admin. A <code>Sitemap:</code> line is appended unless your
                  text already has one.
                </span>
              </label>
            </fieldset>
          </>
        )}

        <div className={styles.actions}>
          <button type="submit" className={styles.saveButton} disabled={saving}>
            {saving ? 'Saving…' : 'Save security settings'}
          </button>
        </div>
      </form>

      <ServerState status={status} error={statusError} busy={busy === 'refresh'}
        onRefresh={() => void run('refresh', async () => {
          setStatus(await refreshServerSecurity());
          return 'The server re-read its settings.';
        })} />
    </>
  );
}
