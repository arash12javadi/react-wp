import { tryGetSupabaseClient } from '../../../src/lib/db';
import { fetchProfile } from '../../../src/lib/profiles';
import { hasCapability } from '../../../src/lib/roles';

/**
 * Whether the person looking at the public site may translate it (manage_options, the same
 * capability rwp_translations requires for writing). Decides whether the Translate button shows
 * and whether untranslated text is collected. The database checks again on every write.
 */

let canTranslate = false;
let version = 0;
const listeners = new Set<() => void>();

export const getCanTranslate = () => canTranslate;
export const getViewerVersion = () => version;
export const subscribeViewer = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const set = (value: boolean) => {
  if (value === canTranslate) return;
  canTranslate = value;
  version += 1;
  listeners.forEach((listener) => listener());
};

async function resolve(userId: string | undefined) {
  if (!userId) {
    set(false);
    return;
  }
  const profile = await fetchProfile(userId).catch(() => null);
  set(Boolean(profile && hasCapability(profile.role, 'manage_options')));
}

export function startViewer(): () => void {
  const supabase = tryGetSupabaseClient();
  if (!supabase) return () => undefined;
  void supabase.auth.getSession().then(({ data }) => resolve(data.session?.user.id));
  // Deferred: a Supabase request made inside this callback can deadlock the auth client.
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => void resolve(session?.user.id), 0);
  });
  return () => {
    data.subscription.unsubscribe();
    set(false);
  };
}
