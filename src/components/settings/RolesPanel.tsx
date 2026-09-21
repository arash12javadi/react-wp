import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../lib/db';
import { fetchProfile, fetchProfiles, type Profile } from '../../lib/profiles';
import {
  capabilities, capabilityLabels, grantableRoles, roleCapabilities, roleLabels, sensitiveCapabilities,
  type Capability, type UserRole,
} from '../../lib/roles';
import {
  addRoleGrant, addUserGrant, capabilityGrantsMigration, fetchRoleGrants, fetchUserGrants, loadCapabilityGrants,
  removeRoleGrant, removeUserGrant, type UserGrant,
} from '../../lib/capabilityGrants';
import settingsStyles from '../SiteSettings.module.css';
import styles from './RolesPanel.module.css';

const allPowerful = (role: UserRole) => role === 'administrator' || role === 'super_admin';

const confirmSensitive = (capability: Capability, who: string) =>
  !sensitiveCapabilities.includes(capability) || window.confirm(
    `"${capabilityLabels[capability]}" (${capability}) gives ${who} control over the whole site: settings, backups and restores, and plugins, which run code. Grant it anyway?`,
  );

/** Built-in capabilities as plain chips, grants as removable ones, and a picker to add more. */
function CapabilityEditor({ builtIn, granted, disabled, busy, onAdd, onRemove }: {
  builtIn: Capability[];
  granted: Capability[];
  disabled: boolean;
  busy: boolean;
  onAdd: (capability: Capability) => void;
  onRemove: (capability: Capability) => void;
}) {
  const available = capabilities.filter((capability) => !builtIn.includes(capability) && !granted.includes(capability));
  const [choice, setChoice] = useState<Capability | ''>('');
  const selected = choice && available.includes(choice) ? choice : '';

  return (
    <div className={styles.editor}>
      <div className={styles.chips}>
        {builtIn.map((capability) => (
          <span key={capability} className={styles.chip} title={`${capability} · part of the role`}>{capabilityLabels[capability]}</span>
        ))}
        {granted.map((capability) => (
          <span key={capability} className={`${styles.chip} ${styles.granted}`} title={`${capability} · added here`}>
            {capabilityLabels[capability]}
            {!disabled && (
              <button type="button" disabled={busy} aria-label={`Remove ${capabilityLabels[capability]}`} onClick={() => onRemove(capability)}>×</button>
            )}
          </span>
        ))}
      </div>
      {!disabled && available.length > 0 && (
        <div className={styles.addRow}>
          <select value={selected} onChange={(event) => setChoice(event.target.value as Capability)} aria-label="Capability to add">
            <option value="">Choose a capability…</option>
            {available.map((capability) => (
              <option key={capability} value={capability}>
                {capabilityLabels[capability]} ({capability}){sensitiveCapabilities.includes(capability) ? ' ⚠' : ''}
              </option>
            ))}
          </select>
          <button type="button" className={settingsStyles.secondaryButton} disabled={!selected || busy}
            onClick={() => { if (selected) { onAdd(selected); setChoice(''); } }}>
            ＋ Add
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Settings → Roles. Every change is saved straight away (rwp_role_capabilities and
 * rwp_user_capabilities) and enforced by public.user_has_cap(), not only by this screen.
 */
export default function RolesPanel() {
  const [viewerRole, setViewerRole] = useState<UserRole | null>(null);
  const [roleGrants, setRoleGrants] = useState<Partial<Record<UserRole, Capability[]>>>({});
  const [userGrants, setUserGrants] = useState<UserGrant[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await getSupabaseClient().auth.getUser();
      const [me, grants, perUser, people] = await Promise.all([
        data.user ? fetchProfile(data.user.id) : Promise.resolve(null),
        fetchRoleGrants(),
        fetchUserGrants(),
        fetchProfiles(),
      ]);
      setViewerRole(me?.role || null);
      setRoleGrants(grants);
      setUserGrants(perUser);
      setProfiles(people);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const canEdit = viewerRole !== null && allPowerful(viewerRole);

  /** Runs one change, reloads the grants (here and for the rest of the admin) and reports it. */
  const run = async (change: () => Promise<void>, done: string) => {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      await change();
      const [grants, perUser] = await Promise.all([fetchRoleGrants(), fetchUserGrants()]);
      setRoleGrants(grants);
      setUserGrants(perUser);
      await loadCapabilityGrants();
      setFeedback(`${done} People who are signed in get the change the next time they load a page.`);
    } catch (changeError: unknown) {
      setError(changeError instanceof Error ? changeError.message : String(changeError));
    } finally {
      setBusy(false);
    }
  };

  const visibleProfiles = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? profiles.filter((profile) => `${profile.display_name || ''} ${profile.email || ''}`.toLowerCase().includes(term)) : profiles;
  }, [profiles, search]);
  const person = profiles.find((profile) => profile.id === selectedUser);
  const grantsOf = (userId: string) => userGrants.filter((grant) => grant.user_id === userId).map((grant) => grant.capability);
  const personName = person ? person.display_name || person.email || 'this person' : '';

  if (loading) return <div className={settingsStyles.loading} role="status">Loading roles…</div>;

  return (
    <div className={styles.panel}>
      {error && (
        <div className={settingsStyles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>Reload</button>
        </div>
      )}
      {feedback && <div className={settingsStyles.success} role="status">{feedback}</div>}
      {!canEdit && (
        <div className={settingsStyles.warning} role="status">
          You can see these grants, but only an Administrator or Super Admin can change them. The database refuses anyone
          else, whatever capabilities their role has.
        </div>
      )}

      <section className={settingsStyles.form} aria-labelledby="role-caps-heading">
        <div>
          <h3 id="role-caps-heading" className={styles.heading}>Capabilities by role</h3>
          <p className={settingsStyles.help}>
            Grey capabilities come with the role and cannot be removed; blue ones were added here. Adding a capability gives
            it to everyone with that role. Administrators and Super Admins already have every capability.
          </p>
        </div>
        {grantableRoles.map((role) => (
          <div key={role} className={styles.role}>
            <strong>{roleLabels[role]}</strong>
            <CapabilityEditor
              builtIn={roleCapabilities[role]}
              granted={roleGrants[role] || []}
              disabled={!canEdit}
              busy={busy}
              onAdd={(capability) => {
                if (!confirmSensitive(capability, `every ${roleLabels[role]}`)) return;
                void run(() => addRoleGrant(role, capability), `${roleLabels[role]}s can now ${capabilityLabels[capability].toLowerCase()}.`);
              }}
              onRemove={(capability) => void run(() => removeRoleGrant(role, capability), `Removed ${capabilityLabels[capability]} from ${roleLabels[role]}.`)}
            />
          </div>
        ))}
      </section>

      <section className={settingsStyles.form} aria-labelledby="user-caps-heading">
        <div>
          <h3 id="user-caps-heading" className={styles.heading}>Capabilities for one person</h3>
          <p className={settingsStyles.help}>
            Select someone to add capabilities on top of their role, without changing the role itself. Changing someone&rsquo;s
            role is under <strong>Users</strong>.
          </p>
        </div>
        <div className={styles.users}>
          <div className={styles.userList}>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or email…" aria-label="Search users" />
            <ul>
              {visibleProfiles.map((profile) => {
                const extra = grantsOf(profile.id).length;
                return (
                  <li key={profile.id}>
                    <button type="button" className={profile.id === selectedUser ? styles.selected : undefined}
                      aria-pressed={profile.id === selectedUser} onClick={() => setSelectedUser(profile.id)}>
                      <strong>{profile.display_name || profile.email || 'Unknown user'}</strong>
                      <small>{profile.email} · {roleLabels[profile.role]}{extra ? ` · +${extra}` : ''}</small>
                    </button>
                  </li>
                );
              })}
              {visibleProfiles.length === 0 && <li className={settingsStyles.help}>No users match.</li>}
            </ul>
          </div>

          <div className={styles.userDetail}>
            {!person ? <p className={settingsStyles.help}>Select a user on the left.</p> : (
              <>
                <strong>{personName}</strong>
                <span className={settingsStyles.help}>{person.email} · {roleLabels[person.role]}</span>
                {allPowerful(person.role) ? (
                  <p className={settingsStyles.help}>{roleLabels[person.role]}s already have every capability.</p>
                ) : (
                  <CapabilityEditor
                    builtIn={[...new Set([...roleCapabilities[person.role], ...(roleGrants[person.role] || [])])]}
                    granted={grantsOf(person.id)}
                    disabled={!canEdit}
                    busy={busy}
                    onAdd={(capability) => {
                      if (!confirmSensitive(capability, personName)) return;
                      void run(() => addUserGrant(person.id, capability), `${personName} can now ${capabilityLabels[capability].toLowerCase()}.`);
                    }}
                    onRemove={(capability) => void run(() => removeUserGrant(person.id, capability), `Removed ${capabilityLabels[capability]} from ${personName}.`)}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <p className={settingsStyles.help}>
        Enforced by the database (<code>user_has_cap</code> reads both lists), so a grant opens the matching admin screens and
        database rows, and removing it closes them again. Changing roles and resetting the site stay limited to
        Administrators whatever is granted here. Needs <code>{capabilityGrantsMigration}</code>.
      </p>
    </div>
  );
}
