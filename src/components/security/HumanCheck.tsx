import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  fallbackAntiBotConfig, formIsGuarded, loadAntiBotConfig, recaptchaToken, turnstileReady,
  verifyHuman, type AntiBotConfig, type AntiBotForm,
} from '../../lib/antiBot';

/**
 * One import for any form that wants a human check:
 *
 *   const human = useHumanCheck('login');
 *   …
 *   <form onSubmit={…}>{human.field}…</form>
 *   const ticket = await human.verify();   // '' when this form is not guarded
 *
 * `field` is the honeypot plus, when a provider is configured, the CAPTCHA widget. `verify()`
 * throws with the server's own wording, so the form shows the real reason.
 */

/**
 * Off-screen rather than `display: none` or `hidden`. A form filler that respects the cascade
 * skips a hidden input; the ones worth catching read the DOM and fill anything that looks like a
 * field, which is exactly what this is. Inline rather than a CSS module so the trap is still
 * invisible if the stylesheet has not loaded — a honeypot that flashes into view is a honeypot
 * that real people fill in.
 */
const trapStyle: CSSProperties = {
  position: 'absolute',
  left: '-9999px',
  top: 'auto',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  opacity: 0,
  pointerEvents: 'none',
};

export interface HumanCheck {
  config: AntiBotConfig;
  /** Render this inside the form. */
  field: ReactNode;
  /** The clearance ticket, or '' when this form is not guarded. Throws on a failed check. */
  verify: () => Promise<string>;
  /** After a rejected submit, so the visitor gets a fresh challenge instead of a stale token. */
  reset: () => void;
  /** True while the provider script is still loading. */
  loading: boolean;
}

export function useHumanCheck(form: AntiBotForm): HumanCheck {
  const [config, setConfig] = useState<AntiBotConfig>(fallbackAntiBotConfig);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tokenRef = useRef('');
  const trapRef = useRef<HTMLInputElement | null>(null);
  // When the form opened, in the visitor's own clock. The server compares it to its own, so a
  // skewed clock can only make a form look older than it is, never younger — and an "older" form
  // is always allowed.
  const startedAt = useRef(Date.now());
  const waiters = useRef<Array<(token: string) => void>>([]);

  useEffect(() => {
    let mounted = true;
    void loadAntiBotConfig().then((loaded) => {
      if (!mounted) return;
      setConfig(loaded);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  const guarded = formIsGuarded(config, form);

  const resolveToken = useCallback((token: string) => {
    tokenRef.current = token;
    waiters.current.splice(0).forEach((resolve) => resolve(token));
  }, []);

  // Turnstile renders a managed widget; reCAPTCHA v3 has none and produces its token on demand in
  // verify() below, so only the former needs mounting.
  useEffect(() => {
    if (!guarded || config.provider !== 'turnstile' || !config.site_key) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;
    let widgetId: string | undefined;
    let cancelled = false;
    void turnstileReady()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        widgetId = api.render(containerRef.current, {
          sitekey: config.site_key,
          callback: (token: string) => resolveToken(token),
          'expired-callback': () => resolveToken(''),
          'error-callback': () => resolveToken(''),
        });
      })
      .catch((scriptError: unknown) => {
        if (!cancelled) setError(scriptError instanceof Error ? scriptError.message : 'The CAPTCHA could not be loaded.');
      });
    return () => {
      cancelled = true;
      tokenRef.current = '';
      if (widgetId !== undefined) {
        void turnstileReady().then((api) => api.remove(widgetId)).catch(() => {});
      }
    };
    // `nonce` is the reset signal: bumping it tears the widget down and renders a fresh one.
  }, [guarded, config.provider, config.site_key, resolveToken, nonce]);

  const reset = useCallback(() => {
    tokenRef.current = '';
    startedAt.current = Date.now();
    setError('');
    setNonce((value) => value + 1);
  }, []);

  const verify = useCallback(async (): Promise<string> => {
    if (!formIsGuarded(config, form)) return '';
    let token = '';
    if (config.provider === 'recaptcha') {
      if (!config.site_key) throw new Error('reCAPTCHA is selected under Settings → Security but no site key is saved, so this form cannot be verified.');
      token = await recaptchaToken(config.site_key, form);
    } else if (config.provider === 'turnstile') {
      token = tokenRef.current;
      if (!token) {
        // The visitor pressed submit before the widget finished. Waiting beats refusing: the
        // challenge usually resolves in well under a second.
        token = await new Promise<string>((resolve) => {
          const timer = window.setTimeout(() => resolve(''), 15_000);
          waiters.current.push((value) => {
            window.clearTimeout(timer);
            resolve(value);
          });
        });
      }
      if (!token) throw new Error('The CAPTCHA has not finished. Wait for the checkbox to turn green, then submit again.');
    }
    return verifyHuman(config, {
      form,
      token,
      honeypot: trapRef.current?.value || '',
      startedAt: startedAt.current,
    });
  }, [config, form]);

  const field = useMemo(() => (
    <>
      {config.honeypot && (
        <div style={trapStyle} aria-hidden="true">
          {/* Labelled and named like a real field so a form filler takes the bait; never focusable,
              never submitted by a person, and excluded from the accessibility tree. */}
          <label htmlFor={`${config.honeypot_field}-${form}`}>Leave this field empty</label>
          <input
            ref={trapRef}
            id={`${config.honeypot_field}-${form}`}
            name={config.honeypot_field}
            type="text"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </div>
      )}
      {guarded && config.provider === 'turnstile' && (
        <div className="rwp-captcha" ref={containerRef} key={nonce} />
      )}
      {error && <div className="rwp-captcha-error" role="alert">{error}</div>}
    </>
  ), [config.honeypot, config.honeypot_field, config.provider, guarded, form, nonce, error]);

  return { config, field, verify, reset, loading };
}

/**
 * The reCAPTCHA v3 badge notice. Google's terms require the badge or this wording; the badge is
 * hidden on most themes because it covers the corner a floating login button also wants.
 */
export function CaptchaNotice({ config }: { config: AntiBotConfig }) {
  if (config.provider !== 'recaptcha') return null;
  return (
    <p className="rwp-captcha-notice">
      This site is protected by reCAPTCHA and the Google{' '}
      <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer noopener">Privacy Policy</a> and{' '}
      <a href="https://policies.google.com/terms" target="_blank" rel="noreferrer noopener">Terms of Service</a> apply.
    </p>
  );
}
