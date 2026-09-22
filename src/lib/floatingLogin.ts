import { isSafeUrl } from './account';
import { describeDbError, getSupabaseClient, tryGetSupabaseClient } from './db';

/**
 * Floating Login (Settings → Floating Login): six floating_login_* rows in the public `options`
 * table, so the public site can read them without signing in. Only manage_options can write them
 * (options RLS). Seeded by supabase/schema.sql; a missing row means the default below.
 *
 * Core's `users_can_register` is read along with them: the Register tab needs both this switch and
 * the site allowing registration, or the tab would offer something /register refuses.
 */

export type FloatingLoginPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export type FloatingLoginTheme = 'dark' | 'light' | 'glassmorphism';

export interface FloatingLoginSettings {
  floating_login_enabled: boolean;
  floating_login_position: FloatingLoginPosition;
  floating_login_button_text: string;
  floating_login_allow_registration: boolean;
  /** 'current' reloads the page the visitor is on; otherwise a site path or an http(s) address. */
  floating_login_redirect_url: string;
  floating_login_theme: FloatingLoginTheme;
}

export const defaultFloatingLoginSettings: FloatingLoginSettings = {
  floating_login_enabled: true,
  floating_login_position: 'bottom-right',
  floating_login_button_text: 'Login / Register',
  floating_login_allow_registration: true,
  floating_login_redirect_url: '/',
  floating_login_theme: 'dark',
};

export const positionLabels: Record<FloatingLoginPosition, string> = {
  'bottom-right': 'Bottom right',
  'bottom-left': 'Bottom left',
  'top-right': 'Top right',
  'top-left': 'Top left',
};

export const themeLabels: Record<FloatingLoginTheme, string> = {
  dark: 'Dark',
  light: 'Light',
  glassmorphism: 'Glass (frosted, see-through)',
};

export const floatingLoginOptionNames = Object.keys(defaultFloatingLoginSettings) as Array<keyof FloatingLoginSettings>;

export const buttonTextMaxLength = 40;

/** Why a redirect value is refused, or '' when it is fine. */
export const redirectProblem = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'current') return '';
  return isSafeUrl(trimmed)
    ? ''
    : 'Use "current", a path on this site starting with / (such as /dashboard), or a full http(s):// address.';
};

/** Where to go after signing in: null means reload the page the visitor is on. */
export const redirectTarget = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'current' || redirectProblem(trimmed)) return null;
  return trimmed;
};

const toBoolean = (value: string | undefined, fallback: boolean) =>
  (value === undefined || value === '' ? fallback : value === 'true' || value === '1');

export const normalizeFloatingLoginSettings = (values: Record<string, string | undefined>): FloatingLoginSettings => {
  const defaults = defaultFloatingLoginSettings;
  const position = values.floating_login_position as FloatingLoginPosition | undefined;
  const theme = values.floating_login_theme as FloatingLoginTheme | undefined;
  const text = (values.floating_login_button_text || '').trim().slice(0, buttonTextMaxLength);
  const saved = values.floating_login_redirect_url;
  const redirect = saved === undefined ? defaults.floating_login_redirect_url : saved.trim();
  return {
    floating_login_enabled: toBoolean(values.floating_login_enabled, defaults.floating_login_enabled),
    floating_login_position: position && position in positionLabels ? position : defaults.floating_login_position,
    floating_login_button_text: text || defaults.floating_login_button_text,
    floating_login_allow_registration: toBoolean(values.floating_login_allow_registration, defaults.floating_login_allow_registration),
    // An empty value means "stay on this page", which is what 'current' already says.
    floating_login_redirect_url: !redirect ? 'current' : redirectProblem(redirect) ? defaults.floating_login_redirect_url : redirect,
    floating_login_theme: theme && theme in themeLabels ? theme : defaults.floating_login_theme,
  };
};

// A tiny store, so the public button, its dialog and the settings screen share one copy and a save
// in the admin shows up in open tabs of this browser straight away.

export interface FloatingLoginState {
  settings: FloatingLoginSettings;
  /** Settings → Accounts → "Anyone can register". */
  siteAllowsRegistration: boolean;
  loaded: boolean;
}

let state: FloatingLoginState = { settings: defaultFloatingLoginSettings, siteAllowsRegistration: true, loaded: false };
let pending: Promise<FloatingLoginState> | null = null;
const listeners = new Set<() => void>();

export const getFloatingLoginState = () => state;

export const subscribeFloatingLogin = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const setState = (next: FloatingLoginState) => {
  state = next;
  listeners.forEach((listener) => listener());
};

/**
 * Reads the options once per page load. Missing rows keep the defaults, and a failed read keeps
 * them too: the button is an extra, it must never break the page.
 */
export const loadFloatingLoginSettings = (): Promise<FloatingLoginState> => {
  if (pending) return pending;
  pending = (async () => {
    const supabase = tryGetSupabaseClient();
    if (!supabase) {
      setState({ ...state, loaded: true });
      return state;
    }
    const { data, error } = await supabase
      .from('options')
      .select('option_name,option_value')
      .in('option_name', [...floatingLoginOptionNames, 'users_can_register']);
    if (error) {
      console.warn(`Floating Login settings could not be loaded (${describeDbError(error)}); the defaults are used.`);
      setState({ ...state, loaded: true });
      return state;
    }
    const values = Object.fromEntries((data || []).map((row) => [row.option_name as string, row.option_value as string]));
    setState({
      settings: normalizeFloatingLoginSettings(values),
      siteAllowsRegistration: toBoolean(values.users_can_register, true),
      loaded: true,
    });
    return state;
  })();
  return pending;
};

export const saveFloatingLoginSettings = async (next: FloatingLoginSettings): Promise<FloatingLoginSettings> => {
  const problem = redirectProblem(next.floating_login_redirect_url);
  if (problem) throw new Error(`The redirect after login was not saved: ${problem}`);
  const clean = normalizeFloatingLoginSettings(
    Object.fromEntries(floatingLoginOptionNames.map((name) => [name, String(next[name])])),
  );
  const rows = floatingLoginOptionNames.map((name) => ({ option_name: name, option_value: String(clean[name]) }));
  const { data, error } = await getSupabaseClient().from('options').upsert(rows).select('option_name');
  if (error) throw new Error(`The settings were not saved: ${describeDbError(error)}`);
  // RLS refuses the write without an error and returns no rows.
  if ((data?.length ?? 0) < rows.length) {
    throw new Error('The settings were not saved: changing options needs the manage_options capability, and your role does not have it.');
  }
  setState({ ...state, settings: clean, loaded: true });
  return clean;
};
