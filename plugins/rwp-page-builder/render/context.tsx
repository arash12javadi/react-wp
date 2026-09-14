import { createContext, useContext, type ComponentType, type HTMLAttributes, type ReactNode } from 'react';
import type { DynamicContext } from '../lib/dynamic';
import type { BuilderNode, Device } from '../lib/types';

export interface EditableTextProps {
  nodeId: string;
  field: string;
  value: string;
  as?: keyof HTMLElementTagNameMap;
  className?: string;
  /** Allow line breaks (text areas) instead of committing on Enter. */
  multiline?: boolean;
}

/**
 * What the editor injects into the shared renderer. The public renderer leaves it null, so
 * none of the editing code (or dnd-kit) is needed to display a page.
 */
export interface EditorBridge {
  EditableText: ComponentType<EditableTextProps>;
  Chrome: ComponentType<{ node: BuilderNode }>;
  EmptyColumn: ComponentType<{ columnId: string }>;
  nodeProps: (node: BuilderNode) => HTMLAttributes<HTMLElement> & Record<string, unknown>;
}

export interface RenderContextValue {
  mode: 'view' | 'edit';
  /** The previewed device in the editor. The public site always uses media queries. */
  device: Device;
  dynamic: DynamicContext | null;
  pageId: number | null;
  editor: EditorBridge | null;
}

const RenderContext = createContext<RenderContextValue>({
  mode: 'view', device: 'desktop', dynamic: null, pageId: null, editor: null,
});

export const useRenderContext = () => useContext(RenderContext);

export function RenderProvider({ value, children }: { value: RenderContextValue; children: ReactNode }) {
  return <RenderContext.Provider value={value}>{children}</RenderContext.Provider>;
}
