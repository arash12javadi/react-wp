import { Fragment, useMemo, useState, type Dispatch, type KeyboardEvent, type ReactNode } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
  areaHasType, blocksForArea, containerDirection, containerLabel, createBlock, findBlock, getBlockDefinition, maxFooterColumns,
  type AnyAreaLayout, type BlockDefinition, type BlockField, type ThemeAreaId, type ThemeBlock, type ThemeContainer, type ThemeLayout,
} from '../../lib/theme';
import { validateMarkup } from '../../lib/themeValidation';
import CodeEditor from './CodeEditor';
import type { EditorAction } from './themeEditorState';
import styles from './ThemeEditor.module.css';

export interface MenuOption {
  id: number;
  name: string;
}

type DragData = { kind: 'new'; blockType: BlockDefinition['type']; label: string } | { kind: 'block'; blockId: string; label: string };
type DropData = { kind: 'container'; containerId: string } | { kind: 'block'; containerId: string; blockId: string };
interface DropHint { containerId: string; index: number }

// A block's own droppable sits inside its container's, so prefer blocks: they carry the position.
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const onBlocks = hits.filter((hit) => String(hit.id).startsWith('drop-block:'));
  return onBlocks.length ? onBlocks : hits;
};

const stripTags = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (value: string, length = 48) => (value.length > length ? `${value.slice(0, length)}…` : value);

const summarize = (block: ThemeBlock, menus: MenuOption[]): string => {
  const s = block.settings;
  const menuName = (id: unknown) => (id ? menus.find((menu) => String(menu.id) === String(id))?.name || `Menu #${String(id)}` : 'Primary menu');
  switch (block.type) {
    case 'primary-menu': return menuName(s.menu_id);
    case 'menu': return [s.title, menuName(s.menu_id)].filter(Boolean).join(' · ');
    case 'custom-html': return clip([s.title, stripTags(String(s.html || ''))].filter(Boolean).join(' · ') || 'Empty');
    case 'text': case 'copyright': return clip(String(s.text || '') || 'Empty');
    case 'widget-area': return s.source === 'footer' ? 'Footer widgets' : 'Sidebar widgets';
    case 'hero': return clip(String(s.heading || ''));
    case 'posts-feed': return clip(`${String(s.heading || 'Posts')} · ${String(s.columns)} column${Number(s.columns) === 1 ? '' : 's'}`);
    case 'discussion-rules': return clip(String(s.title || s.text || ''));
    default: return clip(String(s.title || ''));
  }
};

// Library ----------------------------------------------------------------------------------------

function LibraryItem({ definition, disabled, onAdd }: { definition: BlockDefinition; disabled: boolean; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `new:${definition.type}`,
    data: { kind: 'new', blockType: definition.type, label: definition.label } as DragData,
    disabled,
  });
  return (
    <li ref={setNodeRef} className={`${styles.libraryItem} ${disabled ? styles.libraryItemDisabled : ''} ${isDragging ? styles.dragging : ''}`}>
      <div className={styles.libraryDrag} {...attributes} {...listeners} aria-describedby={undefined} aria-roledescription="block"
        title={disabled ? 'Already in this area (only one allowed)' : 'Drag onto the canvas'}>
        <span className={styles.libraryIcon} aria-hidden="true">{definition.icon}</span>
        <span>
          <strong>{definition.label}</strong>
          <small>{disabled ? 'In use: only one allowed.' : definition.description}</small>
        </span>
      </div>
      <button type="button" className={styles.smallButton} onClick={onAdd} disabled={disabled} aria-label={`Add ${definition.label}`}>Add</button>
    </li>
  );
}

// Canvas -----------------------------------------------------------------------------------------

function BlockCard({
  block, area, containerId, index, count, selected, menus, onSelect, dispatch,
}: {
  block: ThemeBlock;
  area: ThemeAreaId;
  containerId: string;
  index: number;
  count: number;
  selected: boolean;
  menus: MenuOption[];
  onSelect: (id: string) => void;
  dispatch: Dispatch<EditorAction>;
}) {
  const definition = getBlockDefinition(block.type)!;
  const draggable = useDraggable({ id: `block:${block.id}`, data: { kind: 'block', blockId: block.id, label: definition.label } as DragData });
  const droppable = useDroppable({ id: `drop-block:${block.id}`, data: { kind: 'block', containerId, blockId: block.id } as DropData });
  const row = containerDirection(area, containerId) === 'row';
  const summary = summarize(block, menus);
  const move = (offset: number) => dispatch({ type: 'moveBlock', area, blockId: block.id, containerId, index: offset < 0 ? index - 1 : index + 2 });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(block.id);
    }
  };

  return (
    <div
      ref={(node) => { draggable.setNodeRef(node); droppable.setNodeRef(node); }}
      className={[styles.blockCard, selected ? styles.blockCardSelected : '', draggable.isDragging ? styles.dragging : '', block.style.visible ? '' : styles.blockCardHidden].join(' ')}
    >
      <div
        className={styles.blockCardMain}
        {...draggable.attributes}
        {...draggable.listeners}
        aria-describedby={undefined}
        aria-roledescription="block"
        aria-pressed={selected}
        aria-label={`${definition.label}${summary ? `: ${summary}` : ''}. Press Enter to edit its settings.`}
        onClick={() => onSelect(block.id)}
        onKeyDown={onKeyDown}
      >
        <span className={styles.handle} aria-hidden="true">⠿</span>
        <span className={styles.libraryIcon} aria-hidden="true">{definition.icon}</span>
        <span className={styles.blockCardText}>
          <strong>{definition.label}</strong>
          {summary && <small>{summary}</small>}
        </span>
        <span className={styles.badges}>
          {!block.style.visible && <span className={styles.badge}>Hidden</span>}
          {block.style.hide_mobile && <span className={styles.badge}>Not on mobile</span>}
          {block.style.hide_desktop && <span className={styles.badge}>Mobile only</span>}
        </span>
      </div>
      <div className={styles.blockCardActions}>
        <button type="button" onClick={() => move(-1)} disabled={index === 0} aria-label={`Move ${definition.label} ${row ? 'left' : 'up'}`}>{row ? '←' : '↑'}</button>
        <button type="button" onClick={() => move(1)} disabled={index === count - 1} aria-label={`Move ${definition.label} ${row ? 'right' : 'down'}`}>{row ? '→' : '↓'}</button>
        <button type="button" onClick={() => dispatch({ type: 'removeBlock', area, blockId: block.id })} aria-label={`Delete ${definition.label}`} className={styles.dangerIcon}>✕</button>
      </div>
    </div>
  );
}

function DropContainer({ area, container, hint, children, empty }: { area: ThemeAreaId; container: ThemeContainer; hint: DropHint | null; children: ReactNode; empty: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `container:${container.id}`, data: { kind: 'container', containerId: container.id } as DropData });
  const row = containerDirection(area, container.id) === 'row';
  return (
    <section
      ref={setNodeRef}
      className={`${styles.dropContainer} ${isOver || hint?.containerId === container.id ? styles.dropContainerActive : ''}`}
      aria-label={containerLabel(area, container.id)}
    >
      <h4 className={styles.containerLabel}>{containerLabel(area, container.id)}{row ? ' · left to right' : ''}</h4>
      <div className={row ? styles.blockRow : styles.blockColumn}>
        {children}
        {empty && <p className={styles.emptyDrop}>Drop blocks here, or use Add in the block library.</p>}
      </div>
    </section>
  );
}

// Inspector --------------------------------------------------------------------------------------

function FieldInput({ field, value, blockId, menus, onChange }: {
  field: BlockField;
  value: string | number | boolean | undefined;
  blockId: string;
  menus: MenuOption[];
  onChange: (value: string | number | boolean) => void;
}) {
  const id = `field-${blockId}-${field.key}`;
  const help = field.help ? <span className={styles.help}>{field.help}</span> : null;
  switch (field.kind) {
    case 'checkbox':
      return (
        <label className={styles.checkRow} htmlFor={id}>
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
          <span>{field.label}{help}</span>
        </label>
      );
    case 'number':
      return (
        <label htmlFor={id}>{field.label}
          <input id={id} type="number" min={field.min} max={field.max} value={Number(value ?? 0)} onChange={(event) => onChange(Number(event.target.value))} />
          {help}
        </label>
      );
    case 'select':
    case 'menu':
      return (
        <label htmlFor={id}>{field.label}
          <select id={id} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}>
            {field.kind === 'menu'
              ? [<option key="" value="">Primary menu</option>, ...menus.map((menu) => <option key={menu.id} value={String(menu.id)}>{menu.name}</option>)]
              : field.options?.map(([option, label]) => <option key={option} value={option}>{label}</option>)}
          </select>
          {help}
        </label>
      );
    case 'textarea':
      return (
        <label htmlFor={id}>{field.label}
          <textarea id={id} rows={4} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />
          {help}
        </label>
      );
    case 'html':
      return (
        <CodeEditor id={id} label={field.label} language="html" value={String(value ?? '')} onChange={onChange} minRows={8}
          issues={validateMarkup(String(value ?? ''))}
          help="Scripts, <style>, <iframe> and event handlers are removed when the page renders. Shortcodes work." />
      );
    case 'url':
      return (
        <label htmlFor={id}>{field.label}
          <input id={id} type="text" inputMode="url" value={String(value ?? '')} placeholder="https://… or /page"
            onChange={(event) => onChange(event.target.value)} />
          {help || <span className={styles.help}>https://, a site path such as /contact, mailto: or tel:. Anything else is removed.</span>}
        </label>
      );
    case 'text':
    default:
      return (
        <label htmlFor={id}>{field.label}
          <input id={id} type="text" value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />
          {help}
        </label>
      );
  }
}

function ColorInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  // The text field is what gets validated; typing a value the theme rejects (e.g. "bluish") clears it on normalisation.
  const [text, setText] = useState(value);
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
  return (
    <label htmlFor={id}>{label}
      <span className={styles.colorRow}>
        <input type="color" value={hex} aria-label={`${label} picker`} onChange={(event) => { setText(event.target.value); onChange(event.target.value); }} />
        <input id={id} type="text" value={text} placeholder="Theme default"
          onChange={(event) => setText(event.target.value)}
          onBlur={() => onChange(text.trim())} />
      </span>
    </label>
  );
}

function Inspector({ area, layout, blockId, menus, dispatch, onClose }: {
  area: ThemeAreaId;
  layout: AnyAreaLayout;
  blockId: string;
  menus: MenuOption[];
  dispatch: Dispatch<EditorAction>;
  onClose: () => void;
}) {
  const found = findBlock(layout, blockId);
  if (!found) return null;
  const { block, containerId } = found;
  const definition = getBlockDefinition(block.type)!;
  const setSetting = (key: string, value: string | number | boolean) =>
    dispatch({ type: 'updateBlock', area, blockId, settings: { [key]: value } });
  const setStyle = (changes: Partial<ThemeBlock['style']>) => dispatch({ type: 'updateBlock', area, blockId, style: changes });

  return (
    <aside className={styles.inspector} aria-label={`${definition.label} settings`}>
      <div className={styles.inspectorHeader}>
        <h3><span aria-hidden="true">{definition.icon}</span> {definition.label}</h3>
        <button type="button" className={styles.smallButton} onClick={onClose}>Done</button>
      </div>
      <p className={styles.help}>{definition.description}</p>

      {(definition.fields.length > 0 || (area === 'index' && 'full_width' in definition.defaults)) && (
        <fieldset className={styles.fieldset}>
          <legend>Content</legend>
          {definition.fields.map((field) => (
            <FieldInput key={field.key} field={field} value={block.settings[field.key]} blockId={block.id} menus={menus}
              onChange={(value) => setSetting(field.key, value)} />
          ))}
          {area === 'index' && 'full_width' in definition.defaults && (
            <label className={styles.checkRow}>
              <input type="checkbox" checked={Boolean(block.settings.full_width)} onChange={(event) => setSetting('full_width', event.target.checked)} />
              <span>Full width<span className={styles.help}>Spans the page above or below the sidebar instead of sitting beside it.</span></span>
            </label>
          )}
        </fieldset>
      )}

      <fieldset className={styles.fieldset}>
        <legend>Style</legend>
        <label htmlFor={`align-${block.id}`}>Alignment
          <select id={`align-${block.id}`} value={block.style.align} onChange={(event) => setStyle({ align: event.target.value as ThemeBlock['style']['align'] })}>
            <option value="inherit">Theme default</option>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
          {containerDirection(area, containerId) === 'row' && <span className={styles.help}>In a row, Right pushes this block and everything after it to the right.</span>}
        </label>
        <label htmlFor={`padding-${block.id}`}>Padding (px)
          <input id={`padding-${block.id}`} type="number" min={0} max={200} value={block.style.padding}
            onChange={(event) => setStyle({ padding: Number(event.target.value) })} />
        </label>
        <ColorInput key={`bg-${block.id}-${block.style.background}`} id={`bg-${block.id}`} label="Background color" value={block.style.background} onChange={(background) => setStyle({ background })} />
        <ColorInput key={`fg-${block.id}-${block.style.color}`} id={`fg-${block.id}`} label="Text color" value={block.style.color} onChange={(color) => setStyle({ color })} />
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Visibility</legend>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={block.style.visible} onChange={(event) => setStyle({ visible: event.target.checked })} />
          <span>Visible<span className={styles.help}>Untick to keep the block and its settings without showing it.</span></span>
        </label>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={block.style.hide_mobile} onChange={(event) => setStyle({ hide_mobile: event.target.checked })} />
          <span>Hide on mobile (700px and narrower)</span>
        </label>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={block.style.hide_desktop} onChange={(event) => setStyle({ hide_desktop: event.target.checked })} />
          <span>Hide on desktop (wider than 700px)</span>
        </label>
      </fieldset>

      {layout.containers.length > 1 && (
        <label htmlFor={`container-${block.id}`} className={styles.inspectorField}>Position
          <select id={`container-${block.id}`} value={containerId}
            onChange={(event) => {
              const target = layout.containers.find((container) => container.id === event.target.value);
              if (target) dispatch({ type: 'moveBlock', area, blockId, containerId: target.id, index: target.blocks.length });
            }}>
            {layout.containers.map((container) => <option key={container.id} value={container.id}>{containerLabel(area, container.id)}</option>)}
          </select>
        </label>
      )}

      <div className={styles.inspectorActions}>
        {!definition.unique && (
          <button type="button" className={styles.smallButton} onClick={() => dispatch({ type: 'duplicateBlock', area, blockId })}>Duplicate</button>
        )}
        <button type="button" className={styles.dangerSmall} onClick={() => { dispatch({ type: 'removeBlock', area, blockId }); onClose(); }}>Delete block</button>
      </div>
    </aside>
  );
}

// Area settings ----------------------------------------------------------------------------------

export function AreaOptions({ area, layout, dispatch, moderation, onModerationChange }: {
  area: ThemeAreaId;
  layout: ThemeLayout;
  dispatch: Dispatch<EditorAction>;
  moderation: boolean | null;
  onModerationChange: (value: boolean) => void;
}) {
  const set = (options: Record<string, unknown>) => dispatch({ type: 'setOptions', area, options });
  let body: ReactNode = null;
  if (area === 'header' || area === 'sidebar') {
    const options = layout[area].options;
    body = (
      <label className={styles.checkRow}>
        <input type="checkbox" checked={options.sticky} onChange={(event) => set({ sticky: event.target.checked })} />
        <span>Sticky {area}<span className={styles.help}>{area === 'header' ? 'Stays at the top of the window while scrolling.' : 'Stays in view while the content scrolls (desktop only).'}</span></span>
      </label>
    );
  } else if (area === 'footer') {
    body = (
      <label className={styles.inlineField}>Footer columns
        <select value={layout.footer.options.columns} onChange={(event) => dispatch({ type: 'setFooterColumns', columns: Number(event.target.value) })}>
          {Array.from({ length: maxFooterColumns }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}
        </select>
        <span className={styles.help}>Removing columns moves their blocks into the last remaining column. Columns stack on mobile.</span>
      </label>
    );
  } else if (area === 'comments') {
    const options = layout.comments.options;
    body = (
      <>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={options.show_avatars} onChange={(event) => set({ show_avatars: event.target.checked })} />
          <span>Show avatars</span>
        </label>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={options.nested_replies} onChange={(event) => set({ nested_replies: event.target.checked })} />
          <span>Nested replies<span className={styles.help}>Off: no Reply buttons, and existing replies are listed flat by date. The indent depth is under Settings → Site.</span></span>
        </label>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={Boolean(moderation)} disabled={moderation === null} onChange={(event) => onModerationChange(event.target.checked)} />
          <span>Hold new comments for approval<span className={styles.help}>The same setting as Settings → Site → Comment moderation; saved with the theme.</span></span>
        </label>
        <label className={styles.inlineField}>Top-level comments per page
          <input type="number" min={0} max={200} value={options.per_page} onChange={(event) => set({ per_page: Number(event.target.value) })} />
          <span className={styles.help}>0 shows all. Only applies when the Comments pagination block is in the layout.</span>
        </label>
        <label className={styles.inlineField}>Order
          <select value={options.order} onChange={(event) => set({ order: event.target.value })}>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
      </>
    );
  } else if (area === 'index') {
    const options = layout.index.options;
    body = (
      <>
        <label className={styles.inlineField}>Sidebar position
          <select value={options.sidebar_position} onChange={(event) => set({ sidebar_position: event.target.value })}>
            <option value="right">Right</option>
            <option value="left">Left</option>
            <option value="hidden">Hidden</option>
          </select>
          <span className={styles.help}>Left and Right also apply to pages with Show sidebar ticked; Hidden applies to the home page only.</span>
        </label>
        <label className={styles.inlineField}>Pagination style
          <select value={options.pagination_style} onChange={(event) => set({ pagination_style: event.target.value })}>
            <option value="numbered">Numbered pages</option>
            <option value="prev-next">Newer / Older links</option>
            <option value="load-more">Load more button</option>
          </select>
          <span className={styles.help}>Needs the Pagination block. Posts per page is under Settings → Site.</span>
        </label>
      </>
    );
  }
  return (
    <fieldset className={`${styles.fieldset} ${styles.areaOptions}`}>
      <legend>Area settings</legend>
      {body}
    </fieldset>
  );
}

// Builder ----------------------------------------------------------------------------------------

export default function VisualBuilder({ area, layout, menus, dispatch }: {
  area: ThemeAreaId;
  layout: AnyAreaLayout;
  menus: MenuOption[];
  dispatch: Dispatch<EditorAction>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragData | null>(null);
  const [hint, setHint] = useState<DropHint | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const library = useMemo(() => blocksForArea(area), [area]);
  const selected = selectedId && findBlock(layout, selectedId) ? selectedId : null;

  const dropTarget = (event: DragMoveEvent | DragEndEvent): DropHint | null => {
    const data = event.over?.data.current as DropData | undefined;
    if (!event.over || !data) return null;
    const container = layout.containers.find((item) => item.id === data.containerId);
    if (!container) return null;
    if (data.kind === 'container') return { containerId: container.id, index: container.blocks.length };
    const index = container.blocks.findIndex((item) => item.id === data.blockId);
    const start = event.activatorEvent as PointerEvent;
    const x = (start?.clientX ?? 0) + event.delta.x;
    const y = (start?.clientY ?? 0) + event.delta.y;
    const { rect } = event.over;
    const before = containerDirection(area, container.id) === 'row' ? x < rect.left + rect.width / 2 : y < rect.top + rect.height / 2;
    return { containerId: container.id, index: before ? index : index + 1 };
  };

  const onDragStart = (event: DragStartEvent) => {
    setDrag((event.active.data.current as DragData | undefined) || null);
    setHint(null);
  };

  const onDragMove = (event: DragMoveEvent) => {
    const next = dropTarget(event);
    if (next?.containerId !== hint?.containerId || next?.index !== hint?.index) setHint(next);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const item = event.active.data.current as DragData | undefined;
    const target = dropTarget(event);
    setDrag(null);
    setHint(null);
    if (!item || !target) return;
    if (item.kind === 'new') {
      const block = createBlock(item.blockType);
      dispatch({ type: 'addBlock', area, block, containerId: target.containerId, index: target.index });
      setSelectedId(block.id);
      return;
    }
    const found = findBlock(layout, item.blockId);
    // Dropping a block just before or after itself changes nothing, so it must not add an undo step.
    if (!found || (found.containerId === target.containerId && (target.index === found.index || target.index === found.index + 1))) return;
    dispatch({ type: 'moveBlock', area, blockId: item.blockId, containerId: target.containerId, index: target.index });
  };

  const addFromLibrary = (definition: BlockDefinition) => {
    const block = createBlock(definition.type);
    const anchor = selected ? findBlock(layout, selected) : null;
    const container = anchor
      ? layout.containers.find((item) => item.id === anchor.containerId)!
      : layout.containers[0];
    dispatch({ type: 'addBlock', area, block, containerId: container.id, index: anchor ? anchor.index + 1 : container.blocks.length });
    setSelectedId(block.id);
  };

  const renderContainer = (container: ThemeContainer) => (
    <DropContainer key={container.id} area={area} container={container} hint={drag ? hint : null} empty={container.blocks.length === 0}>
      {container.blocks.map((block, index) => (
        <Fragment key={block.id}>
          {drag && hint?.containerId === container.id && hint.index === index && <div className={styles.dropLine} aria-hidden="true" />}
          <BlockCard block={block} area={area} containerId={container.id} index={index} count={container.blocks.length}
            selected={selected === block.id} menus={menus} onSelect={setSelectedId} dispatch={dispatch} />
        </Fragment>
      ))}
      {drag && hint?.containerId === container.id && hint.index === container.blocks.length && <div className={styles.dropLine} aria-hidden="true" />}
    </DropContainer>
  );

  const columns = layout.containers.filter((container) => container.id !== 'bottom');
  const bottom = layout.containers.find((container) => container.id === 'bottom');

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection}
      onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={() => { setDrag(null); setHint(null); }}>
      <div className={styles.builder}>
        <aside className={styles.library} aria-labelledby="theme-library-heading">
          <h3 id="theme-library-heading">Block library</h3>
          <p className={styles.help}>Drag a block onto the canvas{selected ? ', or Add to place it after the selected block' : ', or use Add'}.</p>
          <ul>
            {library.map((definition) => (
              <LibraryItem key={definition.type} definition={definition}
                disabled={Boolean(definition.unique && areaHasType(layout, definition.type))}
                onAdd={() => addFromLibrary(definition)} />
            ))}
          </ul>
        </aside>

        <div className={`${styles.canvas} ${styles[`canvas_${area}`] || ''}`}>
          {area === 'footer' ? (
            <>
              <div className={styles.footerColumns} style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
                {columns.map(renderContainer)}
              </div>
              {bottom && renderContainer(bottom)}
            </>
          ) : layout.containers.map(renderContainer)}
        </div>

        {selected ? (
          <Inspector area={area} layout={layout} blockId={selected} menus={menus} dispatch={dispatch} onClose={() => setSelectedId(null)} />
        ) : (
          <aside className={`${styles.inspector} ${styles.inspectorEmpty}`}>
            <p>Select a block to change its content, alignment, padding, colors and visibility.</p>
          </aside>
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {drag ? <div className={styles.dragChip}>{drag.label}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}
