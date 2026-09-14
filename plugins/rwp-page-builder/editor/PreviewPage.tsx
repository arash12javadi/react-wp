import { useEffect, useState } from 'react';
import type { RwpRouteProps } from '../../../src/lib/plugin-api';
import { loadBuilderPage } from '../lib/api';
import type { BuilderDocument, BuilderPage } from '../lib/types';
import BuilderRenderer, { parseDocument } from '../render/BuilderRenderer';
import { previewKey } from '../lib/keys';

/**
 * /builder/:id/preview — the editor's unsaved document, rendered exactly as visitors would see
 * it (media queries included, so resize the window to check breakpoints). The document comes
 * from localStorage, written by the Preview button, so nothing is saved to the database.
 */
export default function PreviewPage({ params }: RwpRouteProps) {
  const pageId = Number(params.id);
  const [state, setState] = useState<{ page: BuilderPage; doc: BuilderDocument } | { error: string } | null>(null);

  useEffect(() => {
    const read = async () => {
      let stored: { doc: BuilderDocument; title: string } | null = null;
      try {
        stored = JSON.parse(localStorage.getItem(previewKey(pageId)) || 'null');
      } catch {
        stored = null;
      }
      const page = await loadBuilderPage(pageId);
      const doc = parseDocument(stored?.doc) || parseDocument(page.builder_data);
      if (!doc) throw new Error('There is nothing to preview yet. Open the page in the builder and press Preview.');
      setState({ page: { ...page, title: stored?.title || page.title }, doc });
    };
    read().catch((error: unknown) => setState({ error: error instanceof Error ? error.message : 'The preview could not load.' }));
    // The editor rewrites the stored document on each Preview click; follow it without a reload.
    const onStorage = (event: StorageEvent) => { if (event.key === previewKey(pageId)) void read().catch(() => {}); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [pageId]);

  if (!state) return <p style={{ padding: 40 }}>Loading preview…</p>;
  if ('error' in state) return <p role="alert" style={{ padding: 40 }}>{state.error}</p>;
  return (
    <>
      <div style={{ position: 'sticky', top: 0, zIndex: 100, padding: '8px 16px', background: '#fef3c7', color: '#92400e', font: '600 13px system-ui', textAlign: 'center' }}>
        Preview of unsaved changes to “{state.page.title}”. Visitors still see the last published version.
      </div>
      <BuilderRenderer doc={state.doc} page={state.page} />
    </>
  );
}
