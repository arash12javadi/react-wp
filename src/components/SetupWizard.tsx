import React, { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import styles from './SetupWizard.module.css';

const getProjectRef = (url: string): string => {
  const hostname = new URL(url).hostname.toLowerCase();
  return hostname.endsWith('.supabase.co') ? hostname.split('.')[0] : '';
};

interface SetupWizardProps {
  onComplete: () => void;
}

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  // Wizard state (1: Connection, 2: Site & Admin Details)
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1: Connection fields
  const [supabaseUrl, setSupabaseUrl] = useState<string>('');
  const [supabaseKey, setSupabaseKey] = useState<string>('');
  const [dbPassword, setDbPassword] = useState<string>('');
  const [connectionString, setConnectionString] = useState<string>('');
  const [showConnectionString, setShowConnectionString] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  // Step 2: Admin & Site fields
  const [siteTitle, setSiteTitle] = useState<string>('My React-WP Site');
  const [adminEmail, setAdminEmail] = useState<string>('');
  const [adminPassword, setAdminPassword] = useState<string>('');

  // UI state
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Step 1: Verify Connection credentials via Supabase REST API and database test route
  const handleCheckConnection = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setShowConnectionString(false);

    const cleanUrl = supabaseUrl.trim().replace(/\/$/, '');
    const cleanAnonKey = supabaseKey.trim();

    try {
      const parsedUrl = new URL(cleanUrl);
      if (!parsedUrl.protocol.startsWith('http')) {
        throw new Error('Supabase Project URL must start with http:// or https://');
      }

      if (!parsedUrl.hostname.toLowerCase().endsWith('.supabase.co')) {
        throw new Error('Supabase Project URL must be like https://<project-ref>.supabase.co');
      }

      if (!cleanAnonKey) {
        throw new Error('Supabase Publishable / Anon Key is required.');
      }

      if (!dbPassword.trim()) {
        throw new Error('Supabase Database Password is required.');
      }

      const settingsResponse = await fetch(`${cleanUrl}/auth/v1/settings`, {
        headers: {
          apikey: cleanAnonKey,
          Authorization: `Bearer ${cleanAnonKey}`,
        },
      });

      if (settingsResponse.status === 401 || settingsResponse.status === 403) {
        throw new Error('Invalid Supabase Project URL or Publishable / Anon Key.');
      }

      if (!settingsResponse.ok) {
        throw new Error(`Could not reach Supabase Auth server. Status: ${settingsResponse.status}`);
      }

      const schemaResponse = await fetch('/api/install-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectRef: getProjectRef(cleanUrl),
          dbPassword: dbPassword.trim(),
          connectionString: connectionString.trim() || undefined,
        }),
      });

      if (!schemaResponse.ok) {
        const data = await schemaResponse.json().catch(() => ({}));
        setShowConnectionString(true);
        throw new Error(data.error || 'Database setup failed.');
      }

      localStorage.setItem('supabase_url', cleanUrl);
      localStorage.setItem('supabase_key', cleanAnonKey);
      setStep(2);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to connect to Supabase.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Execute migrations, register Superadmin, and update options
  const handleCompleteInstallation = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const url = localStorage.getItem('supabase_url') || supabaseUrl;
      const key = localStorage.getItem('supabase_key') || supabaseKey;

      const supabase = createClient(url, key);
      const { error: schemaError } = await supabase
        .from('options')
        .select('option_name')
        .limit(1);

      if (schemaError) {
        throw new Error(
          'The Supabase schema is not installed. Run supabase/schema.sql in the Supabase SQL Editor, then try again.',
        );
      }

      // Initialize Supabase client and register admin user.
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: adminEmail,
        password: adminPassword,
        options: {
          emailRedirectTo: `${window.location.origin}/admin`,
          data: {
            role: 'administrator',
            display_name: 'Administrator',
          },
        },
      });

      if (signUpError) {
        throw new Error(`Superadmin creation failed: ${signUpError.message}`);
      }

      const settingsResponse = await fetch('/api/install-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectRef: getProjectRef(url),
          dbPassword: dbPassword.trim(),
          connectionString: connectionString.trim() || undefined,
          siteTitle,
          adminEmail,
          saveSettings: true,
        }),
      });

      if (!settingsResponse.ok) {
        const data = await settingsResponse.json().catch(() => ({}));
        throw new Error(data.error || 'Could not save site settings.');
      }

      // Clear sensitive memory state and complete setup
      onComplete();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Installation failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h2>⚙️ React-WP Setup Wizard</h2>
        <p>{step === 1 ? 'Step 1: Database Credentials' : 'Step 2: Admin & Site Setup'}</p>

        {error && <div className={styles.errorBox}>{error}</div>}

        {step === 1 ? (
          <form onSubmit={handleCheckConnection} id="connection-form">
            <div className={styles.formGroup}>
              <label htmlFor="supabaseUrl">Supabase Project URL</label>
              <input
                id="supabaseUrl"
                type="text"
                autoComplete="url"
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
                placeholder="https://your-project-ref.supabase.co"
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="supabaseKey">Supabase Publishable / Anon Key</label>
              <input
                id="supabaseKey"
                type="password"
                autoComplete="current-password"
                value={supabaseKey}
                onChange={(e) => setSupabaseKey(e.target.value)}
                placeholder="sbp_... or eyJ..."
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="dbPassword">Supabase Database Password</label>
              <input
                id="dbPassword"
                type="password"
                autoComplete="new-password"
                value={dbPassword}
                onChange={(e) => setDbPassword(e.target.value)}
                placeholder="Database password from Supabase Settings → Database"
                required
              />
            </div>

            {showConnectionString && (
              <div className={styles.formGroup}>
                <label htmlFor="connectionString">PostgreSQL Connection String (fallback)</label>
                <input
                  id="connectionString"
                  type="password"
                  autoComplete="off"
                  value={connectionString}
                  onChange={(e) => setConnectionString(e.target.value)}
                  placeholder="postgresql://postgres:...@.../postgres"
                />
                <small>The automatic connection failed. Copy the exact connection string from your Supabase Connect dialog.</small>
              </div>
            )}

            <p>
              <button
                type="button"
                onClick={() => setShowGuide((visible) => !visible)}
                style={{ background: 'none', border: 'none', color: '#3182ce', cursor: 'pointer', padding: 0 }}
              >
                {showGuide ? 'Hide Supabase credential guide' : 'How do I find these credentials?'}
              </button>
            </p>
            {showGuide && (
              <div className={styles.errorBox} role="note">
                <strong>Where to find your Supabase credentials</strong>
                <p>Open your Supabase project and click <strong>Connect</strong>.</p>
                <p>For the Project URL and publishable/anon key, use <strong>Project Settings → API</strong>. Never use a service_role or secret key here.</p>
                <p>For the database password, open <strong>Project Settings → Database</strong>. If you cannot view it, reset it there and save the new password.</p>
                <p>For the PostgreSQL connection string, open <strong>Connect → Database/Postgres</strong> and copy the exact Direct, Session pooler, or Transaction pooler string. Replace its password placeholder with your database password if necessary.</p>
                <p>Keep passwords and connection strings private. They are sent to the installation server only and should not be committed to Git.</p>
              </div>
            )}

            <button type="submit" disabled={loading}>
              {loading ? 'Testing Connection...' : 'Next →'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCompleteInstallation} id="installation-form">
            <div className={styles.formGroup}>
              <label htmlFor="siteTitle">Site Title</label>
              <input
                id="siteTitle"
                type="text"
                autoComplete="off"
                value={siteTitle}
                onChange={(e) => setSiteTitle(e.target.value)}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="adminEmail">Admin Email</label>
              <input
                id="adminEmail"
                type="email"
                autoComplete="username"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="adminPassword">Admin Password</label>
              <input
                id="adminPassword"
                type="password"
                autoComplete="new-password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>

            <button type="submit" disabled={loading}>
              {loading ? 'Building Database & Creating Admin...' : '🚀 Finish Installation'}
            </button>

            <button
              type="button"
              onClick={() => setStep(1)}
              style={{
                marginTop: '10px',
                background: 'none',
                border: 'none',
                color: '#718096',
                cursor: 'pointer',
                width: '100%',
                fontSize: '13px',
              }}
            >
              ← Back to Database Settings
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
