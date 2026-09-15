import {
  defaultAreaLayout, duplicateBlock, insertBlock, moveBlock, removeBlock, setFooterColumns, updateBlock,
  type AnyAreaLayout, type BlockSettings, type BlockStyle, type ThemeAreaId, type ThemeBlock, type ThemeCodeField,
  type ThemeLayout, type ThemeSettings,
} from '../../lib/theme';

/**
 * Theme Editor state: the last saved theme, the draft being edited, and undo/redo history.
 * Every layout change goes through the pure operations in lib/theme.ts, so the reducer only
 * decides which area changes and what enters history.
 */

export type EditorTab = ThemeAreaId | 'css';

export interface EditorState {
  saved: ThemeSettings;
  draft: ThemeSettings;
  past: ThemeSettings[];
  future: ThemeSettings[];
  /** Consecutive edits with the same key within a second share one undo step (typing). */
  lastKey: string;
  lastAt: number;
}

export type EditorAction =
  | { type: 'load'; theme: ThemeSettings }
  | { type: 'saved'; theme: ThemeSettings }
  | { type: 'addBlock'; area: ThemeAreaId; block: ThemeBlock; containerId: string; index: number }
  | { type: 'moveBlock'; area: ThemeAreaId; blockId: string; containerId: string; index: number }
  | { type: 'removeBlock'; area: ThemeAreaId; blockId: string }
  | { type: 'duplicateBlock'; area: ThemeAreaId; blockId: string }
  | { type: 'updateBlock'; area: ThemeAreaId; blockId: string; settings?: BlockSettings; style?: Partial<BlockStyle> }
  | { type: 'setOptions'; area: ThemeAreaId; options: Record<string, unknown> }
  | { type: 'setFooterColumns'; columns: number }
  | { type: 'replaceArea'; area: ThemeAreaId; layout: AnyAreaLayout }
  | { type: 'setCode'; field: ThemeCodeField; value: string }
  | { type: 'resetTab'; tab: EditorTab }
  | { type: 'undo' }
  | { type: 'redo' };

const historyLimit = 60;

/** Code fields that belong to each tab; reset clears them along with the tab's layout. */
export const tabCodeFields: Record<EditorTab, ThemeCodeField[]> = {
  header: ['custom_header_code', 'custom_header_html'],
  footer: ['custom_footer_html', 'custom_footer_code'],
  sidebar: ['custom_sidebar_code'],
  comments: ['custom_comments_css'],
  index: [],
  css: ['custom_css'],
};

export const initialEditorState = (theme: ThemeSettings): EditorState => ({
  saved: theme, draft: theme, past: [], future: [], lastKey: '', lastAt: 0,
});

const withArea = (theme: ThemeSettings, area: ThemeAreaId, layout: AnyAreaLayout): ThemeSettings => ({
  ...theme,
  layout: { ...theme.layout, [area]: layout } as ThemeLayout,
});

const commit = (state: EditorState, draft: ThemeSettings, key = ''): EditorState => {
  if (draft === state.draft) return state;
  const now = Date.now();
  const coalesce = key !== '' && key === state.lastKey && now - state.lastAt < 1000;
  return {
    ...state,
    draft,
    past: coalesce ? state.past : [...state.past, state.draft].slice(-historyLimit),
    future: [],
    lastKey: key,
    lastAt: now,
  };
};

/** The layout operations return the same object when they refuse (a second unique block), which must not add an undo step. */
const commitArea = (state: EditorState, area: ThemeAreaId, layout: AnyAreaLayout, key = '') =>
  layout === state.draft.layout[area] ? state : commit(state, withArea(state.draft, area, layout), key);

export function themeEditorReducer(state: EditorState, action: EditorAction): EditorState {
  const { draft } = state;
  switch (action.type) {
    case 'load':
      return initialEditorState(action.theme);
    case 'saved':
      // Keep history: undo after a save returns to the pre-save draft, which then shows as unsaved.
      return { ...state, saved: action.theme, draft: action.theme, lastKey: '' };
    case 'addBlock':
      return commitArea(state, action.area, insertBlock(draft.layout[action.area], action.area, action.block, action.containerId, action.index));
    case 'moveBlock':
      return commitArea(state, action.area, moveBlock(draft.layout[action.area], action.blockId, action.containerId, action.index));
    case 'removeBlock':
      return commitArea(state, action.area, removeBlock(draft.layout[action.area], action.blockId));
    case 'duplicateBlock':
      return commitArea(state, action.area, duplicateBlock(draft.layout[action.area], action.area, action.blockId));
    case 'updateBlock':
      return commitArea(state, action.area,
        updateBlock(draft.layout[action.area], action.blockId, { settings: action.settings, style: action.style }),
        `block:${action.blockId}:${Object.keys(action.settings || action.style || {}).join(',')}`);
    case 'setOptions': {
      const area = draft.layout[action.area];
      return commitArea(state, action.area, { ...area, options: { ...area.options, ...action.options } } as AnyAreaLayout,
        `options:${action.area}:${Object.keys(action.options).join(',')}`);
    }
    case 'setFooterColumns':
      return commitArea(state, 'footer', setFooterColumns(draft.layout.footer, action.columns));
    case 'replaceArea':
      return commitArea(state, action.area, action.layout, `json:${action.area}`);
    case 'setCode':
      return commit(state, { ...draft, [action.field]: action.value }, `code:${action.field}`);
    case 'resetTab': {
      let next: ThemeSettings = { ...draft };
      tabCodeFields[action.tab].forEach((field) => { next[field] = ''; });
      if (action.tab !== 'css') next = withArea(next, action.tab, defaultAreaLayout(action.tab));
      return commit(state, next);
    }
    case 'undo': {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return { ...state, draft: previous, past: state.past.slice(0, -1), future: [state.draft, ...state.future], lastKey: '' };
    }
    case 'redo': {
      if (!state.future.length) return state;
      const [next, ...rest] = state.future;
      return { ...state, draft: next, past: [...state.past, state.draft], future: rest, lastKey: '' };
    }
    default:
      return state;
  }
}

/** Compares content only: id and updated_at change on every save without the theme changing. */
export const themeContent = (theme: ThemeSettings) => {
  const { id: _id, updated_at: _updatedAt, ...content } = theme;
  return JSON.stringify(content);
};
