import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';
import { deleteContent, plural, setContentStatus, type ContentStatus } from '../../../src/lib/contentBulk';
import {
  BulkBar, RowCheckbox, SelectAllCheckbox, describeBulkResult, useBulkSelection, type BulkAction,
} from '../../../src/components/BulkActions';
import { fetchProfile } from '../../../src/lib/profiles';
import { hasCapability, type UserRole } from '../../../src/lib/roles';
import {
  createTemplate, deleteSubmissions, deleteTemplate, fetchServerStatus, listBuilderPages, listSubmissions, listTemplates,
  renameTemplate, setSubmissionStatus, type Submission,
} from '../lib/api';
import { getWidget } from '../lib/registry';
import {
  createSiteTemplate, customizeArchive, listSiteTemplates, templateSlots, type TemplateGroup, type TemplateRow, type TemplateSlot,
} from '../lib/siteTemplates';
import type { BuilderTemplate, SectionNode, TemplateType } from '../lib/types';
import { loadSettings } from '../../../src/lib/settings';
import type { RwpAdminPageProps } from '../../../src/lib/plugin-api';
import styles from './admin.module.css';

type Tab = 'site-pages' | 'templates' | 'submissions' | 'status';
const tabs: Tab[] = ['site-pages', 'templates', 'submissions', 'status'];

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

const groupInfo: Array<{ group: TemplateGroup; title: string; intro: string }> = [
  { group: 'parts', title: 'Layout Parts', intro: 'Shown on every public page, in place of the Theme Editor’s header and footer.' },
  { group: 'content', title: 'System Templates', intro: 'Standard pages and posts without their own builder layout, the 404 page and search results.' },
  { group: 'archive', title: 'Archives', intro: 'The shared layout is used for every archive until you customize a single archive type.' },
  { group: 'shop', title: 'Shop Templates', intro: 'The store screens. Cart, checkout and account widgets embed the real screens, so prices and payments are unchanged.' },
];

type CorePage = { id: number; title: string; slug: string; status: string; is_builder_enabled: boolean } | null;

function StatusBadge({ row, fallbackLabel }: { row?: { status: string; is_builder_enabled: boolean } | null; fallbackLabel: string }) {
  if (!row) return <span className={styles.badgeGrey}>{fallbackLabel}</span>;
  if (row.status === 'published' && row.is_builder_enabled) return <span className={styles.badgeGreen}>Live</span>;
  return <span className={styles.badgeBlue} title="Publish it from the builder to use it on the site">{row.is_builder_enabled ? 'Draft' : 'Builder off'}</span>;
}

/** Core pages and site templates. Administrators and Shop Managers only (enforced by the database too). */
function SiteTemplatesPanel({ navigate }: { navigate: RwpAdminPageProps['navigate'] }) {
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [core, setCore] = useState<{ home: CorePage; blog: CorePage } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  // Shop widgets are registered by the shop plugin, so their absence means it is switched off.
  const shopActive = Boolean(getWidget('shop-cart'));

  useEffect(() => {
    listSiteTemplates().then(setRows).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load site templates.'));
    void (async () => {
      const settings = await loadSettings().catch(() => null);
      const ids = [settings?.home_page_id, settings?.posts_page_id].filter(Boolean) as string[];
      const { data } = ids.length
        ? await getSupabaseClient().from('pages').select('id,title,slug,status,is_builder_enabled').in('id', ids)
        : { data: [] };
      const find = (id?: string) => ((data || []) as NonNullable<CorePage>[]).find((page) => String(page.id) === id) || null;
      setCore({ home: find(settings?.home_page_id), blog: find(settings?.posts_page_id) });
    })();
  }, []);

  const create = async (slot: TemplateSlot) => {
    setError('');
    setBusy(slot.type);
    try {
      const id = slot.overrides ? await customizeArchive(slot) : await createSiteTemplate(slot);
      window.location.href = `/builder/${id}`;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : `Could not create the ${slot.label} template.`);
      setBusy('');
    }
  };

  const coreRow = (label: string, icon: string, description: string, page: CorePage, viewHref: string) => (
    <tr key={label}>
      <td><strong><span aria-hidden="true">{icon}</span> {label}</strong><span className={styles.muted}>{page ? `“${page.title}” · ${description}` : description}</span></td>
      <td><code>{page ? viewHref : '—'}</code></td>
      <td>{page ? <StatusBadge row={page} fallbackLabel="" /> : <span className={styles.badgeGrey}>Not set</span>}</td>
      <td className={styles.actions}>
        {page
          ? <><a className={styles.primary} href={`/builder/${page.id}`}>Edit with Page Builder</a><a className={styles.secondary} href={viewHref} target="_blank" rel="noreferrer">View</a></>
          : <button type="button" className={styles.secondary} onClick={() => navigate('settings', 'site')}>Choose it in Settings → Site</button>}
      </td>
    </tr>
  );

  return (
    <>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <h3>Core Pages</h3>
          <p>Your front page and blog page are ordinary pages: open them in the builder to design them. Other pages use the Standard Pages template below unless they have their own layout.</p>
        </div>
        {!core ? <p className={styles.muted}>Loading…</p> : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Page</th><th>Shown on</th><th>Status</th><th /></tr></thead>
              <tbody>
                {coreRow('Homepage', '🏠', 'The front page of the site.', core.home, '/')}
                {coreRow('Blog Index', '📚', 'Lists your latest posts.', core.blog, core.blog ? `/${core.blog.slug}` : '/')}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {groupInfo.map(({ group, title, intro }) => (
        <section key={group} className={styles.panel}>
          <div className={styles.toolbar}>
            <h3>{title}</h3>
            <p>{intro} A template is used once it is published; while it is a draft, or before one exists, the site shows its built-in screen.</p>
          </div>
          {group === 'shop' && !shopActive && <p className={styles.error} role="alert">The Shop plugin is not active, so its widgets are missing from the builder and shop templates are not shown. Activate it under Plugins.</p>}
          {!rows && !error && <p className={styles.muted}>Loading…</p>}
          {rows && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Template</th><th>Shown on</th><th>Status</th><th>Updated</th><th /></tr></thead>
                <tbody>
                  {templateSlots.filter((slot) => slot.group === group).map((slot) => {
                    const row = rows.find((item) => item.template_type === slot.type);
                    return (
                      <tr key={slot.type}>
                        <td><strong><span aria-hidden="true">{slot.icon}</span> {slot.label}</strong><span className={styles.muted}>{slot.description}</span></td>
                        <td><code>{slot.routes}</code></td>
                        <td><StatusBadge row={row} fallbackLabel={slot.overrides ? 'Uses the shared archive' : 'Default screen'} /></td>
                        <td>{row ? new Date(row.updated_at).toLocaleDateString() : '—'}</td>
                        <td className={styles.actions}>
                          {row
                            ? <a className={styles.primary} href={`/builder/${row.id}`}>Edit with Page Builder</a>
                            : <button type="button" className={styles.primary} disabled={busy !== ''} onClick={() => void create(slot)}>
                              {busy === slot.type ? 'Creating…' : slot.overrides ? 'Customize' : 'Create with Page Builder'}
                            </button>}
                          <a className={styles.secondary} href={slot.viewHref} target="_blank" rel="noreferrer">View</a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </>
  );
}

function SitePagesTab() {
  const [pages, setPages] = useState<Awaited<ReturnType<typeof listBuilderPages>> | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState<'builder' | 'all' | 'trash'>('builder');
  const [status, setStatus] = useState<'' | 'published' | 'draft'>('');
  const [search, setSearch] = useState('');
  const load = useCallback(() => {
    listBuilderPages().then(setPages).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load pages.'));
  }, []);
  useEffect(load, [load]);
  const inTrash = filter === 'trash';
  const term = search.trim().toLowerCase();
  const visible = useMemo(() => (pages || []).filter((page) =>
    (inTrash ? page.status === 'trash' : page.status !== 'trash')
    && (filter !== 'builder' || page.is_builder_enabled)
    && (inTrash || !status || page.status === status)
    && (!term || `${page.title} ${page.slug}`.toLowerCase().includes(term))), [filter, inTrash, pages, status, term]);
  const visibleIds = useMemo(() => visible.map((page) => page.id), [visible]);
  const selection = useBulkSelection(visibleIds);
  const trashCount = (pages || []).filter((page) => page.status === 'trash').length;

  const runBulk = async (action: string, ids: number[]) => {
    const rows = visible.filter((page) => ids.includes(page.id));
    if (!rows.length) return;
    if (action === 'delete' && !window.confirm(`Permanently delete ${plural(rows.length, 'item')}? This cannot be undone.`)) return;
    const plan: Record<string, [ContentStatus | null, string]> = {
      publish: ['published', 'Published'], draft: ['draft', 'Moved to draft'], trash: ['trash', 'Moved to Trash'],
      restore: ['draft', 'Restored as draft'], delete: [null, 'Permanently deleted'],
    };
    const [nextStatus, verb] = plan[action];
    setError(''); setNotice(''); setBusy(action);
    try {
      const result = nextStatus ? await setContentStatus(rows, nextStatus) : await deleteContent(rows);
      const report = describeBulkResult(verb, rows.length, result.changed.length, rows.length === 1 ? 'item' : 'items', result.blockedReason);
      setNotice(report.success); setError(report.error);
      selection.clear();
      load();
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : 'That did not work.');
    } finally { setBusy(''); }
  };

  const actions: BulkAction[] = inTrash
    ? [{ id: 'restore', label: 'Restore', tone: 'primary' }, { id: 'delete', label: 'Delete permanently', tone: 'danger' }]
    : [
      { id: 'publish', label: 'Publish', hidden: status === 'published' },
      { id: 'draft', label: 'Move to draft', hidden: status === 'draft' },
      { id: 'trash', label: 'Move to Trash', tone: 'danger' },
    ];

  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <p>Open any page or post in the visual builder. Saving from the builder switches that page to its layout.</p>
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title or slug" aria-label="Search pages" />
        <select value={filter} onChange={(event) => setFilter(event.target.value as 'builder' | 'all' | 'trash')} aria-label="Filter">
          <option value="builder">Built with the builder</option>
          <option value="all">All pages and posts</option>
          <option value="trash">Trash ({trashCount})</option>
        </select>
        {!inTrash && (
          <select value={status} onChange={(event) => setStatus(event.target.value as '' | 'published' | 'draft')} aria-label="Status">
            <option value="">All statuses</option>
            <option value="published">Published</option>
            <option value="draft">Drafts</option>
          </select>
        )}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.success} role="status">{notice}</p>}
      {!pages && !error && <p className={styles.muted}>Loading…</p>}
      {pages && visible.length === 0 && (
        <p className={styles.muted}>
          {inTrash ? 'The Trash is empty.' : term ? 'Nothing matches your search.' : filter === 'builder' ? 'No pages use the builder yet. Switch the filter to “All pages and posts” and choose one.' : 'No content yet.'}
        </p>
      )}
      {pages && <BulkBar selection={selection} total={visible.length} noun="pages" actions={actions} busy={busy} onAction={(id, ids) => void runBulk(id, ids)} />}
      {visible.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th><SelectAllCheckbox selection={selection} total={visible.length} /></th><th>Title</th><th>Type</th><th>Status</th><th>Editor</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {visible.map((page) => (
                <tr key={page.id}>
                  <td><RowCheckbox selection={selection} id={page.id} label={page.title} /></td>
                  <td><strong>{page.title}</strong><span className={styles.muted}>/{page.slug}</span></td>
                  <td>{page.is_post ? 'Post' : 'Page'}</td>
                  <td><span className={page.status === 'published' ? styles.badgeGreen : page.status === 'trash' ? styles.badgeRed : styles.badgeGrey}>{page.status}</span></td>
                  <td>{page.is_builder_enabled ? 'Builder' : 'Classic'}</td>
                  <td>{new Date(page.updated_at).toLocaleDateString()}</td>
                  <td className={styles.actions}>
                    {inTrash ? (
                      <>
                        <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => void runBulk('restore', [page.id])}>Restore</button>
                        <button type="button" className={styles.danger} disabled={Boolean(busy)} onClick={() => void runBulk('delete', [page.id])}>Delete permanently</button>
                      </>
                    ) : (
                      <>
                        <a className={styles.primary} href={`/builder/${page.id}`}>Edit with Builder</a>
                        {page.status === 'published' && <a className={styles.secondary} href={`/${page.slug}`} target="_blank" rel="noreferrer">View</a>}
                      </>
                    )}
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
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const term = search.trim().toLowerCase();
  const visible = useMemo(() => (templates || []).filter((template) => !term || template.title.toLowerCase().includes(term)), [templates, term]);
  const visibleIds = useMemo(() => visible.map((template) => template.id), [visible]);
  const selection = useBulkSelection(visibleIds);

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

  const runBulk = async (action: string, ids: string[]) => {
    const rows = visible.filter((template) => ids.includes(template.id));
    if (!rows.length) return;
    if (action === 'export') {
      // Browsers may ask once before allowing several downloads from one click.
      rows.forEach((template, index) => window.setTimeout(() => exportTemplate(template), index * 250));
      setNotice(`Exporting ${plural(rows.length, 'template')} as separate .json files.`);
      return;
    }
    if (!window.confirm(`Delete ${plural(rows.length, 'template')}? This cannot be undone.`)) return;
    setError(''); setNotice(''); setBusy(action);
    const failures: string[] = [];
    let deleted = 0;
    for (const template of rows) {
      try {
        await deleteTemplate(template.id);
        deleted += 1;
      } catch (deleteError) {
        failures.push(`“${template.title}”: ${deleteError instanceof Error ? deleteError.message : 'not deleted'}`);
      }
    }
    if (deleted) setNotice(`Deleted ${plural(deleted, 'template')}.`);
    if (failures.length) setError(`${plural(failures.length, 'template')} could not be deleted. ${failures.slice(0, 3).join(' ')}`);
    setBusy('');
    selection.clear();
    load();
  };

  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <h3>Saved Templates</h3>
        <p>Save sections or whole pages from the builder, then insert them from its Templates button.</p>
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search templates" aria-label="Search templates" />
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
      {templates && templates.length > 0 && visible.length === 0 && <p className={styles.muted}>No templates match your search.</p>}
      {templates && (
        <BulkBar selection={selection} total={visible.length} noun="templates" busy={busy}
          actions={[{ id: 'export', label: 'Export' }, { id: 'delete', label: 'Delete', tone: 'danger' }]}
          onAction={(id, ids) => void runBulk(id, ids)} />
      )}
      {visible.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th><SelectAllCheckbox selection={selection} total={visible.length} /></th><th>Title</th><th>Type</th><th>Sections</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {visible.map((template) => (
                <tr key={template.id}>
                  <td><RowCheckbox selection={selection} id={template.id} label={template.title} /></td>
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
export default function BuilderAdmin({ subsection, navigate }: RwpAdminPageProps) {
  const role = useRole();
  // Old ids (pages, shop-pages) are mapped by src/lib/adminNavigation.ts; anything unknown lands on Site Pages.
  const tab: Tab = tabs.includes(subsection as Tab) ? subsection as Tab : 'site-pages';
  const canSeeSubmissions = role ? hasCapability(role, 'edit_pages') : false;
  // Site templates change every page, so only Administrators and Shop Managers see them.
  const canManageTemplates = role ? hasCapability(role, 'manage_shop') : false;
  return (
    <div className={styles.wrap}>
      <div className={styles.intro}>
        <h2>Page Builder</h2>
        <p>Design pages visually with sections, columns and widgets.</p>
      </div>
      {tab === 'site-pages' && <SitePagesTab />}
      {tab === 'templates' && canManageTemplates && <SiteTemplatesPanel navigate={navigate} />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'submissions' && canSeeSubmissions && <SubmissionsTab />}
      {tab === 'status' && canSeeSubmissions && <StatusTab />}
    </div>
  );
}
