import { useCallback, useEffect, useRef, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragStartEvent } from '@dnd-kit/core';
import { Layers, LayoutGrid, Palette, SearchCheck, Settings2 } from 'lucide-react';
import { findNode } from '../lib/tree';
import { autosaveKey } from '../lib/keys';
import Canvas from './Canvas';
import { computeDropTarget } from './dnd';
import GlobalStylesPanel from './GlobalStylesPanel';
import InspectorPanel from './InspectorPanel';
import Navigator from './Navigator';
import PageSettingsPanel from './PageSettingsPanel';
import RevisionsModal from './RevisionsModal';
import SectionAiModal from './ai/SectionAiModal';
import SeoPanel from './seo/SeoPanel';
import TemplatesModal, { type TemplatesModalMode } from './TemplatesModal';
import TopBar from './TopBar';
import WidgetPanel from './WidgetPanel';
import { isDirty, useEditor, useStore, type DragItem, type SidePanel } from './store';
import styles from './editor.module.css';

const panelTabs: Array<{ id: SidePanel; label: string; icon: typeof Layers }> = [
  { id: 'widgets', label: 'Widgets', icon: LayoutGrid },
  { id: 'navigator', label: 'Navigator', icon: Layers },
  { id: 'globals', label: 'Site styles', icon: Palette },
  { id: 'page', label: 'Page settings', icon: Settings2 },
  { id: 'seo', label: 'SEO', icon: SearchCheck },
];

const isTyping = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  // Inside a dialog (templates, media library), Delete and Ctrl+V belong to the dialog, not the canvas.
  return Boolean(element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.closest?.('[role="dialog"]')));
};

export default function PageBuilderLayout() {
  const store = useStore();
  const { actions } = store;
  const panel = useEditor((state) => state.panel);
  const selectedId = useEditor((state) => state.selectedId);
  const drag = useEditor((state) => state.drag);
  const dropTarget = useEditor((state) => state.dropTarget);
  const aiSectionId = useEditor((state) => state.aiSectionId);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplatesModalMode | null>(null);
  const saveRef = useRef<() => void>(() => {});
  const pointer = useRef({ x: 0, y: 0 });
  const frame = useRef(0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Keyboard shortcuts ----------------------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveRef.current();
        return;
      }
      if (isTyping(event.target)) return;
      const { selectedId: selected } = store.getState();
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) actions.redo(); else actions.undo();
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        actions.redo();
      } else if (selected && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        actions.remove(selected);
      } else if (selected && mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        actions.duplicate(selected);
      } else if (selected && mod && event.key.toLowerCase() === 'c') {
        actions.copy(selected);
      } else if (mod && event.key.toLowerCase() === 'v') {
        actions.paste(selected);
      } else if (event.key === 'Escape') {
        actions.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, store]);

  // Local autosave and leave warning --------------------------------------------------------------
  useEffect(() => {
    let timer = 0;
    let lastDoc = store.getState().doc;
    let lastTitle = store.getState().title;
    const unsubscribe = store.subscribe(() => {
      const state = store.getState();
      if (state.doc === lastDoc && state.title === lastTitle) return;
      lastDoc = state.doc;
      lastTitle = state.title;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const current = store.getState();
        try {
          if (isDirty(current)) {
            localStorage.setItem(autosaveKey(current.page.id), JSON.stringify({ doc: current.doc, title: current.title, savedAt: Date.now(), baseUpdatedAt: current.page.updated_at }));
          } else {
            localStorage.removeItem(autosaveKey(current.page.id));
          }
        } catch {
          // Storage full or blocked: autosave is a convenience, saving still works.
        }
      }, 1200);
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty(store.getState())) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [store]);

  // Drag and drop -------------------------------------------------------------------------------
  const trackPointer = useCallback((event: PointerEvent) => {
    pointer.current = { x: event.clientX, y: event.clientY };
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const state = store.getState();
      if (!state.drag) return;
      const target = computeDropTarget(state.doc, state.drag, pointer.current.x, pointer.current.y);
      const previous = state.dropTarget;
      if (target?.parentId !== previous?.parentId || target?.index !== previous?.index || target?.line.y !== previous?.line.y || target?.line.x !== previous?.line.x) {
        store.setState({ dropTarget: target });
      }
    });
  }, [store]);

  // Scroll the canvas while dragging near its top or bottom edge.
  useEffect(() => {
    if (!drag) return undefined;
    const timer = window.setInterval(() => {
      const scroller = document.querySelector<HTMLElement>('[data-rwpb-scroller]');
      if (!scroller) return;
      const rect = scroller.getBoundingClientRect();
      const { x, y } = pointer.current;
      if (x < rect.left || x > rect.right) return;
      if (y < rect.top + 60) scroller.scrollTop -= 14;
      else if (y > rect.bottom - 60) scroller.scrollTop += 14;
    }, 16);
    return () => window.clearInterval(timer);
  }, [drag]);

  const endDrag = () => {
    window.removeEventListener('pointermove', trackPointer);
    cancelAnimationFrame(frame.current);
  };

  const onDragStart = (event: DragStartEvent) => {
    const item = event.active.data.current as DragItem | undefined;
    if (!item) return;
    const start = event.activatorEvent as PointerEvent;
    pointer.current = { x: start.clientX, y: start.clientY };
    store.setState({ drag: item, dropTarget: null });
    window.addEventListener('pointermove', trackPointer);
  };

  const onDragEnd = () => {
    endDrag();
    const { drag: item, dropTarget: target } = store.getState();
    store.setState({ drag: null, dropTarget: null });
    if (item && target) actions.insert(item, target);
  };

  const onDragCancel = () => {
    endDrag();
    store.setState({ drag: null, dropTarget: null });
  };

  const selectedExists = useEditor((state) => Boolean(state.selectedId && findNode(state.doc, state.selectedId)));

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel} autoScroll={false}>
      <div className={styles.shell} data-rwpb-shell>
        <TopBar
          registerSave={(save) => { saveRef.current = save; }}
          onOpenRevisions={() => setRevisionsOpen(true)}
          onOpenTemplates={() => setTemplates({ kind: 'insert' })}
          onSavePageTemplate={() => setTemplates({ kind: 'save-page' })}
        />
        <div className={styles.workspace}>
          <aside className={styles.sidebar} aria-label="Builder panels">
            <div className={styles.sidebarTabs} role="tablist">
              {panelTabs.map(({ id, label, icon: TabIcon }) => (
                <button key={id} type="button" role="tab" aria-selected={panel === id} title={label}
                  className={panel === id ? styles.sidebarTabActive : styles.sidebarTab} onClick={() => actions.setPanel(id)}>
                  <TabIcon size={16} strokeWidth={2} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className={styles.sidebarBody}>
              {panel === 'edit' && selectedId && selectedExists
                ? <InspectorPanel nodeId={selectedId} onSaveTemplate={(nodeId) => setTemplates({ kind: 'save-section', nodeId })} />
                : panel === 'navigator' ? <Navigator onSaveTemplate={(nodeId) => setTemplates({ kind: 'save-section', nodeId })} />
                  : panel === 'globals' ? <GlobalStylesPanel />
                    : panel === 'page' ? <PageSettingsPanel />
                      : panel === 'seo' ? <SeoPanel />
                        : <WidgetPanel />}
            </div>
          </aside>
          <Canvas onOpenTemplates={() => setTemplates({ kind: 'insert' })} />
        </div>
      </div>
      {dropTarget && (
        <div className={styles.dropLine} aria-hidden="true"
          style={{ left: dropTarget.line.x, top: dropTarget.line.y, width: dropTarget.line.width, height: dropTarget.line.height }} />
      )}
      <DragOverlay dropAnimation={null}>
        {drag ? <div className={styles.dragChip}>{drag.label}</div> : null}
      </DragOverlay>
      {revisionsOpen && <RevisionsModal onClose={() => setRevisionsOpen(false)} />}
      {templates && <TemplatesModal mode={templates} onClose={() => setTemplates(null)} />}
      {aiSectionId && <SectionAiModal key={aiSectionId} sectionId={aiSectionId} onClose={actions.closeSectionAi} />}
    </DndContext>
  );
}
