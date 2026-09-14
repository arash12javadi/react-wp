import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Eye, History, LayoutTemplate, Monitor, Redo2, Smartphone, Tablet, Undo2 } from 'lucide-react';
import { rwp } from '../../../src/lib/rwp';
import { saveBuilderPage, SaveConflictError } from '../lib/api';
import { autosaveKey, previewKey } from '../lib/keys';
import type { Device } from '../lib/types';
import { isDirty, useEditor, useStore } from './store';
import styles from './editor.module.css';

const deviceButtons: Array<{ id: Device; label: string; icon: typeof Monitor }> = [
  { id: 'desktop', label: 'Desktop', icon: Monitor },
  { id: 'tablet', label: 'Tablet (768px)', icon: Tablet },
  { id: 'mobile', label: 'Mobile (375px)', icon: Smartphone },
];

interface TopBarProps {
  registerSave: (save: () => void) => void;
  onOpenRevisions: () => void;
  onOpenTemplates: () => void;
  onSavePageTemplate: () => void;
}

export default function TopBar({ registerSave, onOpenRevisions, onOpenTemplates, onSavePageTemplate }: TopBarProps) {
  const store = useStore();
  const { actions } = store;
  const title = useEditor((state) => state.title);
  const status = useEditor((state) => state.status);
  const savedStatus = useEditor((state) => state.savedStatus);
  const device = useEditor((state) => state.device);
  const canUndo = useEditor((state) => state.past.length > 0);
  const canRedo = useEditor((state) => state.future.length > 0);
  const dirty = useEditor(isDirty);
  const canPublish = useEditor((state) => state.canPublish);
  const page = useEditor((state) => state.page);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success' | 'warning'; text: string; conflict?: boolean } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const save = async (nextStatus?: string, force = false) => {
    const state = store.getState();
    const targetStatus = nextStatus || state.status;
    if (targetStatus === 'published' && !state.canPublish) {
      setMessage({ kind: 'error', text: 'Your role cannot publish. Save as a draft and ask an Author or Editor to publish it.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    setMenuOpen(false);
    try {
      const result = await saveBuilderPage({ page: state.page, doc: state.doc, title: state.title, status: targetStatus, layout: state.layout, force });
      store.setState((current) => ({
        page: result.page,
        status: targetStatus,
        // Edits made while the request was in flight stay unsaved.
        savedDoc: state.doc,
        savedTitle: result.page.title,
        title: current.title === state.title ? result.page.title : current.title,
        savedStatus: targetStatus,
        savedLayout: state.layout,
      }));
      try { localStorage.removeItem(autosaveKey(state.page.id)); } catch { /* storage unavailable */ }
      rwp.actions.do(result.page.is_post ? 'rwp_post_updated' : 'rwp_page_updated', result.page);
      setMessage(result.warning
        ? { kind: 'warning', text: result.warning }
        : { kind: 'success', text: targetStatus === 'published' ? (state.savedStatus === 'published' ? 'Updated.' : 'Published.') : 'Draft saved.' });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Saving failed.', conflict: error instanceof SaveConflictError });
    } finally {
      setSaving(false);
    }
  };

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => { registerSave(() => { void saveRef.current(); }); }, [registerSave]);

  useEffect(() => {
    if (message?.kind !== 'success') return undefined;
    const timer = window.setTimeout(() => setMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const preview = () => {
    const state = store.getState();
    try {
      localStorage.setItem(previewKey(state.page.id), JSON.stringify({ doc: state.doc, title: state.title, at: Date.now() }));
    } catch {
      setMessage({ kind: 'error', text: 'Preview needs browser storage, which is blocked or full in this browser.' });
      return;
    }
    window.open(`/builder/${state.page.id}/preview`, `rwpb-preview-${state.page.id}`);
  };

  const primaryLabel = savedStatus === 'published' ? 'Update' : canPublish ? 'Publish' : 'Save draft';

  return (
    <header className={styles.topbar}>
      <div className={styles.topbarGroup}>
        <a className={styles.iconButton} href={`/admin?section=rwp-page-builder`} title="Back to the dashboard" aria-label="Back to the dashboard"
          onClick={(event) => { if (isDirty(store.getState()) && !window.confirm('Leave the builder? Unsaved changes are kept in this browser and offered next time.')) event.preventDefault(); }}>
          <ArrowLeft size={18} />
        </a>
        <input className={styles.titleInput} value={title} aria-label="Page title" onChange={(event) => store.setState({ title: event.target.value })} />
        <span className={status === 'published' ? styles.badgePublished : styles.badgeDraft}>{status === 'published' ? 'Published' : 'Draft'}</span>
        {dirty && <span className={styles.unsaved} title="You have unsaved changes">●</span>}
      </div>

      <div className={styles.deviceSwitch} role="radiogroup" aria-label="Preview device">
        {deviceButtons.map(({ id, label, icon: DeviceIcon }) => (
          <button key={id} type="button" role="radio" aria-checked={device === id} title={label} aria-label={label}
            className={device === id ? styles.deviceActive : styles.device} onClick={() => actions.setDevice(id)}>
            <DeviceIcon size={17} />
          </button>
        ))}
      </div>

      <div className={styles.topbarGroup}>
        {message && (
          <span className={message.kind === 'error' ? styles.toastError : message.kind === 'warning' ? styles.toastWarning : styles.toastSuccess} role={message.kind === 'error' ? 'alert' : 'status'}>
            {message.text}
            {message.conflict && <button type="button" onClick={() => void save(undefined, true)}>Save anyway</button>}
            {message.kind !== 'success' && <button type="button" aria-label="Dismiss" onClick={() => setMessage(null)}>×</button>}
          </span>
        )}
        <button type="button" className={styles.iconButton} title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={actions.undo}><Undo2 size={18} /></button>
        <button type="button" className={styles.iconButton} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo} onClick={actions.redo}><Redo2 size={18} /></button>
        <button type="button" className={styles.iconButton} title="Templates" aria-label="Templates" onClick={onOpenTemplates}><LayoutTemplate size={18} /></button>
        <button type="button" className={styles.iconButton} title="Revisions" aria-label="Revisions" onClick={onOpenRevisions}><History size={18} /></button>
        <button type="button" className={styles.iconButton} title="Preview unsaved changes in a new tab" aria-label="Preview" onClick={preview}><Eye size={18} /></button>
        <div className={styles.saveGroup} ref={menuRef}>
          <button type="button" className={styles.saveButton} disabled={saving} onClick={() => void save(canPublish ? 'published' : 'draft')}>
            {saving ? 'Saving…' : primaryLabel}
          </button>
          <button type="button" className={styles.saveCaret} aria-label="More save options" aria-expanded={menuOpen} disabled={saving} onClick={() => setMenuOpen((open) => !open)}>
            <ChevronDown size={16} />
          </button>
          {menuOpen && (
            <div className={styles.menu} role="menu">
              <button type="button" role="menuitem" onClick={() => void save('draft')}>{savedStatus === 'published' ? 'Switch to draft (unpublish)' : 'Save draft'}</button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onSavePageTemplate(); }}>Save page as template</button>
              {page.status === 'published' && <a role="menuitem" href={`/${page.slug}`} target="_blank" rel="noreferrer">View live page</a>}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
