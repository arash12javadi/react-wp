import React, { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import styles from './SetupWizard.module.css';

interface SetupWizardProps {
  onComplete: () => void;
}

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [supabaseUrl, setSupabaseUrl] = useState<string>('');
  const [supabaseKey, setSupabaseKey] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [showGuide, setShowGuide] = useState<boolean>(false);

const handleCheckConnection = async (e: React.SubmitEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setIsConnected(false);

    const cleanUrl = supabaseUrl.trim().replace(/\/$/, '');
    const cleanKey = supabaseKey.trim();

    if (!cleanUrl || !cleanKey) {
      setError('Please provide both the Supabase URL and Publishable/Anon Key.');
      setLoading(false);
      return;
    }

    // 1. Validate basic URL formatting
    try {
      new URL(cleanUrl);
    } catch {
      setError('Invalid Supabase URL format. Example: https://xyz.supabase.co');
      setLoading(false);
      return;
    }

    try {
      // 2. Ping Supabase Auth health endpoint directly over HTTP
      const healthResponse = await fetch(`${cleanUrl}/auth/v1/health`, {
        method: 'GET',
        headers: {
          apikey: cleanKey,
        },
      });

      if (!healthResponse.ok) {
        throw new Error(`Could not reach Supabase server. HTTP status: ${healthResponse.status}`);
      }

      // 3. Test API Key against Auth settings endpoint
      const settingsResponse = await fetch(`${cleanUrl}/auth/v1/settings`, {
        method: 'GET',
        headers: {
          apikey: cleanKey,
          Authorization: `Bearer ${cleanKey}`,
        },
      });

      if (settingsResponse.status === 401 || settingsResponse.status === 403) {
        throw new Error('Invalid API Key. Please verify your Supabase anon/publishable key.');
      }

      if (!settingsResponse.ok) {
        throw new Error('Failed to verify API Key with Supabase Auth service.');
      }

      // Save verified credentials locally
      localStorage.setItem('supabase_url', cleanUrl);
      localStorage.setItem('supabase_key', cleanKey);

      setIsConnected(true);
    } catch (err: unknown) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setError('Network error or invalid domain. Could not connect to the specified URL.');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to connect to Supabase. Please check your details.');
      }
    } finally {
      setLoading(false);
    }
  };
  const handleProceedInstallation = (): void => {
    if (isConnected) {
      onComplete();
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h2 className={styles.title}>⚙️ React-WP Setup Wizard</h2>
        <p className={styles.subtitle}>Enter your Supabase credentials to connect your database.</p>

        {error && <div className={styles.errorBox}>{error}</div>}

        <form onSubmit={handleCheckConnection}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Supabase Project URL</label>
            <input
              type="text"
              value={supabaseUrl}
              onChange={(e) => {
                setSupabaseUrl(e.target.value);
                setIsConnected(false);
              }}
              placeholder="https://your-project-ref.supabase.co"
              className={styles.input}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Supabase Publishable / Anon Key</label>
            <input
              type="password"
              value={supabaseKey}
              onChange={(e) => {
                setSupabaseKey(e.target.value);
                setIsConnected(false);
              }}
              placeholder="sbp_... or eyJhbGciOiJIUzI1NiIsInR5cCI6..."
              className={styles.input}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`${styles.button} ${isConnected ? styles.buttonConnected : ''} ${
              loading ? styles.buttonDisabled : ''
            }`}
          >
            {loading ? (
              <span>
                <span className={styles.rotatingEmoji}>🔄</span> Checking Connection...
              </span>
            ) : isConnected ? (
              '✓ Connection Verified!'
            ) : (
              '🔍 Check Connection'
            )}
          </button>
        </form>

        {isConnected && (
          <button
            type="button"
            onClick={handleProceedInstallation}
            className={styles.installButton}
          >
            🚀 Proceed to Installation
          </button>
        )}

        <div className={styles.guideToggleContainer}>
          <button
            type="button"
            onClick={() => setShowGuide(!showGuide)}
            className={styles.toggleButton}
          >
            <span>{showGuide ? '📖 Hide Setup Instructions' : '❓ How to find your Supabase Project URL and Public Key'}</span>
            <span>{showGuide ? '▲' : '▼'}</span>
          </button>
        </div>

        {showGuide && (
          <div className={styles.guideContainer}>
            <h3 className={styles.guideHeading}>How to find your Supabase Project URL and Public Key</h3>

            <ol className={styles.guideList}>
              <li>
                Sign in to the{' '}
                <a
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noreferrer"
                  className={styles.link}
                >
                  Supabase Dashboard
                </a>{' '}
                and open the project you want to connect.
              </li>
              <li>Click <strong>Connect</strong> near the top of the project dashboard.</li>
              <li>In the connection dialog, select your application framework if prompted.</li>
              <li>
                Copy the following values:
                <ul className={styles.subList}>
                  <li><strong>Project URL</strong> — your Supabase project URL.</li>
                  <li><strong>Publishable key</strong> — the recommended public key for client-side applications.</li>
                </ul>
              </li>
            </ol>

            <h4 className={styles.guideSubHeading}>Alternative: Find them in Project Settings</h4>
            <ol className={styles.guideList}>
              <li>Open your Supabase project.</li>
              <li>Go to <strong>Project Settings</strong> &rarr; <strong>API Keys</strong>.</li>
              <li>
                Copy:
                <ul className={styles.subList}>
                  <li>The <strong>Project URL</strong>.</li>
                  <li>The <strong>Publishable key</strong> under Publishable Keys.</li>
                </ul>
              </li>
            </ol>

            <p className={styles.guideNoteText}>
              <em>If your project uses the older API key interface:</em> Open <strong>Project Settings</strong> &rarr; <strong>API Keys</strong> &rarr; Select the <strong>Legacy API Keys</strong> tab &rarr; Copy the key labeled <code>anon / public</code>.
            </p>

            <div className={styles.securityBox}>
              <strong className={styles.securityTitle}>🔒 Important security notes:</strong>
              <ul className={styles.securityList}>
                <li>The publishable key or legacy anon key is safe to use in frontend applications.</li>
                <li>Do not use or expose the <code>service_role</code> key or a secret key in browser code.</li>
                <li>Never share your database password, JWT secret, or secret API key.</li>
              </ul>
            </div>

            <p className={styles.envText}>Store the values in environment variables, for example:</p>
            <pre className={styles.codeBlock}>
{`SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-public-key`}
            </pre>

            <p className={styles.footerNote}>
              💡 <em>Supabase is transitioning from the legacy anon key to the newer publishable key, so use the publishable key for new integrations whenever possible.</em>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}