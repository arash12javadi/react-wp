import AuthForm, { type AuthMode } from './auth/AuthForm';
import styles from './AuthPage.module.css';

/**
 * The built-in full-screen sign-in, register and lost-password screens, shown at /login,
 * /register and /lost-password while Settings → Accounts has no page chosen for them (or the
 * chosen page is missing or unpublished, so nobody is ever locked out of signing in).
 */
export default function AuthPage({ mode }: { mode: AuthMode }) {
  return (
    <div className={`${styles.shell} rwp-auth-shell`}>
      <AuthForm mode={mode} variant="standalone" />
    </div>
  );
}
