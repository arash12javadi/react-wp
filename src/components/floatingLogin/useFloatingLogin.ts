import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseClient, tryGetSupabaseClient } from '../../lib/db';
import { rwp } from '../../lib/rwp';
import {
  getFloatingLoginState, loadFloatingLoginSettings, redirectTarget, subscribeFloatingLogin, type FloatingLoginSettings,
} from '../../lib/floatingLogin';

export type FloatingLoginTab = 'login' | 'register' | 'forgot';

export interface UseFloatingLoginOptions {
  /** The admin's Live Preview: draft settings, no session, and nothing is sent to Supabase. */
  preview?: boolean;
  settings?: FloatingLoginSettings;
}

/** How long the "Signed in" message shows before the redirect. */
const successDelay = 900;

/**
 * Supabase Auth messages, reworded where they are unclear to a visitor, and naming the setting to
 * change where the cause is the project's configuration rather than what was typed.
 */
export const describeAuthError = (error: unknown): string => {
  const { message = '', code = '', status } = (error && typeof error === 'object' ? error : {}) as {
    message?: string; code?: string; status?: number;
  };
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) return 'The email or password is incorrect.';
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
    return 'This email address is not confirmed yet. Open the confirmation link we emailed you, then sign in.';
  }
  if (code === 'user_already_exists' || /already registered/i.test(message)) {
    return 'This email already has an account. Sign in, or use "Forgot password?" to choose a new password.';
  }
  if (code === 'signup_disabled' || /signups not allowed/i.test(message)) {
    return 'The Supabase project does not accept new sign-ups ("Allow new users to sign up" is off under Authentication → Sign In / Providers).';
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429) {
    return `Too many attempts in a short time, so Supabase refused this one. Wait a minute and try again. (${message || 'rate limit'})`;
  }
  if (code === 'weak_password') return message || 'That password is too weak. Use a longer one.';
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return 'The request did not reach Supabase (no network connection, or the Supabase URL is wrong or blocked).';
  }
  return message || 'Something went wrong, and Supabase did not say what.';
};

/**
 * State and actions for the floating login: the settings, whether someone is signed in, the modal
 * and its tab, and login / register / forgotPassword against Supabase Auth.
 *
 * There is no nonce: supabase-js sends the session as an Authorization header from its own
 * storage, never as a cookie, so another site cannot make a visitor's browser act for them (which
 * is the attack a WordPress nonce stops). The password goes straight to Supabase Auth over HTTPS.
 */
export function useFloatingLogin({ preview = false, settings: draft }: UseFloatingLoginOptions = {}) {
  const store = useSyncExternalStore(subscribeFloatingLogin, getFloatingLoginState);
  const settings = draft || store.settings;
  const canRegister = settings.floating_login_allow_registration && store.siteAllowsRegistration;

  /** undefined while the session is still being read. */
  const [user, setUser] = useState<User | null | undefined>(preview ? null : undefined);
  const [isOpen, setIsOpen] = useState(false);
  const [requestedTab, setRequestedTab] = useState<FloatingLoginTab>('login');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const redirectTimer = useRef<number | undefined>(undefined);

  // A Register tab left open when registration gets switched off falls back to Log in.
  const activeTab: FloatingLoginTab = requestedTab === 'register' && !canRegister ? 'login' : requestedTab;

  useEffect(() => { void loadFloatingLoginSettings(); }, []);

  useEffect(() => {
    if (preview) return undefined;
    const supabase = tryGetSupabaseClient();
    if (!supabase) {
      setUser(null);
      return undefined;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data }) => { if (active) setUser(data.session?.user ?? null); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { if (active) setUser(session?.user ?? null); });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [preview]);

  useEffect(() => () => window.clearTimeout(redirectTimer.current), []);

  const clearMessages = () => {
    setErrorMessage('');
    setNotice('');
  };

  const setActiveTab = useCallback((tab: FloatingLoginTab) => {
    setRequestedTab(tab);
    setErrorMessage('');
    setNotice('');
  }, []);

  const open = useCallback((tab: FloatingLoginTab = 'login') => {
    setActiveTab(tab);
    setSuccessMessage('');
    setIsOpen(true);
  }, [setActiveTab]);

  const close = useCallback(() => setIsOpen(false), []);

  /** Shows the success state, then goes where Floating Login → "Redirect after login" says. */
  const finish = (message: string) => {
    setSuccessMessage(message);
    const target = redirectTarget(settings.floating_login_redirect_url);
    redirectTimer.current = window.setTimeout(() => {
      if (target) window.location.assign(target);
      else window.location.reload();
    }, successDelay);
  };

  /** Runs one request: one at a time, with its failure shown in the modal. */
  const run = async (action: () => Promise<void>) => {
    if (loading) return;
    clearMessages();
    if (preview) {
      setNotice('This is a preview: nothing was sent.');
      return;
    }
    setLoading(true);
    try {
      await action();
    } catch (error: unknown) {
      setErrorMessage(describeAuthError(error));
    } finally {
      setLoading(false);
    }
  };

  const login = (email: string, password: string) => run(async () => {
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    if (!data.session) throw new Error('Supabase accepted the password but returned no session.');
    rwp.actions.do('rwp_user_logged_in', data.session.user);
    finish('You are signed in.');
  });

  const register = (displayName: string, email: string, password: string) => run(async () => {
    const address = email.trim();
    // Never a role here: handle_new_user gives new accounts the site's default_user_role.
    const { data, error } = await getSupabaseClient().auth.signUp({
      email: address,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: { display_name: displayName.trim() || address.split('@')[0] },
      },
    });
    if (error) throw error;
    if (data.session) {
      finish('Your account is ready and you are signed in.');
      return;
    }
    // With email confirmation on, Supabase answers an existing address with a user that has no
    // identities instead of an error.
    if (data.user && data.user.identities?.length === 0) {
      throw Object.assign(new Error('User already registered'), { code: 'user_already_exists' });
    }
    setNotice(`Account created. Open the confirmation link we sent to ${address}, then sign in.`);
  });

  const forgotPassword = (email: string) => run(async () => {
    const address = email.trim();
    // /lost-password is core's reset screen: the link signs the visitor in there to choose a new password.
    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(address, {
      redirectTo: `${window.location.origin}/lost-password`,
    });
    if (error) throw error;
    setNotice(`If an account exists for ${address}, a link to choose a new password is on its way.`);
  });

  return {
    settings,
    /** The settings have been read (or failed to be read and the defaults apply). */
    ready: Boolean(draft) || store.loaded,
    canRegister,
    user,
    isLoggedIn: Boolean(user),
    isOpen,
    open,
    close,
    activeTab,
    setActiveTab,
    loading,
    errorMessage,
    notice,
    successMessage,
    login,
    register,
    forgotPassword,
    preview,
  };
}

export type FloatingLoginController = ReturnType<typeof useFloatingLogin>;
