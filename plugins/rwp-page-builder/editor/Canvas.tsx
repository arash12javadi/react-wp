import { memo, useEffect, useMemo, useRef, useState, type ClipboardEvent, type ReactNode, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Copy, GripVertical, LayoutTemplate, Move, Pencil, Plus, Trash2 } from 'lucide-react';
import { getSupabaseClient } from '../../../src/lib/db';
import { globalCss, globalVars, googleFontFamilies, useGlobalStyles, useGoogleFonts } from '../lib/globals';
import { findNode, locate } from '../lib/tree';
import type { BuilderNode, ColumnNode, SectionNode } from '../lib/types';
import { effectiveBag } from '../lib/style';
import { useDynamicContext } from '../render/BuilderRenderer';
import { RenderProvider, type EditableTextProps, type EditorBridge, type RenderContextValue } from '../render/context';
import { generateCss } from '../render/generateCss';
import { NodeView } from '../render/NodeView';
import { nodeTitle } from './InspectorPanel';
import { useEditor, useStore } from './store';
import '../render/builder.css';
import styles from './editor.module.css';

const deviceWidths = { desktop: '100%', tablet: '768px', mobile: '375px' };

// Inline text editing -----------------------------------------------------------------------------

/**
 * contentEditable text that commits on every keystroke without moving the caret. While focused,
 * React keeps rendering the text as it was at focus time, so it never writes to the DOM the
 * user is typing into; on blur the element remounts with the stored value.
 */
function InlineText({ nodeId, field, value, as = 'span', className, multiline }: EditableTextProps) {
  const { actions } = useStore();
  const selected = useEditor((state) => state.selectedId === nodeId);
  const [editing, setEditing] = useState(false);
  const [frozen, setFrozen] = useState(value);
  const [version, setVersion] = useState(0);
  const Tag = as as 'span';
  const shown = editing ? frozen : value;
  const content = multiline ? shown.split('\n').flatMap((line, index) => (index ? [<br key={index} />, line] : [line])) : shown;

  if (!selected) return <Tag className={className}>{content}</Tag>;
  return (
    <Tag
      key={version}
      className={`${className || ''} ${styles.inlineEditable}`}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder="Type here…"
      onFocus={() => { setFrozen(value); setEditing(true); }}
      onBlur={() => { setEditing(false); setVersion((current) => current + 1); }}
      onInput={(event) => {
        const text = (multiline ? event.currentTarget.innerText : event.currentTarget.textContent || '').replace(/\n$/, '');
        actions.setSetting(nodeId, field, text);
      }}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' && !multiline) || event.key === 'Escape') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onPaste={(event: ClipboardEvent<HTMLElement>) => {
        // Pasting rich HTML would put markup into a plain-text field.
        event.preventDefault();
        document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
      }}
    >
      {content}
    </Tag>
  );
}

// Chrome: outlines, handles and toolbars -----------------------------------------------------------

function DragHandle({ node, className, children }: { node: BuilderNode; className: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `canvas:${node.id}`, data: { source: 'node', nodeId: node.id, label: nodeTitle(node) } });
  return (
    <button ref={setNodeRef} type="button" className={className} title={`Drag to move ${nodeTitle(node)}`} aria-label={`Move ${nodeTitle(node)}`} {...attributes} {...listeners}>
      {children}
    </button>
  );
}

function ColumnResizer({ column }: { column: ColumnNode }) {
  const store = useStore();
  const [dragging, setDragging] = useState<number | null>(null);
  const start = useRef<{ x: number; width: number; left: number; right: number; rightId: string } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = store.getState();
    const location = locate(state.doc, column.id);
    const section = location ? findNode(state.doc, location.parentId) as SectionNode | null : null;
    if (!section || !location) return;
    const right = section.children[location.index + 1];
    const container = (event.currentTarget.closest('[data-rwpb-node]')?.parentElement) as HTMLElement | null;
    if (!right || !container) return;
    event.preventDefault();
    event.stopPropagation();
    const count = section.children.length;
    const widthOf = (item: ColumnNode) => Number(effectiveBag(item.style, state.device).width ?? 100 / count);
    start.current = { x: event.clientX, width: container.getBoundingClientRect().width, left: widthOf(column), right: widthOf(right), rightId: right.id };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(widthOf(column));
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const origin = start.current;
    if (!origin) return;
    const total = origin.left + origin.right;
    const delta = ((event.clientX - origin.x) / origin.width) * 100;
    const left = Math.max(5, Math.min(total - 5, origin.left + delta));
    setDragging(left);
    store.actions.setColumnWidths([[column.id, left], [origin.rightId, total - left]]);
  };

  const onPointerUp = () => {
    start.current = null;
    setDragging(null);
  };

  return (
    <button type="button" className={styles.resizer} aria-label="Resize column" title="Drag to resize"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onClick={(event) => event.stopPropagation()}>
      {dragging !== null && <span className={styles.resizeValue}>{Math.round(dragging * 10) / 10}%</span>}
    </button>
  );
}

function Chrome({ node }: { node: BuilderNode }) {
  const { actions, getState } = useStore();
  const selected = useEditor((state) => state.selectedId === node.id);
  const hovered = useEditor((state) => state.hoveredPath.includes(node.id));
  const directHover = useEditor((state) => state.hoveredPath[state.hoveredPath.length - 1] === node.id);
  const dragging = useEditor((state) => Boolean(state.drag));
  const canResize = useEditor((state) => {
    if (node.kind !== 'column') return false;
    const location = locate(state.doc, node.id);
    const section = location ? findNode(state.doc, location.parentId) as SectionNode | null : null;
    if (!section || !location || location.index >= section.children.length - 1) return false;
    const stackOn = String(section.settings.stackOn || 'mobile');
    const stacked = (state.device === 'mobile' && stackOn !== 'none') || (state.device === 'tablet' && stackOn === 'tablet');
    return !stacked;
  });

  const stop = (action: () => void) => (event: ReactMouseEvent) => { event.stopPropagation(); action(); };
  const visible = selected || hovered;
  const kindClass = node.kind === 'section' ? styles.chromeSection : node.kind === 'column' ? styles.chromeColumn : styles.chromeWidget;

  // Hidden rather than unmounted while dragging: removing the handle that started a drag cancels it.
  return (
    <span className={dragging ? styles.chromeDragging : styles.chromeLayer}>
      {visible && <span className={`${styles.outline} ${kindClass}${selected ? ` ${styles.outlineSelected}` : ''}`} aria-hidden="true" />}
      {node.kind === 'section' && visible && (
        <span className={styles.sectionTab} onClick={(event) => event.stopPropagation()}>
          <button type="button" title="Add section above" aria-label="Add section above" onClick={stop(() => {
            const index = getState().doc.content.findIndex((item) => item.id === node.id);
            actions.addSection([100], index < 0 ? undefined : index);
          })}><Plus size={13} /></button>
          <DragHandle node={node} className={styles.tabHandle}><GripVertical size={13} /></DragHandle>
          <button type="button" title="Edit section" aria-label="Edit section" onClick={stop(() => actions.select(node.id))}><Pencil size={12} /></button>
          <button type="button" title="Duplicate" aria-label="Duplicate section" onClick={stop(() => actions.duplicate(node.id))}><Copy size={12} /></button>
          <button type="button" title="Delete" aria-label="Delete section" onClick={stop(() => actions.remove(node.id))}><Trash2 size={12} /></button>
        </span>
      )}
      {node.kind === 'column' && visible && (
        <span className={styles.columnTab} onClick={(event) => event.stopPropagation()}>
          <DragHandle node={node} className={styles.tabHandle}><Move size={11} /></DragHandle>
          <button type="button" title="Edit column" aria-label="Edit column" onClick={stop(() => actions.select(node.id))}><Pencil size={11} /></button>
        </span>
      )}
      {node.kind === 'column' && canResize && (hovered || selected) && <ColumnResizer column={node} />}
      {node.kind === 'widget' && (selected || directHover) && (
        <span className={styles.widgetTab} onClick={(event) => event.stopPropagation()}>
          <DragHandle node={node} className={styles.tabHandle}><GripVertical size={12} /></DragHandle>
          <span className={styles.widgetName}>{nodeTitle(node)}</span>
          <button type="button" title="Duplicate" aria-label="Duplicate widget" onClick={stop(() => actions.duplicate(node.id))}><Copy size={12} /></button>
          <button type="button" title="Delete" aria-label="Delete widget" onClick={stop(() => actions.remove(node.id))}><Trash2 size={12} /></button>
        </span>
      )}
    </span>
  );
}

function EmptyColumn({ columnId }: { columnId: string }) {
  const { actions } = useStore();
  return (
    <button type="button" className={styles.emptyColumn} onClick={(event) => { event.stopPropagation(); actions.select(columnId); actions.setPanel('widgets'); }}>
      <Plus size={16} /> Drag a widget here
    </button>
  );
}

// Canvas ---------------------------------------------------------------------------------------------

const CanvasContent = memo(function CanvasContent({ content }: { content: SectionNode[] }) {
  return <>{content.map((node) => <NodeView key={node.id} node={node} />)}</>;
});

/** The newest published post (single_post) or page (page) to preview a template with, or null. */
function useTemplateSample(type: string | null | undefined): number | null {
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    if (type !== 'single_post' && type !== 'page') { setId(null); return undefined; }
    let active = true;
    let query = getSupabaseClient().from('pages').select('id').eq('status', 'published').eq('is_post', type === 'single_post');
    if (type === 'page') query = query.eq('is_site_template', false).eq('is_builder_enabled', false);
    void query.order('created_at', { ascending: false }).limit(1).then(({ data }) => {
      if (active) setId((data as Array<{ id: number }> | null)?.[0]?.id ?? null);
    });
    return () => { active = false; };
  }, [type]);
  return id;
}

export default function Canvas({ onOpenTemplates }: { onOpenTemplates: () => void }) {
  const store = useStore();
  const { actions } = store;
  const doc = useEditor((state) => state.doc);
  const device = useEditor((state) => state.device);
  const page = useEditor((state) => state.page);
  const title = useEditor((state) => state.title);
  const globals = useGlobalStyles();
  useGoogleFonts(googleFontFamilies(globals, doc));

  // Dynamic tags preview against this page, including a title edited but not yet saved. The Single
  // Post and Standard Pages templates preview against the latest published post or page instead.
  const sampleId = useTemplateSample(page.is_site_template ? page.template_type : null);
  const previewPage = useMemo(() => (sampleId ? { id: sampleId } : { ...page, title }), [page, title, sampleId]);
  const dynamic = useDynamicContext(previewPage);

  const css = useMemo(
    () => `${globalCss(globals)}\n${globalVars(globals, '[data-rwpb-shell]')}\n${generateCss(doc, { device })}`,
    [doc, device, globals],
  );

  const bridge = useMemo<EditorBridge>(() => ({
    EditableText: InlineText,
    Chrome,
    EmptyColumn,
    nodeProps: (node) => ({
      'data-rwpb-node': node.id,
      onClick: (event: ReactMouseEvent) => {
        event.stopPropagation();
        actions.select(node.id);
      },
    }),
  }), [actions]);

  const context = useMemo<RenderContextValue>(() => ({
    mode: 'edit', device, dynamic, pageId: page.id, editor: bridge,
  }), [device, dynamic, page.id, bridge]);

  const onMouseOver = (event: ReactMouseEvent) => {
    // Frozen during a drag, so the handle that started it stays rendered.
    if (store.getState().drag) return;
    const path: string[] = [];
    let element = (event.target as HTMLElement).closest<HTMLElement>('[data-rwpb-node]');
    while (element) {
      path.unshift(element.dataset.rwpbNode!);
      element = element.parentElement?.closest<HTMLElement>('[data-rwpb-node]') || null;
    }
    actions.hover(path);
  };

  return (
    <main className={styles.canvasArea} data-rwpb-scroller onClick={() => actions.select(null)}>
      <style>{css}</style>
      <div className={styles.deviceFrame} style={{ width: deviceWidths[device] }} data-device={device}>
        <RenderProvider value={context}>
          <div
            className={`rwpb-root ${styles.canvasRoot}`}
            data-rwpb-container="root"
            data-rwpb-accepts="section"
            onMouseOver={onMouseOver}
            onMouseLeave={() => actions.hover([])}
            // Links, buttons and forms are for editing here, not for navigating away.
            onClickCapture={(event) => {
              if ((event.target as HTMLElement).closest('a[href], form button[type=submit]')) event.preventDefault();
            }}
            onSubmitCapture={(event) => event.preventDefault()}
          >
            {doc.settings.showTitle && <h1 className="rwpb-page-title">{title}</h1>}
            <CanvasContent content={doc.content} />
          </div>
        </RenderProvider>
        <div className={styles.addSectionBar} onClick={(event) => event.stopPropagation()}>
          {doc.content.length === 0 && <p>Your page is empty. Drag a widget or a section here, or start from a template.</p>}
          <div>
            <button type="button" className={styles.addSectionButton} onClick={() => actions.addSection([100])}><Plus size={16} /> Add section</button>
            <button type="button" className={styles.addTemplateButton} onClick={onOpenTemplates}><LayoutTemplate size={16} /> Templates</button>
          </div>
        </div>
      </div>
    </main>
  );
}
