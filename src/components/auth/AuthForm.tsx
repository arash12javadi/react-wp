import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../lib/db';
import { defaultSettings, loadSettings, type SiteSettings } from '../../lib/settings';
import { afterLoginUrl, requestedRedirect, signOutAndRedirect } from '../../lib/account';
import { openGovernedSession } from '../../lib/session';
import { CaptchaNotice, useHumanCheck } from '../security/HumanCheck';
import { rwp } from '../../lib/rwp';
import styles from '../AuthPage.module.css';

export type AuthMode = 'login' | 'register' | 'lost_password';
type Provider = 'google' | 'facebook';

const providerLabels: Record<Provider, string> = { google: 'Google', facebook: 'Facebook' };

export interface AuthFormProps {
  mode: AuthMode;
  /** standalone: the full-screen card at /login when no page is chosen; inline: inside a page. */
  variant?: 'standalone' | 'inline';
  title?: string;
  subtitle?: string;
  buttonLabel?: string;
  /** Where to go afterwards, when the link did not carry ?redirect=. */
  redirect?: string;
  showSocial?: boolean;
  showLinks?: boolean;
  /**
   * The Page Builder canvas: always show the form (the designer is signed in, which would
   * otherwise show "You are signed in"), and never submit it.
   */
  preview?: boolean;
}

const defaults: Record<AuthMode, { title: string; subtitle: string; button: string }> = {
  login: { title: 'Sign in', subtitle: 'Welcome back.', button: 'Sign in' },
  register: { title: 'Create an account', subtitle: 'Fill in your details to get started.', button: 'Create account' },
  lost_password: { title: 'Reset your password', subtitle: 'Enter your email and we will send you a link to choose a new password.', button: 'Send reset link' },
};

/** Keeps ?redirect= when moving between the sign-in, register and lost-password screens. */
const withRedirect = (path: string) => {
  const requested = requestedRedirect();
  return requested ? `${path}?redirect=${encodeURIComponent(requested)}` : path;
};

/**
 * Sign in, register and lost password. Backs the built-in /login screen and the
 * [rwp_login_form], [rwp_register_form] and [rwp_lost_password_form] shortcodes, so a page
 * chosen under Settings → Accounts can surround it with anything.
 */
export default function AuthForm({
  mode, variant = 'inline', title, subtitle, buttonLabel, redirect, showSocial = true, showLinks = true, preview = false,
}: AuthFormProps) {
  const [settings, setSettings] = useState<SiteSettings>(defaultSettings);
  const [realSession, setSession] = useState<Session | null>(null);
  const session = preview ? null : realSession;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyProvider, setBusyProvider] = useState<Provider | ''>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [remember, setRemember] = useState(false);
  // The honeypot and the CAPTCHA. `mode` is already the form name the server knows this by.
  const human = useHumanCheck(mode);

  const continueTo = async (userId: string) => {
    const explicit = !requestedRedirect() && redirect && /^\/(?!\/)/.test(redirect) ? redirect : '';
    window.location.href = explicit || await afterLoginUrl(userId, settings);
  };

  useEffect(() => {
    let mounted = true;
    const supabase = getSupabaseClient();
    void Promise.all([loadSettings().catch(() => defaultSettings), supabase.auth.getSession()]).then(async ([loaded, { data }]) => {
      if (!mounted) return;
      setSettings(loaded);
      setSession(data.session);
      setReady(true);
      // Back from Google or Facebook: the session arrives in the URL, so carry on straight away.
      const returning = /access_token=|[?&]code=/.test(`${window.location.hash}${window.location.search}`);
      if (data.session && returning && mode !== 'lost_password' && !preview) {
        window.location.href = await afterLoginUrl(data.session.user.id, loaded);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => { if (mounted) setSession(next); });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [mode, preview]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (preview) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const supabase = getSupabaseClient();
      // Before anything is sent to Supabase: a form that failed the human check must not also
      // count against the account's sign-in attempts.
      await human.verify();
      if (mode === 'login') {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError || !data.session) throw new Error(signInError?.message || 'Unable to sign in.');
        // The administrator's session policy, as an HttpOnly cookie. Best-effort: a host without
        // server.mjs has no such endpoint, and that must not stop anyone signing in.
        await openGovernedSession(remember);
        rwp.actions.do('rwp_user_logged_in', data.session.user);
        await continueTo(data.session.user.id);
        return;
      }

      if (mode === 'lost_password') {
        if (session) {
          // Opened from the reset email (or by someone signed in): choose the new password.
          if (password !== confirmPassword) throw new Error('The two passwords do not match.');
          const { error: updateError } = await supabase.auth.updateUser({ password });
          if (updateError) throw new Error(updateError.message);
          setPassword('');
          setConfirmPassword('');
          setNotice('Your password has been changed.');
          return;
        }
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/lost-password`,
        });
        if (resetError) throw new Error(resetError.message);
        setNotice(`If an account exists for ${email}, a link to choose a new password is on its way. It opens this page.`);
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
        await openGovernedSession(remember);
        await continueTo(data.session.user.id);
      } else {
        setNotice(`Account created. Check ${email} for a confirmation link before signing in.`);
      }
    } catch (authError: unknown) {
      setError(authError instanceof Error ? authError.message : 'Something went wrong.');
      // A used or failed challenge cannot be replayed, so the next attempt needs a fresh one.
      human.reset();
    } finally {
      setLoading(false);
    }
  };

  const signInWith = async (provider: Provider) => {
    if (preview) return;
    setBusyProvider(provider);
    setError('');
    try {
      const requested = requestedRedirect();
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
          ? `${oauthError.message} — check that ${providerLabels[provider]} is enabled under Authentication → Providers in Supabase, and that ${window.location.origin}/login is listed under Redirect URLs.`
          : 'Could not start the sign-in.',
      );
    }
  };

  const cardClass = `${styles.card} ${variant === 'inline' ? styles.inline : ''} rwp-auth-card rwp-auth-${mode.replace('_', '-')}`;
  if (!ready) return <p className={styles.muted}>Loading…</p>;

  const text = defaults[mode];
  const resetStep = mode === 'lost_password' && Boolean(session);
  const heading = resetStep ? 'Choose a new password' : title || text.title;
  // A page chosen for this screen already has its own h1.
  const Heading = variant === 'standalone' ? 'h1' : 'h2';
  const brand = variant === 'standalone' &&<a className={styles.brand} href="/">{settings.site_title}</a>;

  if (mode === 'register' && !settings.users_can_register) {
    return (
      <div className={cardClass}>
        {brand}
        <Heading>Registration is closed</Heading>
        <p>This site is not accepting new accounts right now.</p>
        <a className={styles.altLink} href={withRedirect('/login')}>Back to sign in</a>
      </div>
    );
  }

  if (session && mode !== 'lost_password') {
    const name = (session.user.user_metadata?.display_name as string | undefined) || session.user.email;
    return (
      <div className={cardClass}>
        {brand}
        <Heading>You are signed in</Heading>
        <p className={styles.subtitle}>Signed in as <strong>{name}</strong>.</p>
        <button type="button" className={styles.primary} onClick={() => void continueTo(session.user.id)}>Continue</button>
        <button type="button" className={styles.linkButton} onClick={() => void signOutAndRedirect(settings)}>Sign out</button>
      </div>
    );
  }

  const providers = (showSocial && mode !== 'lost_password'
    ? [settings.auth_google_enabled && 'google', settings.auth_facebook_enabled && 'facebook'].filter(Boolean)
    : []) as Provider[];

  return (
    <form className={cardClass} onSubmit={submit} noValidate={preview}>
      {brand}
      <Heading>{heading}</Heading>
      <p className={styles.subtitle}>
        {resetStep ? `For ${session?.user.email}. Use at least 6 characters.` : subtitle || text.subtitle}
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

      {!resetStep && (
        <label>
          Email
          <input type="email" required autoComplete="username" value={email}
            onChange={(event) => setEmail(event.target.value)} />
        </label>
      )}

      {(mode !== 'lost_password' || resetStep) && (
        <label>
          {resetStep ? 'New password' : 'Password'}
          <input type="password" required minLength={6}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
      )}

      {resetStep && (
        <label>
          Confirm new password
          <input type="password" required minLength={6} autoComplete="new-password"
            value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
      )}

      {mode === 'login' && !resetStep && (
        <label className={styles.rememberRow}>
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          Keep me signed in
        </label>
      )}

      {/* The invisible trap field and, when one is configured, the CAPTCHA widget. */}
      {human.field}

      <button type="submit" className={styles.primary} disabled={loading}>
        {loading ? 'Please wait…' : resetStep ? 'Save new password' : buttonLabel || text.button}
      </button>

      <CaptchaNotice config={human.config} />

      {mode === 'login' && showLinks && (
        <a className={styles.linkButton} href={withRedirect('/lost-password')}>Forgot password?</a>
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

      {showLinks && (
        <p className={styles.switch}>
          {mode === 'login' ? (
            settings.users_can_register
              ? <>No account yet? <a href={withRedirect('/register')}>Create one</a></>
              : <>Registration is currently closed.</>
          ) : resetStep && notice ? (
            <a href="#continue" onClick={(event) => { event.preventDefault(); if (session) void continueTo(session.user.id); }}>Continue</a>
          ) : (
            <>{mode === 'register' ? 'Already have an account?' : 'Remembered it?'} <a href={withRedirect('/login')}>Sign in</a></>
          )}
        </p>
      )}
    </form>
  );
}
