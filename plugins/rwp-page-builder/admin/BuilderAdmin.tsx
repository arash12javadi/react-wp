import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';
import { fetchProfile } from '../../../src/lib/profiles';
import { hasCapability, type UserRole } from '../../../src/lib/roles';
import {
  createTemplate, deleteSubmissions, deleteTemplate, fetchServerStatus, listBuilderPages, listSubmissions, listTemplates,
  renameTemplate, setSubmissionStatus, type Submission,
} from '../lib/api';
import type { BuilderTemplate, SectionNode, TemplateType } from '../lib/types';
import type { RwpAdminPageProps } from '../../../src/lib/plugin-api';
import styles from './admin.module.css';

type Tab = 'pages' | 'templates' | 'submissions' | 'status';

function useRole() {
  const [role, setRole] = useState<UserRole | null>(null);
  useEffect(() => {
    void getSupabaseClient().auth.getUser().then(async ({ data }) => {
      if (!data.user) return setRole('subscriber');
      const profile = await fetchProfile(data.user.id).catch(() => null);
      setRole(profile?.role || 'subscriber');
    });
  }, []);
  return role;
}

function PagesTab() {
  const [pages, setPages] = useState<Awaited<ReturnType<typeof listBuilderPages>> | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'builder' | 'all'>('builder');
  useEffect(() => {
    listBuilderPages().then(setPages).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load pages.'));
  }, []);
  const visible = (pages || []).filter((page) => filter === 'all' || page.is_builder_enabled);
  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <p>Open any page or post in the visual builder. Saving from the builder switches that page to its layout.</p>
        <select value={filter} onChange={(event) => setFilter(event.target.value as 'builder' | 'all')} aria-label="Filter">
          <option value="builder">Built with the builder</option>
          <option value="all">All pages and posts</option>
        </select>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!pages && !error && <p className={styles.muted}>Loading…</p>}
      {pages && visible.length === 0 && <p className={styles.muted}>{filter === 'builder' ? 'No pages use the builder yet. Switch the filter to “All pages and posts” and choose one.' : 'No content yet.'}</p>}
      {visible.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Editor</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {visible.map((page) => (
                <tr key={page.id}>
                  <td><strong>{page.title}</strong><span className={styles.muted}>/{page.slug}</span></td>
                  <td>{page.is_post ? 'Post' : 'Page'}</td>
                  <td><span className={page.status === 'published' ? styles.badgeGreen : styles.badgeGrey}>{page.status}</span></td>
                  <td>{page.is_builder_enabled ? 'Builder' : 'Classic'}</td>
                  <td>{new Date(page.updated_at).toLocaleDateString()}</td>
                  <td className={styles.actions}>
                    <a className={styles.primary} href={`/builder/${page.id}`}>Edit with Builder</a>
                    {page.status === 'published' && <a className={styles.secondary} href={`/${page.slug}`} target="_blank" rel="noreferrer">View</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TemplatesTab() {
  const [templates, setTemplates] = useState<BuilderTemplate[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    listTemplates().then(setTemplates).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load templates.'));
  }, []);
  useEffect(load, [load]);

  const run = async (action: () => Promise<void>, success: string) => {
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
      load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'That did not work.');
    }
  };

  const exportTemplate = (template: BuilderTemplate) => {
    const blob = new Blob([JSON.stringify({ format: 'rwp-page-builder-template', version: 1, title: template.title, type: template.type, content: template.builder_data.content }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${template.title.replace(/[^\w-]+/g, '-').toLowerCase() || 'template'}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const importFile = async (file: File) => {
    const parsed = JSON.parse(await file.text()) as { format?: string; title?: string; type?: TemplateType; content?: SectionNode[] };
    if (parsed.format !== 'rwp-page-builder-template' || !Array.isArray(parsed.content)) {
      throw new Error('This file is not a page builder template export (expected "format": "rwp-page-builder-template").');
    }
    await createTemplate(parsed.title || file.name.replace(/\.json$/i, ''), parsed.type === 'page' ? 'page' : 'section', parsed.content);
  };

  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <p>Save sections or whole pages from the builder, then insert them from its Templates button.</p>
        <button type="button" className={styles.secondary} onClick={() => fileInput.current?.click()}>Import template (.json)</button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void run(() => importFile(file), `Imported “${file.name}”.`);
        }} />
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.success} role="status">{notice}</p>}
      {!templates && !error && <p className={styles.muted}>Loading…</p>}
      {templates?.length === 0 && <p className={styles.muted}>No templates yet.</p>}
      {templates && templates.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Title</th><th>Type</th><th>Sections</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id}>
                  <td><strong>{template.title}</strong></td>
                  <td>{template.type === 'page' ? 'Page' : 'Section'}</td>
                  <td>{Array.isArray(template.builder_data?.content) ? template.builder_data.content.length : 0}</td>
                  <td>{new Date(template.updated_at).toLocaleDateString()}</td>
                  <td className={styles.actions}>
                    <button type="button" className={styles.secondary} onClick={() => {
                      const title = window.prompt('Template name', template.title);
                      if (title && title.trim() !== template.title) void run(() => renameTemplate(template.id, title.trim()), 'Template renamed.');
                    }}>Rename</button>
                    <button type="button" className={styles.secondary} onClick={() => exportTemplate(template)}>Export</button>
                    <button type="button" className={styles.danger} onClick={() => {
                      if (window.confirm(`Delete “${template.title}”?`)) void run(() => deleteTemplate(template.id), 'Template deleted.');
                    }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const csvCell = (value: string) => {
  // A leading = + - @ makes spreadsheet apps evaluate the cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};

function SubmissionsTab() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: Submission[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const perPage = 25;

  const load = useCallback(() => {
    setError('');
    listSubmissions({ status: status || undefined, page, perPage })
      .then((result) => { setData(result); setSelected([]); })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load submissions.'));
  }, [status, page]);
  useEffect(load, [load]);

  const act = async (action: () => Promise<void>) => {
    try {
      await action();
      load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'That did not work.');
    }
  };

  const exportCsv = () => {
    const rows = data?.rows || [];
    const labels = [...new Set(rows.flatMap((row) => row.fields_data.map((field) => field.label)))];
    const lines = [
      ['Date', 'Form', 'Page', 'Status', ...labels].map(csvCell).join(','),
      ...rows.map((row) => [
        new Date(row.created_at).toISOString(), row.form_name || row.form_id, row.pages?.title || '', row.status,
        ...labels.map((label) => row.fields_data.find((field) => field.label === label)?.value || ''),
      ].map((cell) => csvCell(String(cell))).join(',')),
    ];
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
    link.download = `form-submissions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const pages = Math.max(1, Math.ceil((data?.total || 0) / perPage));

  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="Status">
          <option value="">All submissions</option>
          <option value="new">New</option>
          <option value="read">Read</option>
          <option value="spam">Spam</option>
        </select>
        {selected.length > 0 && (
          <>
            <button type="button" className={styles.secondary} onClick={() => void act(() => setSubmissionStatus(selected, 'read'))}>Mark read</button>
            <button type="button" className={styles.secondary} onClick={() => void act(() => setSubmissionStatus(selected, 'spam'))}>Mark spam</button>
            <button type="button" className={styles.danger} onClick={() => { if (window.confirm(`Delete ${selected.length} submission(s)? This cannot be undone.`)) void act(() => deleteSubmissions(selected)); }}>Delete</button>
          </>
        )}
        <button type="button" className={styles.secondary} disabled={!data?.rows.length} onClick={exportCsv}>Export this page as CSV</button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!data && !error && <p className={styles.muted}>Loading…</p>}
      {data?.rows.length === 0 && <p className={styles.muted}>No submissions{status ? ` marked ${status}` : ''} yet.</p>}
      {data && data.rows.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="Select all" checked={selected.length === data.rows.length} onChange={(event) => setSelected(event.target.checked ? data.rows.map((row) => row.id) : [])} /></th>
                <th>Received</th><th>Form</th><th>Summary</th><th>Status</th><th>Email</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <Fragment key={row.id}>
                  <tr className={row.status === 'new' ? styles.unread : undefined}>
                    <td><input type="checkbox" aria-label="Select" checked={selected.includes(row.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} /></td>
                    <td>{new Date(row.created_at).toLocaleString()}</td>
                    <td>{row.form_name || row.form_id}<span className={styles.muted}>{row.pages ? row.pages.title : 'Deleted page'}</span></td>
                    <td>
                      <button type="button" className={styles.link} aria-expanded={open === row.id} onClick={() => {
                        setOpen(open === row.id ? null : row.id);
                        if (row.status === 'new') void act(() => setSubmissionStatus([row.id], 'read'));
                      }}>
                        {row.fields_data.slice(0, 2).map((field) => field.value).filter(Boolean).join(' · ').slice(0, 80) || 'View'}
                      </button>
                    </td>
                    <td><span className={row.status === 'new' ? styles.badgeBlue : row.status === 'spam' ? styles.badgeRed : styles.badgeGrey}>{row.status}</span></td>
                    <td className={styles.muted}>{row.email_status || '—'}</td>
                  </tr>
                  {open === row.id && (
                    <tr key={`${row.id}-detail`} className={styles.detailRow}>
                      <td />
                      <td colSpan={5}>
                        <dl className={styles.fields}>
                          {row.fields_data.map((field) => (
                            <div key={field.id}><dt>{field.label}</dt><dd>{field.value || <em>empty</em>}</dd></div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className={styles.pager}>
          <button type="button" className={styles.secondary} disabled={page <= 1} onClick={() => setPage(page - 1)}>← Newer</button>
          <span>Page {page} of {pages}</span>
          <button type="button" className={styles.secondary} disabled={page >= pages} onClick={() => setPage(page + 1)}>Older →</button>
        </div>
      )}
    </section>
  );
}

function StatusTab() {
  const [status, setStatus] = useState<{ smtp: boolean; secretKey: boolean } | null | undefined>(undefined);
  useEffect(() => { void fetchServerStatus().then(setStatus); }, []);
  const item = (ok: boolean, label: string, fix: string) => (
    <li className={ok ? styles.ok : styles.bad}><strong>{ok ? '✓' : '✕'} {label}</strong>{!ok && <span>{fix}</span>}</li>
  );
  return (
    <section className={styles.panel}>
      <h3>Form email</h3>
      {status === undefined && <p className={styles.muted}>Checking the server…</p>}
      {status === null && <p className={styles.error}>The server did not answer at /api/plugins/rwp-page-builder/status. Form entries are still stored, but notification emails need the Node server (npm start) or the Vercel function to be running with this plugin active.</p>}
      {status && (
        <ul className={styles.checklist}>
          {item(status.smtp, 'SMTP is configured', 'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM in .env.local (or the host environment) and restart the server.')}
          {item(status.secretKey, 'SUPABASE_SECRET_KEY is set', 'The server needs it to read private form recipients and record whether each email was sent. Add it to .env.local and restart.')}
        </ul>
      )}
      <h3>How forms are protected</h3>
      <ul className={styles.plainList}>
        <li>Field rules (required, email format, allowed choices) are checked by the database function <code>builder_submit_form</code>, not only the browser.</li>
        <li>Each form accepts at most 20 submissions a minute, and the server limits each visitor to 10 a minute. A hidden honeypot field drops simple bots.</li>
        <li>Email recipients live in <code>builder_form_settings</code>, which visitors cannot read. The layout JSON that renders the page never contains them.</li>
      </ul>
    </section>
  );
}

/** Page Builder, with its section chosen from the admin sidebar's submenu (see index.tsx). */
export default function BuilderAdmin({ subsection }: RwpAdminPageProps) {
  const role = useRole();
  const tab: Tab = (['pages', 'templates', 'submissions', 'status'] as Tab[]).includes(subsection as Tab) ? subsection as Tab : 'pages';
  const canSeeSubmissions = role ? hasCapability(role, 'edit_pages') : false;
  return (
    <div className={styles.wrap}>
      <div className={styles.intro}>
        <h2>Page Builder</h2>
        <p>Design pages visually with sections, columns and widgets.</p>
      </div>
      {tab === 'pages' && <PagesTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'submissions' && canSeeSubmissions && <SubmissionsTab />}
      {tab === 'status' && canSeeSubmissions && <StatusTab />}
    </div>
  );
}
