/**
 * The browser half of the anti-bot engine: the honeypot fields, the Cloudflare Turnstile or
 * Google reCAPTCHA v3 widget, and the call to POST /api/security/verify that turns a solved
 * challenge into a clearance ticket.
 *
 * What this layer does and does not do
 * ------------------------------------
 * Sign-in, registration and comments go from here straight to Supabase; the Node server is not in
 * that path and cannot be. So for those forms this is a gate in front of the request, not around
 * it: it stops bots that drive a real page — which is nearly all of them — and it does not stop
 * something that talks to the Supabase REST API directly. What stops that is Supabase's own auth
 * rate limiting, email confirmation, and the comment RLS policies. This is a layer, not a wall,
 * and saying otherwise in a comment would be how someone later removes the real protections.
 *
 * For anything that does reach the server (plugin form widgets, chat, uploads, the admin
 * endpoints) the ticket is verified there by requireClearance() and the check is enforced.
 *
 * On a static host with no server.mjs (Vercel), /api/security/config is not there. The engine
 * reports itself unavailable, the honeypot still renders and is still checked in the browser, and
 * nothing throws — a missing endpoint must never be the reason a visitor cannot sign in.
 */

export type AntiBotProvider = 'none' | 'turnstile' | 'recaptcha';
/** The forms an administrator can require a check on (Settings → Security → Anti-bot). */
export type AntiBotForm = 'login' | 'register' | 'lost_password' | 'comment' | 'contact';

export const antiBotForms: AntiBotForm[] = ['login', 'register', 'lost_password', 'comment', 'contact'];

export const antiBotFormLabels: Record<AntiBotForm, string> = {
  login: 'Sign in',
  register: 'Registration',
  lost_password: 'Lost password',
  comment: 'Comments',
  contact: 'Contact and form widgets',
};

export interface AntiBotConfig {
  /** False when this host has no server.mjs, so no ticket can be issued. */
  available: boolean;
  provider: AntiBotProvider;
  site_key: string;
  honeypot: boolean;
  honeypot_field: string;
  timestamp_field: string;
  minimum_seconds: number;
  forms: AntiBotForm[];
}

export const fallbackAntiBotConfig: AntiBotConfig = {
  available: false,
  provider: 'none',
  site_key: '',
  honeypot: true,
  honeypot_field: 'rwp_website_url',
  timestamp_field: 'rwp_form_started',
  minimum_seconds: 2,
  forms: [],
};

let configPromise: Promise<AntiBotConfig> | null = null;

/**
 * The public settings, fetched once per page load and shared by every form on it. The server
 * caches this for a minute of its own, so a settings change reaches open pages on the next load
 * rather than immediately — which is the right trade for a value read by every form.
 */
export const loadAntiBotConfig = (): Promise<AntiBotConfig> => {
  if (configPromise) return configPromise;
  configPromise = fetch('/api/security/config', { headers: { Accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok) return fallbackAntiBotConfig;
      const body = await response.json();
      return {
        available: true,
        provider: (['turnstile', 'recaptcha'].includes(body?.provider) ? body.provider : 'none') as AntiBotProvider,
        site_key: String(body?.site_key || ''),
        honeypot: body?.honeypot !== false,
        honeypot_field: String(body?.honeypot_field || fallbackAntiBotConfig.honeypot_field),
        timestamp_field: String(body?.timestamp_field || fallbackAntiBotConfig.timestamp_field),
        minimum_seconds: Number(body?.minimum_seconds) || fallbackAntiBotConfig.minimum_seconds,
        forms: Array.isArray(body?.forms) ? body.forms.filter((form: string) => antiBotForms.includes(form as AntiBotForm)) : [],
      } satisfies AntiBotConfig;
    })
    // A static host, an offline moment or a 500: the forms carry on without a ticket.
    .catch(() => fallbackAntiBotConfig);
  return configPromise;
};

/** After saving Settings → Security, so the next form picks up the new provider without a reload. */
export const forgetAntiBotConfig = () => { configPromise = null; };

/** Whether this form needs a ticket at all. A form nobody protected costs nothing. */
export const formIsGuarded = (config: AntiBotConfig, form: AntiBotForm) =>
  config.available && config.forms.includes(form) && (config.provider !== 'none' || config.honeypot);

// --- Provider scripts -------------------------------------------------------------------------

interface TurnstileApi {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}
interface RecaptchaApi {
  ready: (callback: () => void) => void;
  execute: (siteKey: string, options: { action: string }) => Promise<string>;
}
type ScriptWindow = Window & { turnstile?: TurnstileApi; grecaptcha?: RecaptchaApi };

const scripts = new Map<string, Promise<void>>();

/** Loads a provider script once per page, whatever how many forms ask for it. */
const loadScript = (src: string): Promise<void> => {
  const existing = scripts.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const element = document.createElement('script');
    element.src = src;
    element.async = true;
    element.defer = true;
    element.onload = () => resolve();
    // Named after the thing that failed: "the CAPTCHA script was blocked" sends someone to their
    // ad blocker, which is where the answer usually is. A generic failure sends them nowhere.
    element.onerror = () => reject(new Error(`The CAPTCHA script at ${new URL(src).host} could not be loaded. A blocker or a network policy may be stopping it.`));
    document.head.appendChild(element);
  });
  scripts.set(src, promise);
  return promise;
};

export const turnstileReady = async (): Promise<TurnstileApi> => {
  await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  const api = (window as ScriptWindow).turnstile;
  if (!api) throw new Error('The Cloudflare Turnstile script loaded but did not register itself.');
  return api;
};

export const recaptchaToken = async (siteKey: string, action: string): Promise<string> => {
  await loadScript(`https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`);
  const api = (window as ScriptWindow).grecaptcha;
  if (!api) throw new Error('The Google reCAPTCHA script loaded but did not register itself.');
  await new Promise<void>((resolve) => api.ready(resolve));
  return api.execute(siteKey, { action });
};

// --- Verification -----------------------------------------------------------------------------

export interface VerifyInput {
  form: AntiBotForm;
  token: string;
  /** What the hidden trap field held, and when the form opened. */
  honeypot: string;
  startedAt: number;
}

/**
 * Exchanges a solved challenge for a clearance ticket. Throws with the server's own wording,
 * which already distinguishes "not configured", "you failed the check" and "the service is down" —
 * three problems with three different fixes, and a single "verification failed" hides all of them.
 */
export const verifyHuman = async (config: AntiBotConfig, input: VerifyInput): Promise<string> => {
  if (!formIsGuarded(config, input.form)) return '';
  const response = await fetch('/api/security/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      form: input.form,
      token: input.token,
      [config.honeypot_field]: input.honeypot,
      [config.timestamp_field]: input.startedAt,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `Verification failed (HTTP ${response.status}).`);
  return String(body?.ticket || '');
};
