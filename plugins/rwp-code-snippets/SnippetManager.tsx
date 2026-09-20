import { useCallback, useEffect, useMemo, useState } from 'react';
import CodeEditor, { type CodeLanguage } from '../../src/components/theme/CodeEditor';
import { getSnippetRunReport, refreshSnippets, subscribeSnippetRuntime } from '../../src/core/SnippetInjector';
import {
  snippetLocationLabels, snippetLocations, snippetTypeLabels, snippetTypes,
  type CodeSnippet, type SnippetDraft, type SnippetLocation, type SnippetType,
} from '../../src/lib/snippets';
import type { RwpAdminPageProps } from '../../src/lib/plugin-api';
import {
  BulkBar, RowCheckbox, SelectAllCheckbox, useBulkSelection, type BulkAction,
} from '../../src/components/BulkActions';
import AiChatDrawer from './AiChatDrawer';
import BackupRestoreModal, { buildBackup } from './BackupRestoreModal';
import { blankDraft, createSnippet, deleteSnippet, fetchServerStatus, listSnippets, toDraft, updateSnippet } from './lib/api';
import { generateSnippet } from './services/geminiSnippetAssistant';
import styles from './snippets.module.css';

/**
 * the Code Snippets screen.
 *
 * Every save is followed by refreshSnippets(), so the running site picks the change up without a
 * reload — including switching a broken snippet off again, which is the whole reason the runtime
 * tracks what each snippet added.
 */

const starterCode: Record<SnippetType, string> = {
  css: '/* Added to <head> on the public site. Target the global rwp-*, rwpt-* and rwpb-* classes. */\n',
  javascript: "// Runs in the visitor's browser, inside its own scope.\n// Put something on window if another snippet needs to see it.\n",
  html: '<!-- Added to the page as written. An inline <script> in here does run. -->\n',
  hook: [
    '// Plain JavaScript: no imports, no JSX. The hook registry arrives as `rwp`.',
    '// Everything registered here is removed again when the snippet is switched off.',
    '',
    "rwp.addFilter('rwp_site_title', (title) => title);",
    '',
  ].join('\n'),
};

const languageOf = (type: SnippetType): CodeLanguage => (type === 'css' ? 'css' : type === 'html' ? 'html' : 'javascript');

const warningFor = (type: SnippetType): string => {
  if (type === 'javascript') return 'This code runs in every visitor’s browser. It is not checked or sandboxed — only the “Manage settings” capability can save it.';
  if (type === 'html') return 'The markup is inserted exactly as written and is not sanitized, so an inline <script> in it runs.';
  if (type === 'hook') return 'Evaluated with new Function when the snippet is switched on. A syntax error is reported on the Status tab instead of breaking the page.';
  return '';
};

type Filter = 'all' | 'active' | 'inactive' | SnippetType;

// Editor ---------------------------------------------------------------------------------------

interface EditorProps {
  draft: SnippetDraft;
  onChange: (patch: Partial<SnippetDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
  onOpenAssistant: () => void;
  saving: boolean;
  isNew: boolean;
  aiReady: boolean | null;
}

function SnippetEditor({ draft, onChange, onSave, onCancel, onOpenAssistant, saving, isNew, aiReady }: EditorProps) {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiNote, setAiNote] = useState('');

  const generate = async (mode: 'create' | 'refine') => {
    setAiError(''); setAiNote(''); setGenerating(true);
    try {
      const result = await generateSnippet({
        snippetType: draft.snippet_type,
        prompt,
        existingCode: draft.code,
        mode,
        title: draft.title,
        location: draft.location,
      });
      onChange({ code: result.code });
      setAiNote(`${result.explanation || 'Code inserted.'} Read it before switching the snippet on.${result.model ? ` (${result.model})` : ''}`);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'The AI request failed.');
    } finally {
      setGenerating(false);
    }
  };

  const warning = warningFor(draft.snippet_type);

  return (
    <section className={styles.panel} aria-label={isNew ? 'New snippet' : `Editing ${draft.title}`}>
      <div className={styles.toolbar}>
        <h3>{isNew ? 'New snippet' : 'Edit snippet'}</h3>
        <span className={styles.spacer} />
        <button type="button" className={styles.secondary} onClick={onOpenAssistant}>Ask the assistant</button>
      </div>

      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor="rwp-snippet-title">Title</label>
          <input id="rwp-snippet-title" value={draft.title} maxLength={255}
            onChange={(event) => onChange({ title: event.target.value })} placeholder="Hide the sidebar on the blog index" />
        </div>

        <div className={styles.settings}>
          <div className={styles.field}>
            <label htmlFor="rwp-snippet-type">Type</label>
            <select id="rwp-snippet-type" value={draft.snippet_type} onChange={(event) => {
              const type = event.target.value as SnippetType;
              // Replacing untouched starter code keeps the example useful; typed-in code is kept.
              const untouched = Object.values(starterCode).includes(draft.code) || !draft.code.trim();
              onChange({ snippet_type: type, ...(untouched ? { code: starterCode[type] } : {}) });
            }}>
              {snippetTypes.map((type) => <option key={type} value={type}>{snippetTypeLabels[type]}</option>)}
            </select>
            <span className={styles.hint}>What kind of code this is.</span>
          </div>
          <div className={styles.field}>
            <label htmlFor="rwp-snippet-location">Runs</label>
            <select id="rwp-snippet-location" value={draft.location}
              onChange={(event) => onChange({ location: event.target.value as SnippetLocation })}>
              {snippetLocations.map((location) => <option key={location} value={location}>{snippetLocationLabels[location]}</option>)}
            </select>
            <span className={styles.hint}>Where it is injected. Hook snippets register regardless.</span>
          </div>
          <div className={styles.field}>
            <label htmlFor="rwp-snippet-priority">Priority</label>
            <input id="rwp-snippet-priority" type="number" min={0} max={1000} value={draft.priority}
              onChange={(event) => onChange({ priority: Number(event.target.value) })} />
            <span className={styles.hint}>Lower runs first. 10 is the default.</span>
          </div>
          <div className={styles.field}>
            <label htmlFor="rwp-snippet-tags">Tags</label>
            <input id="rwp-snippet-tags" value={draft.tags.join(', ')}
              onChange={(event) => onChange({ tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })}
              placeholder="layout, analytics" />
            <span className={styles.hint}>Comma separated. Searchable.</span>
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor="rwp-snippet-description">Description</label>
          <textarea id="rwp-snippet-description" rows={2} value={draft.description} maxLength={5000}
            onChange={(event) => onChange({ description: event.target.value })}
            placeholder="What it does, and why it is here. Your future self will want this." />
        </div>
      </div>

      {/* A composer, not a one-line field: a useful instruction is a few sentences long. */}
      <div className={styles.aiBox}>
        <div className={styles.aiHead}>
          <span className={styles.label}>AI</span>
          <span className={styles.sub}>Describe what you want in {snippetTypeLabels[draft.snippet_type]}. Generate writes from scratch; Refine rewrites what is in the editor.</span>
        </div>
        <textarea
          className={styles.aiPrompt}
          value={prompt}
          rows={3}
          aria-label="Describe the code you want"
          placeholder={draft.snippet_type === 'css'
            ? 'Make the header sticky with a soft shadow, and hide it while scrolling down on phones…'
            : 'Describe what this snippet should do, and any details that matter — which element, which page, what should happen…'}
          disabled={aiReady === false}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift + Enter starts a new line, as in the assistant drawer.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (prompt.trim() && !generating) void generate(draft.code.trim() ? 'refine' : 'create');
            }
          }}
        />
        <div className={styles.aiFoot}>
          <span className={styles.aiKeys}>Enter sends · Shift + Enter for a new line</span>
          <span className={styles.spacer} />
          <button type="button" className={styles.secondary} disabled={generating || !prompt.trim() || !draft.code.trim() || aiReady === false} onClick={() => void generate('refine')}>
            Refine this code
          </button>
          <button type="button" className={styles.primary} disabled={generating || !prompt.trim() || aiReady === false} onClick={() => void generate('create')}>
            {generating ? 'Writing…' : 'Generate'}
          </button>
        </div>
        {aiReady === false && <p className={styles.aiNote}>Set GEMINI_API_KEY on the server to use this — see the Status tab.</p>}
        {aiNote && <p className={styles.aiNote}>{aiNote}</p>}
        {aiError && <p className={styles.error} role="alert">{aiError}</p>}
      </div>

      <CodeEditor
        id="rwp-snippet-code"
        label={`${snippetTypeLabels[draft.snippet_type]} code`}
        language={languageOf(draft.snippet_type)}
        value={draft.code}
        onChange={(code) => onChange({ code })}
        minRows={14}
      />
      {warning && <p className={styles.warning}>{warning}</p>}

      <div className={styles.editorFoot}>
        <label className={styles.switch}>
          <input type="checkbox" checked={draft.is_active} onChange={(event) => onChange({ is_active: event.target.checked })} />
          <span className={styles.track} aria-hidden="true" />
          <span>{draft.is_active ? 'On — runs as soon as it is saved' : 'Off'}</span>
        </label>
        <span className={styles.spacer} />
        <button type="button" className={styles.secondary} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className={styles.primary} onClick={onSave} disabled={saving || !draft.title.trim()}>
          {saving ? 'Saving…' : isNew ? 'Create snippet' : 'Save changes'}
        </button>
      </div>
    </section>
  );
}

// Status ----------------------------------------------------------------------------------------

function StatusTab() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof fetchServerStatus>> | undefined>(undefined);
  const [report, setReport] = useState(getSnippetRunReport());

  useEffect(() => { void fetchServerStatus().then(setStatus); }, []);
  useEffect(() => subscribeSnippetRuntime(() => setReport(getSnippetRunReport())), []);

  const item = (ok: boolean, label: string, fix: string) => (
    <li className={ok ? styles.ok : styles.bad}><strong>{ok ? '✓' : '✕'} {label}</strong>{!ok && <span>{fix}</span>}</li>
  );

  return (
    <>
      <section className={styles.panel}>
        <h3>AI assistant</h3>
        {status === undefined && <p className={styles.muted}>Checking the server…</p>}
        {status === null && (
          <p className={styles.error}>
            The server did not answer at <code>/api/plugins/rwp-code-snippets/status</code>. Snippets still work — only the AI
            features need the Node server (<code>npm start</code>), or the Vercel function, to be running with this plugin active.
          </p>
        )}
        {status && (
          <ul className={styles.checklist}>
            {item(status.gemini, `GEMINI_API_KEY is set${status.model ? ` (model: ${status.model})` : ''}`,
              'Create a free key at aistudio.google.com/apikey, add GEMINI_API_KEY to .env.local and restart the server. Never use a VITE_ prefix: that would publish the key in the site’s JavaScript, where anyone could read it.')}
          </ul>
        )}
        <p className={styles.muted}>The key is never sent to the browser. Prompts go to this site’s own server, which calls Gemini.</p>
      </section>

      <section className={styles.panel}>
        <h3>What is running in this tab</h3>
        {!report.at && <p className={styles.muted}>The snippet runtime has not loaded yet.</p>}
        {report.loadError && <p className={styles.error} role="alert">{report.loadError}</p>}
        {report.at > 0 && !report.loadError && (
          <p className={styles.muted}>
            {report.applied} snippet{report.applied === 1 ? '' : 's'} applied on the <strong>{report.surface === 'admin' ? 'admin' : 'public site'}</strong> surface,
            last loaded at {new Date(report.at).toLocaleTimeString()}. Snippets set to run on the public site are not applied here.
          </p>
        )}
        {report.failures.length > 0 && (
          <ul className={styles.checklist}>
            {report.failures.map((failure) => (
              <li key={failure.id} className={styles.bad}><strong>✕ {failure.title}</strong><span>{failure.message}</span></li>
            ))}
          </ul>
        )}
        {report.at > 0 && !report.failures.length && !report.loadError && <p className={styles.success}>No snippet failed to apply.</p>}
        <p className={styles.muted}>
          A JavaScript snippet that throws after it has started (in a click handler, say) is reported in the browser console, not here —
          look for messages beginning <code>[rwp-code-snippets]</code>.
        </p>
      </section>

      <section className={styles.panel}>
        <h3>How snippets are protected</h3>
        <ul className={styles.checklist}>
          <li className={styles.ok}><strong>Only Administrators can write them.</strong><span>RLS on <code>code_snippets</code> checks <code>user_has_cap(&#39;manage_options&#39;)</code> for every insert, update and delete. Everyone else may read the active rows, which is how the public site loads them before anyone signs in.</span></li>
          <li className={styles.ok}><strong>Switching one off removes it.</strong><span>Every element and every hook a snippet registered is tracked, so turning it off undoes it without a reload. Work a JavaScript snippet already did — a request it sent, an element it deleted — is not undone; that needs a reload.</span></li>
          <li className={styles.ok}><strong>One failure does not take the site down.</strong><span>Each snippet is applied inside its own try/catch, and JavaScript snippets run inside an IIFE with a catch around them.</span></li>
        </ul>
      </section>
    </>
  );
}

// Screen ----------------------------------------------------------------------------------------

export default function SnippetManager({ subsection }: RwpAdminPageProps) {
  const [snippets, setSnippets] = useState<CodeSnippet[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; draft: SnippetDraft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [busy, setBusy] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [backup, setBackup] = useState(false);
  const [aiReady, setAiReady] = useState<boolean | null>(null);

  const tab = subsection === 'status' ? 'status' : 'snippets';

  const load = useCallback(() => {
    listSnippets()
      .then(setSnippets)
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load the snippets.'));
  }, []);
  useEffect(load, [load]);
  useEffect(() => { void fetchServerStatus().then((status) => setAiReady(status ? status.gemini : false)); }, []);

  const term = search.trim().toLowerCase();
  const visible = useMemo(() => (snippets || []).filter((snippet) => {
    if (filter === 'active' && !snippet.is_active) return false;
    if (filter === 'inactive' && snippet.is_active) return false;
    if (filter !== 'all' && filter !== 'active' && filter !== 'inactive' && snippet.snippet_type !== filter) return false;
    return !term || `${snippet.title} ${snippet.description} ${snippet.tags.join(' ')}`.toLowerCase().includes(term);
  }), [snippets, filter, term]);

  // Only rows that are still on screen stay selected, so changing a filter cannot delete something
  // the filter had hidden.
  const visibleIds = useMemo(() => visible.map((snippet) => snippet.id), [visible]);
  const selection = useBulkSelection(visibleIds);

  const counts = useMemo(() => {
    const all = snippets || [];
    return {
      all: all.length,
      active: all.filter((snippet) => snippet.is_active).length,
      inactive: all.filter((snippet) => !snippet.is_active).length,
      ...Object.fromEntries(snippetTypes.map((type) => [type, all.filter((snippet) => snippet.snippet_type === type).length])),
    } as Record<Filter, number>;
  }, [snippets]);

  // "Switch on" is pointless while the list is filtered to the ones already on, and vice versa.
  const bulkActions: BulkAction[] = [
    { id: 'enable', label: 'Switch on', tone: 'primary', hidden: filter === 'active' },
    { id: 'disable', label: 'Switch off', hidden: filter === 'inactive' },
    { id: 'export', label: 'Export selected' },
    { id: 'delete', label: 'Delete', tone: 'danger' },
  ];

  /** Every write goes through here: report it, reload the list, and re-apply the live snippets. */
  const run = async (action: () => Promise<string>) => {
    setError('');
    setNotice('');
    try {
      setNotice(await action());
      load();
      await refreshSnippets();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'That did not work.');
    }
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    await run(async () => {
      if (editing.id) {
        await updateSnippet(editing.id, editing.draft);
        return `Saved “${editing.draft.title}”.`;
      }
      await createSnippet(editing.draft);
      return `Created “${editing.draft.title}”.`;
    });
    setSaving(false);
    setEditing(null);
  };

  const toggle = async (snippet: CodeSnippet) => {
    setBusyId(snippet.id);
    await run(async () => {
      await updateSnippet(snippet.id, { is_active: !snippet.is_active });
      return `“${snippet.title}” is now ${snippet.is_active ? 'off' : 'on'}.`;
    });
    setBusyId('');
  };

  /**
   * Enable, disable, export or delete every ticked snippet. Each row is written on its own, so
   * one that RLS or a constraint refuses is counted and named instead of failing the whole batch.
   */
  const runBulk = async (action: string, ids: string[]) => {
    const rows = visible.filter((snippet) => ids.includes(snippet.id));
    if (!rows.length) return;

    if (action === 'export') {
      const blob = new Blob([JSON.stringify(buildBackup(rows), null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `react-wp-snippets-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      setError('');
      setNotice(`Exported ${rows.length} snippet${rows.length === 1 ? '' : 's'}.`);
      return;
    }
    if (action === 'delete' && !window.confirm(`Permanently delete ${rows.length} snippet${rows.length === 1 ? '' : 's'}? This cannot be undone.`)) return;

    setError('');
    setNotice('');
    setBusy(action);
    const failures: string[] = [];
    let changed = 0;
    for (const snippet of rows) {
      try {
        if (action === 'delete') {
          await deleteSnippet(snippet.id);
          if (editing?.id === snippet.id) setEditing(null);
        } else {
          // Already in the requested state: nothing to write, but it still counts as done.
          const next = action === 'enable';
          if (snippet.is_active !== next) await updateSnippet(snippet.id, { is_active: next });
        }
        changed += 1;
      } catch (bulkError) {
        failures.push(`“${snippet.title}”: ${bulkError instanceof Error ? bulkError.message : 'not changed'}`);
      }
    }
    const verb = action === 'delete' ? 'Deleted' : action === 'enable' ? 'Switched on' : 'Switched off';
    const noun = rows.length === 1 ? 'snippet' : 'snippets';
    if (changed) setNotice(`${verb} ${changed} ${noun}.`);
    if (failures.length) setError(`${failures.length} of ${rows.length} ${noun} could not be changed. ${failures.slice(0, 3).join(' ')}`);
    setBusy('');
    selection.clear();
    load();
    await refreshSnippets();
  };

  const remove = (snippet: CodeSnippet) => {
    if (!window.confirm(`Delete “${snippet.title}”? This cannot be undone.`)) return;
    void run(async () => {
      await deleteSnippet(snippet.id);
      if (editing?.id === snippet.id) setEditing(null);
      return `Deleted “${snippet.title}”.`;
    });
  };

  const duplicate = (snippet: CodeSnippet) => setEditing({
    id: null,
    draft: { ...toDraft(snippet), title: `${snippet.title} (copy)`, is_active: false },
  });

  const startNew = () => setEditing({ id: null, draft: { ...blankDraft, code: starterCode.css } });

  return (
    <div className={styles.wrap}>
      <div className={styles.intro}>
        <h2>Code Snippets</h2>
        <p>
          Add CSS, JavaScript, HTML and React hooks to this site without editing any files. Snippets are stored in the
          database and applied while the site is running, so switching one off takes effect immediately.
        </p>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.success} role="status">{notice}</p>}

      {tab === 'status' ? <StatusTab /> : (
        <>
          <section className={styles.panel}>
            <div className={styles.toolbar}>
              <button type="button" className={styles.primary} onClick={startNew}>Add snippet</button>
              <input type="search" value={search} placeholder="Search title, description or tag" aria-label="Search snippets"
                onChange={(event) => setSearch(event.target.value)} />
              <span className={styles.spacer} />
              <button type="button" className={styles.secondary} onClick={() => setDrawer(true)}>AI assistant</button>
              <button type="button" className={styles.secondary} onClick={() => setBackup(true)}>Backup &amp; Restore</button>
            </div>

            <div className={styles.filters}>
              {(['all', 'active', 'inactive', ...snippetTypes] as Filter[]).map((key) => (
                <button key={key} type="button" className={filter === key ? styles.filterActive : styles.filter} onClick={() => setFilter(key)}>
                  {key === 'all' ? 'All' : key === 'active' ? 'On' : key === 'inactive' ? 'Off' : snippetTypeLabels[key as SnippetType]}
                  <span className={styles.count}>{counts[key] ?? 0}</span>
                </button>
              ))}
            </div>

            {!snippets && !error && <p className={styles.muted}>Loading…</p>}
            {snippets?.length === 0 && (
              <p className={styles.muted}>No snippets yet. Add one, or restore a backup from another site.</p>
            )}
            {snippets && snippets.length > 0 && visible.length === 0 && <p className={styles.muted}>Nothing matches that filter.</p>}

            {snippets && (
              <BulkBar selection={selection} total={visible.length} noun="snippets" busy={busy} actions={bulkActions}
                onAction={(action, ids) => void runBulk(action, ids)} />
            )}

            {visible.length > 0 && (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th><SelectAllCheckbox selection={selection} total={visible.length} /></th>
                      <th>On</th><th>Snippet</th><th>Type</th><th>Runs</th><th>Priority</th><th>Updated</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((snippet) => (
                      <tr key={snippet.id} className={editing?.id === snippet.id ? styles.editing : undefined}>
                        <td><RowCheckbox selection={selection} id={snippet.id} label={snippet.title} /></td>
                        <td>
                          <label className={styles.switch}>
                            <input type="checkbox" checked={snippet.is_active} disabled={busyId === snippet.id}
                              aria-label={`${snippet.is_active ? 'Switch off' : 'Switch on'} ${snippet.title}`}
                              onChange={() => void toggle(snippet)} />
                            <span className={styles.track} aria-hidden="true" />
                          </label>
                        </td>
                        <td>
                          <strong>{snippet.title}</strong>
                          {snippet.description && <span className={styles.muted}>{snippet.description}</span>}
                          {snippet.tags.length > 0 && (
                            <span className={styles.tagList}>{snippet.tags.map((tag) => <span key={tag} className={styles.tag}>{tag}</span>)}</span>
                          )}
                        </td>
                        <td><span className={styles.badge}>{snippetTypeLabels[snippet.snippet_type]}</span></td>
                        <td className={styles.muted}>{snippetLocationLabels[snippet.location]}</td>
                        <td>{snippet.priority}</td>
                        <td className={styles.muted}>{snippet.updated_at ? new Date(snippet.updated_at).toLocaleDateString() : '—'}</td>
                        <td className={styles.actions}>
                          <button type="button" className={styles.secondary} onClick={() => setEditing({ id: snippet.id, draft: toDraft(snippet) })}>Edit</button>
                          <button type="button" className={styles.secondary} onClick={() => duplicate(snippet)}>Duplicate</button>
                          <button type="button" className={styles.danger} onClick={() => remove(snippet)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {editing && (
            <SnippetEditor
              draft={editing.draft}
              isNew={!editing.id}
              saving={saving}
              aiReady={aiReady}
              onChange={(patch) => setEditing({ ...editing, draft: { ...editing.draft, ...patch } })}
              onSave={() => void save()}
              onCancel={() => setEditing(null)}
              onOpenAssistant={() => setDrawer(true)}
            />
          )}
        </>
      )}

      {drawer && (
        <AiChatDrawer
          onClose={() => setDrawer(false)}
          editor={editing ? {
            code: editing.draft.code,
            type: editing.draft.snippet_type,
            insert: (code) => setEditing((current) => (current ? { ...current, draft: { ...current.draft, code } } : current)),
          } : null}
        />
      )}

      {backup && (
        <BackupRestoreModal
          onClose={() => setBackup(false)}
          onImported={(message) => {
            setBackup(false);
            setNotice(message);
            load();
            void refreshSnippets();
          }}
        />
      )}
    </div>
  );
}
