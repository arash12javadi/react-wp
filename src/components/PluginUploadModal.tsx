import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getSupabaseClient } from '../lib/db';
import styles from './PluginUploadModal.module.css';

/** Kept equal to MAX_ZIP_BYTES in server/pluginInstaller.mjs. */
const MAX_PLUGIN_ZIP_BYTES = 25 * 1024 * 1024;

type ServerStep = 'downloading' | 'extracting' | 'validating' | 'installing' | 'registering-routes' | 'triggering-rebuild';
type StepId = 'uploading' | ServerStep;
type StepState = 'pending' | 'active' | 'done' | 'skipped' | 'error';

export interface PluginInstallResult {
  plugin: { id: string; name: string; version: string; folder: string };
  files: number;
  serverRoutes: { detected: boolean; registered: boolean };
  sql: Array<{ path: string; sql: string }>;
  dependencies: {
    missing: Array<{ name: string; range?: string; reason: 'not-declared' | 'not-installed'; usedIn: string[] }>;
    installCommand: string | null;
  };
  deploy: { configured: boolean; triggered: boolean; status?: number; error?: string };
  restart: { required: boolean; reason: string };
  warnings: string[];
}

type ServerEvent =
  | { type: 'step'; step: ServerStep }
  | { type: 'result'; result: PluginInstallResult }
  | { type: 'error'; error: string; status?: number };

const stepLabels: Record<StepId, string> = {
  uploading: 'Uploading',
  downloading: 'Downloading',
  extracting: 'Extracting',
  validating: 'Validating',
  installing: 'Installing files',
  'registering-routes': 'Registering routes',
  'triggering-rebuild': 'Triggering rebuild',
};

const stepsFor = (mode: 'file' | 'url'): StepId[] => [
  mode === 'file' ? 'uploading' : 'downloading',
  'extracting', 'validating', 'installing', 'registering-routes', 'triggering-rebuild',
];

const formatBytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * POSTs to /api/admin/plugins/upload with XMLHttpRequest rather than fetch: it reports upload
 * progress, and exposes the streamed NDJSON response as it arrives.
 */
function sendInstall(
  body: File | { url: string },
  accessToken: string,
  onUploadProgress: (fraction: number) => void,
  onEvent: (event: ServerEvent) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/plugins/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    let offset = 0;
    const drain = (final: boolean) => {
      const text = xhr.responseText;
      let newline = text.indexOf('\n', offset);
      while (newline !== -1 || (final && offset < text.length)) {
        const end = newline === -1 ? text.length : newline;
        const line = text.slice(offset, end).trim();
        offset = end + 1;
        if (line) {
          try {
            onEvent(JSON.parse(line) as ServerEvent);
          } catch {
            onEvent({ type: 'error', error: `The server sent a response that is not valid JSON: ${line.slice(0, 200)}` });
          }
        }
        newline = text.indexOf('\n', offset);
      }
    };
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onUploadProgress(event.loaded / event.total);
    };
    xhr.onprogress = () => {
      if (xhr.status === 200) drain(false);
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        drain(true);
        resolve();
        return;
      }
      let message = '';
      try {
        message = (JSON.parse(xhr.responseText) as { error?: string }).error || '';
      } catch {
        // Not JSON: e.g. an HTML 404 page from a host without this endpoint.
      }
      if (xhr.status === 404 && !message) {
        message = 'This host has no /api/admin/plugins/upload endpoint. Plugins can only be uploaded when the site runs on server.mjs (npm start); in development, start server.mjs on :3000 as well.';
      }
      reject(new Error(message || `The upload failed: the server answered HTTP ${xhr.status}.`));
    };
    xhr.onerror = () => reject(new Error('The upload could not reach the server (network error, or the connection was closed). In development, is server.mjs running on :3000?'));
    if (body instanceof File) {
      xhr.setRequestHeader('Content-Type', 'application/zip');
      xhr.send(body);
    } else {
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify(body));
    }
  });
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.copy}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

/**
 * Under `npm run dev`, Vite reloads the page as soon as the new plugins/<id>/index.tsx appears,
 * which would wipe the SQL and npm instructions. The result is kept for this tab until dismissed.
 */
const pendingResultKey = 'rwp-plugin-install-result';

export const readPendingInstallResult = (): PluginInstallResult | null => {
  try {
    const raw = window.sessionStorage.getItem(pendingResultKey);
    return raw ? (JSON.parse(raw) as PluginInstallResult) : null;
  } catch {
    return null;
  }
};

const storePendingInstallResult = (result: PluginInstallResult | null) => {
  try {
    if (result) window.sessionStorage.setItem(pendingResultKey, JSON.stringify(result));
    else window.sessionStorage.removeItem(pendingResultKey);
  } catch {
    // Storage unavailable (private mode): the result is still shown until the page reloads.
  }
};

interface Props {
  onClose: () => void;
  /** Called after a successful install so the plugin list can refresh. */
  onInstalled: (result: PluginInstallResult) => void;
  /** Reopens the result screen of an install that finished before a page reload. */
  initialResult?: PluginInstallResult | null;
}

export default function PluginUploadModal({ onClose: close, onInstalled, initialResult = null }: Props) {
  const onClose = () => {
    storePendingInstallResult(null);
    close();
  };
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Partial<Record<StepId, StepState>>>({});
  const [uploadFraction, setUploadFraction] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PluginInstallResult | null>(initialResult);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  const started = Object.keys(steps).length > 0;
  const order = stepsFor(mode);

  /** Marks `step` active and every earlier step done (or skipped, if it never ran). */
  const advance = (step: StepId) => setSteps((current) => {
    const next = { ...current };
    const index = order.indexOf(step);
    order.forEach((id, position) => {
      if (position < index && next[id] !== 'done') next[id] = next[id] === 'active' ? 'done' : 'skipped';
    });
    next[step] = 'active';
    return next;
  });

  const choose = (selected: File | null) => {
    setError('');
    if (!selected) {
      setFile(null);
      return;
    }
    if (!selected.name.toLowerCase().endsWith('.zip')) {
      setFile(null);
      setError(`"${selected.name}" is not a .zip file. Plugins are uploaded as ZIP archives.`);
      return;
    }
    if (selected.size > MAX_PLUGIN_ZIP_BYTES) {
      setFile(null);
      setError(`"${selected.name}" is ${formatBytes(selected.size)}; plugin ZIPs may be at most ${formatBytes(MAX_PLUGIN_ZIP_BYTES)}.`);
      return;
    }
    setFile(selected);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setResult(null);
    if (mode === 'file' && !file) {
      setError('Choose a plugin .zip file first.');
      return;
    }
    if (mode === 'url' && !/^https:\/\//i.test(url.trim())) {
      setError('Enter an https:// link to a plugin .zip file.');
      return;
    }

    setBusy(true);
    setSteps({});
    setUploadFraction(0);
    let failed = false;
    let lastStep: StepId = order[0];
    try {
      const { data } = await getSupabaseClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Your session has expired. Sign in again, then retry the upload.');
      if (mode === 'file') advance('uploading');

      await sendInstall(
        mode === 'file' ? (file as File) : { url: url.trim() },
        token,
        setUploadFraction,
        (serverEvent) => {
          if (serverEvent.type === 'step') {
            lastStep = serverEvent.step;
            advance(serverEvent.step);
          } else if (serverEvent.type === 'result') {
            const installed = serverEvent.result;
            setSteps((current) => {
              const next = { ...current };
              order.forEach((id) => {
                if (next[id] === 'active') next[id] = 'done';
                else if (!next[id]) next[id] = 'skipped';
              });
              if (!installed.deploy.triggered) next['triggering-rebuild'] = installed.deploy.error ? 'error' : 'skipped';
              return next;
            });
            storePendingInstallResult(installed);
            setResult(installed);
            onInstalled(installed);
          } else {
            failed = true;
            setSteps((current) => ({ ...current, [lastStep]: 'error' }));
            setError(serverEvent.error);
          }
        },
      );
    } catch (installError: unknown) {
      failed = true;
      setSteps((current) => ({ ...current, [lastStep]: 'error' }));
      setError(installError instanceof Error ? installError.message : 'The plugin could not be installed.');
    } finally {
      setBusy(false);
      if (failed) setSteps((current) => Object.fromEntries(Object.entries(current).map(([id, state]) => [id, state === 'active' ? 'error' : state])));
    }
  };

  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="plugin-upload-title" tabIndex={-1}>
        <div className={styles.header}>
          <h3 id="plugin-upload-title">Upload Plugin</h3>
          <button type="button" className={styles.close} onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>

        {!result && (
          <form onSubmit={(event) => void submit(event)}>
            <p className={styles.intro}>
              Installs a plugin into <code>plugins/</code> on this server. It arrives inactive; any SQL it ships is shown afterwards for you to run.
              Only install plugins you trust: their code runs with full access to your site.
            </p>
            <div className={styles.tabs} role="tablist" aria-label="Plugin source">
              <button type="button" role="tab" aria-selected={mode === 'file'} className={mode === 'file' ? styles.tabActive : styles.tab}
                disabled={busy} onClick={() => { setMode('file'); setSteps({}); setError(''); }}>ZIP file</button>
              <button type="button" role="tab" aria-selected={mode === 'url'} className={mode === 'url' ? styles.tabActive : styles.tab}
                disabled={busy} onClick={() => { setMode('url'); setSteps({}); setError(''); }}>From URL</button>
            </div>

            {mode === 'file' ? (
              <label className={styles.drop}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); if (!busy) choose(event.dataTransfer.files[0] || null); }}>
                <input type="file" accept=".zip,application/zip" disabled={busy}
                  onChange={(event) => choose(event.target.files?.[0] || null)} />
                <span>{file ? `${file.name} (${formatBytes(file.size)})` : `Choose or drop a .zip file (max ${formatBytes(MAX_PLUGIN_ZIP_BYTES)})`}</span>
              </label>
            ) : (
              <input type="url" className={styles.url} placeholder="https://example.com/my-plugin.zip" value={url} disabled={busy}
                onChange={(event) => setUrl(event.target.value)} aria-label="Plugin ZIP URL" />
            )}

            {started && (
              <ol className={styles.steps} aria-live="polite">
                {order.map((id) => {
                  const state = steps[id] || 'pending';
                  return (
                    <li key={id} className={styles[state]}>
                      <span className={styles.marker} aria-hidden="true">
                        {state === 'done' ? '✓' : state === 'error' ? '!' : state === 'skipped' ? '–' : state === 'active' ? '…' : ''}
                      </span>
                      {stepLabels[id]}
                      {id === 'uploading' && state === 'active' && <small> {Math.round(uploadFraction * 100)}%</small>}
                      {state === 'skipped' && <small> skipped</small>}
                    </li>
                  );
                })}
              </ol>
            )}

            {error && <div className={styles.errorBox} role="alert">{error}</div>}

            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className={styles.primary} disabled={busy || (mode === 'file' ? !file : !url.trim())}>
                {busy ? 'Installing…' : 'Install Now'}
              </button>
            </div>
          </form>
        )}

        {result && (
          <div className={styles.result}>
            {started && (
              <ol className={styles.steps}>
                {order.map((id) => {
                  const state = steps[id] || 'skipped';
                  return (
                    <li key={id} className={styles[state]}>
                      <span className={styles.marker} aria-hidden="true">{state === 'done' ? '✓' : state === 'error' ? '!' : '–'}</span>
                      {stepLabels[id]}
                      {state === 'skipped' && <small> skipped</small>}
                    </li>
                  );
                })}
              </ol>
            )}

            <div className={styles.success} role="status">
              <strong>{result.plugin.name} {result.plugin.version}</strong> was installed to <code>plugins/{result.plugin.folder}</code> ({result.files} files).
              {result.serverRoutes.detected && <> Its <code>server.mjs</code> {result.serverRoutes.registered ? 'was registered in' : 'was already listed in'} <code>server/plugins.mjs</code>.</>}
            </div>

            {result.restart.required && (
              <div className={styles.alert}>
                <strong>Restart required.</strong> {result.restart.reason} After that, activate the plugin under Plugins.
              </div>
            )}

            {result.deploy.configured && (
              <div className={result.deploy.triggered ? styles.alert : styles.errorBox}>
                <strong>Vercel:</strong> {result.deploy.triggered ? 'a rebuild was triggered with the deploy hook.' : result.deploy.error}
              </div>
            )}

            {result.sql.length > 0 && (
              <div className={styles.alert}>
                <strong>Run {result.sql.length === 1 ? 'this SQL script' : `these ${result.sql.length} SQL scripts, in this order,`} in the Supabase SQL Editor before activating the plugin.</strong>
                {result.sql.map((script) => (
                  <details key={script.path} className={styles.sql}>
                    <summary>
                      <code>{script.path}</code>
                      <CopyButton text={script.sql} label="Copy SQL" />
                    </summary>
                    <pre>{script.sql}</pre>
                  </details>
                ))}
              </div>
            )}

            {result.dependencies.missing.length > 0 && (
              <div className={styles.alert}>
                <strong>Missing npm packages.</strong> The build will fail until they are installed. In the project folder on the server, run:
                {result.dependencies.installCommand && (
                  <div className={styles.command}>
                    <code>{result.dependencies.installCommand}</code>
                    <CopyButton text={result.dependencies.installCommand} />
                  </div>
                )}
                <ul className={styles.packages}>
                  {result.dependencies.missing.map((dependency) => (
                    <li key={dependency.name}>
                      <code>{dependency.name}{dependency.range ? `@${dependency.range}` : ''}</code>{' '}
                      {dependency.reason === 'not-declared' ? 'is not in package.json' : 'is in package.json but not installed (run npm install)'}
                      {' '}— used in {dependency.usedIn.join(', ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.warnings.map((warning) => <div key={warning} className={styles.alert}>{warning}</div>)}

            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => { storePendingInstallResult(null); setResult(null); setSteps({}); setFile(null); setUrl(''); }}>Upload another</button>
              <button type="button" className={styles.primary} onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
