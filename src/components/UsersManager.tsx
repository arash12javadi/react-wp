import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../lib/db';
import { fetchProfiles, missingProfilesTable, type Profile } from '../lib/profiles';
import { capabilityLabels, roleCapabilities, roleLabels, roles, type UserRole } from '../lib/roles';
import styles from './UsersManager.module.css';

export default function UsersManager({ role: currentRole }: { role: UserRole }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [savingId, setSavingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const canPromote = currentRole === 'administrator' || currentRole === 'super_admin';

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await getSupabaseClient().auth.getUser();
      setCurrentUserId(data.user?.id || '');
      setProfiles(await fetchProfiles());
    } catch (loadError: unknown) {
      const message = loadError instanceof Error ? loadError.message : 'Unable to load users.';
      setError(missingProfilesTable(message)
        ? 'The profiles table is missing. Run supabase/migrations/20260912_profiles_capabilities_media.sql in the Supabase SQL Editor, then reload.'
        : message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const changeRole = async (profile: Profile, role: UserRole) => {
    setSavingId(profile.id);
    setError('');
    setFeedback('');
    const previous = profiles;
    setProfiles((current) => current.map((item) => (item.id === profile.id ? { ...item, role } : item)));
    const { error: updateError } = await getSupabaseClient()
      .from('profiles')
      .update({ role })
      .eq('id', profile.id);
    if (updateError) {
      setProfiles(previous);
      setError(updateError.message);
    } else {
      setFeedback(`${profile.email || 'User'} is now ${roleLabels[role]}.`);
    }
    setSavingId('');
  };

  return (
    <section className={styles.container} aria-labelledby="users-heading">
      <div className={styles.intro}>
        <h2 id="users-heading">Users</h2>
        <p>
          Roles determine what each person can do. Capabilities are defined in <code>src/lib/roles.ts</code> and
          enforced by database policies, so changing a role here changes what that account can do at the database level.
        </p>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {feedback && <div className={styles.feedback} role="status">{feedback}</div>}
      {!canPromote && <div className={styles.notice}>Your role can view users but not change their roles.</div>}

      {loading ? <div className={styles.status} role="status">Loading users…</div> : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>User</th><th>Role</th><th>Capabilities</th></tr>
            </thead>
            <tbody>
              {profiles.map((profile) => {
                const isSelf = profile.id === currentUserId;
                const granted = roleCapabilities[profile.role] || [];
                const open = expanded === profile.id;
                return (
                  <tr key={profile.id}>
                    <td>
                      <strong>{profile.display_name || profile.email || 'Unknown user'}</strong>
                      <small>{profile.email}{isSelf ? ' · you' : ''}</small>
                    </td>
                    <td>
                      <select
                        value={profile.role}
                        disabled={!canPromote || isSelf || savingId === profile.id}
                        onChange={(event) => void changeRole(profile, event.target.value as UserRole)}
                      >
                        {roles.map((item) => <option key={item} value={item}>{roleLabels[item]}</option>)}
                      </select>
                      {isSelf && <small className={styles.hint}>You cannot change your own role.</small>}
                    </td>
                    <td>
                      <div className={styles.chips}>
                        {(open ? granted : granted.slice(0, 4)).map((capability) => (
                          <span key={capability} className={styles.chip}>{capabilityLabels[capability]}</span>
                        ))}
                        {granted.length > 4 && (
                          <button type="button" className={styles.more}
                            onClick={() => setExpanded(open ? null : profile.id)}>
                            {open ? 'Show less' : `+${granted.length - 4} more`}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className={styles.footnote}>
        New accounts start as Subscriber. Creating and deleting accounts requires the Supabase dashboard, because the
        Supabase admin API needs a secret key that must never reach the browser.
      </p>
    </section>
  );
}
