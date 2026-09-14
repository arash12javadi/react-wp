import { useMemo, useState, type ReactNode } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Lock, Search } from 'lucide-react';
import { Icon } from '../lib/icons';
import { categoryLabels, getWidgets, type WidgetCategory } from '../lib/registry';
import { useEditor, useStore, type DragItem } from './store';
import styles from './editor.module.css';

const sectionPresets: Array<{ label: string; widths: number[] }> = [
  { label: '1 column', widths: [100] },
  { label: '2 columns', widths: [50, 50] },
  { label: '3 columns', widths: [33.333, 33.333, 33.334] },
  { label: '4 columns', widths: [25, 25, 25, 25] },
  { label: '1/3 + 2/3', widths: [33.333, 66.667] },
  { label: '2/3 + 1/3', widths: [66.667, 33.333] },
];

function PanelItem({ id, item, onActivate, children, className }: { id: string; item: DragItem; onActivate: () => void; children: ReactNode; className?: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: item });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`${className || styles.widgetCard}${isDragging ? ` ${styles.isDragging}` : ''}`}
      {...attributes}
      {...listeners}
      // A click (no drag) adds the item: keyboard and touch users need a way in too.
      onClick={onActivate}
      title={`Drag onto the page, or click to add: ${item.label}`}
    >
      {children}
    </button>
  );
}

function SectionPreview({ widths }: { widths: number[] }) {
  return (
    <span className={styles.sectionPreview} aria-hidden="true">
      {widths.map((width, index) => <span key={index} style={{ flexBasis: `${width}%` }} />)}
    </span>
  );
}

export default function WidgetPanel() {
  const { actions } = useStore();
  const canManageOptions = useEditor((state) => state.canManageOptions);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const widgets = getWidgets();

  const grouped = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matches = widgets.filter((widget) => !term
      || widget.label.toLowerCase().includes(term)
      || widget.keywords?.some((keyword) => keyword.includes(term)));
    return (['basic', 'pro', 'dynamic', 'layout'] as WidgetCategory[])
      .map((category) => ({ category, items: matches.filter((widget) => widget.category === category) }))
      .filter((group) => group.items.length);
  }, [widgets, query]);

  const showLayout = !query.trim() || 'section columns inner'.includes(query.trim().toLowerCase());

  return (
    <div className={styles.panel}>
      <label className={styles.search}>
        <Search size={15} aria-hidden="true" />
        <input type="search" placeholder="Search widgets…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search widgets" />
      </label>

      {showLayout && (
        <section className={styles.widgetGroup}>
          <h3>Layout</h3>
          <div className={styles.presetGrid}>
            {sectionPresets.map((preset) => (
              <PanelItem key={preset.label} id={`preset:${preset.label}`} className={styles.presetCard}
                item={{ source: 'section', widths: preset.widths, inner: false, label: `Section · ${preset.label}` }}
                onActivate={() => actions.addSection(preset.widths)}>
                <SectionPreview widths={preset.widths} />
                <span>{preset.label}</span>
              </PanelItem>
            ))}
          </div>
          <div className={styles.widgetGrid}>
            <PanelItem id="inner-section" item={{ source: 'section', widths: [50, 50], inner: true, label: 'Inner section' }}
              onActivate={() => setNotice(actions.addInnerSectionToSelection()
                ? ''
                : 'Select a column or a widget in a top-level section first, or drag the inner section into a column.')}>
              <Icon name="columns" size={22} />
              <span>Inner Section</span>
            </PanelItem>
          </div>
          <p className={notice ? styles.hintWarning : styles.hint} role={notice ? 'alert' : undefined}>{notice || 'Drag an inner section into a column to nest two more columns.'}</p>
        </section>
      )}

      {grouped.map(({ category, items }) => (
        <section key={category} className={styles.widgetGroup}>
          <h3>{categoryLabels[category]}</h3>
          <div className={styles.widgetGrid}>
            {items.map((widget) => {
              const locked = widget.adminOnly && !canManageOptions;
              return (
                <PanelItem key={widget.type} id={`widget:${widget.type}`}
                  item={{ source: 'widget', widgetType: widget.type, label: widget.label }}
                  onActivate={() => actions.addWidgetToSelection(widget.type)}>
                  <Icon name={widget.icon} size={22} />
                  <span>{widget.label}</span>
                  {locked && <Lock size={12} className={styles.lockIcon} aria-label="Administrators only" />}
                </PanelItem>
              );
            })}
          </div>
        </section>
      ))}
      {!grouped.length && !showLayout && <p className={styles.hint}>No widgets match “{query}”.</p>}
      {!canManageOptions && <p className={styles.hint}><Lock size={11} /> Custom HTML can be placed by anyone, but only an administrator can save it, because its code runs in visitors&apos; browsers.</p>}
    </div>
  );
}
