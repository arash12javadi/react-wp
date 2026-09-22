import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../lib/db';
import { loginHref } from '../../lib/account';
import SavedCollections from './SavedCollections';
import FollowingFeed from './FollowingFeed';

/** [rwp_saved_collections] and [rwp_following_feed]: the feed for a signed-in visitor, or a sign-in link. */
export default function SignedInFeed({ feed }: { feed: 'saved' | 'following' }) {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  useEffect(() => {
    let active = true;
    void getSupabaseClient().auth.getSession().then(({ data }) => { if (active) setState(data.session ? 'in' : 'out'); });
    return () => { active = false; };
  }, []);
  if (state === 'loading') return null;
  if (state === 'out') {
    return (
      <p className="rwp-engagement-muted">
        <a href={loginHref()}>Sign in</a> to see {feed === 'saved' ? 'your saved collections' : 'the posts from people and categories you follow'}.
      </p>
    );
  }
  return feed === 'saved' ? <SavedCollections /> : <FollowingFeed />;
}
