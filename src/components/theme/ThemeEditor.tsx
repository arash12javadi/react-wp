import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type Dispatch } from 'react';
import { describeDbError, getSupabaseClient } from '../../lib/db';
import { loadSettings, saveSettings } from '../../lib/settings';
import {
  clearPreviewDraft, defaultTheme, fetchTheme, saveTheme, themeAreaIds, themeAreaLabels, themeMigration,
  ThemeMigrationMissingError, writePreviewDraft,
  type AnyAreaLayout, type ThemeAreaId, type ThemeCodeField, type ThemeSettings,
} from '../../lib/theme';
import {
  hasErrors, validateCss, validateLayoutJson, validateMarkup, validateScripts, type CodeIssue,
} from '../../lib/themeValidation';
import CodeEditor, { type CodeLanguage } from './CodeEditor';
import VisualBuilder, { AreaOptions, type MenuOption } from './VisualBuilder';
import {
  initialEditorState, tabCodeFields, themeContent, themeEditorReducer,
  type EditorAction, type EditorTab,
} from './themeEditorState';
import settingsStyles from '../SiteSettings.module.css';
import styles from './ThemeEditor.module.css';

/**
 * Appearance → Theme Editor. One draft covers every tab, so switching tabs keeps unsaved work and
 * one Save writes the whole theme. The area tab lives in &area= next to the admin's section/tab,
 * so a reload returns to it.
 */

type CodeKind = 'markup' | 'scripts' | 'css';

interface CodeFieldDefinition {
  field: ThemeCodeField;
  label: string;
  language: CodeLanguage;
  kind: CodeKind;
  help: string;
  placeholder?: string;
}

const codeFields: Record<ThemeCodeField, CodeFieldDefinition> = {
  custom_header_code: {
    field: 'custom_header_code', label: '<head> code', language: 'html', kind: 'scripts',
    help: 'Analytics, tag managers, verification and other meta tags. Only <script>, <noscript> (with an <iframe> or <img>), <link> and <meta> are kept, with https:// URLs. Runs on public pages only, never in the admin. For tags that must load before the app, Settings → SEO → Tracking scripts is also available.',
    placeholder: '<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>',
  },
  custom_header_html: {
    field: 'custom_header_html', label: 'Header HTML', language: 'html', kind: 'markup',
    help: 'Shown in the header where the Code snippet block is, or at the end of the header without one. Scripts, <style>, <iframe> and event handlers are removed when the page renders; shortcodes such as [rwp_login] work.',
    placeholder: '<a class="header-cta" href="/contact">Get in touch</a>',
  },
  custom_footer_html: {
    field: 'custom_footer_html', label: 'Footer HTML', language: 'html', kind: 'markup',
    help: 'Shown where the Code snippet block is in the footer, or at the end of the bottom bar without one. Sanitized like Header HTML.',
  },
  custom_footer_code: {
    field: 'custom_footer_code', label: 'Footer scripts', language: 'html', kind: 'scripts',
    help: 'Added at the end of <body> on public pages: chat widgets, pixels, deferred analytics. Same allowlist as the <head> code.',
    placeholder: '<script src="https://example.com/widget.js" defer></script>',
  },
  custom_sidebar_code: {
    field: 'custom_sidebar_code', label: 'Sidebar HTML', language: 'html', kind: 'markup',
    help: 'Shown where the Code snippet block is in the sidebar, or at the end of it. This is HTML, not JSX: React components cannot run from saved text, but shortcodes can.',
  },
  custom_comments_css: {
    field: 'custom_comments_css', label: 'Comments CSS', language: 'css', kind: 'css',
    help: 'Loaded after Custom CSS on every public page. Stable hooks: .rwp-comments, .rwp-comments-list, .rwp-comment, .rwpt-rules, .rwpt-pagination. Comment markup itself is not a template: comment text is written by visitors, and letting saved HTML wrap it would put their text into an unescaped template.',
    placeholder: '.rwp-comments .rwp-comment article {\n  border-radius: 0;\n}',
  },
  custom_css: {
    field: 'custom_css', label: 'Custom CSS', language: 'css', kind: 'css',
    help: 'Applied to every public page after the theme\'s own styles, so rules with equal specificity win. Stable hooks: .rwp-site, .rwp-header, .rwp-nav, .rwp-brand, .rwp-footer, .rwp-footer-columns, .rwp-sidebar, .rwp-index, .rwp-hero, .rwp-posts-feed, .rwp-post-card, .rwpt-block-<type>. Not applied in the admin.',
    placeholder: '.rwp-header {\n  background: #0f172a;\n}\n.rwp-header .rwp-nav a {\n  color: #fff;\n}',
  },
};

const validateField = (definition: CodeFieldDefinition, value: string): CodeIssue[] =>
  definition.kind === 'scripts' ? validateScripts(value) : definition.kind === 'css' ? validateCss(value) : validateMarkup(value);

const editorTabs: Array<{ id: EditorTab; label: string }> = [
  ...themeAreaIds.map((id) => ({ id, label: themeAreaLabels[id] })),
  { id: 'css', label: 'Custom CSS & Code' },
];

const isEditorTab = (value: string | null): value is EditorTab => editorTabs.some((tab) => tab.id === value);

const isTyping = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)));
};

function IssueList({ issues, title }: { issues: Array<CodeIssue & { where?: string }>; title?: string }) {
  if (!issues.length) return null;
  const errors = issues.filter((issue) => issue.level === 'error').length;
  return (
    <div className={errors ? styles.issuesError : styles.issuesWarning} role={errors ? 'alert' : 'status'}>
      {title && <strong>{title}</strong>}
      <ul>
        {issues.map((issue, index) => (
          <li key={index}>
            <span className={issue.level === 'error' ? styles.levelError : styles.levelWarning}>{issue.level === 'error' ? 'Error' : 'Warning'}</span>
            {issue.where && <> {issue.where}</>}{issue.line ? ` (line ${issue.line})` : ''}: {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The area's layout as JSON. Valid edits apply as you type; invalid JSON blocks Save until fixed. */
function LayoutJsonEditor({ area, layout, dispatch, onValidity }: {
  area: ThemeAreaId;
  layout: AnyAreaLayout;
  dispatch: Dispatch<EditorAction>;
  onValidity: (area: ThemeAreaId, error: string | null) => void;
}) {
  const serialized = useMemo(() => JSON.stringify(layout, null, 2), [layout]);
  const [text, setText] = useState(serialized);
  const [issues, setIssues] = useState<CodeIssue[]>([]);
  const applied = useRef(serialized);

  // Undo, Reset or the visual editor changed the layout: show that instead of the stale text.
  useEffect(() => {
    if (serialized !== applied.current) {
      applied.current = serialized;
      setText(serialized);
      setIssues([]);
      onValidity(area, null);
    }
  }, [area, onValidity, serialized]);

  useEffect(() => () => onValidity(area, null), [area, onValidity]);

  const change = (value: string) => {
    setText(value);
    const result = validateLayoutJson(area, value);
    setIssues(result.issues);
    if (!result.layout) {
      onValidity(area, result.issues[0]?.message || 'Invalid JSON.');
      return;
    }
    onValidity(area, null);
    applied.current = JSON.stringify(result.layout, null, 2);
    dispatch({ type: 'replaceArea', area, layout: result.layout });
  };

  return (
    <details className={styles.jsonDetails} open={area === 'index'}>
      <summary>Layout JSON</summary>
      <CodeEditor id={`layout-json-${area}`} label={`${themeAreaLabels[area]} layout configuration`} language="json" value={text} onChange={change}
        issues={issues} minRows={16}
        help="The same layout the visual editor edits. Valid changes apply as you type; unknown blocks and settings are dropped and listed below." />
      <IssueList issues={issues} />
    </details>
  );
}

export default function ThemeEditor() {
  const [state, dispatch] = useReducer(themeEditorReducer, defaultTheme(), initialEditorState);
  const { draft, saved } = state;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saveIssues, setSaveIssues] = useState<Array<CodeIssue & { where: string; tab: EditorTab }>>([]);
  const [checked, setChecked] = useState<Partial<Record<EditorTab, CodeIssue[] | null>>>({});
  const [tab, setTab] = useState<EditorTab>(() => {
    const requested = new URLSearchParams(window.location.search).get('area');
    return isEditorTab(requested) ? requested : 'header';
  });
  const [modes, setModes] = useState<Record<ThemeAreaId, 'visual' | 'code'>>({
    header: 'visual', footer: 'visual', sidebar: 'visual', comments: 'visual', index: 'visual',
  });
  const [jsonErrors, setJsonErrors] = useState<Partial<Record<ThemeAreaId, string>>>({});
  const [menus, setMenus] = useState<MenuOption[]>([]);
  const [moderation, setModeration] = useState<{ saved: boolean; value: boolean } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const dirty = themeContent(draft) !== themeContent(saved) || Boolean(moderation && moderation.saved !== moderation.value);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setMigrationMissing(false);
    try {
      const [theme, menuResult, siteSettings] = await Promise.all([
        fetchTheme(),
        getSupabaseClient().from('menus').select('id,name').order('name'),
        loadSettings().catch(() => null),
      ]);
      dispatch({ type: 'load', theme });
      setMenus((menuResult.data || []) as MenuOption[]);
      setModeration(siteSettings ? { saved: siteSettings.comment_moderation, value: siteSettings.comment_moderation } : null);
    } catch (loadFailure: unknown) {
      if (loadFailure instanceof ThemeMigrationMissingError) setMigrationMissing(true);
      else setLoadError(describeDbError(loadFailure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Keep &area= in the URL next to section and tab.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('area', tab);
    window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
  }, [tab]);

  useEffect(() => {
    if (!dirty) return undefined;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  // The preview tab listens for this key and re-renders on every change.
  useEffect(() => {
    if (!previewing) return undefined;
    const timer = window.setTimeout(() => writePreviewDraft(draft), 250);
    return () => window.clearTimeout(timer);
  }, [draft, previewing]);

  const onJsonValidity = useCallback((area: ThemeAreaId, message: string | null) => {
    setJsonErrors((current) => {
      if ((current[area] || null) === message) return current;
      const next = { ...current };
      if (message) next[area] = message; else delete next[area];
      return next;
    });
  }, []);

  /** Every problem in the draft, for Save. */
  const validateAll = (theme: ThemeSettings) => {
    const found: Array<CodeIssue & { where: string; tab: EditorTab }> = [];
    editorTabs.forEach(({ id }) => {
      tabCodeFields[id].forEach((field) => {
        validateField(codeFields[field], theme[field]).forEach((issue) => found.push({ ...issue, where: codeFields[field].label, tab: id }));
      });
    });
    themeAreaIds.forEach((area) => {
      theme.layout[area].containers.forEach((container) => container.blocks.forEach((block) => {
        if (block.type !== 'custom-html') return;
        validateMarkup(String(block.settings.html || '')).forEach((issue) =>
          found.push({ ...issue, where: `${themeAreaLabels[area]} › Custom HTML box${block.settings.title ? ` “${String(block.settings.title)}”` : ''}`, tab: area }));
      }));
      if (jsonErrors[area]) found.push({ level: 'error', message: jsonErrors[area]!, where: `${themeAreaLabels[area]} › Layout JSON`, tab: area });
    });
    return found;
  };

  const save = async () => {
    if (saving || loading) return;
    setError('');
    setSuccess('');
    const found = validateAll(draft);
    setSaveIssues(found);
    if (hasErrors(found)) {
      const count = found.filter((issue) => issue.level === 'error').length;
      setError(`Nothing was saved: fix the ${count} error${count === 1 ? '' : 's'} listed below first.`);
      return;
    }
    setSaving(true);
    try {
      const stored = await saveTheme(draft);
      dispatch({ type: 'saved', theme: stored });
      if (previewing) writePreviewDraft(stored); else clearPreviewDraft();
      let message = 'Theme saved. Visitors see it on their next page load.';
      if (moderation && moderation.value !== moderation.saved) {
        try {
          await saveSettings({ comment_moderation: moderation.value });
          setModeration({ saved: moderation.value, value: moderation.value });
        } catch (settingsError: unknown) {
          setError(`The theme was saved, but "Hold new comments for approval" was not: ${describeDbError(settingsError)}`);
          message = '';
        }
      }
      setSuccess(message);
      setSaveIssues(found.filter((issue) => issue.level === 'warning'));
    } catch (saveError: unknown) {
      if (saveError instanceof ThemeMigrationMissingError) setMigrationMissing(true);
      setError(describeDbError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveRef.current();
      } else if (mod && event.key.toLowerCase() === 'z' && !isTyping(event.target)) {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (mod && event.key.toLowerCase() === 'y' && !isTyping(event.target)) {
        event.preventDefault();
        dispatch({ type: 'redo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const reset = () => {
    const parts = tab === 'css'
      ? 'Custom CSS'
      : [`the ${themeAreaLabels[tab]} layout`, ...tabCodeFields[tab].map((field) => codeFields[field].label)].join(', ');
    if (!window.confirm(`Reset ${parts} to the theme default? You can undo this, and nothing changes on the site until you save.`)) return;
    dispatch({ type: 'resetTab', tab });
    setChecked((current) => ({ ...current, [tab]: null }));
  };

  const openPreview = () => {
    writePreviewDraft(draft);
    setPreviewing(true);
    // A named window: clicking again reuses the same tab instead of opening another.
    const opened = window.open('/?theme_preview=1', 'rwp-theme-preview');
    if (!opened) setError('The preview tab was blocked by the browser. Allow pop-ups for this site, then click Live preview again.');
  };

  const runValidation = () => {
    const found: CodeIssue[] = [];
    tabCodeFields[tab].forEach((field) => {
      validateField(codeFields[field], draft[field]).forEach((issue) => found.push({ ...issue, message: `${codeFields[field].label}: ${issue.message}` }));
    });
    if (tab !== 'css' && jsonErrors[tab]) found.push({ level: 'error', message: `Layout JSON: ${jsonErrors[tab]}` });
    setChecked((current) => ({ ...current, [tab]: found }));
  };

  const area: ThemeAreaId | null = tab === 'css' ? null : tab;
  const mode = area ? modes[area] : 'code';
  const tabResult = checked[tab];

  const renderCodeField = (field: ThemeCodeField) => {
    const definition = codeFields[field];
    return (
      <CodeEditor key={field} id={`theme-${field}`} label={definition.label} language={definition.language} value={draft[field]}
        help={definition.help} placeholder={definition.placeholder} minRows={field === 'custom_css' ? 24 : 12}
        issues={tabResult ? validateField(definition, draft[field]) : []}
        onChange={(value) => {
          dispatch({ type: 'setCode', field, value });
          if (tabResult) setChecked((current) => ({ ...current, [tab]: null }));
        }} />
    );
  };

  if (loading) return <div className={settingsStyles.loading} role="status">Loading the theme…</div>;

  return (
    <section className={settingsStyles.container} aria-labelledby="theme-editor-heading">
      <div className={settingsStyles.pageIntro}>
        <h2 id="theme-editor-heading">Theme Editor</h2>
        <p>
          Arrange the header, footer, sidebar, comments and home page with blocks, or write code for them.
          Active theme: <code>{draft.active_theme}</code>.
        </p>
      </div>

      <div className={styles.stickyBar}>
        <span className={dirty ? styles.statusDirty : styles.statusClean} role="status">
          {saving ? 'Saving…' : dirty ? 'Unsaved changes' : saved.updated_at ? `Saved ${new Date(saved.updated_at).toLocaleString()}` : 'Theme default'}
        </span>
        <div className={styles.barActions}>
          <button type="button" className={settingsStyles.secondaryButton} onClick={() => dispatch({ type: 'undo' })} disabled={!state.past.length} title="Ctrl+Z">Undo</button>
          <button type="button" className={settingsStyles.secondaryButton} onClick={() => dispatch({ type: 'redo' })} disabled={!state.future.length} title="Ctrl+Shift+Z">Redo</button>
          <button type="button" className={settingsStyles.secondaryButton} onClick={reset}>
            Reset {tab === 'css' ? 'Custom CSS' : themeAreaLabels[tab]} to theme default
          </button>
          <button type="button" className={settingsStyles.secondaryButton} onClick={openPreview}
            title="Opens the site in another tab with your unsaved changes, updating as you edit. Only you see it.">
            Live preview{previewing ? ' ↗' : ''}
          </button>
          <button type="button" className={settingsStyles.saveButton} onClick={() => void save()} disabled={saving || migrationMissing || !dirty} title="Ctrl+S">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {migrationMissing && (
        <div className={settingsStyles.error} role="alert">
          <span>
            The <code>theme_settings</code> table does not exist yet, so the theme cannot be saved. Open Supabase → SQL Editor, paste all
            of <code>{themeMigration}</code>, click Run (it is safe to run again), then reload this page. Until then the site uses the default layout.
          </span>
          <button type="button" onClick={() => void load()}>Reload</button>
        </div>
      )}
      {loadError && (
        <div className={settingsStyles.error} role="alert">
          <span>The theme could not be loaded: {loadError}</span>
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      )}
      {error && <div className={settingsStyles.error} role="alert"><span>{error}</span><button type="button" onClick={() => setError('')}>Dismiss</button></div>}
      {success && <div className={settingsStyles.success} role="status"><span>{success}</span></div>}
      {saveIssues.length > 0 && (
        <div className={styles.saveIssues}>
          <IssueList issues={saveIssues} title={hasErrors(saveIssues) ? 'Problems found' : 'Saved with warnings'} />
          <div className={styles.issueLinks}>
            {[...new Set(saveIssues.map((issue) => issue.tab))].map((issueTab) => (
              <button key={issueTab} type="button" className={styles.smallButton} onClick={() => {
                setTab(issueTab);
                if (issueTab !== 'css') setModes((current) => ({ ...current, [issueTab]: 'code' }));
              }}>
                Open {issueTab === 'css' ? 'Custom CSS & Code' : themeAreaLabels[issueTab]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={settingsStyles.tabs} role="tablist" aria-label="Theme areas">
        {editorTabs.map(({ id, label }) => (
          <button key={id} type="button" role="tab" id={`theme-tab-${id}`} aria-selected={tab === id} aria-controls="theme-tab-panel"
            className={tab === id ? settingsStyles.tabActive : settingsStyles.tab} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div id="theme-tab-panel" role="tabpanel" aria-labelledby={`theme-tab-${tab}`}>
        {area && (
          <div className={styles.modeRow}>
            <div className={styles.modeSwitch} role="radiogroup" aria-label="Edit mode">
              {(['visual', 'code'] as const).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={mode === value}
                  className={mode === value ? styles.modeActive : styles.mode}
                  onClick={() => setModes((current) => ({ ...current, [area]: value }))}>
                  {value === 'visual' ? 'Visual builder' : 'Code'}
                </button>
              ))}
            </div>
            {jsonErrors[area] && mode === 'visual' && (
              <span className={styles.levelError}>The layout JSON in Code mode is invalid and blocks saving.</span>
            )}
          </div>
        )}

        {area && mode === 'visual' && (
          <>
            <AreaOptions area={area} layout={draft.layout} dispatch={dispatch}
              moderation={moderation ? moderation.value : null}
              onModerationChange={(value) => setModeration((current) => (current ? { ...current, value } : current))} />
            <VisualBuilder key={area} area={area} layout={draft.layout[area]} menus={menus} dispatch={dispatch} />
          </>
        )}

        {mode === 'code' && (
          <div className={styles.codePanel}>
            {tab === 'css' && (
              <p className={styles.help}>
                The <code>&lt;head&gt;</code> code and scripts are on the Header and Footer tabs (Code mode); comment styles are on the Comments tab.
              </p>
            )}
            {tabCodeFields[tab].map(renderCodeField)}
            {area && <LayoutJsonEditor key={area} area={area} layout={draft.layout[area]} dispatch={dispatch} onValidity={onJsonValidity} />}
            <div className={styles.validateRow}>
              <button type="button" className={settingsStyles.secondaryButton} onClick={runValidation}>Validate code</button>
              {tabResult && tabResult.length === 0 && <span className={styles.valid} role="status">No problems found.</span>}
            </div>
            {tabResult && <IssueList issues={tabResult} />}
          </div>
        )}
      </div>
    </section>
  );
}
