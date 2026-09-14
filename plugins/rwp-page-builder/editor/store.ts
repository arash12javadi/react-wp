import { createContext, useContext, useSyncExternalStore } from 'react';
import { controlStore, getPath, setPath } from '../lib/controls';
import { getWidget, type Control, type ControlTab } from '../lib/registry';
import {
  canContain, cloneWithNewIds, duplicateNode, findNode, insertNode, isDescendant, locate, moveNode, newId, parentKindOf,
  rebalanceColumns, removeNode, ROOT_ID, sectionDepth, updateNode,
} from '../lib/tree';
import type { BuilderDocument, BuilderNode, BuilderPage, ColumnNode, Device, SectionNode, WidgetNode } from '../lib/types';

export type SidePanel = 'widgets' | 'navigator' | 'globals' | 'page' | 'edit';

export interface DropTarget {
  parentId: string;
  index: number;
  /** A widget dropped on empty canvas space gets a new section and column around it. */
  wrap?: boolean;
  /** Indicator line, in viewport coordinates. */
  line: { x: number; y: number; width: number; height: number };
}

export type DragItem =
  | { source: 'widget'; widgetType: string; label: string }
  | { source: 'section'; widths: number[]; inner: boolean; label: string }
  | { source: 'node'; nodeId: string; label: string };

export interface EditorState {
  page: BuilderPage;
  doc: BuilderDocument;
  title: string;
  status: string;
  layout: string;
  savedDoc: BuilderDocument;
  savedTitle: string;
  savedStatus: string;
  savedLayout: string;
  selectedId: string | null;
  hoveredPath: string[];
  device: Device;
  panel: SidePanel;
  inspectorTab: ControlTab;
  past: BuilderDocument[];
  future: BuilderDocument[];
  coalesce: { key: string; at: number } | null;
  drag: DragItem | null;
  dropTarget: DropTarget | null;
  clipboard: BuilderNode | null;
  canPublish: boolean;
  canManageOptions: boolean;
}

type Listener = () => void;

export function createEditorStore(initial: EditorState) {
  let state = initial;
  const listeners = new Set<Listener>();
  const store = {
    getState: () => state,
    setState: (update: Partial<EditorState> | ((current: EditorState) => Partial<EditorState>)) => {
      const patch = typeof update === 'function' ? update(state) : update;
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return { ...store, actions: createActions(store) };
}

export type EditorStore = ReturnType<typeof createEditorStore>;

export const EditorStoreContext = createContext<EditorStore | null>(null);

export function useStore(): EditorStore {
  const store = useContext(EditorStoreContext);
  if (!store) throw new Error('useStore must be used inside the page builder.');
  return store;
}

/** Selectors must return primitives or existing objects, or React re-renders forever. */
export function useEditor<T>(selector: (state: EditorState) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

export const isDirty = (state: EditorState) =>
  state.doc !== state.savedDoc || state.title !== state.savedTitle || state.status !== state.savedStatus || state.layout !== state.savedLayout;

// Node factories -----------------------------------------------------------------------------------

const emptyNode = { style: { desktop: {} }, advanced: {} };

export function createColumn(width: number): ColumnNode {
  return { id: newId(), kind: 'column', type: 'column', settings: {}, style: { desktop: { width } }, advanced: {}, children: [] };
}

export function createSection(widths: number[] = [100]): SectionNode {
  return {
    id: newId(), kind: 'section', type: 'section', settings: { layout: 'boxed', stackOn: 'mobile' },
    ...emptyNode, style: { desktop: {} }, children: widths.map(createColumn),
  };
}

export function createWidget(type: string): WidgetNode {
  const definition = getWidget(type);
  const defaults = definition?.defaults() || { settings: {} };
  return {
    id: newId(), kind: 'widget', type, settings: defaults.settings,
    style: { desktop: { ...(defaults.style || {}) } }, advanced: {},
  };
}

// Actions ---------------------------------------------------------------------------------------------

interface BaseStore {
  getState: () => EditorState;
  setState: (update: Partial<EditorState> | ((current: EditorState) => Partial<EditorState>)) => void;
}

const HISTORY_LIMIT = 100;
const COALESCE_MS = 900;

function createActions(store: BaseStore) {
  /**
   * Applies a document change as one undo step. Changes sharing a coalesce key within a short
   * window (typing, dragging a slider, resizing a column) merge into the same step.
   */
  const commit = (update: (doc: BuilderDocument) => BuilderDocument, options: { coalesce?: string; select?: string | null } = {}) => {
    const state = store.getState();
    const next = update(state.doc);
    if (next === state.doc) {
      if (options.select !== undefined) store.setState({ selectedId: options.select });
      return;
    }
    const now = Date.now();
    const merge = Boolean(options.coalesce && state.coalesce?.key === options.coalesce && now - state.coalesce.at < COALESCE_MS);
    store.setState({
      doc: next,
      past: merge ? state.past : [...state.past, state.doc].slice(-HISTORY_LIMIT),
      future: [],
      coalesce: options.coalesce ? { key: options.coalesce, at: now } : null,
      ...(options.select !== undefined ? { selectedId: options.select, panel: options.select ? 'edit' : state.panel } : {}),
    });
  };

  const actions = {
    commit,

    undo: () => store.setState((state) => {
      if (!state.past.length) return {};
      const previous = state.past[state.past.length - 1];
      return {
        doc: previous, past: state.past.slice(0, -1), future: [state.doc, ...state.future], coalesce: null,
        selectedId: state.selectedId && findNode(previous, state.selectedId) ? state.selectedId : null,
      };
    }),

    redo: () => store.setState((state) => {
      if (!state.future.length) return {};
      const [next, ...rest] = state.future;
      return {
        doc: next, past: [...state.past, state.doc], future: rest, coalesce: null,
        selectedId: state.selectedId && findNode(next, state.selectedId) ? state.selectedId : null,
      };
    }),

    select: (id: string | null) => store.setState((state) => ({
      selectedId: id,
      panel: id ? 'edit' : state.panel === 'edit' ? 'widgets' : state.panel,
    })),

    hover: (path: string[]) => store.setState((state) =>
      (state.hoveredPath.join() === path.join() ? {} : { hoveredPath: path })),

    setDevice: (device: Device) => store.setState({ device }),
    setPanel: (panel: SidePanel) => store.setState({ panel }),
    setInspectorTab: (inspectorTab: ControlTab) => store.setState({ inspectorTab }),

    /** Writes one control value to the right bag; responsive controls write to the previewed device. */
    setControlValue: (nodeId: string, control: Control, value: unknown) => {
      const { device } = store.getState();
      const where = controlStore(control);
      commit((doc) => updateNode(doc, nodeId, (node) => {
        if (where === 'settings') return { ...node, settings: setPath(node.settings, control.key, value) };
        if (where === 'advanced') return { ...node, advanced: setPath(node.advanced as Record<string, unknown>, control.key, value) };
        const bagKey = control.responsive ? device : 'desktop';
        const bag = (node.style[bagKey] || {}) as Record<string, unknown>;
        return { ...node, style: { ...node.style, [bagKey]: setPath(bag, control.key, value) } };
      }), { coalesce: `control:${nodeId}:${control.key}:${device}` });
    },

    setSetting: (nodeId: string, key: string, value: unknown) => commit(
      (doc) => updateNode(doc, nodeId, (node) => ({ ...node, settings: setPath(node.settings, key, value) })),
      { coalesce: `setting:${nodeId}:${key}` },
    ),

    /** Removes a responsive override so the device inherits from the larger one again. */
    resetResponsive: (nodeId: string, key: string) => {
      const { device } = store.getState();
      if (device === 'desktop') return;
      commit((doc) => updateNode(doc, nodeId, (node) => ({
        ...node, style: { ...node.style, [device]: setPath((node.style[device] || {}) as Record<string, unknown>, key, undefined) },
      })));
    },

    setColumnWidths: (widths: Array<[string, number]>) => {
      const { device } = store.getState();
      commit((doc) => widths.reduce((current, [id, width]) => updateNode(current, id, (node) => ({
        ...node, style: { ...node.style, [device]: { ...(node.style[device] || {}), width: Math.round(width * 10) / 10 } },
      })), doc), { coalesce: `resize:${widths.map(([id]) => id).join()}:${device}` });
    },

    insert: (item: DragItem, target: Pick<DropTarget, 'parentId' | 'index' | 'wrap'>) => {
      const state = store.getState();
      if (item.source === 'node') {
        const node = findNode(state.doc, item.nodeId);
        if (!node) return;
        if (target.wrap) {
          const section = createSection([100]);
          commit((doc) => {
            const withSection = insertNode(doc, ROOT_ID, target.index, section);
            return moveNode(withSection, item.nodeId, section.children[0].id, 0);
          }, { select: item.nodeId });
          return;
        }
        const from = locate(state.doc, item.nodeId);
        commit((doc) => {
          let next = moveNode(doc, item.nodeId, target.parentId, target.index);
          // Columns moved between sections: keep both rows adding up to 100%.
          if (node.kind === 'column' && from && from.parentId !== target.parentId) {
            [from.parentId, target.parentId].forEach((sectionId) => {
              next = updateNode(next, sectionId, (section) => rebalanceColumns(section as SectionNode));
            });
          }
          return next;
        }, { select: item.nodeId });
        return;
      }
      const created: BuilderNode = item.source === 'widget' ? createWidget(item.widgetType) : createSection(item.widths);
      if (target.wrap) {
        const section = createSection([100]);
        section.children[0].children = [created as WidgetNode];
        commit((doc) => insertNode(doc, ROOT_ID, target.index, section), { select: created.id });
        return;
      }
      commit((doc) => insertNode(doc, target.parentId, target.index, created), { select: created.id });
    },

    addWidgetToSelection: (type: string) => {
      const state = store.getState();
      const widget = createWidget(type);
      const selected = state.selectedId ? findNode(state.doc, state.selectedId) : null;
      const location = selected ? locate(state.doc, selected.id) : null;
      if (selected?.kind === 'column') {
        commit((doc) => insertNode(doc, selected.id, selected.children.length, widget), { select: widget.id });
      } else if (selected?.kind === 'widget' && location) {
        commit((doc) => insertNode(doc, location.parentId, location.index + 1, widget), { select: widget.id });
      } else if (selected?.kind === 'section') {
        const column = selected.children[0];
        commit((doc) => insertNode(doc, column.id, column.children.length, widget), { select: widget.id });
      } else {
        const section = createSection([100]);
        section.children[0].children = [widget];
        commit((doc) => insertNode(doc, ROOT_ID, doc.content.length, section), { select: widget.id });
      }
    },

    /** Returns false when nothing suitable is selected. */
    addInnerSectionToSelection: (): boolean => {
      const state = store.getState();
      const selected = state.selectedId ? findNode(state.doc, state.selectedId) : null;
      if (!selected) return false;
      const inner = createSection([50, 50]);
      const columnId = selected.kind === 'column' ? selected.id : selected.kind === 'widget' ? locate(state.doc, selected.id)?.parentId : null;
      if (!columnId || !canContain('column', inner, sectionDepth(state.doc, columnId))) return false;
      const column = findNode(state.doc, columnId);
      if (!column || column.kind !== 'column') return false;
      const index = selected.kind === 'widget' ? (locate(state.doc, selected.id)?.index ?? column.children.length) + 1 : column.children.length;
      commit((doc) => insertNode(doc, columnId, index, inner), { select: inner.id });
      return true;
    },

    addSection: (widths: number[], index?: number) => {
      const section = createSection(widths);
      commit((doc) => insertNode(doc, ROOT_ID, index ?? doc.content.length, section), { select: section.id });
    },

    addColumn: (sectionId: string) => commit((doc) => updateNode(doc, sectionId, (node) => {
      const section = node as SectionNode;
      if (section.children.length >= 6) return node;
      return rebalanceColumns({ ...section, children: [...section.children, createColumn(0)] });
    })),

    remove: (id: string) => {
      const state = store.getState();
      const location = locate(state.doc, id);
      const node = findNode(state.doc, id);
      if (!location || !node) return;
      commit((doc) => {
        let next = removeNode(doc, id);
        if (node.kind === 'column') {
          const section = findNode(next, location.parentId) as SectionNode | null;
          // A section with no columns left is removed too; otherwise the rest widen to fill it.
          next = section && section.children.length === 0
            ? removeNode(next, section.id)
            : updateNode(next, location.parentId, (parent) => rebalanceColumns(parent as SectionNode));
        }
        return next;
      }, { select: state.selectedId === id || (state.selectedId && isDescendant(node, state.selectedId)) ? null : state.selectedId });
    },

    duplicate: (id: string) => {
      const state = store.getState();
      const node = findNode(state.doc, id);
      const location = locate(state.doc, id);
      if (!node || !location) return;
      const result = duplicateNode(state.doc, id);
      commit(() => (node.kind === 'column'
        ? updateNode(result.doc, location.parentId, (parent) => rebalanceColumns(parent as SectionNode))
        : result.doc), { select: result.newId });
    },

    moveBy: (id: string, delta: -1 | 1) => {
      const state = store.getState();
      const location = locate(state.doc, id);
      if (!location) return;
      const target = location.index + (delta > 0 ? 2 : -1);
      if (target < 0) return;
      commit((doc) => moveNode(doc, id, location.parentId, target));
    },

    toggleHidden: (id: string) => commit((doc) => updateNode(doc, id, (node) => ({ ...node, hidden: !node.hidden }))),

    rename: (id: string, label: string) => commit((doc) => updateNode(doc, id, (node) => ({ ...node, label: label.trim() || undefined }))),

    copy: (id: string) => {
      const node = findNode(store.getState().doc, id);
      if (node) store.setState({ clipboard: node });
    },

    /** Pastes after the selection, or into it when the clipboard node fits inside. */
    paste: (targetId: string | null) => {
      const state = store.getState();
      if (!state.clipboard) return;
      const copy = cloneWithNewIds(state.clipboard);
      const target = targetId ? findNode(state.doc, targetId) : null;
      if (target && target.kind !== 'widget' && canContain(target.kind, copy, sectionDepth(state.doc, target.id))) {
        commit((doc) => insertNode(doc, target.id, target.children.length, copy), { select: copy.id });
        return;
      }
      const location = target ? locate(state.doc, target.id) : null;
      if (location) {
        const parentKind = parentKindOf(state.doc, location.parentId);
        if (parentKind && canContain(parentKind, copy, sectionDepth(state.doc, location.parentId))) {
          commit((doc) => insertNode(doc, location.parentId, location.index + 1, copy), { select: copy.id });
          return;
        }
      }
      if (copy.kind === 'section') commit((doc) => insertNode(doc, ROOT_ID, doc.content.length, copy), { select: copy.id });
    },

    pasteStyle: (targetId: string) => {
      const { clipboard } = store.getState();
      if (!clipboard) return;
      commit((doc) => updateNode(doc, targetId, (node) => (node.type === clipboard.type
        ? { ...node, style: JSON.parse(JSON.stringify(clipboard.style)), advanced: { ...clipboard.advanced, cssId: node.advanced.cssId } }
        : node)));
    },

    insertSections: (sections: SectionNode[], index?: number) => {
      const copies = sections.map((section) => cloneWithNewIds(section));
      if (!copies.length) return;
      commit((doc) => copies.reduce((current, section, offset) => insertNode(current, ROOT_ID, (index ?? current.content.length) + offset, section), doc), { select: copies[0].id });
    },

    replaceDocument: (doc: BuilderDocument) => commit(() => doc, { select: null }),

    setDocumentSetting: (key: string, value: unknown) => commit((doc) => ({ ...doc, settings: { ...doc.settings, [key]: value } }), { coalesce: `doc:${key}` }),

    readControlValue: (node: BuilderNode, control: Control): { value: unknown; inherited: boolean } => {
      const where = controlStore(control);
      if (where === 'settings') return { value: getPath(node.settings, control.key), inherited: false };
      if (where === 'advanced') return { value: getPath(node.advanced as Record<string, unknown>, control.key), inherited: false };
      if (!control.responsive) return { value: getPath(node.style.desktop, control.key), inherited: false };
      const { device } = store.getState();
      const own = getPath(node.style[device] as Record<string, unknown> | undefined, control.key);
      if (own !== undefined || device === 'desktop') return { value: own, inherited: false };
      const tablet = device === 'mobile' ? getPath(node.style.tablet as Record<string, unknown> | undefined, control.key) : undefined;
      return { value: tablet !== undefined ? tablet : getPath(node.style.desktop, control.key), inherited: true };
    },
  };
  return actions;
}
