import { useEffect, useState } from 'react';
import { listRevisions, loadRevision, type RevisionSummary } from '../lib/api';
import { findNode, walkNodes } from '../lib/tree';
import type { BuilderDocument } from '../lib/types';
import { parseDocument } from '../render/BuilderRenderer';
import Modal from './Modal';
import { useEditor, useStore } from './store';
import styles from './editor.module.css';

const countNodes = (doc: BuilderDocument) => {
  let widgets = 0;
  walkNodes(doc.content, (node) => { if (node.kind === 'widget') widgets += 1; });
  return { sections: doc.content.length, widgets };
};

export default function RevisionsModal({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const { actions } = store;
  const pageId = useEditor((state) => state.page.id);
  const [revisions, setRevisions] = useState<RevisionSummary[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ id: number; doc: BuilderDocument } | null>(null);

  useEffect(() => {
    listRevisions(pageId).then(setRevisions).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load revisions.'));
  }, [pageId]);

  const inspect = async (id: number) => {
    setBusy(id);
    setError('');
    try {
      const doc = parseDocument(await loadRevision(id));
      if (!doc) throw new Error('That revision does not contain a valid layout.');
      setPreview({ id, doc });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the revision.');
    } finally {
      setBusy(null);
    }
  };

  const restore = () => {
    if (!preview) return;
    // Revisions never contain form recipients (they are stored privately), so carry the current ones over.
    const current = store.getState().doc;
    const restored = JSON.parse(JSON.stringify(preview.doc)) as BuilderDocument;
    walkNodes(restored.content, (node) => {
      const existing = node.type === 'form' ? findNode(current, node.id) : null;
      if (existing) Object.entries(existing.settings).filter(([key]) => key.startsWith('private_')).forEach(([key, value]) => { node.settings[key] = value; });
    });
    // Restoring is an ordinary, undoable edit. Nothing is written until the page is saved.
    actions.replaceDocument(restored);
    onClose();
  };

  return (
    <Modal title="Revisions" onClose={onClose}>
      <p className={styles.hint}>Every save keeps a revision (the latest 30). Restoring loads it into the editor as an undoable change; save to make it live.</p>
      {error && <p className={styles.errorText} role="alert">{error}</p>}
      {!revisions && !error && <p className={styles.hint}>Loading revisions…</p>}
      {revisions && revisions.length === 0 && <p className={styles.hint}>No revisions yet. They appear after the first save from the builder.</p>}
      {revisions && revisions.length > 0 && (
        <ol className={styles.revisionList}>
          {revisions.map((revision, index) => {
            const summary = preview?.id === revision.id ? countNodes(preview.doc) : null;
            return (
              <li key={revision.id} className={preview?.id === revision.id ? styles.revisionActive : undefined}>
                <div>
                  <strong>{new Date(revision.created_at).toLocaleString()}</strong>
                  <span>{revision.author}{index === 0 ? ' · latest save' : ''}</span>
                  {summary && <span>{summary.sections} sections, {summary.widgets} widgets</span>}
                </div>
                {preview?.id === revision.id
                  ? <button type="button" className={styles.primaryButton} onClick={restore}>Restore this revision</button>
                  : <button type="button" className={styles.secondaryButton} disabled={busy !== null} onClick={() => void inspect(revision.id)}>{busy === revision.id ? 'Loading…' : 'Select'}</button>}
              </li>
            );
          })}
        </ol>
      )}
    </Modal>
  );
}
