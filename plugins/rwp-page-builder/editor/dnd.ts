import { canContain, findNode, locate, ROOT_ID, sectionDepth } from '../lib/tree';
import type { BuilderDocument, BuilderNode, NodeKind } from '../lib/types';
import type { DragItem, DropTarget } from './store';

/**
 * Drop targets are found from the DOM under the pointer rather than with dnd-kit collision
 * detection, which is built for flat sortable lists. The canvas and the navigator both mark
 * containers with data-rwpb-container (+ data-rwpb-accepts) and nodes with data-rwpb-node,
 * so one function serves both.
 */

function draggedKind(doc: BuilderDocument, item: DragItem): { kind: NodeKind; node: BuilderNode | null; inner: boolean } {
  if (item.source === 'widget') return { kind: 'widget', node: null, inner: false };
  if (item.source === 'section') return { kind: 'section', node: null, inner: item.inner };
  const node = findNode(doc, item.nodeId);
  const location = node ? locate(doc, item.nodeId) : null;
  return { kind: node?.kind || 'widget', node, inner: node?.kind === 'section' && location?.parentId !== ROOT_ID };
}

function accepts(doc: BuilderDocument, item: DragItem, containerId: string, containerAccepts: string): { ok: boolean; wrap?: boolean } {
  const { kind, node, inner } = draggedKind(doc, item);
  if (containerAccepts === 'section') {
    if (kind === 'section' && !inner) return { ok: true };
    // A widget dropped straight onto the page gets wrapped in a new section.
    if (kind === 'widget') return { ok: true, wrap: true };
    return { ok: false };
  }
  if (containerAccepts === 'column') {
    if (kind !== 'column') return { ok: false };
    // A column holding an inner section may only sit in a top-level section, or nesting would go two deep.
    const holdsSection = node?.kind === 'column' && node.children.some((child) => child.kind === 'section');
    return { ok: !holdsSection || locate(doc, containerId)?.parentId === ROOT_ID };
  }
  if (containerAccepts === 'widget') {
    if (kind === 'widget') return { ok: true };
    if (kind !== 'section' || !inner) return { ok: false };
    const probe = node || ({ kind: 'section', children: [] } as unknown as BuilderNode);
    return { ok: canContain('column', probe, sectionDepth(doc, containerId)) };
  }
  return { ok: false };
}

export function computeDropTarget(doc: BuilderDocument, item: DragItem, x: number, y: number): DropTarget | null {
  const draggedId = item.source === 'node' ? item.nodeId : null;

  for (const element of document.elementsFromPoint(x, y)) {
    if (!(element instanceof HTMLElement)) continue;

    // Hovering a collapsed parent's row in the navigator drops at the end of it.
    const into = element.dataset.rwpbDropInto;
    if (into && into !== draggedId) {
      const parentNode = findNode(doc, into);
      const acceptsKind = parentNode?.kind === 'column' ? 'widget' : parentNode?.kind === 'section' ? 'column' : '';
      if (parentNode && acceptsKind && accepts(doc, item, into, acceptsKind).ok) {
        const rect = element.getBoundingClientRect();
        const count = parentNode.kind === 'widget' ? 0 : parentNode.children.length;
        return { parentId: into, index: count, line: { x: rect.left + 24, y: rect.bottom - 1, width: rect.width - 24, height: 2 } };
      }
    }

    const containerId = element.dataset.rwpbContainer;
    if (!containerId) continue;
    if (draggedId && (containerId === draggedId || element.closest(`[data-rwpb-node="${CSS.escape(draggedId)}"]`))) continue;
    const verdict = accepts(doc, item, containerId, element.dataset.rwpbAccepts || '');
    if (!verdict.ok) continue;

    const children = Array.from(element.querySelectorAll<HTMLElement>(':scope > [data-rwpb-node]'));
    const containerRect = element.getBoundingClientRect();
    // Columns sit side by side unless the previewed device stacks them.
    const horizontal = element.dataset.rwpbAccepts === 'column' && getComputedStyle(element).flexWrap !== 'wrap';

    let index = 0;
    for (const child of children) {
      const rect = child.getBoundingClientRect();
      const middle = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
      if ((horizontal ? x : y) > middle) index += 1;
    }

    let line: DropTarget['line'];
    if (!children.length) {
      line = { x: containerRect.left + 8, y: containerRect.top + containerRect.height / 2, width: Math.max(0, containerRect.width - 16), height: 2 };
    } else if (horizontal) {
      const reference = children[Math.min(index, children.length - 1)].getBoundingClientRect();
      const lineX = index < children.length ? reference.left - 2 : reference.right;
      line = { x: lineX, y: reference.top, width: 3, height: reference.height };
    } else {
      const reference = children[Math.min(index, children.length - 1)].getBoundingClientRect();
      const lineY = index < children.length ? reference.top - 1 : reference.bottom;
      line = { x: reference.left, y: lineY, width: reference.width, height: 3 };
    }

    return { parentId: containerId === 'root' ? ROOT_ID : containerId, index, wrap: verdict.wrap, line };
  }
  return null;
}
