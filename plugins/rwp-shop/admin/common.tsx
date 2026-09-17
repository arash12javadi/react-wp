import { useState, type ReactNode } from 'react';
import MediaManager from '../../../src/components/MediaManager';
import { orderStatusLabels, type OrderStatus } from '../lib/types';
import styles from './admin.module.css';

export function Tabs<T extends string>({ tabs, active, onChange, variant = 'tabs' }: {
  tabs: Array<[T, string]>;
  active: T;
  onChange: (tab: T) => void;
  variant?: 'tabs' | 'pills';
}) {
  const container = variant === 'tabs' ? styles.tabs : styles.subTabs;
  return (
    <div className={container} role="tablist">
      {tabs.map(([id, label]) => {
        const selected = id === active;
        const className = variant === 'tabs'
          ? (selected ? styles.tabActive : styles.tab)
          : (selected ? styles.subTabActive : styles.subTab);
        return (
          <button key={id} type="button" role="tab" aria-selected={selected} className={className} onClick={() => onChange(id)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Feedback({ error, success }: { error?: string; success?: string }) {
  return (
    <>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {success && <div className={styles.success} role="status">{success}</div>}
    </>
  );
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`${styles.status} ${styles[`status_${status}`] || ''}`}>{orderStatusLabels[status] || status}</span>;
}

/** Opens the site media library as a picker. */
export function ImagePicker({ value, onChange, label = 'Set image' }: { value: string | null; onChange: (url: string | null) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.boxed}>
      {value ? (
        <div className={styles.imageTile} style={{ width: '100%', height: 180 }}>
          <img src={value} alt="" />
          <button type="button" aria-label="Remove image" onClick={() => onChange(null)}>×</button>
        </div>
      ) : null}
      <button type="button" className={styles.buttonSecondary} onClick={() => setOpen(true)}>{value ? 'Replace image' : label}</button>
      {open && (
        <MediaManager
          heading="Choose image"
          onClose={() => setOpen(false)}
          onSelect={(item) => { onChange(item.url); setOpen(false); }}
        />
      )}
    </div>
  );
}

export function GalleryPicker({ value, onChange }: { value: string[]; onChange: (urls: string[]) => void }) {
  const [open, setOpen] = useState(false);
  // Positions, not URLs: the same image may be added twice.
  const [marked, setMarked] = useState<number[]>([]);
  const update = (urls: string[]) => { setMarked([]); onChange(urls); };
  const liveMarked = marked.filter((index) => index < value.length);
  const allMarked = value.length > 0 && liveMarked.length === value.length;
  const toggleMark = (index: number) =>
    setMarked((current) => (current.includes(index) ? current.filter((entry) => entry !== index) : [...current, index]));
  return (
    <div className={styles.boxed}>
      {value.length > 0 && (
        <div className={styles.imageRow}>
          {value.map((url, index) => (
            <div key={`${url}-${index}`} className={liveMarked.includes(index) ? styles.imageTileMarked : styles.imageTile}>
              <img src={url} alt="" />
              <input type="checkbox" className={styles.imageTileCheck} checked={liveMarked.includes(index)}
                aria-label={`Select gallery image ${index + 1}`} onChange={() => toggleMark(index)} />
              <button type="button" aria-label="Remove from gallery" onClick={() => update(value.filter((_, i) => i !== index))}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className={styles.imageActions}>
        <button type="button" className={styles.buttonSecondary} onClick={() => setOpen(true)}>Add gallery images</button>
        {value.length > 0 && (
          <button type="button" className={styles.buttonSecondary}
            onClick={() => setMarked(allMarked ? [] : value.map((_, index) => index))}>
            {allMarked ? 'Deselect all' : 'Select all'}
          </button>
        )}
        {liveMarked.length > 0 && (
          <button type="button" className={styles.buttonDanger}
            onClick={() => update(value.filter((_, index) => !liveMarked.includes(index)))}>
            Remove selected ({liveMarked.length})
          </button>
        )}
        {value.length > 0 && (
          <button type="button" className={styles.buttonDanger} onClick={() => update([])}>Clear all</button>
        )}
      </div>
      {open && (
        <MediaManager
          heading="Add to product gallery"
          onClose={() => setOpen(false)}
          onSelect={(item) => { update([...value, item.url]); setOpen(false); }}
          onSelectMany={(items) => { update([...value, ...items.map((item) => item.url)]); setOpen(false); }}
        />
      )}
    </div>
  );
}

export function Field({ label, hint, children, full = false }: { label: string; hint?: ReactNode; children: ReactNode; full?: boolean }) {
  return (
    <label className={`${styles.field} ${full ? styles.full : ''}`}>
      {label}
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
    </label>
  );
}

/** Empty inputs become null, so a cleared price is stored as "no price" rather than 0. */
export const numberOrNull = (value: string): number | null => {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const slugify = (value: string) => value
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 190);

export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (next: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const parts = draft.split(/[,|]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setDraft('');
  };
  return (
    <div className={styles.boxed} style={{ padding: 8 }}>
      <div className={styles.pillList}>
        {value.map((item) => (
          <span key={item} className={styles.pill}>
            {item}
            <button type="button" aria-label={`Remove ${item}`} onClick={() => onChange(value.filter((entry) => entry !== item))}>×</button>
          </span>
        ))}
      </div>
      <input className={styles.input} value={draft} placeholder={placeholder || 'Type and press Enter'}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commit();
          }
        }} />
    </div>
  );
}
