import { useCallback, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import styles from './BulkActions.module.css';

type Id = string | number;

/**
 * Row selection for admin lists. Only ids still in `visibleIds` count as selected, so changing a
 * filter or search never leaves hidden rows selected for a bulk action.
 */
export function useBulkSelection<T extends Id>(visibleIds: T[]) {
  const [picked, setPicked] = useState<T[]>([]);
  const anchor = useRef<T | null>(null);
  const selected = useMemo(() => picked.filter((id) => visibleIds.includes(id)), [picked, visibleIds]);
  const allSelected = visibleIds.length > 0 && selected.length === visibleIds.length;

  const toggle = useCallback((id: T, range = false) => {
    const from = anchor.current;
    setPicked((current) => {
      if (range && from !== null && from !== id) {
        const start = visibleIds.indexOf(from);
        const end = visibleIds.indexOf(id);
        if (start >= 0 && end >= 0) {
          const span = visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1);
          return [...current, ...span.filter((entry) => !current.includes(entry))];
        }
      }
      return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
    });
    anchor.current = id;
  }, [visibleIds]);

  const toggleAll = useCallback(() => {
    setPicked((current) => (allSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : [...current, ...visibleIds.filter((id) => !current.includes(id))]));
  }, [allSelected, visibleIds]);

  const clear = useCallback(() => setPicked([]), []);
  const isSelected = useCallback((id: T) => selected.includes(id), [selected]);

  return { selected, allSelected, toggle, toggleAll, clear, isSelected };
}

export type BulkSelection<T extends Id> = ReturnType<typeof useBulkSelection<T>>;

const shiftHeld = (event: ChangeEvent<HTMLInputElement>) => Boolean((event.nativeEvent as Partial<MouseEvent>).shiftKey);

/** The header checkbox: ticks every visible row, and shows a dash when only some are ticked. */
export function SelectAllCheckbox<T extends Id>({ selection, total, label = 'Select all' }: {
  selection: BulkSelection<T>;
  total: number;
  label?: string;
}) {
  return (
    <input
      type="checkbox"
      className={styles.checkbox}
      aria-label={label}
      disabled={total === 0}
      checked={selection.allSelected}
      ref={(input) => { if (input) input.indeterminate = selection.selected.length > 0 && !selection.allSelected; }}
      onChange={selection.toggleAll}
    />
  );
}

/** A row checkbox. Shift-click ticks every row between this one and the last one clicked. */
export function RowCheckbox<T extends Id>({ selection, id, label }: { selection: BulkSelection<T>; id: T; label: string }) {
  return (
    <input
      type="checkbox"
      className={styles.checkbox}
      aria-label={`Select ${label}`}
      checked={selection.isSelected(id)}
      onChange={(event) => selection.toggle(id, shiftHeld(event))}
    />
  );
}

export interface BulkAction {
  id: string;
  label: string;
  tone?: 'default' | 'primary' | 'danger';
  hidden?: boolean;
}

/** The bar above a list: selection count and the actions that apply to the selected rows. */
export function BulkBar<T extends Id>({ selection, total, noun, actions, busy, onAction, children }: {
  selection: BulkSelection<T>;
  total: number;
  /** Plural noun, e.g. "pages". */
  noun: string;
  actions: BulkAction[];
  busy?: string;
  onAction: (id: string, selected: T[]) => void;
  /** Extra controls (e.g. a "change role to" picker), shown while something is selected. */
  children?: ReactNode;
}) {
  const count = selection.selected.length;
  if (total === 0) return null;
  return (
    <div className={styles.bar} role="region" aria-label="Bulk actions">
      <label className={styles.selectAll}>
        <SelectAllCheckbox selection={selection} total={total} />
        {selection.allSelected ? 'Deselect all' : `Select all (${total})`}
      </label>
      {count === 0 ? (
        <span className={styles.hint}>Tick {noun} to act on several at once. Shift-click selects a range.</span>
      ) : (
        <>
          <span className={styles.count}>{count} selected</span>
          <button type="button" className={styles.ghost} onClick={selection.clear} disabled={Boolean(busy)}>Clear</button>
          <span className={styles.divider} aria-hidden="true" />
          {actions.filter((action) => !action.hidden).map((action) => (
            <button
              key={action.id}
              type="button"
              className={action.tone === 'danger' ? styles.danger : action.tone === 'primary' ? styles.primary : styles.button}
              disabled={Boolean(busy)}
              onClick={() => onAction(action.id, selection.selected)}
            >
              {busy === action.id ? 'Working…' : action.label}
            </button>
          ))}
          {children}
        </>
      )}
    </div>
  );
}

/** Groups a select and its Apply button inside a BulkBar. */
export function BulkInline({ children }: { children: ReactNode }) {
  return <span className={styles.inline}>{children}</span>;
}

/** Downloads rows as a UTF-8 CSV that spreadsheet apps open without mangling accents or formulas. */
export function downloadCsv(fileName: string, header: string[], rows: Array<Array<string | number | null | undefined>>) {
  const cell = (value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? '' : String(value);
    // A leading = + - @ makes spreadsheet apps evaluate the cell as a formula.
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** Describes how many of the requested rows a bulk write actually changed. */
export const describeBulkResult = (verb: string, requested: number, changed: number, noun: string, blockedReason: string) => {
  if (changed === requested) return { success: `${verb} ${changed} ${noun}.`, error: '' };
  return {
    success: changed ? `${verb} ${changed} ${noun}.` : '',
    error: `${requested - changed} of ${requested} ${noun} were not changed: ${blockedReason}`,
  };
};
