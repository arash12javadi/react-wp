import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { ChevronRight, Eye, EyeOff, GripVertical, MoreVertical } from 'lucide-react';
import { Icon } from '../lib/icons';
import { getWidget } from '../lib/registry';
import { findNode } from '../lib/tree';
import type { BuilderNode } from '../lib/types';
import { nodeTitle } from './InspectorPanel';
import { useEditor, useStore } from './store';
import styles from './editor.module.css';

interface MenuState { nodeId: string; x: number; y: number }

function ContextMenu({ menu, onClose, onRename, onSaveTemplate }: { menu: MenuState; onClose: () => void; onRename: (id: string) => void; onSaveTemplate: (id: string) => void }) {
  const { actions } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const doc = useEditor((state) => state.doc);
  const clipboard = useEditor((state) => state.clipboard);
  const target = findNode(doc, menu.nodeId);

  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [onClose]);

  if (!target) return null;
  const run = (action: () => void) => () => { action(); onClose(); };
  return (
    <div ref={ref} className={styles.contextMenu} role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 330) }}>
      <button type="button" role="menuitem" onClick={run(() => actions.select(target.id))}>Edit</button>
      <button type="button" role="menuitem" onClick={run(() => onRename(target.id))}>Rename</button>
      <button type="button" role="menuitem" onClick={run(() => actions.duplicate(target.id))}>Duplicate</button>
      <button type="button" role="menuitem" onClick={run(() => actions.toggleHidden(target.id))}>{target.hidden ? 'Show' : 'Hide'}</button>
      <button type="button" role="menuitem" onClick={run(() => actions.moveBy(target.id, -1))}>Move up</button>
      <button type="button" role="menuitem" onClick={run(() => actions.moveBy(target.id, 1))}>Move down</button>
      <hr />
      <button type="button" role="menuitem" onClick={run(() => actions.copy(target.id))}>Copy</button>
      <button type="button" role="menuitem" disabled={!clipboard} onClick={run(() => actions.paste(target.id))}>Paste</button>
      <button type="button" role="menuitem" disabled={!clipboard || clipboard.type !== target.type} onClick={run(() => actions.pasteStyle(target.id))}>Paste style</button>
      {target.kind === 'section' && <button type="button" role="menuitem" onClick={run(() => onSaveTemplate(target.id))}>Save as template</button>}
      <hr />
      <button type="button" role="menuitem" className={styles.danger} onClick={run(() => actions.remove(target.id))}>Delete</button>
    </div>
  );
}

function TreeItem({ node, depth, collapsed, onToggle, renaming, onRename, onRenamed, onMenu }: {
  node: BuilderNode; depth: number; collapsed: Set<string>; onToggle: (id: string) => void;
  renaming: string | null; onRename: (id: string) => void; onRenamed: () => void; onMenu: (event: ReactMouseEvent, id: string) => void;
}) {
  const { actions } = useStore();
  const selected = useEditor((state) => state.selectedId === node.id);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `nav:${node.id}`, data: { source: 'node', nodeId: node.id, label: nodeTitle(node) } });
  const children = node.kind === 'widget' ? [] : (node.children as BuilderNode[]);
  const isCollapsed = collapsed.has(node.id);
  const icon = node.kind === 'widget' ? getWidget(node.type)?.icon || 'square' : node.kind === 'section' ? 'columns' : 'square';
  const accepts = node.kind === 'section' ? 'column' : node.kind === 'column' ? 'widget' : '';

  return (
    <li data-rwpb-node={node.id} className={isDragging ? styles.isDragging : undefined}>
      <div
        className={`${styles.treeRow}${selected ? ` ${styles.treeRowSelected}` : ''}${node.hidden ? ` ${styles.treeRowHidden}` : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        data-rwpb-drop-into={accepts && (isCollapsed || !children.length) ? node.id : undefined}
        onClick={() => actions.select(node.id)}
        onContextMenu={(event) => onMenu(event, node.id)}
        onMouseEnter={() => actions.hover([node.id])}
        onMouseLeave={() => actions.hover([])}
      >
        <span ref={setNodeRef} className={styles.treeHandle} {...attributes} {...listeners} aria-label={`Drag ${nodeTitle(node)}`} onClick={(event) => event.stopPropagation()}>
          <GripVertical size={13} />
        </span>
        {children.length > 0 || node.kind !== 'widget' ? (
          <button type="button" className={styles.treeToggle} aria-label={isCollapsed ? 'Expand' : 'Collapse'} aria-expanded={!isCollapsed}
            onClick={(event) => { event.stopPropagation(); onToggle(node.id); }}>
            <ChevronRight size={13} className={isCollapsed ? undefined : styles.rotated90} />
          </button>
        ) : <span className={styles.treeToggleSpacer} />}
        <Icon name={icon} size={14} />
        {renaming === node.id ? (
          <input
            className={styles.treeRename}
            defaultValue={node.label || ''}
            placeholder={nodeTitle({ ...node, label: undefined })}
            autoFocus
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => { actions.rename(node.id, event.target.value); onRenamed(); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') onRenamed();
            }}
          />
        ) : (
          <span className={styles.treeLabel} onDoubleClick={() => onRename(node.id)}>{nodeTitle(node)}</span>
        )}
        <button type="button" className={styles.treeAction} aria-label={node.hidden ? 'Show' : 'Hide'} title={node.hidden ? 'Show' : 'Hide'}
          onClick={(event) => { event.stopPropagation(); actions.toggleHidden(node.id); }}>
          {node.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        <button type="button" className={styles.treeAction} aria-label="More actions" title="More actions"
          onClick={(event) => { event.stopPropagation(); onMenu(event, node.id); }}>
          <MoreVertical size={13} />
        </button>
      </div>
      {accepts && !isCollapsed && (
        <ul data-rwpb-container={node.id} data-rwpb-accepts={accepts} className={styles.treeList}>
          {children.map((child) => (
            <TreeItem key={child.id} node={child} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} renaming={renaming} onRename={onRename} onRenamed={onRenamed} onMenu={onMenu} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Navigator({ onSaveTemplate }: { onSaveTemplate: (nodeId: string) => void }) {
  const content = useEditor((state) => state.doc.content);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const toggle = (id: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const openMenu = (event: ReactMouseEvent, id: string) => {
    event.preventDefault();
    // Keyboard activation of the ⋮ button reports 0,0; anchor the menu to the button instead.
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ nodeId: id, x: event.clientX || rect.left, y: event.clientY || rect.bottom });
  };

  return (
    <div className={styles.panel}>
      <p className={styles.hint}>Drag rows to reorder. Right-click (or ⋮) for more. Double-click a name to rename.</p>
      {content.length === 0 && <p className={styles.hint}>The page is empty. Add a section from the Widgets panel.</p>}
      <ul className={styles.tree} data-rwpb-container="root" data-rwpb-accepts="section">
        {content.map((node) => (
          <TreeItem key={node.id} node={node} depth={0} collapsed={collapsed} onToggle={toggle} renaming={renaming} onRename={setRenaming} onRenamed={() => setRenaming(null)} onMenu={openMenu} />
        ))}
      </ul>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} onRename={setRenaming} onSaveTemplate={onSaveTemplate} />}
    </div>
  );
}
