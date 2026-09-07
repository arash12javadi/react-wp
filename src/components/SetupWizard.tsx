import React, { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import styles from './SetupWizard.module.css';

interface SetupWizardProps {
  onComplete: () => void;
}

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  // Step state (1: Connection, 2: Site & Admin Details)
  const [step, setStep] = useState<1 | 2>(1);

  // Connection fields
  const [supabaseUrl, setSupabaseUrl] = useState<string>('');
  const [supabaseKey, setSupabaseKey] = useState<string>('');
  const [serviceRoleKey, setServiceRoleKey] = useState<string>('');

  // Admin & Site fields
  const [siteTitle, setSiteTitle] = useState<string>('My React-WP Site');
  const [adminEmail, setAdminEmail] = useState<string>('');
  const [adminPassword, setAdminPassword] = useState<string>('');

  // UI state
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Helper to validate legacy JWTs or modern Supabase secret keys
  const isValidServiceRoleKeyFormat = (token: string): boolean => {
    if (!token) return false;

    // Modern Supabase Secret Key format (sb_secret_... / sbp_...)
    if (token.startsWith('sb_secret_') || token.startsWith('sbp_') || token.startsWith('sb_')) {
      return token.length > 20;
    }

    // Legacy JWT format (eyJ...)
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      const payload = JSON.parse(atob(parts[1]));
      return payload.role === 'service_role' || payload.role === 'supabase_admin';
    } catch {
      return false;
    }
  };

  // Step 1: Verify Connection credentials
  const handleCheckConnection = async (e: React.SubmitEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const cleanUrl = supabaseUrl.trim().replace(/\/$/, '');
    const cleanAnonKey = supabaseKey.trim();
    const cleanServiceKey = serviceRoleKey.trim();

    try {
      new URL(cleanUrl);

      // 1. Check Service Role Key string format first
      if (!isValidServiceRoleKeyFormat(cleanServiceKey)) {
        throw new Error('The provided Service Role Key format is invalid. Ensure you are using your Secret Key (sb_secret_...) or legacy service_role JWT.');
      }

      // 2. Validate Anon/Publishable API Key against settings
      const settingsResponse = await fetch(`${cleanUrl}/auth/v1/settings`, {
        headers: {
          apikey: cleanAnonKey,
          Authorization: `Bearer ${cleanAnonKey}`,
        },
      });

      if (settingsResponse.status === 401 || settingsResponse.status === 403) {
        throw new Error('Invalid Supabase Anon/Publishable API Key. Please verify your public key.');
      }

      if (!settingsResponse.ok) {
        throw new Error(`Could not reach Supabase Auth server. HTTP status: ${settingsResponse.status}`);
      }

      // Save credentials locally
      localStorage.setItem('supabase_url', cleanUrl);
      localStorage.setItem('supabase_key', cleanAnonKey);
      localStorage.setItem('supabase_service_key', cleanServiceKey);

      setStep(2);
    } catch (err: unknown) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setError('Network error or invalid URL domain. Check CORS settings or your connection.');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to connect to Supabase.');
      }
    } finally {
      setLoading(false);
    }
  };

// Execute SQL schema creation via backend API endpoint
const runDatabaseMigrations = async (cleanUrl: string, cleanServiceKey: string): Promise<void> => {
  // Extract project reference ID from https://<project-id>.supabase.co
  const projectRef = cleanUrl.replace('https://', '').split('.')[0];
  
  // Construct direct database connection string or pass key payload
  const dbConnectionString = `postgres://postgres.${projectRef}:${cleanServiceKey}@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`;

  const response = await fetch('/api/install-schema', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dbConnectionString,
    }),
  });

  const responseText = await response.text();
  let data: { error?: string; message?: string } = {};

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error(`Server returned non-JSON response (${response.status}): ${responseText || 'Empty response'}`);
  }

  if (!response.ok) {
    throw new Error(data.error || `Migration failed with status ${response.status}`);
  }
};
  // Step 2: Create Tables, Register Superadmin, and Finish Setup
  const handleCompleteInstallation = async (e: React.SubmitEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const url = localStorage.getItem('supabase_url') || supabaseUrl;
      const key = localStorage.getItem('supabase_key') || supabaseKey;
      const sKey = localStorage.getItem('supabase_service_key') || serviceRoleKey;

      // 1. Run Migrations via server route (verifies Service Role Key server-side)
      if (sKey) {
        await runDatabaseMigrations(url, sKey);
      }

      // 2. Initialize Supabase client
      const supabase = createClient(url, key);

      // 3. Sign up Superadmin user
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: adminEmail,
        password: adminPassword,
        options: {
          data: {
            role: 'superadmin',
            display_name: 'Administrator',
          },
        },
      });

      if (signUpError) {
        throw new Error(`Failed to create Superadmin user: ${signUpError.message}`);
      }

      // 4. Populate default options into options table
      if (authData.user) {
        const { error: optionError } = await supabase.from('options').upsert([
          { option_name: 'site_title', option_value: siteTitle },
          { option_name: 'admin_email', option_value: adminEmail },
        ]);

        if (optionError) {
          console.warn('Could not set initial options:', optionError.message);
        }
      }

      onComplete();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to complete installation.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h2 className={styles.title}>⚙️ React-WP Setup Wizard</h2>
        <p className={styles.subtitle}>
          {step === 1 ? 'Step 1: Connect your Supabase database.' : 'Step 2: Create Superadmin account & site details.'}
        </p>

        {error && <div className={styles.errorBox}>{error}</div>}

        {step === 1 ? (
          <form onSubmit={handleCheckConnection} id="supabase-config-form">
            <div className={styles.formGroup}>
              <label htmlFor="supabaseUrl" className={styles.label}>Supabase Project URL</label>
              <input
                id="supabaseUrl"
                name="supabaseUrl"
                type="text"
                autoComplete="url"
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
                placeholder="https://your-project-ref.supabase.co"
                className={styles.input}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="supabaseKey" className={styles.label}>Supabase Publishable / Anon Key</label>
              <input
                id="supabaseKey"
                name="supabaseKey"
                type="password"
                autoComplete="current-password"
                value={supabaseKey}
                onChange={(e) => setSupabaseKey(e.target.value)}
                placeholder="sbp_... or eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                className={styles.input}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="serviceRoleKey" className={styles.label}>Supabase Service Role / Secret Key</label>
              <input
                id="serviceRoleKey"
                name="serviceRoleKey"
                type="password"
                autoComplete="new-password"
                value={serviceRoleKey}
                onChange={(e) => setServiceRoleKey(e.target.value)}
                placeholder="sb_secret_... or eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                className={styles.input}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`${styles.button} ${loading ? styles.buttonDisabled : ''}`}
            >
              {loading ? 'Checking Connection...' : '🔍 Connect Database & Next'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCompleteInstallation} id="superadmin-config-form">
            <div className={styles.formGroup}>
              <label htmlFor="siteTitle" className={styles.label}>Site Title</label>
              <input
                id="siteTitle"
                name="siteTitle"
                type="text"
                autoComplete="off"
                value={siteTitle}
                onChange={(e) => setSiteTitle(e.target.value)}
                placeholder="My Awesome Website"
                className={styles.input}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="adminEmail" className={styles.label}>Superadmin Email</label>
              <input
                id="adminEmail"
                name="adminEmail"
                type="email"
                autoComplete="username"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="admin@example.com"
                className={styles.input}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="adminPassword" className={styles.label}>Superadmin Password</label>
              <input
                id="adminPassword"
                name="adminPassword"
                type="password"
                autoComplete="new-password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className={styles.input}
                minLength={6}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`${styles.button} ${styles.buttonConnected} ${loading ? styles.buttonDisabled : ''}`}
            >
              {loading ? 'Executing Migrations & Creating Admin...' : '🚀 Complete Installation'}
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