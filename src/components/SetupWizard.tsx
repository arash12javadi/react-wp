import { useState, type ReactNode } from 'react';
import { resetClient } from '../lib/db';
import styles from './SetupWizard.module.css';

type Deployment = 'node' | 'serverless' | 'edge';
type DbType = 'supabase' | 'postgres' | 'mysql' | 'sqlite' | 'libsql';

interface SetupWizardProps {
  /** Called after the cached adapters are reset and storage is cleared, just before navigation. */
  onComplete?: () => void;
}

const DEPLOYMENTS: Array<{ id: Deployment; label: string; hint: string }> = [
  { id: 'node', label: 'Persistent Node Server / VPS', hint: 'Docker, DigitalOcean, Render with a disk, VPS. Writes data/react-wp-config.json and serves uploads locally.' },
  { id: 'serverless', label: 'Serverless', hint: 'Vercel, Netlify, Render. Read-only filesystem — you get a formatted .env to paste into your platform.' },
  { id: 'edge', label: 'Edge', hint: 'Cloudflare Workers/Pages, Bun, Deno. Read-only — uses LibSQL/Turso and S3-compatible storage.' },
];

const PROVIDERS: Array<{ id: DbType; label: string; hint: string }> = [
  { id: 'supabase', label: 'Supabase Cloud', hint: 'Postgres + Auth + Storage, fully managed. Keeps RLS, the plugin installer and SEO prerendering.' },
  { id: 'postgres', label: 'Self-Hosted PostgreSQL', hint: 'Any Postgres: Neon, Render, Railway, your own server. Connection string or discrete fields.' },
  { id: 'mysql', label: 'MySQL / MariaDB', hint: 'PlanetScale, MariaDB, self-hosted. Connection string or discrete fields.' },
  { id: 'sqlite', label: 'SQLite', hint: 'Zero-config embedded file database. Perfect for a single container or local development.' },
  { id: 'libsql', label: 'SQLite / Turso (LibSQL)', hint: 'Embedded file or a serverless/edge Turso database over HTTP.' },
];

const STEP_LABELS = ['Environment', 'Database', 'Connection', 'Site & Admin', 'Provision'];

/** Setup scratch keys that must not survive into the installed site. */
const SETUP_STORAGE_KEYS = ['supabase_url', 'supabase_key', 'rwp_installed', 'rwp_config', 'rwp_setup'];

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<number>(1);
  const [deployment, setDeployment] = useState<Deployment>('node');
  const [dbType, setDbType] = useState<DbType>('supabase');

  // Connection fields
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const [connectionString, setConnectionString] = useState('');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('');
  const [database, setDatabase] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [sqliteFile, setSqliteFile] = useState('');
  const [libsqlAuthToken, setLibsqlAuthToken] = useState('');

  // Site & admin fields
  const [siteTitle, setSiteTitle] = useState('My React-WP Site');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [health, setHealth] = useState<{ ok: boolean; message: string } | null>(null);
  const [envOutput, setEnvOutput] = useState('');

  /**
   * Step 5 succeeded: invalidate the cached frontend DB/auth adapters, clear any setup scratch keys
   * from storage, then force a hard navigation to the dashboard. A full navigation (rather than React
   * state) guarantees the freshly written config is re-read — including the public config the server
   * injects into index.html at request time.
   */
  const finishSetup = (): void => {
    resetClient();
    try {
      SETUP_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
    } catch {
      // Private windows and blocked storage can refuse access; navigation still proceeds.
    }
    onComplete?.();
    window.location.href = '/';
  };

  const defaultPort = dbType === 'mysql' ? '3306' : '5432';
  const isSql = dbType === 'postgres' || dbType === 'mysql';

  /** The credential payload shared by the health check and the install calls. */
  const connectionBody = () => {
    const body: Record<string, unknown> = { dbType };
    if (dbType === 'supabase') {
      body.supabaseUrl = supabaseUrl.trim().replace(/\/$/, '');
      body.supabasePublishableKey = supabaseKey.trim();
      body.dbPassword = dbPassword.trim();
      if (connectionString.trim()) body.connectionString = connectionString.trim();
    } else if (isSql) {
      if (connectionString.trim()) body.databaseUrl = connectionString.trim();
      body.host = host.trim();
      body.port = port.trim() || defaultPort;
      body.database = database.trim();
      body.user = user.trim();
      body.password = password;
    } else if (dbType === 'sqlite') {
      if (sqliteFile.trim()) body.sqliteFile = sqliteFile.trim();
    } else if (dbType === 'libsql') {
      body.databaseUrl = connectionString.trim() || sqliteFile.trim() || 'file:data/react-wp.db';
      if (libsqlAuthToken.trim()) body.libsqlAuthToken = libsqlAuthToken.trim();
    }
    return body;
  };

  const validateStep3 = (): string | null => {
    if (dbType === 'supabase') {
      if (!supabaseUrl.trim()) return 'The Supabase Project URL is required.';
      if (!supabaseKey.trim()) return 'The Supabase publishable/anon key is required.';
      if (!dbPassword.trim()) return 'The Supabase database password is required.';
      return null;
    }
    if (isSql) {
      if (!connectionString.trim() && (!database.trim() || !user.trim())) {
        return 'Enter a connection string, or a database name and user.';
      }
      return null;
    }
    return null;
  };

  const setDbTypeAndReset = (next: DbType) => {
    setDbType(next);
    setHealth(null);
    setError('');
  };

  const testConnection = async (): Promise<void> => {
    setLoading(true);
    setError('');
    setHealth(null);
    try {
      const validation = validateStep3();
      if (validation) throw new Error(validation);

      if (dbType === 'supabase') {
        const url = supabaseUrl.trim().replace(/\/$/, '');
        const key = supabaseKey.trim();
        const response = await fetch(`${url}/auth/v1/settings`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        if (response.status === 401 || response.status === 403) {
          throw new Error('Invalid Supabase Project URL or publishable/anon key.');
        }
        if (!response.ok) throw new Error(`Could not reach the Supabase Auth server (HTTP ${response.status}).`);
        setHealth({ ok: true, message: 'Connected to Supabase.' });
      } else {
        const response = await fetch('/api/install/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(connectionBody()),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.message || data.error || 'Connection failed.');
        setHealth({ ok: true, message: data.message || 'Connected.' });
      }
    } catch (err: unknown) {
      setHealth({ ok: false, message: err instanceof Error ? err.message : 'Connection failed.' });
    } finally {
      setLoading(false);
    }
  };

  const runInstall = async (): Promise<void> => {
    setLoading(true);
    setError('');
    setEnvOutput('');
    const saveSettings = deployment === 'node';
    const body: Record<string, unknown> = {
      ...connectionBody(),
      siteTitle,
      adminEmail: adminEmail.trim(),
      adminPassword,
      saveSettings,
    };

    try {
      if (!adminEmail.trim() || !adminPassword) {
        throw new Error('Admin email and password are required.');
      }

      if (dbType === 'supabase') {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(body.supabaseUrl as string, body.supabasePublishableKey as string);
        const { error: signUpError } = await supabase.auth.signUp({
          email: adminEmail.trim(),
          password: adminPassword,
          options: {
            emailRedirectTo: `${window.location.origin}/admin`,
            data: { role: 'administrator', display_name: 'Administrator' },
          },
        });
        if (signUpError) throw new Error(`Superadmin creation failed: ${signUpError.message}`);
      }

      const response = await fetch('/api/install-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Installation failed.');

      if (!saveSettings && typeof data.env === 'string') {
        setEnvOutput(data.env);
      } else {
        finishSetup();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Installation failed.');
    } finally {
      setLoading(false);
    }
  };

  const next = () => setStep((s) => Math.min(s + 1, 5));
  const back = () => setStep((s) => Math.max(s - 1, 1));

  const canProceed = step === 3 ? Boolean(health?.ok) : true;

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h2>⚙️ React-WP Setup</h2>
        <div className={styles.stepper}>
          {STEP_LABELS.map((label, index) => {
            const number = index + 1;
            const className = number === step
              ? `${styles.stepperStep} ${styles.stepperStepActive}`
              : number < step
                ? `${styles.stepperStep} ${styles.stepperStepDone}`
                : styles.stepperStep;
            return <div key={label} className={className}>Step {number}: {label}</div>;
          })}
        </div>

        {error && <div className={styles.errorBox}>{error}</div>}
        {step === 3 && health && health.ok && <div className={styles.successBox}>✓ {health.message}</div>}
        {step === 3 && health && !health.ok && <div className={styles.errorBox}>{health.message}</div>}

        {step === 1 && (
          <div>
            {DEPLOYMENTS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`${styles.optionCard} ${deployment === item.id ? styles.optionCardSelected : ''}`}
                onClick={() => setDeployment(item.id)}
              >
                {item.label}
                <small>{item.hint}</small>
              </button>
            ))}
            <button type="button" className={styles.buttonSecondary} onClick={next}>Next →</button>
          </div>
        )}

        {step === 2 && (
          <div>
            {PROVIDERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`${styles.optionCard} ${dbType === item.id ? styles.optionCardSelected : ''}`}
                onClick={() => setDbTypeAndReset(item.id)}
              >
                {item.label}
                <small>{item.hint}</small>
              </button>
            ))}
            <div className={styles.buttonRow}>
              <button type="button" className={styles.buttonSecondary} onClick={back}>← Back</button>
              <button type="button" className={styles.buttonSecondary} onClick={next}>Next →</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <form onSubmit={(e) => { e.preventDefault(); void testConnection(); }}>
              {step3Fields()}
              <button type="submit" disabled={loading}>
                {loading ? 'Testing Connection…' : 'Test Connection'}
              </button>
            </form>
            <div className={styles.buttonRow}>
              <button type="button" className={styles.buttonSecondary} onClick={back}>← Back</button>
              <button type="button" className={styles.buttonSecondary} disabled={!canProceed} onClick={next}>Next →</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <form onSubmit={(e) => { e.preventDefault(); next(); }}>
            <div className={styles.formGroup}>
              <label htmlFor="siteTitle">Site Title</label>
              <input id="siteTitle" type="text" autoComplete="off" value={siteTitle} onChange={(e) => setSiteTitle(e.target.value)} required />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="adminEmail">Admin Email</label>
              <input id="adminEmail" type="email" autoComplete="username" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="adminPassword">Admin Password</label>
              <input id="adminPassword" type="password" autoComplete="new-password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} minLength={6} required />
            </div>
            <div className={styles.buttonRow}>
              <button type="button" className={styles.buttonSecondary} onClick={back}>← Back</button>
              <button type="submit" disabled={!adminEmail.trim() || adminPassword.length < 6}>Next →</button>
            </div>
          </form>
        )}

        {step === 5 && (
          <form onSubmit={(e) => { e.preventDefault(); void runInstall(); }}>
            {envOutput ? (
              <>
                <div className={styles.successBox}>Schema provisioned. Paste this into your deployment platform's environment variables:</div>
                <textarea className={styles.envOutput} readOnly value={envOutput} onFocus={(e) => e.currentTarget.select()} />
              </>
            ) : (
              <p>Running the schema migration and provisioning your site…</p>
            )}
            <button type="submit" disabled={loading}>
              {loading ? 'Provisioning…' : '🚀 Finish Installation'}
            </button>
            {!envOutput && (
              <button type="button" className={styles.buttonSecondary} onClick={back}>← Back</button>
            )}
          </form>
        )}
      </div>
    </div>
  );

  function step3Fields(): ReactNode {
    const group = (label: string, control: ReactNode) => (
      <div className={styles.formGroup}><label>{label}</label>{control}</div>
    );
    if (dbType === 'supabase') {
      return (
        <>
          {group('Supabase Project URL', <input type="text" autoComplete="url" value={supabaseUrl} onChange={(e) => setSupabaseUrl(e.target.value)} placeholder="https://your-project-ref.supabase.co" />)}
          {group('Publishable / Anon Key', <input type="password" autoComplete="current-password" value={supabaseKey} onChange={(e) => setSupabaseKey(e.target.value)} placeholder="sbp_... or eyJ..." />)}
          {group('Database Password', <input type="password" autoComplete="new-password" value={dbPassword} onChange={(e) => setDbPassword(e.target.value)} placeholder="From Supabase Settings → Database" />)}
          {group('Session Pooler Connection String (optional)', <input type="password" autoComplete="off" value={connectionString} onChange={(e) => setConnectionString(e.target.value)} placeholder="postgresql://...pooler.supabase.com:6543/postgres" />)}
        </>
      );
    }
    if (isSql) {
      return (
        <>
          {group('Connection String (overrides the fields below)', <input type="password" autoComplete="off" value={connectionString} onChange={(e) => setConnectionString(e.target.value)} placeholder={`${dbType}://user:password@host:port/database`} />)}
          <div className={styles.row}>
            {group('Host', <input type="text" value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" />)}
            {group('Port', <input type="text" value={port} onChange={(e) => setPort(e.target.value)} placeholder={defaultPort} />)}
          </div>
          {group('Database Name', <input type="text" value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="react_wp" />)}
          <div className={styles.row}>
            {group('User', <input type="text" value={user} onChange={(e) => setUser(e.target.value)} placeholder={dbType === 'postgres' ? 'postgres' : 'root'} />)}
            {group('Password', <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />)}
          </div>
        </>
      );
    }
    if (dbType === 'sqlite') {
      return group('SQLite File (leave blank for data/react-wp.db)', <input type="text" value={sqliteFile} onChange={(e) => setSqliteFile(e.target.value)} placeholder="data/react-wp.db" />);
    }
    return (
      <>
        {group('LibSQL URL', <input type="text" value={connectionString || sqliteFile} onChange={(e) => setConnectionString(e.target.value)} placeholder="libsql://<database>.turso.io or file:data/react-wp.db" />)}
        {group('Auth Token (Turso only)', <input type="password" value={libsqlAuthToken} onChange={(e) => setLibsqlAuthToken(e.target.value)} placeholder="eyJ..." />)}
      </>
    );
  }
}

