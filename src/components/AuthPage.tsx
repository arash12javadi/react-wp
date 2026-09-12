import { useEffect, useState, type FormEvent } from 'react';
import { getSupabaseClient } from '../lib/db';
import { defaultSettings, loadSettings, type SiteSettings } from '../lib/settings';
import { fetchProfile } from '../lib/profiles';
import { canAccessAdmin } from '../lib/roles';
import { rwp } from '../lib/rwp';
import styles from './AuthPage.module.css';

type Mode = 'login' | 'register';
type Provider = 'google' | 'facebook';

const providerLabels: Record<Provider, string> = { google: 'Google', facebook: 'Facebook' };

const redirectTarget = () => new URLSearchParams(window.location.search).get('redirect') || '';

export default function AuthPage({ mode }: { mode: Mode }) {
  const [settings, setSettings] = useState<SiteSettings>(defaultSettings);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyProvider, setBusyProvider] = useState<Provider | ''>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadSettings()
      .then(setSettings)
      .catch(() => setSettings(defaultSettings))
      .finally(() => setReady(true));
  }, []);

  const goAfterLogin = async (userId: string) => {
    const requested = redirectTarget();
    if (requested.startsWith('/')) {
      window.location.href = requested;
      return;
    }
    const profile = await fetchProfile(userId).catch(() => null);
    window.location.href = profile && canAccessAdmin(profile.role) ? '/admin' : '/';
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const supabase = getSupabaseClient();
      if (mode === 'login') {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError || !data.session) throw new Error(signInError?.message || 'Unable to sign in.');
        rwp.actions.do('rwp_user_logged_in', data.session.user);
        await goAfterLogin(data.session.user.id);
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
          data: { display_name: displayName.trim() || email.split('@')[0] },
        },
      });
      if (signUpError) throw new Error(signUpError.message);

      // Supabase returns a session only when email confirmation is disabled. Without this
      // branch the form would look like it had silently done nothing.
      if (data.session) {
        await goAfterLogin(data.session.user.id);
      } else {
        setNotice(`Account created. Check ${email} for a confirmation link before signing in.`);
      }
    } catch (authError: unknown) {
      setError(authError instanceof Error ? authError.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const signInWith = async (provider: Provider) => {
    setBusyProvider(provider);
    setError('');
    try {
      const requested = redirectTarget();
      const { error: oauthError } = await getSupabaseClient().auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/login${requested ? `?redirect=${encodeURIComponent(requested)}` : ''}`,
        },
      });
      if (oauthError) throw new Error(oauthError.message);
    } catch (oauthError: unknown) {
      setBusyProvider('');
      setError(
        oauthError instanceof Error
          ? `${oauthError.message} — check that ${providerLabels[provider]} is enabled under Authentication → Providers in Supabase, and that this URL is listed under Redirect URLs.`
          : 'Could not start the sign-in.',
      );
    }
  };

  const providers = ([
    settings.auth_google_enabled && 'google',
    settings.auth_facebook_enabled && 'facebook',
  ].filter(Boolean)) as Provider[];

  if (!ready) return <div className={styles.shell}><p className={styles.muted}>Loading…</p></div>;

  if (mode === 'register' && !settings.users_can_register) {
    return (
      <div className={styles.shell}>
        <div className={styles.card}>
          <h1>Registration is closed</h1>
          <p>This site is not accepting new accounts right now.</p>
          <a className={styles.altLink} href="/login">Back to sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <form className={styles.card} onSubmit={submit}>
        <a className={styles.brand} href="/">{settings.site_title}</a>
        <h1>{mode === 'login' ? 'Sign in' : 'Create an account'}</h1>
        <p className={styles.subtitle}>
          {mode === 'login' ? 'Welcome back.' : 'Fill in your details to get started.'}
        </p>

        {error && <div className={styles.error} role="alert">{error}</div>}
        {notice && <div className={styles.notice} role="status">{notice}</div>}

        {mode === 'register' && (
          <label>
            Display name
            <input value={displayName} autoComplete="name" onChange={(event) => setDisplayName(event.target.value)}
              placeholder="How your name appears on the site" />
          </label>
        )}

        <label>
          Email
          <input type="email" required autoComplete="username" value={email}
            onChange={(event) => setEmail(event.target.value)} />
        </label>

        <label>
          Password
          <input type="password" required minLength={6}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>

        <button type="submit" className={styles.primary} disabled={loading}>
          {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        {mode === 'login' && (
          <button
            type="button"
            className={styles.linkButton}
            onClick={async () => {
              if (!email) return setError('Enter your email address first, then choose Forgot password.');
              setError('');
              const { error: resetError } = await getSupabaseClient().auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/login`,
              });
              if (resetError) setError(resetError.message);
              else setNotice(`Password reset link sent to ${email}.`);
            }}
          >
            Forgot password?
          </button>
        )}

        {providers.length > 0 && (
          <>
            <div className={styles.divider}><span>or continue with</span></div>
            <div className={styles.providers}>
              {providers.map((provider) => (
                <button key={provider} type="button" className={styles.provider}
                  disabled={Boolean(busyProvider)} onClick={() => void signInWith(provider)}>
                  <span className={styles.providerIcon} aria-hidden="true">
                    {provider === 'google' ? 'G' : 'f'}
                  </span>
                  {busyProvider === provider ? 'Redirecting…' : providerLabels[provider]}
                </button>
              ))}
            </div>
          </>
        )}

        <p className={styles.switch}>
          {mode === 'login' ? (
            settings.users_can_register
              ? <>No account yet? <a href="/register">Create one</a></>
              : <>Registration is currently closed.</>
          ) : (
            <>Already have an account? <a href="/login">Sign in</a></>
          )}
        </p>
      </form>
    </div>
  );
}
