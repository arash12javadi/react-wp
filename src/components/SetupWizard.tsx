import { useState, type ReactNode } from 'react';
import { resetClient } from '../lib/db';
import styles from './SetupWizard.module.css';

type Deployment = 'node' | 'serverless' | 'edge';
type DbType = 'supabase' | 'postgres' | 'mysql' | 'sqlite' | 'libsql';
type ConnectionMode = 'url' | 'fields';

interface SetupWizardProps {
  onComplete?: () => void;
}

interface StepMeta {
  id: number;
  title: string;
  subtitle: string;
}

interface Badge {
  tone: 'error' | 'warn' | 'info';
  text: string;
}

interface DbOptionState {
  disabled: boolean;
  badge?: Badge;
}

const STEPS: StepMeta[] = [
  { id: 1, title: 'Environment', subtitle: 'Where will this site run?' },
  { id: 2, title: 'Database', subtitle: 'Choose your backend' },
  { id: 3, title: 'Connection', subtitle: 'How to reach the database' },
  { id: 4, title: 'Site & Admin', subtitle: 'Name your site and create the admin' },
  { id: 5, title: 'Provision', subtitle: 'Install & launch' },
];

const DEPLOYMENTS: Array<{ id: Deployment; label: string; hint: string }> = [
  { id: 'node', label: 'Persistent Node Server / VPS', hint: 'Docker, DigitalOcean, Render with a persistent disk, Hostinger VPS. Writes data/react-wp-config.json and serves uploads locally.' },
  { id: 'serverless', label: 'Serverless', hint: 'Vercel, Netlify, Render Serverless. Read-only filesystem (EROFS) — you get a formatted .env to paste into your platform.' },
  { id: 'edge', label: 'Edge', hint: 'Cloudflare Workers/Pages, Bun, Deno. Read-only — requires HTTP-based databases (Turso/LibSQL, Supabase) and S3 storage.' },
];

const PROVIDERS: Array<{ id: DbType; label: string; hint: string }> = [
  { id: 'supabase', label: 'Supabase Cloud', hint: 'Postgres + Auth + Storage, fully managed. HTTP-compatible (works on every target).' },
  { id: 'postgres', label: 'Self-Hosted PostgreSQL', hint: 'Any Postgres: Neon, Render, Railway, your own server. Connection string or discrete fields.' },
  { id: 'mysql', label: 'MySQL / MariaDB', hint: 'PlanetScale, Hostinger Remote MySQL, Railway, self-hosted. Connection string or discrete fields.' },
  { id: 'sqlite', label: 'SQLite (Local File)', hint: 'Embedded local .db file. Writable filesystem only.' },
  { id: 'libsql', label: 'SQLite / Turso (LibSQL)', hint: 'Serverless HTTP-based SQLite. Works everywhere, including edge.' },
];

type MatrixCell = 'yes' | 'no' | 'warn' | 'warn-http';
const MATRIX_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'sqlite', label: 'Local SQLite' },
  { key: 'hostinger', label: 'Hostinger/cPanel MySQL' },
  { key: 'cloudmysql', label: 'Cloud MySQL (Railway)' },
  { key: 'cloudpg', label: 'Cloud Postgres (Neon/Supabase)' },
  { key: 'turso', label: 'Turso (LibSQL)' },
];
const MATRIX_ROWS: Array<{ key: Deployment; label: string; cells: Record<string, MatrixCell> }> = [
  { key: 'node', label: 'VPS / Docker', cells: { sqlite: 'yes', hostinger: 'yes', cloudmysql: 'yes', cloudpg: 'yes', turso: 'yes' } },
  { key: 'serverless', label: 'Serverless (Vercel)', cells: { sqlite: 'no', hostinger: 'no', cloudmysql: 'yes', cloudpg: 'yes', turso: 'yes' } },
  { key: 'edge', label: 'Edge (Cloudflare)', cells: { sqlite: 'no', hostinger: 'no', cloudmysql: 'warn-http', cloudpg: 'yes', turso: 'yes' } },
];

const MATRIX_CELL_LABEL: Record<MatrixCell, string> = {
  yes: '✅ Compatible',
  no: '❌ Incompatible',
  warn: '⚠️ Warning',
  'warn-http': '⚠️ HTTP Driver Only',
};

const SETUP_STORAGE_KEYS = ['supabase_url', 'supabase_key', 'rwp_installed', 'rwp_config', 'rwp_setup'];

/**
 * The address this wizard is being served from.
 *
 * Supabase only honours an `emailRedirectTo` that is listed under Authentication → URL
 * Configuration → Redirect URLs; anything else is silently replaced with the project's Site URL
 * (http://localhost:3000 by default). That is why a confirmation email links back to localhost on a
 * live site but looks fine while developing: the Site URL matches during development. Step 3 prints
 * this address so it can be pasted straight into that list before the admin account is created.
 */
const siteOrigin = (): string => (typeof window === 'undefined' ? '' : window.location.origin);

function dbOptionState(deployment: Deployment, dbType: DbType): DbOptionState {
  if (deployment === 'node') return { disabled: false };
  if (dbType === 'sqlite') {
    return { disabled: true, badge: { tone: 'error', text: '❌ Incompatible with Read-Only Filesystem' } };
  }
  if (dbType === 'mysql') {
    if (deployment === 'edge') {
      return { disabled: true, badge: { tone: 'error', text: '❌ No TCP Support — Edge requires HTTP/WebSocket drivers (Turso, Neon, Supabase).' } };
    }
    return { disabled: false, badge: { tone: 'warn', text: '⚠️ Firewall Alert: Hostinger shared MySQL blocks incoming connections from Vercel/AWS. Use Railway MySQL, Neon Postgres, or Supabase instead.' } };
  }
  if (deployment === 'edge' && dbType === 'postgres') {
    return { disabled: false, badge: { tone: 'warn', text: '⚠️ Use Neon over its serverless driver; standard TCP pg will not run on edge.' } };
  }
  return { disabled: false };
}


export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<number>(1);
  const [deployment, setDeployment] = useState<Deployment>('node');
  const [dbType, setDbType] = useState<DbType>('supabase');
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('url');

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

  const [siteTitle, setSiteTitle] = useState('My React-WP Site');
  const [siteTagline, setSiteTagline] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPasswordConfirmation, setAdminPasswordConfirmation] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [health, setHealth] = useState<{ ok: boolean; message: string } | null>(null);
  const [envOutput, setEnvOutput] = useState('');
  const [showMatrix, setShowMatrix] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState('');

  const isReadOnly = deployment !== 'node';
  const defaultPort = dbType === 'mysql' ? '3306' : '5432';
  const isSql = dbType === 'postgres' || dbType === 'mysql';

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

  const connectionBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = { dbType };
    if (dbType === 'supabase') {
      body.supabaseUrl = supabaseUrl.trim().replace(/\/$/, '');
      body.supabasePublishableKey = supabaseKey.trim();
      body.dbPassword = dbPassword.trim();
      if (connectionString.trim()) body.connectionString = connectionString.trim();
    } else if (isSql) {
      if (connectionMode === 'url' && connectionString.trim()) body.databaseUrl = connectionString.trim();
      body.host = host.trim();
      body.port = port.trim() || defaultPort;
      body.database = database.trim();
      body.user = user.trim();
      body.password = password;
      body.ssl = 'auto';
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
      if (connectionMode === 'url') {
        if (!connectionString.trim()) return 'Enter a connection string (e.g. postgres://user:pass@host:5432/db).';
      } else if (!database.trim() || !user.trim()) {
        return 'Enter a database name and user, or switch to Connection String mode.';
      }
      return null;
    }
    if (dbType === 'libsql' && !connectionString.trim() && !sqliteFile.trim()) {
      return 'Enter a LibSQL URL or file path.';
    }
    return null;
  };

  const validateStep4 = (): string | null => {
    if (!siteTitle.trim()) return 'The site title is required.';
    if (!adminUsername.trim()) return 'The admin username is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim())) return 'A valid admin email is required.';
    if (adminPassword.length < 6) return 'The admin password must be at least 6 characters.';
    if (adminPassword !== adminPasswordConfirmation) return 'The password confirmation does not match.';
    return null;
  };

  const canProceed = (): boolean => {
    if (step === 1) return true;
    if (step === 2) return !dbOptionState(deployment, dbType).disabled;
    if (step === 3) return health?.ok === true;
    if (step === 4) return !validateStep4();
    return true;
  };

  const next = (): void => {
    setError('');
    if (step === 3) {
      const validation = validateStep3();
      if (validation) { setError(validation); return; }
      if (health?.ok !== true) { setError('Test the connection first — it must pass before you continue.'); return; }
    }
    if (step === 4) {
      const validation = validateStep4();
      if (validation) { setError(validation); return; }
    }
    if (step < 5) setStep(step + 1);
  };

  const back = (): void => {
    setError('');
    if (step > 1) setStep(step - 1);
  };

  const setDbTypeAndReset = (nextDb: DbType): void => {
    setDbType(nextDb);
    setHealth(null);
    setError('');
    setEnvOutput('');
    if (nextDb === 'postgres' || nextDb === 'mysql') setConnectionMode('url');
  };

  const setDeploymentAndReset = (nextDep: Deployment): void => {
    setDeployment(nextDep);
    setError('');
    setEnvOutput('');
    if (dbOptionState(nextDep, dbType).disabled) {
      setDbType(nextDep === 'edge' ? 'libsql' : 'postgres');
      setHealth(null);
    }
  };


  const testConnection = async (): Promise<void> => {
    setLoading(true);
    setError('');
    setHealth(null);
    try {
      const validation = validateStep3();
      if (validation) throw new Error(validation);
      const response = await fetch('/api/install/test-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connectionBody()),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        ok?: boolean;
        message?: string;
        error?: string;
      };
      const succeeded = payload.success === true || payload.ok === true;
      if (!response.ok || !succeeded) {
        throw new Error(payload.error || payload.message || `Connection test failed (HTTP ${response.status}).`);
      }
      setHealth({ ok: true, message: payload.message || 'Connected.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection test failed.';
      setHealth({ ok: false, message });
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const installBody = (): Record<string, unknown> => ({
    ...connectionBody(),
    deployment,
    saveSettings: deployment === 'node',
    storage: isReadOnly ? 's3' : 'local',
    siteTitle: siteTitle.trim(),
    siteTagline: siteTagline.trim(),
    adminUsername: adminUsername.trim(),
    adminEmail: adminEmail.trim(),
    adminPassword,
  });

  /**
   * Creates the first administrator in Supabase Auth from the browser.
   *
   * `auth.signUp` with the publishable key is the only way to create an account, and the server's
   * direct connection can only promote the matching `public.profiles` row — `handle_new_user`
   * refuses the administrator role on purpose. Without this call Step 5 provisions the schema but
   * leaves the site with no administrator (the "admin is not created" bug on Vercel + Supabase).
   *
   * An account that already exists (a re-run of the wizard) is not an error: the installer
   * re-promotes it. No session comes back when the project requires email confirmation, but the
   * account still exists, so it is still promoted.
   */
  const createSupabaseAdmin = async (): Promise<void> => {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl.trim().replace(/\/$/, ''), supabaseKey.trim());
    const { error } = await supabase.auth.signUp({
      email: adminEmail.trim(),
      password: adminPassword,
      options: {
        // /login, like every other account flow: it is the address the README tells people to allow-list,
        // and after confirming the admin is signed in and sent on to /admin by afterLoginUrl.
        emailRedirectTo: `${window.location.origin}/login`,
        data: { display_name: adminUsername.trim() || 'Administrator' },
      },
    });
    if (error && !/already\s*(registered|exists)|user_already_exists/i.test(error.message)) {
      throw new Error(`Admin account creation failed: ${error.message}`);
    }
  };

  const runInstall = async (): Promise<void> => {
    setLoading(true);
    setError('');
    setEnvOutput('');
    try {
      // Supabase Auth owns the account; the installer only promotes its profile, so the browser has
      // to create it first (see `createSupabaseAdmin`). Every other backend signs the admin up
      // server-side inside `/api/install-schema`.
      if (dbType === 'supabase') await createSupabaseAdmin();
      const response = await fetch('/api/install-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(installBody()),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        mode?: 'persistent' | 'serverless';
        env?: string;
        error?: string;
      };
      if (!response.ok || payload.success !== true) {
        throw new Error(payload.error || `Provisioning failed (HTTP ${response.status}).`);
      }
      if (payload.mode === 'persistent' || deployment === 'node') {
        finishSetup();
        return;
      }
      setEnvOutput(payload.env || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Provisioning failed.');
    } finally {
      setLoading(false);
    }
  };

  const verifyAndLaunch = async (): Promise<void> => {
    setLoading(true);
    setVerifyStatus('Checking the deployed environment…');
    try {
      const response = await fetch('/api/install/check');
      const payload = (await response.json().catch(() => ({}))) as { installed?: boolean };
      if (payload.installed) {
        finishSetup();
        return;
      }
      setVerifyStatus('Not ready yet: paste the environment variables into your platform and redeploy, then try again.');
    } catch {
      setVerifyStatus('Could not reach the verification endpoint. Redeploy with the environment variables, then try again.');
    } finally {
      setLoading(false);
    }
  };

  const group = (label: string, control: ReactNode): ReactNode => (
    <div className={styles.formGroup}><label>{label}</label>{control}</div>
  );

  const optionCard = (
    item: { id: string; label: string; hint: string },
    isSelected: boolean,
    state: DbOptionState,
    onClick: () => void,
  ): ReactNode => (
    <button
      key={item.id}
      type="button"
      className={`${styles.optionCard} ${isSelected ? styles.optionCardSelected : ''} ${state.disabled ? styles.optionCardDisabled : ''}`}
      onClick={onClick}
      disabled={state.disabled}
    >
      <span className={styles.optionCardLabel}>{item.label}</span>
      {state.badge && (
        <span className={`${styles.badge} ${state.badge.tone === 'error' ? styles.badgeError : state.badge.tone === 'warn' ? styles.badgeWarn : styles.badgeInfo}`}>
          {state.badge.text}
        </span>
      )}
      <small>{item.hint}</small>
    </button>
  );


  return (
    <div className={styles.container}>
      <div className={styles.wizard}>
        <aside className={styles.sidebar}>
          <div className={styles.brand}>React-WP Setup</div>
          <ol className={styles.stepperList}>
            {STEPS.map((item) => {
              const state = step > item.id ? 'done' : step === item.id ? 'active' : 'pending';
              return (
                <li key={item.id} className={`${styles.stepperItem} ${styles[`stepperItem${state[0].toUpperCase()}${state.slice(1)}`]}`}>
                  <span className={styles.stepNumber}>{state === 'done' ? '✓' : item.id}</span>
                  <span className={styles.stepInfo}>
                    <span className={styles.stepTitle}>{item.title}</span>
                    <span className={styles.stepSubtitle}>{item.subtitle}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </aside>

        <main className={styles.content}>
          <div className={styles.card}>
            <header className={styles.cardHeader}>
              <h2>{STEPS[step - 1].title}</h2>
              <p>{STEPS[step - 1].subtitle}</p>
            </header>

            {error && <div className={styles.errorBox}>{error}</div>}
            {health?.ok && step === 3 && <div className={styles.successBox}>{health.message}</div>}

            {step === 1 && (
              <div>
                {DEPLOYMENTS.map((item) => optionCard(item, deployment === item.id, { disabled: false }, () => setDeploymentAndReset(item.id)))}
                <div className={styles.buttonRow}>
                  <button type="button" className={styles.buttonSecondary} disabled>← Back</button>
                  <button type="button" className={styles.buttonPrimary} onClick={next}>Next →</button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                <div className={styles.guideToggleRow}>
                  <button type="button" className={styles.guideToggle} onClick={() => setShowMatrix(true)}>View Compatibility Matrix</button>
                </div>
                {PROVIDERS.map((item) => optionCard(item, dbType === item.id, dbOptionState(deployment, item.id), () => setDbTypeAndReset(item.id)))}
                <div className={styles.buttonRow}>
                  <button type="button" className={styles.buttonSecondary} onClick={back}>← Back</button>
                  <button type="button" className={styles.buttonPrimary} disabled={!canProceed()} onClick={next}>Next →</button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div>
                <form onSubmit={(e) => { e.preventDefault(); void testConnection(); }}>
                  {step3Fields()}
                  <button type="submit" className={styles.buttonPrimary} disabled={loading}>
                    {loading ? 'Testing Connection…' : 'Test Connection'}
                  </button>
                </form>
                <div className={styles.buttonRow}>
                  <button type="button" className={styles.buttonSecondary} onClick={back}>← Back</button>
                  <button type="button" className={styles.buttonPrimary} disabled={!canProceed()} onClick={next}>Next →</button>
                </div>
              </div>
            )}

            {step === 4 && (
              <form onSubmit={(e) => { e.preventDefault(); next(); }}>
                {group('Site Name', <input id="siteTitle" type="text" autoComplete="off" value={siteTitle} onChange={(e) => setSiteTitle(e.target.value)} required />)}
                {group('Site Tagline', <input id="siteTagline" type="text" autoComplete="off" value={siteTagline} onChange={(e) => setSiteTagline(e.target.value)} placeholder="Just another React-WP site" />)}
                {group('Admin Username', <input id="adminUsername" type="text" autoComplete="username" value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} required />)}
                {group('Admin Email', <input id="adminEmail" type="email" autoComplete="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required />)}
                {group('Admin Password', <input id="adminPassword" type="password" autoComplete="new-password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} minLength={6} required />)}
                {group('Confirm Password', <input id="adminPasswordConfirmation" type="password" autoComplete="new-password" value={adminPasswordConfirmation} onChange={(e) => setAdminPasswordConfirmation(e.target.value)} minLength={6} required />)}
                <div className={styles.buttonRow}>
                  <button type="button" className={styles.buttonSecondary} onClick={back}>← Back</button>
                  <button type="submit" className={styles.buttonPrimary} disabled={Boolean(validateStep4())}>Next →</button>
                </div>
              </form>
            )}

            {step === 5 && (
              <div>
                {envOutput ? (
                  <>
                    <div className={styles.successBox}>Schema provisioned. Paste this into your deployment platform's environment variables (Vercel Project Settings → Environment Variables):</div>
                    <textarea className={styles.envOutput} readOnly value={envOutput} onFocus={(e) => e.currentTarget.select()} />
                    <div className={styles.buttonRow}>
                      <button type="button" className={styles.buttonPrimary} onClick={() => void verifyAndLaunch()} disabled={loading}>
                        {loading ? 'Verifying…' : 'Verify & Launch Application'}
                      </button>
                    </div>
                    {verifyStatus && <p className={styles.guideBox}>{verifyStatus}</p>}
                    <button type="button" className={styles.buttonSecondary} onClick={back}>← Back</button>
                  </>
                ) : (
                  <>
                    <p className={styles.guideBox}>
                      {deployment === 'node'
                        ? 'Test the database, write data/react-wp-config.json, run migrations, seed the admin account, then redirect to the dashboard.'
                        : 'Run migrations and seed the admin account remotely, then copy the generated environment variables into your platform.'}
                    </p>
                    <div className={styles.summaryList}>
                      <div><span>Target</span><strong>{DEPLOYMENTS.find((d) => d.id === deployment)?.label}</strong></div>
                      <div><span>Database</span><strong>{PROVIDERS.find((p) => p.id === dbType)?.label}</strong></div>
                      <div><span>Site</span><strong>{siteTitle}</strong></div>
                      <div><span>Admin</span><strong>{adminEmail}</strong></div>
                    </div>
                    <div className={styles.buttonRow}>
                      <button type="button" className={styles.buttonPrimary} onClick={() => void runInstall()} disabled={loading}>
                        {loading ? 'Provisioning…' : '🚀 Finish Installation'}
                      </button>
                    </div>
                    <button type="button" className={styles.buttonSecondary} onClick={back}>← Back</button>
                  </>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {showMatrix && (
        <div className={styles.modalOverlay} onClick={() => setShowMatrix(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <header className={styles.modalHeader}>
              <h3>Environment vs. Database Compatibility</h3>
              <button type="button" className={styles.modalClose} onClick={() => setShowMatrix(false)} aria-label="Close">×</button>
            </header>
            <div className={styles.matrixScroll}>
              <table className={styles.matrixTable}>
                <thead>
                  <tr>
                    <th>Hosting Target</th>
                    {MATRIX_COLUMNS.map((col) => <th key={col.key}>{col.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {MATRIX_ROWS.map((row) => (
                    <tr key={row.key}>
                      <th>{row.label}</th>
                      {MATRIX_COLUMNS.map((col) => {
                        const cell = row.cells[col.key];
                        return (
                          <td key={col.key} className={`${styles.matrixCell} ${styles[cellClass(cell)]}`}>
                            {MATRIX_CELL_LABEL[cell]}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className={styles.buttonPrimary} onClick={() => setShowMatrix(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );

  function cellClass(cell: MatrixCell): string {
    if (cell === 'warn-http') return 'cellWarn';
    return `cell${cell[0].toUpperCase()}${cell.slice(1)}`;
  }


  function step3Fields(): ReactNode {
    if (dbType === 'supabase') {
      return (
        <>
          {group('Supabase Project URL', <input type="text" autoComplete="url" value={supabaseUrl} onChange={(e) => setSupabaseUrl(e.target.value)} placeholder="https://your-project-ref.supabase.co" />)}
          {group('Publishable / Anon Key', <input type="password" autoComplete="current-password" value={supabaseKey} onChange={(e) => setSupabaseKey(e.target.value)} placeholder="sbp_... or eyJ..." />)}
          {group('Database Password', <input type="password" autoComplete="new-password" value={dbPassword} onChange={(e) => setDbPassword(e.target.value)} placeholder="From Supabase Settings → Database" />)}
          {group('Session Pooler Connection String (optional)', <input type="password" autoComplete="off" value={connectionString} onChange={(e) => setConnectionString(e.target.value)} placeholder="postgresql://...pooler.supabase.com:6543/postgres" />)}
          <p className={styles.guideBox}>
            Supabase → <strong>Authentication → URL Configuration</strong>: set <strong>Site URL</strong> to <code>{siteOrigin()}</code> and add <code>{siteOrigin()}/**</code> to <strong>Redirect URLs</strong> (plus <code>http://localhost:3000/**</code> while developing). Supabase replaces the return address the app sends with the Site URL whenever it is not listed, so confirmation and password-reset emails otherwise link to localhost even on a live site.
          </p>
        </>
      );
    }
    if (isSql) {
      return (
        <>
          <div className={styles.modeToggle} role="tablist">
            <button type="button" role="tab" className={connectionMode === 'url' ? styles.modeActive : ''} onClick={() => setConnectionMode('url')}>Connection String</button>
            <button type="button" role="tab" className={connectionMode === 'fields' ? styles.modeActive : ''} onClick={() => setConnectionMode('fields')}>Discrete Fields</button>
          </div>
          {connectionMode === 'url' ? (
            <>
              {group('Connection String URL', <input type="password" autoComplete="off" value={connectionString} onChange={(e) => setConnectionString(e.target.value)} placeholder={`${dbType}://user:password@host:port/database`} />)}
              <small className={styles.sslNote}>SSL is attached automatically for cloud/serverless connections.</small>
            </>
          ) : (
            <>
              <div className={styles.formRow}>
                {group('Host', <input type="text" value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" />)}
                {group('Port', <input type="text" value={port} onChange={(e) => setPort(e.target.value)} placeholder={defaultPort} />)}
              </div>
              {group('Database Name', <input type="text" value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="react_wp" />)}
              <div className={styles.formRow}>
                {group('User', <input type="text" value={user} onChange={(e) => setUser(e.target.value)} placeholder={dbType === 'postgres' ? 'postgres' : 'root'} />)}
                {group('Password', <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />)}
              </div>
            </>
          )}
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





