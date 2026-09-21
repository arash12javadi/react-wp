import { useEffect, useState, type FormEvent } from 'react';
import { describeDbError, getSupabaseClient } from '../lib/db';
import {
  emptyProfileDetails, explainProfileDetailsError, fetchProfile, fetchProfileDetails, saveProfileDetails, socialNetworks,
  type Profile, type ProfileDetails,
} from '../lib/profiles';
import { canUploadMedia, roleLabels, type UserRole } from '../lib/roles';
import MediaManager from './MediaManager';
import styles from './ProfileManager.module.css';

const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
const timezones: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') || [browserTimezone];
  } catch {
    return [browserTimezone];
  }
})();

/**
 * The admin Profile screen, and the public [rwp_user_profile] shortcode (`embedded`), which is
 * what the User profile page chosen under Settings → Site shows.
 */
export default function ProfileManager({ role, embedded = false }: { role: UserRole; embedded?: boolean }) {
  // The media library needs upload_files; without it, an avatar is set by its address.
  const canPickAvatar = canUploadMedia(role);
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
  const [details, setDetails] = useState<ProfileDetails>(emptyProfileDetails);
  const [detailsAvailable, setDetailsAvailable] = useState(true);
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [detailsFeedback, setDetailsFeedback] = useState('');

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
        // Loaded separately so a missing migration only disables this card, not the whole screen.
        try {
          setDetails(await fetchProfileDetails(data.user.id));
        } catch (detailsLoadError: unknown) {
          setDetailsAvailable(false);
          setDetailsError(explainProfileDetailsError(detailsLoadError));
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

  const setDetail = (key: Exclude<keyof ProfileDetails, 'social_links'>, value: string) =>
    setDetails((current) => ({ ...current, [key]: value }));

  const saveDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingDetails(true);
    setDetailsError('');
    setDetailsFeedback('');
    try {
      const { data } = await getSupabaseClient().auth.getUser();
      if (!data.user) throw new Error('You are not signed in.');
      setDetails(await saveProfileDetails(data.user.id, details));
      setDetailsFeedback('Details saved.');
    } catch (saveError: unknown) {
      setDetailsError(explainProfileDetailsError(saveError));
    } finally {
      setSavingDetails(false);
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
    <section className={`${styles.container} ${embedded ? 'rwp-user-profile' : ''}`} aria-labelledby="profile-heading">
      <div className={styles.intro}>
        <h2 id="profile-heading">{embedded ? 'Your profile' : 'Profile'}</h2>
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
              {canPickAvatar ? (
                <button type="button" className={styles.secondary} onClick={() => setPickingAvatar(true)}>
                  Choose avatar
                </button>
              ) : (
                <input type="url" value={avatarUrl} aria-label="Avatar image address" placeholder="https://example.com/me.jpg"
                  onChange={(event) => setAvatarUrl(event.target.value)} />
              )}
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

      <form className={`${styles.card} ${styles.detailsCard}`} onSubmit={saveDetails}>
        <div>
          <h3>More about you <span className={styles.optional}>optional</span></h3>
          <p className={styles.help}>
            Only you and people who can manage users (Administrators and Shop Managers) can see these. They are not shown
            on the public site.
          </p>
        </div>
        {detailsError && <div className={styles.error} role="alert">{detailsError}</div>}
        {detailsFeedback && <div className={styles.feedback} role="status">{detailsFeedback}</div>}

        {detailsAvailable && (
          <>
            <div className={styles.detailsGrid}>
              <label>First name<input value={details.first_name} maxLength={100} autoComplete="given-name" onChange={(event) => setDetail('first_name', event.target.value)} /></label>
              <label>Last name<input value={details.last_name} maxLength={100} autoComplete="family-name" onChange={(event) => setDetail('last_name', event.target.value)} /></label>
              <label>Pronouns<input value={details.pronouns} maxLength={40} placeholder="e.g. she/her, they/them" onChange={(event) => setDetail('pronouns', event.target.value)} /></label>
              <label>Job title<input value={details.job_title} maxLength={120} autoComplete="organization-title" onChange={(event) => setDetail('job_title', event.target.value)} /></label>
              <label>Company<input value={details.company} maxLength={120} autoComplete="organization" onChange={(event) => setDetail('company', event.target.value)} /></label>
              <label>Website<input type="url" value={details.website} maxLength={300} placeholder="https://example.com" autoComplete="url" onChange={(event) => setDetail('website', event.target.value)} /></label>
              <label>Location<input value={details.location} maxLength={120} placeholder="City, country" onChange={(event) => setDetail('location', event.target.value)} /></label>
              <label>
                Time zone
                <input value={details.timezone} maxLength={60} list="rwp-timezones" placeholder={browserTimezone}
                  onChange={(event) => setDetail('timezone', event.target.value)} />
                <datalist id="rwp-timezones">{timezones.map((zone) => <option key={zone} value={zone} />)}</datalist>
              </label>
              <label>Phone<input type="tel" value={details.phone} maxLength={40} autoComplete="tel" onChange={(event) => setDetail('phone', event.target.value)} /></label>
              <label>Birth date<input type="date" value={details.birth_date} min="1900-01-01" max={new Date().toISOString().slice(0, 10)} onChange={(event) => setDetail('birth_date', event.target.value)} /></label>
            </div>

            <fieldset className={styles.socialFieldset}>
              <legend>Social profiles</legend>
              <div className={styles.detailsGrid}>
                {socialNetworks.map((network) => (
                  <label key={network.id}>
                    {network.label}
                    <input type="url" value={details.social_links[network.id] || ''} placeholder={network.placeholder}
                      onChange={(event) => setDetails((current) => ({ ...current, social_links: { ...current.social_links, [network.id]: event.target.value } }))} />
                  </label>
                ))}
              </div>
            </fieldset>

            <div className={styles.actions}>
              <button type="submit" className={styles.primary} disabled={savingDetails}>
                {savingDetails ? 'Saving…' : 'Save details'}
              </button>
            </div>
          </>
        )}
      </form>

      {pickingAvatar && canPickAvatar && (
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
