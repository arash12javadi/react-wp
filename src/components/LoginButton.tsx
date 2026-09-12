import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../lib/db';
import styles from './LoginButton.module.css';

interface LoginButtonProps {
  label?: string;
  variant?: 'button' | 'link';
}

/** Backs both the navbar auth controls and the [rwp_login] shortcode. */
export default function LoginButton({ label, variant = 'button' }: LoginButtonProps) {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    const supabase = getSupabaseClient();
    supabase.auth.getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setEmail(data.session?.user.email || null);
        setReady(true);
      })
      .catch(() => { if (mounted) setReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setEmail(session?.user.email || null);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (!ready) return null;

  const className = variant === 'link' ? styles.link : styles.button;

  if (email) {
    return (
      <button
        type="button"
        className={className}
        onClick={async () => {
          await getSupabaseClient().auth.signOut();
          window.location.reload();
        }}
      >
        {label || 'Log out'}
      </button>
    );
  }

  return <a className={className} href={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}>{label || 'Log in'}</a>;
}
