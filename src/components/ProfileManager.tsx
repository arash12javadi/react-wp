import { useEffect, useState, type FormEvent } from 'react';
import { describeDbError, getSupabaseClient } from '../lib/db';
import { fetchProfile, type Profile } from '../lib/profiles';
import { roleLabels, type UserRole } from '../lib/roles';
import MediaManager from './MediaManager';
import styles from './ProfileManager.module.css';

export default function ProfileManager({ role }: { role: UserRole }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [email, setEmail] = useState('');
  const [currentEmail, setCurrentEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pickingAvatar, setPickingAvatar] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await getSupabaseClient().auth.getUser();
        if (!data.user) throw new Error('You are not signed in.');
        setEmail(data.user.email || '');
        setCurrentEmail(data.user.email || '');
        const result = await fetchProfile(data.user.id);
        if (result) {
          setProfile(result);
          setDisplayName(result.display_name || '');
          setBio(result.bio || '');
          setAvatarUrl(result.avatar_url || '');
        }
      } catch (loadError: unknown) {
        setError(describeDbError(loadError));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingProfile(true);
    setError('');
    setFeedback('');
    try {
      const supabase = getSupabaseClient();
      const { data: userData } = await supabase.auth.getUser();
      const id = profile?.id || userData.user?.id;
      if (!id) throw new Error('You are not signed in.');

      const changes = {
        display_name: displayName.trim(),
        bio: bio.trim() || null,
        avatar_url: avatarUrl.trim() || null,
      };

      // .select() matters: an UPDATE blocked by row level security affects zero rows and
      // returns no error, so without checking what came back this reports a save that
      // never happened.
      const { data, error: updateError } = await supabase
        .from('profiles').update(changes).eq('id', id).select();
      if (updateError) throw updateError;

      if (!data || data.length === 0) {
        // No row matched. Either the profile row is missing, or the policy rejected it.
        const { data: created, error: insertError } = await supabase
          .from('profiles')
          .upsert({ id, email: userData.user?.email, ...changes })
          .select();
        if (insertError) throw insertError;
        if (!created || created.length === 0) {
          throw new Error('The database accepted the request but changed nothing. Your row level security policy is rejecting this update — check that supabase/migrations/20260912_profiles_capabilities_media.sql has been run.');
        }
        setProfile(created[0] as Profile);
      } else {
        setProfile(data[0] as Profile);
      }
      setFeedback('Profile saved.');
    } catch (saveError: unknown) {
      const message = describeDbError(saveError);
      setError(/column .*(bio|avatar_url)|schema cache/i.test(message)
        ? 'The profiles table is missing the bio and avatar columns. Run supabase/migrations/20260915_comments_profiles_widgets.sql in the Supabase SQL Editor, then reload.'
        : message);
    } finally {
      setSavingProfile(false);
    }
  };

  const saveAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingAccount(true);
    setError('');
    setFeedback('');
    try {
      const supabase = getSupabaseClient();
      const messages: string[] = [];

      if (password) {
        if (password !== confirmPassword) throw new Error('The two passwords do not match.');
        if (password.length < 6) throw new Error('Password must be at least 6 characters.');
        const { error: passwordError } = await supabase.auth.updateUser({ password });
        if (passwordError) throw new Error(passwordError.message);
        messages.push('Password updated.');
        setPassword('');
        setConfirmPassword('');
      }

      // Compared against the auth user's address, not the profile row: if the profile
      // failed to load this would otherwise fire an email change on every save.
      const trimmedEmail = email.trim();
      if (trimmedEmail && trimmedEmail !== currentEmail) {
        const { error: emailError } = await supabase.auth.updateUser({ email: trimmedEmail });
        if (emailError) throw new Error(emailError.message);
        // Supabase only applies the new address after the confirmation link is clicked,
        // so saying "saved" here would be a lie.
        messages.push(`A confirmation link was sent to ${trimmedEmail}. The address changes once you click it.`);
      }

      setFeedback(messages.length ? messages.join(' ') : 'Nothing to update.');
    } catch (accountError: unknown) {
      setError(accountError instanceof Error ? accountError.message : 'Unable to update your account.');
    } finally {
      setSavingAccount(false);
    }
  };

  if (loading) return <div className={styles.loading} role="status">Loading your profile…</div>;

  return (
    <section className={styles.container} aria-labelledby="profile-heading">
      <div className={styles.intro}>
        <h2 id="profile-heading">Profile</h2>
        <p>Your details as they appear across the site, plus your sign-in credentials.</p>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {feedback && <div className={styles.feedback} role="status">{feedback}</div>}

      <div className={styles.grid}>
        <form className={styles.card} onSubmit={saveProfile}>
          <h3>Public details</h3>

          <div className={styles.avatarRow}>
            {avatarUrl
              ? <img className={styles.avatar} src={avatarUrl} alt="" />
              : <span className={styles.avatarFallback} aria-hidden="true">
                  {(displayName || profile?.email || 'A').charAt(0).toUpperCase()}
                </span>}
            <div className={styles.avatarActions}>
              <button type="button" className={styles.secondary} onClick={() => setPickingAvatar(true)}>
                Choose avatar
              </button>
              {avatarUrl && (
                <button type="button" className={styles.linkButton} onClick={() => setAvatarUrl('')}>Remove</button>
              )}
            </div>
          </div>

          <label>
            Display name
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)}
              placeholder="How your name appears on comments and posts" />
          </label>

          <label>
            Bio
            <textarea rows={4} value={bio} onChange={(event) => setBio(event.target.value)}
              placeholder="A short description of yourself" />
          </label>

          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={savingProfile}>
              {savingProfile ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>

        <div className={styles.side}>
          <form className={styles.card} onSubmit={saveAccount}>
            <h3>Account</h3>

            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              <span className={styles.help}>Changing this sends a confirmation link to the new address.</span>
            </label>

            <label>
              New password
              <input type="password" value={password} autoComplete="new-password"
                onChange={(event) => setPassword(event.target.value)} placeholder="Leave blank to keep current" />
            </label>

            <label>
              Confirm new password
              <input type="password" value={confirmPassword} autoComplete="new-password"
                onChange={(event) => setConfirmPassword(event.target.value)} />
            </label>

            <div className={styles.actions}>
              <button type="submit" className={styles.primary} disabled={savingAccount}>
                {savingAccount ? 'Saving…' : 'Update account'}
              </button>
            </div>
          </form>

          <div className={styles.card}>
            <h3>Role</h3>
            <p className={styles.roleValue}>{roleLabels[role]}</p>
            <p className={styles.help}>
              Only an administrator can change this, under <strong>Users</strong>. It cannot be changed from here —
              that is what stops an account from promoting itself.
            </p>
            {profile && (
              <p className={styles.help}>Member since {new Date(profile.created_at).toLocaleDateString()}.</p>
            )}
          </div>
        </div>
      </div>

      {pickingAvatar && (
        <MediaManager
          heading="Choose an avatar"
          onClose={() => setPickingAvatar(false)}
          onSelect={(item) => {
            setAvatarUrl(item.url);
            setPickingAvatar(false);
          }}
        />
      )}
    </section>
  );
}
