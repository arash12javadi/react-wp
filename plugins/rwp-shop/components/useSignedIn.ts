import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';

/**
 * The signed-in user's id ('' when signed out), or null until the session is known. The commerce
 * components also render inside builder pages, outside PublicChrome, so they cannot rely on its context.
 */
export function useSignedIn(): string | null {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const supabase = getSupabaseClient();
    void supabase.auth.getSession().then(({ data }) => { if (active) setUserId(data.session?.user.id || ''); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { if (active) setUserId(session?.user.id || ''); });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);
  return userId;
}
