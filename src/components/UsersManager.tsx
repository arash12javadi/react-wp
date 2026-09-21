import { useEffect, useMemo, useState } from 'react';
import { describeDbError, getSupabaseClient } from '../lib/db';
import { fetchProfiles, missingProfilesTable, type Profile } from '../lib/profiles';
import { capabilitiesFor, capabilityLabels, roleLabels, roles, type UserRole } from '../lib/roles';
import { fetchUserGrants, type UserGrant } from '../lib/capabilityGrants';
import { BulkBar, BulkInline, RowCheckbox, SelectAllCheckbox, downloadCsv, useBulkSelection } from './BulkActions';
import styles from './UsersManager.module.css';

export default function UsersManager({ role: currentRole }: { role: UserRole }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [savingId, setSavingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | UserRole>('');
  const [bulkRole, setBulkRole] = useState<UserRole>('subscriber');
  const [userGrants, setUserGrants] = useState<UserGrant[]>([]);

  const canPromote = currentRole === 'administrator' || currentRole === 'super_admin';

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await getSupabaseClient().auth.getUser();
      setCurrentUserId(data.user?.id || '');
      setProfiles(await fetchProfiles());
      // Settings → Roles grants for one person; an empty list before the 20261001 migration.
      setUserGrants(await fetchUserGrants().catch(() => []));
    } catch (loadError: unknown) {
      const message = loadError instanceof Error ? loadError.message : describeDbError(loadError);
      setError(missingProfilesTable(message)
        ? 'The profiles table is missing. Run supabase/migrations/20260912_profiles_capabilities_media.sql in the Supabase SQL Editor, then reload.'
        : message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return profiles.filter((profile) =>
      (!roleFilter || profile.role === roleFilter)
      && (!term || `${profile.display_name || ''} ${profile.email || ''}`.toLowerCase().includes(term)));
  }, [profiles, roleFilter, search]);
  const visibleIds = useMemo(() => visible.map((profile) => profile.id), [visible]);
  const selection = useBulkSelection(visibleIds);
  const roleCounts = useMemo(() => profiles.reduce<Partial<Record<UserRole, number>>>((counts, profile) => {
    counts[profile.role] = (counts[profile.role] || 0) + 1;
    return counts;
  }, {}), [profiles]);

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

  const changeRoles = async (ids: string[]) => {
    // The role guard raises for your own row, which would abort the whole statement.
    const targets = profiles.filter((profile) => ids.includes(profile.id) && profile.id !== currentUserId && profile.role !== bulkRole);
    const skippedSelf = ids.includes(currentUserId);
    if (!targets.length) {
      setError('');
      setFeedback(skippedSelf && ids.length === 1
        ? 'You cannot change your own role.'
        : `The selected users are already ${roleLabels[bulkRole]}${skippedSelf ? ' (your own account is skipped)' : ''}.`);
      return;
    }
    if (!window.confirm(`Change ${targets.length} user(s) to ${roleLabels[bulkRole]}?${skippedSelf ? ' Your own account is skipped.' : ''}`)) return;
    setSavingId('bulk');
    setError('');
    setFeedback('');
    try {
      const { data, error: updateError } = await getSupabaseClient()
        .from('profiles')
        .update({ role: bulkRole })
        .in('id', targets.map((profile) => profile.id))
        .select('id');
      if (updateError) throw updateError;
      const changed = new Set(((data || []) as Array<{ id: string }>).map((row) => row.id));
      setProfiles((current) => current.map((profile) => (changed.has(profile.id) ? { ...profile, role: bulkRole } : profile)));
      if (changed.size) setFeedback(`${changed.size} user(s) are now ${roleLabels[bulkRole]}.${skippedSelf ? ' Your own account was skipped.' : ''}`);
      if (changed.size < targets.length) {
        setError(`${targets.length - changed.size} user(s) were not changed: row level security skipped them. Changing roles needs the edit_users capability.`);
      }
      selection.clear();
    } catch (updateError: unknown) {
      setError(describeDbError(updateError));
    } finally {
      setSavingId('');
    }
  };

  const exportUsers = (ids: string[]) => {
    const rows = visible.filter((profile) => ids.includes(profile.id));
    downloadCsv(`users-${new Date().toISOString().slice(0, 10)}.csv`, ['Name', 'Email', 'Role', 'Registered'],
      rows.map((profile) => [profile.display_name, profile.email, roleLabels[profile.role], new Date(profile.created_at).toISOString()]));
    setFeedback(`Exported ${rows.length} user(s) to CSV.`);
  };

  return (
    <section className={styles.container} aria-labelledby="users-heading">
      <div className={styles.intro}>
        <h2 id="users-heading">Users</h2>
        <p>
          Roles determine what each person can do. Capabilities are defined in <code>src/lib/roles.ts</code> and
          enforced by database policies, so changing a role here changes what that account can do at the database level.
          Extra capabilities for a role or for one person are added under <strong>Settings → Roles</strong>.
        </p>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {feedback && <div className={styles.feedback} role="status">{feedback}</div>}
      {!canPromote && <div className={styles.notice}>Your role can view users but not change their roles.</div>}

      {loading ? <div className={styles.status} role="status">Loading users…</div> : (
        <>
          <div className={styles.filters}>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or email…" aria-label="Search users" />
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as '' | UserRole)} aria-label="Filter by role">
              <option value="">All roles ({profiles.length})</option>
              {roles.map((item) => <option key={item} value={item}>{roleLabels[item]} ({roleCounts[item] || 0})</option>)}
            </select>
          </div>
          <BulkBar selection={selection} total={visible.length} noun="users" busy={savingId === 'bulk' ? 'role' : ''}
            actions={[{ id: 'export', label: 'Export CSV' }]}
            onAction={(action, ids) => { if (action === 'export') exportUsers(ids); }}>
            {canPromote && (
              <BulkInline>
                <select value={bulkRole} onChange={(event) => setBulkRole(event.target.value as UserRole)} aria-label="New role for selected users">
                  {roles.map((item) => <option key={item} value={item}>Change role to {roleLabels[item]}</option>)}
                </select>
                <button type="button" className={styles.apply} disabled={savingId === 'bulk'} onClick={() => void changeRoles(selection.selected)}>
                  {savingId === 'bulk' ? 'Saving…' : 'Apply'}
                </button>
              </BulkInline>
            )}
          </BulkBar>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th className={styles.checkCell}><SelectAllCheckbox selection={selection} total={visible.length} /></th><th>User</th><th>Role</th><th>Capabilities</th></tr>
              </thead>
              <tbody>
                {visible.length === 0 && <tr><td colSpan={4} className={styles.status}>No users match your search.</td></tr>}
                {visible.map((profile) => {
                  const isSelf = profile.id === currentUserId;
                  const granted = [...new Set([
                    ...capabilitiesFor(profile.role),
                    ...userGrants.filter((grant) => grant.user_id === profile.id).map((grant) => grant.capability),
                  ])];
                  const open = expanded === profile.id;
                  return (
                    <tr key={profile.id} className={selection.isSelected(profile.id) ? styles.rowSelected : undefined}>
                      <td className={styles.checkCell}><RowCheckbox selection={selection} id={profile.id} label={profile.display_name || profile.email || 'user'} /></td>
                      <td>
                        <strong>{profile.display_name || profile.email || 'Unknown user'}</strong>
                        <small>{profile.email}{isSelf ? ' · you' : ''}</small>
                      </td>
                      <td>
                        <select
                          value={profile.role}
                          disabled={!canPromote || isSelf || savingId === profile.id || savingId === 'bulk'}
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
        </>
      )}

      <p className={styles.footnote}>
        New accounts start as Subscriber. Creating and deleting accounts requires the Supabase dashboard, because the
        Supabase admin API needs a secret key that must never reach the browser.
      </p>
    </section>
  );
}
