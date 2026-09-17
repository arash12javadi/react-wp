import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';
import { fetchProfile } from '../../../src/lib/profiles';
import { canAccessAdmin, hasCapability, type UserRole } from '../../../src/lib/roles';
import type { RwpRouteProps } from '../../../src/lib/plugin-api';
import { loadBuilderPage } from '../lib/api';
import { autosaveKey } from '../lib/keys';
import { emptyDocument, type BuilderDocument, type BuilderPage } from '../lib/types';
import { parseDocument } from '../render/BuilderRenderer';
import PageBuilderLayout from './PageBuilderLayout';
import { createEditorStore, EditorStoreContext, seoFieldsFromPage, type EditorState } from './store';
import '../render/widgets';
import styles from './editor.module.css';

export interface Autosave { doc: BuilderDocument; title: string; savedAt: number; baseUpdatedAt: string }

export function readAutosave(pageId: number): Autosave | null {
  try {
    const raw = localStorage.getItem(autosaveKey(pageId));
    return raw ? JSON.parse(raw) as Autosave : null;
  } catch {
    return null;
  }
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; signIn?: boolean }
  | { status: 'ready'; page: BuilderPage; role: UserRole; autosave: Autosave | null };

function initialState(page: BuilderPage, role: UserRole, savedDoc: BuilderDocument, doc: BuilderDocument, title: string): EditorState {
  const seo = seoFieldsFromPage(page);
  return {
    // A page opened in the builder for the first time switches to full width, as builder layouts expect.
    page, doc, title, status: page.status === 'published' ? 'published' : 'draft', layout: page.is_builder_enabled ? page.layout || 'full' : 'full',
    savedDoc, savedTitle: page.title, savedStatus: page.status === 'published' ? 'published' : 'draft',
    savedLayout: page.is_builder_enabled ? page.layout || 'full' : page.layout || 'boxed',
    // One object for both, so the page starts clean; editing replaces seo and makes it dirty.
    seo, savedSeo: seo,
    selectedId: null, hoveredPath: [], device: 'desktop', panel: 'widgets', inspectorTab: 'content',
    past: [], future: [], coalesce: null, drag: null, dropTarget: null, clipboard: null,
    canPublish: hasCapability(role, 'publish_posts'),
    canManageOptions: hasCapability(role, 'manage_options'),
    aiSectionId: null,
  };
}

/** Public route /builder/:id. Full screen, outside the admin layout, like Elementor. */
export default function PageBuilderApp({ params }: RwpRouteProps) {
  const pageId = Number(params.id);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [restore, setRestore] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!Number.isInteger(pageId) || pageId <= 0) throw new Error(`"${params.id}" is not a page id.`);
      const { data } = await getSupabaseClient().auth.getSession();
      const user = data.session?.user;
      if (!user) {
        if (active) setState({ status: 'error', message: 'Sign in to use the page builder.', signIn: true });
        return;
      }
      const profile = await fetchProfile(user.id);
      const role = profile?.role || 'subscriber';
      if (!canAccessAdmin(role)) throw new Error('Your role cannot edit content. The page builder needs Contributor or above.');
      const page = await loadBuilderPage(pageId);
      const autosave = readAutosave(pageId);
      // Only offer to restore work that is newer than, and different from, what is saved.
      const useful = autosave && autosave.baseUpdatedAt === page.updated_at
        && JSON.stringify(autosave.doc) !== JSON.stringify(parseDocument(page.builder_data) || emptyDocument())
        ? autosave : null;
      if (active) setState({ status: 'ready', page, role, autosave: useful });
    };
    load().catch((error: unknown) => active && setState({ status: 'error', message: error instanceof Error ? error.message : 'The page builder could not load.' }));
    return () => { active = false; };
  }, [pageId, params.id]);

  const ready = state.status === 'ready' ? state : null;
  const needsDecision = Boolean(ready?.autosave) && restore === null;

  const store = useMemo(() => {
    if (!ready || needsDecision) return null;
    const saved = parseDocument(ready.page.builder_data) || emptyDocument();
    const useAutosave = restore && ready.autosave;
    return createEditorStore(initialState(ready.page, ready.role, saved, useAutosave ? ready.autosave!.doc : saved, useAutosave ? ready.autosave!.title : ready.page.title));
  }, [ready, needsDecision, restore]);

  useEffect(() => {
    document.title = ready ? `Page builder: ${ready.page.title}` : 'Page builder';
  }, [ready]);

  if (state.status === 'loading') return <div className={styles.fullscreenMessage} role="status">Loading the page builder…</div>;
  if (state.status === 'error') {
    return (
      <div className={styles.fullscreenMessage} role="alert">
        <div className={styles.messageCard}>
          <h1>The page builder could not open</h1>
          <p>{state.message}</p>
          <p>
            {state.signIn
              ? <a className={styles.primaryButton} href={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}>Sign in</a>
              : <a className={styles.secondaryButton} href="/admin">Back to the dashboard</a>}
          </p>
        </div>
      </div>
    );
  }
  if (needsDecision && ready?.autosave) {
    return (
      <div className={styles.fullscreenMessage}>
        <div className={styles.messageCard}>
          <h1>Restore unsaved changes?</h1>
          <p>This browser has changes to “{ready.page.title}” from {new Date(ready.autosave.savedAt).toLocaleString()} that were never saved.</p>
          <p className={styles.messageActions}>
            <button type="button" className={styles.primaryButton} onClick={() => setRestore(true)}>Restore my changes</button>
            <button type="button" className={styles.secondaryButton} onClick={() => {
              try { localStorage.removeItem(autosaveKey(pageId)); } catch { /* storage unavailable */ }
              setRestore(false);
            }}>Discard them</button>
          </p>
        </div>
      </div>
    );
  }
  if (!store) return null;
  return (
    <EditorStoreContext.Provider value={store}>
      <PageBuilderLayout />
    </EditorStoreContext.Provider>
  );
}
