import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import settingsStyles from '../SiteSettings.module.css';
import { FloatingLoginTrigger } from '../floatingLogin/FloatingLoginButton';
import FloatingLoginModal from '../floatingLogin/FloatingLoginModal';
import { useFloatingLogin } from '../floatingLogin/useFloatingLogin';
import {
  buttonTextMaxLength, defaultFloatingLoginSettings, getFloatingLoginState, loadFloatingLoginSettings, positionLabels,
  redirectProblem, saveFloatingLoginSettings, subscribeFloatingLogin, themeLabels,
  type FloatingLoginPosition, type FloatingLoginSettings as Settings, type FloatingLoginTheme,
} from '../../lib/floatingLogin';
import styles from './FloatingLoginPanel.module.css';

const toastDuration = 4000;

/** The button and dialog as visitors will see them, drawn from the unsaved form. */
function LivePreview({ settings }: { settings: Settings }) {
  const controller = useFloatingLogin({ preview: true, settings });
  return (
    <div className={styles.preview} aria-label="Live preview">
      <div className={styles.previewPage}>
        <div className={styles.previewChrome} aria-hidden="true"><span /><span /><span /></div>
        <div className={styles.previewLines} aria-hidden="true"><i /><i /><i /><i /></div>
        {settings.floating_login_enabled
          ? <FloatingLoginTrigger controller={controller} contained />
          : <p className={styles.previewOff}>Switched off: visitors see no button.</p>}
      </div>
      <div className={styles.previewStage}>
        <FloatingLoginModal controller={controller} inline />
      </div>
      <p className={settingsStyles.help}>
        The dialog is interactive here (switch tabs, try the validation), but nothing is sent to Supabase.
      </p>
    </div>
  );
}

/** Settings → Floating Login: the six floating_login_* options and a live preview of the result. */
export default function FloatingLoginPanel() {
  const store = useSyncExternalStore(subscribeFloatingLogin, getFloatingLoginState);
  const [form, setForm] = useState<Settings | null>(store.loaded ? store.settings : null);
  const [saved, setSaved] = useState<Settings | null>(form);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    void loadFloatingLoginSettings().then((loaded) => {
      setForm((current) => current || loaded.settings);
      setSaved((current) => current || loaded.settings);
    });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), toastDuration);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!form) return <p className={settingsStyles.loading} role="status">Loading Floating Login settings…</p>;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));
  const redirectError = redirectProblem(form.floating_login_redirect_url);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setToast('');
    try {
      const clean = await saveFloatingLoginSettings(form);
      setForm(clean);
      setSaved(clean);
      setToast('Floating Login settings saved. Visitors see them on their next page load.');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.layout}>
      <form className={`${settingsStyles.form} ${styles.form}`} onSubmit={(event) => void submit(event)}>
        {error && <div className={settingsStyles.error} role="alert"><span>{error}</span></div>}

        <fieldset className={settingsStyles.fieldset}>
          <legend>Button</legend>
          <label className={settingsStyles.checkboxRow}>
            <input type="checkbox" checked={form.floating_login_enabled}
              onChange={(event) => set('floating_login_enabled', event.target.checked)} />
            Show the floating login button on the public site
          </label>
          <span className={settingsStyles.help}>
            It is never shown to someone who is signed in, nor on /login, /register and the other account pages.
          </span>
          <label>
            Button text
            <input value={form.floating_login_button_text} maxLength={buttonTextMaxLength}
              placeholder={defaultFloatingLoginSettings.floating_login_button_text}
              onChange={(event) => set('floating_login_button_text', event.target.value)} />
          </label>
          <div className={styles.twoColumns}>
            <label>
              Position
              <select value={form.floating_login_position}
                onChange={(event) => set('floating_login_position', event.target.value as FloatingLoginPosition)}>
                {Object.entries(positionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Theme
              <select value={form.floating_login_theme}
                onChange={(event) => set('floating_login_theme', event.target.value as FloatingLoginTheme)}>
                {Object.entries(themeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          <span className={settingsStyles.help}>
            Persian Origins&rsquo; floating display settings button also sits in the bottom-right corner; choose another
            corner if both are on.
          </span>
        </fieldset>

        <fieldset className={settingsStyles.fieldset}>
          <legend>Dialog</legend>
          <label className={settingsStyles.checkboxRow}>
            <input type="checkbox" checked={form.floating_login_allow_registration}
              onChange={(event) => set('floating_login_allow_registration', event.target.checked)} />
            Show the Register tab
          </label>
          {form.floating_login_allow_registration && !store.siteAllowsRegistration && (
            <div className={settingsStyles.warning} role="status">
              Settings → Accounts does not let anyone register, so the Register tab stays hidden.{' '}
              <a href="/admin?section=settings&tab=accounts">Open Settings → Accounts</a>
            </div>
          )}
          <label>
            Redirect after login
            <input value={form.floating_login_redirect_url} placeholder="current" aria-invalid={redirectError ? true : undefined}
              aria-describedby="rwp-fl-redirect-help" onChange={(event) => set('floating_login_redirect_url', event.target.value)} />
          </label>
          <span id="rwp-fl-redirect-help" className={redirectError ? styles.fieldError : settingsStyles.help}>
            {redirectError || <><code>current</code> (or empty) reloads the page the visitor is on; <code>/</code>, <code>/dashboard</code> or a full https:// address goes there.</>}
          </span>
        </fieldset>

        <div className={settingsStyles.actions}>
          {dirty && <span className={styles.unsaved}>Unsaved changes</span>}
          <button type="button" className={styles.secondary} disabled={busy}
            onClick={() => setForm({ ...defaultFloatingLoginSettings })}>
            Restore defaults
          </button>
          <button type="submit" className={settingsStyles.saveButton} disabled={busy || Boolean(redirectError)}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>

      <aside className={styles.previewColumn}>
        <h3 className={styles.previewHeading}>Live preview</h3>
        <LivePreview settings={form} />
      </aside>

      {toast && (
        <div className={styles.toast} role="status">
          <span aria-hidden="true">✓</span> {toast}
          <button type="button" className={styles.toastClose} aria-label="Dismiss" onClick={() => setToast('')}>×</button>
        </div>
      )}
    </div>
  );
}
