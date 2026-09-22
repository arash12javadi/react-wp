import { createPortal } from 'react-dom';
import { accountPageByPath } from '../../lib/account';
import { useFloatingLogin, type FloatingLoginController } from './useFloatingLogin';
import FloatingLoginModal from './FloatingLoginModal';
import './floatingLogin.css';

interface FloatingLoginTriggerProps {
  controller: FloatingLoginController;
  /** The admin's Live Preview: positioned inside the preview box instead of the window. */
  contained?: boolean;
}

/** The button itself, shared by the public site and the admin preview. */
export function FloatingLoginTrigger({ controller, contained = false }: FloatingLoginTriggerProps) {
  const { settings, isOpen, open } = controller;
  return (
    <button
      type="button"
      className={`rwp-fl rwp-fl-theme-${settings.floating_login_theme} rwp-fl-trigger rwp-fl-pos-${settings.floating_login_position}${contained ? ' rwp-fl-trigger--contained' : ''}`}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      onClick={() => open('login')}
    >
      <svg className="rwp-fl-trigger-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z" />
      </svg>
      <span>{settings.floating_login_button_text}</span>
    </button>
  );
}

/**
 * The floating Login / Register button on every public page, with its dialog. Rendered by
 * PublicLayout, so no page has to include it; configured under Settings → Floating Login.
 *
 * Renders nothing when Floating Login is switched off, for someone who is signed in, and on the
 * account pages (/login, /register, …), which already show the same forms.
 */
export default function FloatingLoginButton() {
  const controller = useFloatingLogin();
  const { ready, settings, user, isOpen } = controller;

  if (!ready || !settings.floating_login_enabled || user === undefined) return null;
  if (accountPageByPath(window.location.pathname)) return null;
  // Signing in makes the visitor signed in before the success message has shown, so the dialog
  // stays until the redirect; only the button goes.
  if (user && !isOpen) return null;

  return (
    <>
      {!user && createPortal(<FloatingLoginTrigger controller={controller} />, document.body)}
      <FloatingLoginModal controller={controller} />
    </>
  );
}
