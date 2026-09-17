import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowUp, ChevronDown, Copy, Database, Link2, Monitor,
  Plus, RotateCcw, Smartphone, Tablet, Trash2, Unlink,
} from 'lucide-react';
import ClassicEditor from '../../../src/components/ClassicEditor';
import MediaManager from '../../../src/components/MediaManager';
import { opts } from '../lib/controls';
import { dynamicTags } from '../lib/dynamic';
import { fontChoices, globalColorLabels } from '../lib/globals';
import { Icon, iconNames } from '../lib/icons';
import type { Control, ControlOption } from '../lib/registry';
import type { Background, Border, Box, Shadow, SizeValue, Typography } from '../lib/style';
import type { Device, FormField } from '../lib/types';
import { fetchCategories, fetchMenus, type MenuRecord } from '../render/data';
import { formFieldTypes, newField } from '../render/widgets/form';
import styles from './editor.module.css';

type Value = unknown;

export interface ControlProps {
  control: Control;
  value: Value;
  onChange: (value: Value) => void;
  /** Node kind, for controls that differ (overlays exist on sections and columns only). */
  kind?: string;
  /** The whole settings object, for controls that edit more than one key (form email). */
  settings?: Record<string, unknown>;
  onSettingChange?: (key: string, value: Value) => void;
}

const deviceIcons: Record<Device, typeof Monitor> = { desktop: Monitor, tablet: Tablet, mobile: Smartphone };

export function Row({ label, children, device, inherited, onReset, help, htmlFor, action }: {
  label: string; children: ReactNode; device?: Device; inherited?: boolean; onReset?: () => void; help?: string; htmlFor?: string; action?: ReactNode;
}) {
  const DeviceIcon = device ? deviceIcons[device] : null;
  return (
    <div className={styles.control}>
      <div className={styles.controlLabel}>
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
        {DeviceIcon && <DeviceIcon size={12} className={styles.deviceHint} aria-label={`Value for ${device}`} />}
        {inherited && <span className={styles.inherited} title="Inherited from a larger device">inherited</span>}
        {onReset && <button type="button" className={styles.resetButton} title="Remove this device's override" aria-label="Reset to inherited value" onClick={onReset}><RotateCcw size={11} /></button>}
        {action}
      </div>
      {children}
      {help && <p className={styles.controlHelp}>{help}</p>}
    </div>
  );
}

const POPOVER_WIDTH = 300;
const POPOVER_GAP = 6;
const VIEWPORT_MARGIN = 8;

/**
 * Inserts a {{tag}} at the end of a text value.
 *
 * The list is portalled into the editor shell with fixed positioning. Rendered in place, it was
 * clipped by the sidebar's scroll container, and anchored by its right edge it opened off the
 * left of the screen whenever the button sat at the start of a row (the rich text control).
 */
export function DynamicTagButton({ onInsert }: { onInsert: (tag: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchId = useId();

  const place = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    // Start at the button's left edge; slide left only as far as needed to stay on screen.
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN));
    const below = window.innerHeight - rect.bottom - POPOVER_GAP - VIEWPORT_MARGIN;
    const above = rect.top - POPOVER_GAP - VIEWPORT_MARGIN;
    const openAbove = below < 260 && above > below;
    const maxHeight = Math.max(160, Math.min(420, openAbove ? above : below));
    setPosition({ left, maxHeight, top: openAbove ? rect.top - POPOVER_GAP - maxHeight : rect.bottom + POPOVER_GAP });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey, true);
    // Capture: the sidebar scrolls inside its own container, not the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const term = query.trim().toLowerCase();
  const matches = dynamicTags.filter((tag) => !term || tag.label.toLowerCase().includes(term) || tag.tag.includes(term) || tag.group.toLowerCase().includes(term));
  const groups = [...new Set(matches.map((tag) => tag.group))];
  const host = typeof document === 'undefined' ? null : buttonRef.current?.closest<HTMLElement>('[data-rwpb-shell]') || document.body;

  const insert = (tag: string) => {
    onInsert(`{{${tag}}}`);
    setOpen(false);
    setQuery('');
    buttonRef.current?.focus();
  };

  return (
    <div className={styles.popoverAnchor}>
      <button ref={buttonRef} type="button" className={styles.tagButton} title="Insert a dynamic tag" aria-label="Insert a dynamic tag"
        aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Database size={13} />
      </button>
      {open && position && host && createPortal(
        <div ref={popoverRef} className={styles.popover} role="dialog" aria-label="Dynamic tags"
          style={{ top: position.top, left: position.left, maxHeight: position.maxHeight, width: Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2) }}>
          <div className={styles.popoverHead}>
            <strong><Database size={13} /> Dynamic tags</strong>
            <button type="button" className={styles.popoverClose} aria-label="Close" onClick={() => setOpen(false)}>×</button>
          </div>
          <label className={styles.srOnly} htmlFor={searchId}>Search dynamic tags</label>
          <input id={searchId} className={styles.popoverSearch} type="search" placeholder="Search tags…" value={query} autoFocus
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && matches[0]) { event.preventDefault(); insert(matches[0].tag); } }} />
          <div className={styles.popoverList}>
            {groups.map((group) => (
              <div key={group} role="group" aria-label={group}>
                <p className={styles.popoverGroup}>{group}</p>
                {matches.filter((tag) => tag.group === group).map((tag) => (
                  <button key={tag.tag} type="button" className={styles.popoverItem} onClick={() => insert(tag.tag)}>
                    <span>{tag.label}</span>
                    <code>{`{{${tag.tag}}}`}</code>
                  </button>
                ))}
              </div>
            ))}
            {!matches.length && <p className={styles.popoverNote}>No tags match “{query}”.</p>}
          </div>
          <p className={styles.popoverFoot}>Add a fallback after a bar: <code>{'{{user.name|there}}'}</code>. For url.param, replace NAME with the parameter.</p>
        </div>,
        host,
      )}
    </div>
  );
}

const asString = (value: Value) => (value === undefined || value === null ? '' : String(value));
const numberOrUndefined = (text: string) => (text.trim() === '' ? undefined : Number(text));

function TextControl({ control, value, onChange }: ControlProps) {
  const id = useId();
  const input = control.type === 'textarea'
    ? <textarea id={id} className={styles.input} rows={3} value={asString(value)} placeholder={control.placeholder} onChange={(event) => onChange(event.target.value)} />
    : <input id={id} className={styles.input} value={asString(value)} placeholder={control.placeholder} onChange={(event) => onChange(event.target.value)} />;
  return (
    <div className={styles.inputWithTag}>
      {input}
      {control.dynamic && <DynamicTagButton onInsert={(tag) => onChange(`${asString(value)}${tag}`)} />}
    </div>
  );
}

function NumberControl({ control, value, onChange }: ControlProps) {
  return <input className={styles.input} type="number" min={control.min} max={control.max} step={control.step} value={asString(value)} onChange={(event) => onChange(numberOrUndefined(event.target.value))} />;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={checked ? styles.switchOn : styles.switch} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function SelectControl({ control, value, onChange }: ControlProps) {
  const options = control.options || [];
  const current = asString(value);
  return (
    <select className={styles.input} value={options.some((option) => option.value === current) ? current : options[0]?.value ?? ''} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

function SliderControl({ control, value, onChange }: ControlProps) {
  const min = control.min ?? 0;
  const max = control.max ?? 100;
  return (
    <div className={styles.slider}>
      <input type="range" min={min} max={max} step={control.step ?? 1} value={value === undefined || value === '' ? min : Number(value)} onChange={(event) => onChange(Number(event.target.value))} />
      <input className={styles.input} type="number" min={min} max={max} step={control.step ?? 1} value={asString(value)} onChange={(event) => onChange(numberOrUndefined(event.target.value))} />
    </div>
  );
}

function UnitSelect({ units, value, onChange }: { units: string[]; value?: string; onChange: (unit: string) => void }) {
  if (units.length < 2) return <span className={styles.unit}>{units[0] || 'px'}</span>;
  return (
    <select className={styles.unitSelect} value={value || units[0]} onChange={(event) => onChange(event.target.value)} aria-label="Unit">
      {units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
    </select>
  );
}

function SizeControl({ control, value, onChange }: ControlProps) {
  const current = (value || {}) as SizeValue;
  const units = control.units || ['px'];
  return (
    <div className={styles.sizeRow}>
      <input className={styles.input} type="number" value={asString(current.size)} onChange={(event) => onChange({ ...current, size: numberOrUndefined(event.target.value), unit: current.unit || units[0] })} />
      <UnitSelect units={units} value={current.unit} onChange={(unit) => onChange({ ...current, unit })} />
    </div>
  );
}

function DimensionsControl({ control, value, onChange }: ControlProps) {
  const current = (value || {}) as Box;
  const [linked, setLinked] = useState(() => current.top !== undefined && current.top === current.right && current.top === current.bottom && current.top === current.left);
  const units = control.units || ['px'];
  const sides: Array<keyof Box> = ['top', 'right', 'bottom', 'left'];
  const set = (side: keyof Box, text: string) => {
    const number = text.trim() === '' ? undefined : Number(text);
    const next = linked ? { ...current, top: number, right: number, bottom: number, left: number } : { ...current, [side]: number };
    onChange({ ...next, unit: current.unit || units[0] });
  };
  return (
    <div className={styles.dimensions}>
      {sides.map((side) => (
        <label key={side}>
          <input className={styles.input} type="number" value={asString(current[side])} onChange={(event) => set(side, event.target.value)} />
          <span>{side}</span>
        </label>
      ))}
      <button type="button" className={linked ? styles.linkOn : styles.linkOff} title={linked ? 'Unlink values' : 'Link values'} aria-pressed={linked} onClick={() => setLinked((value) => !value)}>
        {linked ? <Link2 size={14} /> : <Unlink size={14} />}
      </button>
      <UnitSelect units={units} value={current.unit} onChange={(unit) => onChange({ ...current, unit })} />
    </div>
  );
}

export function ColorInput({ value, onChange, allowGlobal = true }: { value: Value; onChange: (value: string | undefined) => void; allowGlobal?: boolean }) {
  const text = asString(value);
  const isGlobal = text.startsWith('global:');
  const hex = /^#[0-9a-f]{6}$/i.test(text) ? text : '#000000';
  return (
    <div className={styles.colorControl}>
      <div className={styles.colorRow}>
        <span className={styles.swatch} style={{ background: isGlobal ? `var(--rwpb-${text.slice(7)})` : text || 'transparent' }}>
          {!isGlobal && <input type="color" value={hex} onChange={(event) => onChange(event.target.value)} aria-label="Pick a colour" />}
        </span>
        <input className={styles.input} value={isGlobal ? `Global: ${globalColorLabels[text.slice(7) as keyof typeof globalColorLabels] || text.slice(7)}` : text}
          readOnly={isGlobal} placeholder="#hex, rgba() or blank" onChange={(event) => onChange(event.target.value || undefined)}
          onFocus={(event) => { if (isGlobal) event.currentTarget.select(); }} />
        {text && <button type="button" className={styles.clearButton} aria-label="Clear colour" onClick={() => onChange(undefined)}>×</button>}
      </div>
      {allowGlobal && (
        <div className={styles.globalChips}>
          {(Object.keys(globalColorLabels) as Array<keyof typeof globalColorLabels>).map((key) => (
            <button key={key} type="button" title={`Use the global ${globalColorLabels[key]} colour`} aria-pressed={text === `global:${key}`}
              className={text === `global:${key}` ? styles.chipActive : styles.chip} onClick={() => onChange(`global:${key}`)}>
              <span style={{ background: `var(--rwpb-${key})` }} />{globalColorLabels[key]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ImageControl({ control, value, onChange }: ControlProps) {
  const [open, setOpen] = useState(false);
  const url = asString(value);
  const isTag = url.includes('{{');
  return (
    <div className={styles.imageControl}>
      {url && !isTag && <img src={url} alt="" className={styles.imagePreview} />}
      {isTag && <p className={styles.tagPreview}><Database size={12} /> {url}</p>}
      <div className={styles.inputWithTag}>
        <input className={styles.input} value={url} placeholder="https://… or choose from the library" onChange={(event) => onChange(event.target.value)} />
        {control.dynamic && <DynamicTagButton onInsert={(tag) => onChange(tag)} />}
      </div>
      <div className={styles.buttonRow}>
        <button type="button" className={styles.smallButton} onClick={() => setOpen(true)}>{url ? 'Replace' : 'Choose image'}</button>
        {url && <button type="button" className={styles.smallButtonGhost} onClick={() => onChange('')}>Remove</button>}
      </div>
      {open && <MediaManager heading="Choose image" onClose={() => setOpen(false)} onSelect={(item) => { onChange(item.url); setOpen(false); }} />}
    </div>
  );
}

function LinkControl({ control, value, onChange }: ControlProps) {
  const link = (value && typeof value === 'object' ? value : { url: asString(value) }) as { url?: string; newTab?: boolean; nofollow?: boolean };
  return (
    <div className={styles.stack}>
      <div className={styles.inputWithTag}>
        <input className={styles.input} value={link.url || ''} placeholder={control.placeholder} onChange={(event) => onChange({ ...link, url: event.target.value })} />
        {control.dynamic && <DynamicTagButton onInsert={(tag) => onChange({ ...link, url: tag })} />}
      </div>
      <label className={styles.checkRow}><input type="checkbox" checked={Boolean(link.newTab)} onChange={(event) => onChange({ ...link, newTab: event.target.checked })} /> Open in a new tab</label>
      <label className={styles.checkRow}><input type="checkbox" checked={Boolean(link.nofollow)} onChange={(event) => onChange({ ...link, nofollow: event.target.checked })} /> Add nofollow</label>
    </div>
  );
}

function RichTextControl({ control, value, onChange }: ControlProps) {
  return (
    <div className={styles.stack}>
      <div className={styles.richText}>
        <ClassicEditor value={asString(value)} onChange={onChange} />
      </div>
      {control.dynamic && (
        <div className={styles.tagRow}>
          <DynamicTagButton onInsert={(tag) => onChange(`${asString(value)}<p>${tag}</p>`)} />
          <span className={styles.controlHelp}>Insert a dynamic tag (added as a new paragraph at the end)</span>
        </div>
      )}
    </div>
  );
}

function IconControl({ value, onChange }: ControlProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = asString(value);
  const matches = iconNames.filter((name) => name.includes(query.trim().toLowerCase()));
  return (
    <div className={styles.stack}>
      <div className={styles.buttonRow}>
        <span className={styles.iconPreview}>{current ? <Icon name={current} size={20} /> : '—'}</span>
        <button type="button" className={styles.smallButton} aria-expanded={open} onClick={() => setOpen((state) => !state)}>{open ? 'Close' : 'Choose icon'}</button>
        {current && <button type="button" className={styles.smallButtonGhost} onClick={() => onChange('')}>None</button>}
      </div>
      {open && (
        <div className={styles.iconPicker}>
          <input className={styles.input} type="search" placeholder="Search icons…" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
          <div className={styles.iconGrid}>
            {matches.map((name) => (
              <button key={name} type="button" title={name} aria-label={name} aria-pressed={name === current} className={name === current ? styles.iconChoiceActive : styles.iconChoice}
                onClick={() => { onChange(name); setOpen(false); }}>
                <Icon name={name} size={18} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CodeControl({ control, value, onChange }: ControlProps) {
  return (
    <textarea
      className={styles.code}
      spellCheck={false}
      rows={control.language === 'css' ? 6 : 8}
      value={asString(value)}
      placeholder={control.language === 'css' ? 'selector { }' : ''}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        event.preventDefault();
        const target = event.currentTarget;
        const { selectionStart, selectionEnd } = target;
        const next = `${target.value.slice(0, selectionStart)}  ${target.value.slice(selectionEnd)}`;
        onChange(next);
        requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = selectionStart + 2; });
      }}
    />
  );
}

const alignIcons: Record<string, typeof AlignLeft> = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify };

function AlignControl({ control, value, onChange }: ControlProps) {
  return (
    <div className={styles.segmented} role="radiogroup">
      {(control.options || []).map((option) => {
        const AlignIcon = alignIcons[option.value];
        return (
          <button key={option.value} type="button" role="radio" aria-checked={value === option.value} title={option.label} aria-label={option.label}
            className={value === option.value ? styles.segmentActive : styles.segment} onClick={() => onChange(value === option.value ? undefined : option.value)}>
            {AlignIcon ? <AlignIcon size={15} /> : option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A group of related fields behind a disclosure, like Elementor's typography popover. */
function Group({ summary, children, active }: { summary: string; children: ReactNode; active: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.group}>
      <button type="button" className={styles.groupToggle} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>{summary}</span>
        {active && <span className={styles.groupDot} aria-label="Customised" />}
        <ChevronDown size={14} className={open ? styles.rotated : undefined} />
      </button>
      {open && <div className={styles.groupBody}>{children}</div>}
    </div>
  );
}

const weightOptions = opts(['', 'Default'], ['300', '300 Light'], ['400', '400 Normal'], ['500', '500 Medium'], ['600', '600 Semi-bold'], ['700', '700 Bold'], ['800', '800 Extra-bold']);

function MiniField({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.miniField}><span>{label}</span>{children}</label>;
}

function MiniSelect({ value, options, onChange }: { value: Value; options: ControlOption[]; onChange: (value: string | undefined) => void }) {
  return (
    <select className={styles.input} value={asString(value)} onChange={(event) => onChange(event.target.value || undefined)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

function TypographyControl({ value, onChange }: ControlProps) {
  const current = (value || {}) as Typography;
  const set = (key: keyof Typography, next: Value) => onChange({ ...current, [key]: next === '' ? undefined : next });
  const active = Object.values(current).some((item) => item !== undefined && item !== '');
  return (
    <Group summary={current.family || current.size ? [current.family?.replace('global:', 'Global '), current.size ? `${current.size}${current.sizeUnit || 'px'}` : ''].filter(Boolean).join(' · ') : 'Default'} active={active}>
      <MiniField label="Family">
        <MiniSelect value={current.family} onChange={(next) => set('family', next)} options={[
          { value: '', label: 'Default' }, { value: 'global:primary', label: 'Global: primary font' }, { value: 'global:headings', label: 'Global: headings font' },
          ...fontChoices.map((font) => ({ value: font.value, label: font.label })),
        ]} />
      </MiniField>
      <MiniField label="Size">
        <div className={styles.sizeRow}>
          <input className={styles.input} type="number" value={asString(current.size)} onChange={(event) => set('size', numberOrUndefined(event.target.value))} />
          <UnitSelect units={['px', 'rem', 'em', 'vw']} value={current.sizeUnit} onChange={(unit) => set('sizeUnit', unit)} />
        </div>
      </MiniField>
      <MiniField label="Weight"><MiniSelect value={current.weight} options={weightOptions} onChange={(next) => set('weight', next)} /></MiniField>
      <MiniField label="Line height"><input className={styles.input} type="number" step="0.1" value={asString(current.lineHeight)} onChange={(event) => set('lineHeight', numberOrUndefined(event.target.value))} /></MiniField>
      <MiniField label="Letter spacing (px)"><input className={styles.input} type="number" step="0.1" value={asString(current.letterSpacing)} onChange={(event) => set('letterSpacing', numberOrUndefined(event.target.value))} /></MiniField>
      <MiniField label="Transform"><MiniSelect value={current.transform} onChange={(next) => set('transform', next)} options={opts(['', 'Default'], ['uppercase', 'UPPERCASE'], ['lowercase', 'lowercase'], ['capitalize', 'Capitalize'], ['none', 'Normal'])} /></MiniField>
      <MiniField label="Style"><MiniSelect value={current.style} onChange={(next) => set('style', next)} options={opts(['', 'Default'], ['normal', 'Normal'], ['italic', 'Italic'])} /></MiniField>
      <MiniField label="Decoration"><MiniSelect value={current.decoration} onChange={(next) => set('decoration', next)} options={opts(['', 'Default'], ['none', 'None'], ['underline', 'Underline'], ['line-through', 'Line through'])} /></MiniField>
      {active && <button type="button" className={styles.smallButtonGhost} onClick={() => onChange(undefined)}>Reset typography</button>}
    </Group>
  );
}

function BackgroundControl({ value, onChange, kind }: ControlProps) {
  const current = (value || {}) as Background;
  const set = (key: keyof Background, next: Value) => onChange({ ...current, [key]: next === '' ? undefined : next });
  const [picking, setPicking] = useState(false);
  const gradient = current.type === 'gradient';
  return (
    <div className={styles.stack}>
      <div className={styles.segmented}>
        <button type="button" className={!gradient ? styles.segmentActive : styles.segment} onClick={() => set('type', 'classic')}>Classic</button>
        <button type="button" className={gradient ? styles.segmentActive : styles.segment} onClick={() => set('type', 'gradient')}>Gradient</button>
      </div>
      {gradient ? (
        <>
          <MiniField label="From"><ColorInput value={current.gradientFrom} onChange={(next) => set('gradientFrom', next)} /></MiniField>
          <MiniField label="To"><ColorInput value={current.gradientTo} onChange={(next) => set('gradientTo', next)} /></MiniField>
          <MiniField label="Angle (deg)"><input className={styles.input} type="number" value={asString(current.gradientAngle ?? 180)} onChange={(event) => set('gradientAngle', numberOrUndefined(event.target.value))} /></MiniField>
        </>
      ) : (
        <>
          <MiniField label="Colour"><ColorInput value={current.color} onChange={(next) => set('color', next)} /></MiniField>
          <MiniField label="Image">
            <div className={styles.stack}>
              {current.image && <img src={current.image} alt="" className={styles.imagePreview} />}
              <div className={styles.buttonRow}>
                <button type="button" className={styles.smallButton} onClick={() => setPicking(true)}>{current.image ? 'Replace' : 'Choose image'}</button>
                {current.image && <button type="button" className={styles.smallButtonGhost} onClick={() => set('image', undefined)}>Remove</button>}
              </div>
            </div>
          </MiniField>
          {current.image && (
            <>
              <MiniField label="Position"><MiniSelect value={current.position} onChange={(next) => set('position', next)} options={opts(['', 'Center'], ['top center', 'Top'], ['bottom center', 'Bottom'], ['center left', 'Left'], ['center right', 'Right'])} /></MiniField>
              <MiniField label="Size"><MiniSelect value={current.size} onChange={(next) => set('size', next)} options={opts(['', 'Cover'], ['contain', 'Contain'], ['auto', 'Auto'])} /></MiniField>
              <MiniField label="Repeat"><MiniSelect value={current.repeat} onChange={(next) => set('repeat', next)} options={opts(['', 'No repeat'], ['repeat', 'Repeat'], ['repeat-x', 'Repeat horizontally'], ['repeat-y', 'Repeat vertically'])} /></MiniField>
              <MiniField label="Attachment"><MiniSelect value={current.attachment} onChange={(next) => set('attachment', next)} options={opts(['', 'Scroll'], ['fixed', 'Fixed (parallax-like)'])} /></MiniField>
            </>
          )}
        </>
      )}
      {kind !== 'widget' && (
        <>
          <MiniField label="Overlay colour"><ColorInput value={current.overlayColor} onChange={(next) => set('overlayColor', next)} /></MiniField>
          {current.overlayColor && (
            <MiniField label="Overlay opacity">
              <div className={styles.slider}>
                <input type="range" min={0} max={1} step={0.05} value={current.overlayOpacity ?? 0.5} onChange={(event) => set('overlayOpacity', Number(event.target.value))} />
                <span className={styles.unit}>{Math.round((current.overlayOpacity ?? 0.5) * 100)}%</span>
              </div>
            </MiniField>
          )}
        </>
      )}
      {picking && <MediaManager heading="Background image" onClose={() => setPicking(false)} onSelect={(item) => { set('image', item.url); setPicking(false); }} />}
    </div>
  );
}

function BorderControl({ value, onChange }: ControlProps) {
  const current = (value || {}) as Border;
  const set = (key: keyof Border, next: Value) => onChange({ ...current, [key]: next === '' ? undefined : next });
  return (
    <div className={styles.stack}>
      <MiniField label="Style"><MiniSelect value={current.style} onChange={(next) => set('style', next)} options={opts(['', 'None'], ['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['double', 'Double'])} /></MiniField>
      {current.style && current.style !== 'none' && (
        <>
          <MiniField label="Width"><DimensionsControl control={{ key: 'width', label: 'Width', type: 'dimensions', units: ['px'] }} value={current.width} onChange={(next) => set('width', next)} /></MiniField>
          <MiniField label="Colour"><ColorInput value={current.color} onChange={(next) => set('color', next)} /></MiniField>
        </>
      )}
      <MiniField label="Corner radius"><DimensionsControl control={{ key: 'radius', label: 'Radius', type: 'dimensions', units: ['px', '%'] }} value={current.radius} onChange={(next) => set('radius', next)} /></MiniField>
    </div>
  );
}

function ShadowControl({ control, value, onChange }: ControlProps) {
  const current = (value || {}) as Shadow;
  const set = (key: keyof Shadow, next: Value) => onChange({ ...current, [key]: next === '' ? undefined : next });
  const text = control.type === 'textShadow';
  const fields: Array<[keyof Shadow, string]> = text ? [['x', 'X'], ['y', 'Y'], ['blur', 'Blur']] : [['x', 'X'], ['y', 'Y'], ['blur', 'Blur'], ['spread', 'Spread']];
  return (
    <Group summary={current.color ? 'Custom' : 'None'} active={Boolean(current.color)}>
      <MiniField label="Colour"><ColorInput value={current.color} onChange={(next) => set('color', next)} /></MiniField>
      <div className={styles.shadowGrid}>
        {fields.map(([key, label]) => (
          <label key={key}><input className={styles.input} type="number" value={asString(current[key])} onChange={(event) => set(key, numberOrUndefined(event.target.value))} /><span>{label}</span></label>
        ))}
      </div>
      {current.color && <button type="button" className={styles.smallButtonGhost} onClick={() => onChange(undefined)}>Remove shadow</button>}
    </Group>
  );
}

function RepeaterControl({ control, value, onChange }: ControlProps) {
  const items = (Array.isArray(value) ? value : []) as Array<Record<string, unknown>>;
  const [open, setOpen] = useState<number | null>(null);
  const update = (index: number, key: string, next: Value) => onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: next } : item)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    setOpen(target);
  };
  return (
    <div className={styles.repeater}>
      {items.map((item, index) => (
        <div key={String(item.id ?? index)} className={styles.repeaterItem}>
          <div className={styles.repeaterHead}>
            <button type="button" className={styles.repeaterTitle} aria-expanded={open === index} onClick={() => setOpen(open === index ? null : index)}>
              {asString(item[control.itemLabel || 'title']) || `Item ${index + 1}`}
            </button>
            <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></button>
            <button type="button" aria-label="Move down" disabled={index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></button>
            <button type="button" aria-label="Duplicate" onClick={() => onChange([...items.slice(0, index + 1), { ...item, id: Math.random().toString(36).slice(2, 8) }, ...items.slice(index + 1)])}><Copy size={13} /></button>
            <button type="button" aria-label="Delete" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={13} /></button>
          </div>
          {open === index && (
            <div className={styles.repeaterBody}>
              {(control.fields || []).map((field) => (
                <Row key={field.key} label={field.label} help={field.help}>
                  <ControlInput control={field} value={item[field.key]} onChange={(next) => update(index, field.key, next)} />
                </Row>
              ))}
            </div>
          )}
        </div>
      ))}
      <button type="button" className={styles.addItem} onClick={() => { onChange([...items, control.newItem ? control.newItem() : { id: Math.random().toString(36).slice(2, 8) }]); setOpen(items.length); }}>
        <Plus size={14} /> Add item
      </button>
    </div>
  );
}

const fieldIdPattern = /^[a-z][a-z0-9_]{0,39}$/;

/** Edited as free text and committed without blank lines, so typing Enter isn't undone mid-edit. */
function OptionsEditor({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  const [draft, setDraft] = useState(options.join('\n'));
  const commit = (text: string) => onChange([...new Set(text.split('\n').map((line) => line.trim()).filter(Boolean))]);
  return (
    <textarea className={styles.input} rows={4} value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => commit(event.target.value)} />
  );
}

function FormFieldsControl({ value, onChange }: ControlProps) {
  const fields = (Array.isArray(value) ? value : []) as FormField[];
  const [open, setOpen] = useState<number | null>(null);
  const update = (index: number, patch: Partial<FormField>) => onChange(fields.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)));
  const ids = fields.map((field) => field.id);
  return (
    <div className={styles.repeater}>
      {fields.map((field, index) => {
        const idError = !fieldIdPattern.test(field.id) ? 'Use lowercase letters, numbers and _ (start with a letter).'
          : ids.indexOf(field.id) !== index ? 'Another field already uses this name.' : '';
        return (
          <div key={index} className={styles.repeaterItem}>
            <div className={styles.repeaterHead}>
              <button type="button" className={styles.repeaterTitle} aria-expanded={open === index} onClick={() => setOpen(open === index ? null : index)}>
                {field.label || field.id} <small>{field.type}{field.required ? ' · required' : ''}</small>
                {idError && <span className={styles.errorDot} aria-label="This field has a problem" />}
              </button>
              <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => { const next = [...fields]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next); }}><ArrowUp size={13} /></button>
              <button type="button" aria-label="Move down" disabled={index === fields.length - 1} onClick={() => { const next = [...fields]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; onChange(next); }}><ArrowDown size={13} /></button>
              <button type="button" aria-label="Delete field" onClick={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index))}><Trash2 size={13} /></button>
            </div>
            {open === index && (
              <div className={styles.repeaterBody}>
                <MiniField label="Type"><MiniSelect value={field.type} options={formFieldTypes} onChange={(next) => update(index, { type: (next || 'text') as FormField['type'] })} /></MiniField>
                <MiniField label="Label"><input className={styles.input} value={field.label} onChange={(event) => update(index, { label: event.target.value })} /></MiniField>
                <MiniField label="Field name">
                  <input className={styles.input} value={field.id} onChange={(event) => update(index, { id: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} aria-invalid={Boolean(idError)} />
                </MiniField>
                {idError ? <p className={styles.controlError}>{idError}</p> : <p className={styles.controlHelp}>Names each value in submissions. Changing it on a live form files new entries under the new name.</p>}
                {field.type !== 'checkbox' && <MiniField label="Placeholder"><input className={styles.input} value={field.placeholder || ''} onChange={(event) => update(index, { placeholder: event.target.value })} /></MiniField>}
                {(field.type === 'select' || field.type === 'checkbox') && (
                  <MiniField label={field.type === 'checkbox' ? 'Options (one per line; empty = single tick box)' : 'Options (one per line)'}>
                    <OptionsEditor options={field.options || []} onChange={(options) => update(index, { options })} />
                  </MiniField>
                )}
                <MiniField label="Width"><MiniSelect value={field.width || '100'} options={opts(['100', 'Full'], ['50', 'Half'])} onChange={(next) => update(index, { width: next === '50' ? '50' : '100' })} /></MiniField>
                <label className={styles.checkRow}><input type="checkbox" checked={Boolean(field.required)} onChange={(event) => update(index, { required: event.target.checked })} /> Required</label>
              </div>
            )}
          </div>
        );
      })}
      <button type="button" className={styles.addItem} onClick={() => {
        const field = newField();
        onChange([...fields, field]);
        setOpen(fields.length);
      }}>
        <Plus size={14} /> Add field
      </button>
    </div>
  );
}

function MenuControl({ value, onChange }: ControlProps) {
  const [menus, setMenus] = useState<MenuRecord[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    fetchMenus(true).then(setMenus).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load menus.'));
  }, []);
  if (error) return <p className={styles.controlError}>{error}</p>;
  if (!menus) return <p className={styles.controlHelp}>Loading menus…</p>;
  if (!menus.length) return <p className={styles.controlHelp}>No menus yet. Create one under Menus in the admin.</p>;
  return (
    <select className={styles.input} value={asString(value)} onChange={(event) => onChange(event.target.value)}>
      <option value="">First menu ({menus[0].name})</option>
      {menus.map((menu) => <option key={menu.id} value={String(menu.id)}>{menu.name}</option>)}
    </select>
  );
}

function CategoryControl({ value, onChange }: ControlProps) {
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => { void fetchCategories().then(setCategories); }, []);
  return (
    <select className={styles.input} value={asString(value)} onChange={(event) => onChange(event.target.value)}>
      <option value="">All categories</option>
      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
    </select>
  );
}

function FormEmailControl({ settings = {}, onSettingChange }: ControlProps) {
  const actions = (Array.isArray(settings.actions) ? settings.actions : ['save']) as string[];
  const enabled = actions.includes('email');
  return (
    <div className={styles.stack}>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={enabled} onChange={(event) => onSettingChange?.('actions', event.target.checked ? [...new Set([...actions, 'save', 'email'])] : actions.filter((action) => action !== 'email'))} />
        Send an email for each submission
      </label>
      {enabled && (
        <>
          <MiniField label="Send to">
            <input className={styles.input} type="email" multiple value={asString(settings.private_email_to)} placeholder="Site admin email when empty" onChange={(event) => onSettingChange?.('private_email_to', event.target.value)} />
          </MiniField>
          <MiniField label="Subject">
            <input className={styles.input} value={asString(settings.private_email_subject)} placeholder={`New submission: ${asString(settings.form_name) || 'form'}`} onChange={(event) => onSettingChange?.('private_email_subject', event.target.value)} />
          </MiniField>
          <p className={styles.controlHelp}>The recipient is stored privately, not in the page data visitors can download. Sending needs SMTP_HOST, SMTP_FROM and SUPABASE_SECRET_KEY on the server; every entry is saved under Page Builder → Submissions either way.</p>
        </>
      )}
    </div>
  );
}

/** A select whose choices come from the database (templates, products, pages). */
function AsyncSelectControl({ control, value, onChange }: ControlProps) {
  const [options, setOptions] = useState<ControlOption[] | null>(null);
  const [error, setError] = useState('');
  const { loadOptions } = control;
  useEffect(() => {
    let active = true;
    if (!loadOptions) return undefined;
    loadOptions()
      .then((loaded) => active && setOptions(loaded))
      .catch((loadError: unknown) => active && setError(loadError instanceof Error ? loadError.message : String(loadError)));
    return () => { active = false; };
  }, [loadOptions]);
  const current = asString(value);
  if (error) return <p className={styles.controlError}>{error}</p>;
  if (!options) return <p className={styles.controlHelp}>Loading…</p>;
  return (
    <select className={styles.input} value={current} onChange={(event) => onChange(event.target.value)}>
      <option value="">{control.placeholder || '— Choose —'}</option>
      {current && !options.some((option) => option.value === current) && <option value={current}>Not found ({current})</option>}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

/** A list of image URLs picked from the media library, one or several at a time. */
function GalleryControl({ value, onChange }: ControlProps) {
  const images = (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === 'string');
  const [open, setOpen] = useState(false);
  // Positions, not URLs: the same image may appear twice.
  const [marked, setMarked] = useState<number[]>([]);
  const update = (next: string[]) => { setMarked([]); onChange(next); };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    update(next);
  };
  const liveMarked = marked.filter((index) => index < images.length);
  const allMarked = images.length > 0 && liveMarked.length === images.length;
  const toggleMark = (index: number) =>
    setMarked((current) => (current.includes(index) ? current.filter((entry) => entry !== index) : [...current, index]));
  return (
    <div className={styles.stack}>
      {images.length > 0 && (
        <div className={styles.galleryGrid}>
          {images.map((url, index) => (
            <div key={`${url}-${index}`} className={liveMarked.includes(index) ? styles.galleryThumbMarked : styles.galleryThumb}>
              <img src={url} alt="" />
              <input type="checkbox" className={styles.galleryCheck} checked={liveMarked.includes(index)}
                aria-label={`Select image ${index + 1}`} onChange={() => toggleMark(index)} />
              <div>
                <button type="button" aria-label="Move earlier" disabled={index === 0} onClick={() => move(index, -1)}>‹</button>
                <button type="button" aria-label="Remove image" onClick={() => update(images.filter((_, itemIndex) => itemIndex !== index))}>×</button>
                <button type="button" aria-label="Move later" disabled={index === images.length - 1} onClick={() => move(index, 1)}>›</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className={styles.buttonRow}>
        <button type="button" className={styles.smallButton} onClick={() => setOpen(true)}><Plus size={13} /> Add images</button>
        {images.length > 0 && (
          <button type="button" className={styles.smallButtonGhost}
            onClick={() => setMarked(allMarked ? [] : images.map((_, index) => index))}>
            {allMarked ? 'Deselect all' : 'Select all'}
          </button>
        )}
        {liveMarked.length > 0 && (
          <button type="button" className={styles.smallButtonGhost}
            onClick={() => update(images.filter((_, index) => !liveMarked.includes(index)))}>
            Remove selected ({liveMarked.length})
          </button>
        )}
        {images.length > 0 && <button type="button" className={styles.smallButtonGhost} onClick={() => update([])}>Clear all</button>}
        <span className={styles.controlHelp}>{images.length} image{images.length === 1 ? '' : 's'}</span>
      </div>
      {open && (
        <MediaManager heading="Add to gallery" onClose={() => setOpen(false)}
          onSelect={(item) => { update([...images, item.url]); setOpen(false); }}
          onSelectMany={(picked) => { update([...images, ...picked.map((item) => item.url)]); setOpen(false); }} />
      )}
    </div>
  );
}

export function ControlInput(props: ControlProps) {
  switch (props.control.type) {
    case 'text': case 'textarea': return <TextControl {...props} />;
    case 'number': return <NumberControl {...props} />;
    case 'toggle': return <Toggle checked={Boolean(props.value)} onChange={props.onChange} label={props.control.label} />;
    case 'select': return <SelectControl {...props} />;
    case 'color': return <ColorInput value={props.value} onChange={props.onChange} />;
    case 'slider': return <SliderControl {...props} />;
    case 'size': return <SizeControl {...props} />;
    case 'dimensions': return <DimensionsControl {...props} />;
    case 'image': return <ImageControl {...props} />;
    case 'link': return <LinkControl {...props} />;
    case 'richtext': return <RichTextControl {...props} />;
    case 'icon': return <IconControl {...props} />;
    case 'code': return <CodeControl {...props} />;
    case 'align': return <AlignControl {...props} />;
    case 'typography': return <TypographyControl {...props} />;
    case 'background': return <BackgroundControl {...props} />;
    case 'border': return <BorderControl {...props} />;
    case 'shadow': case 'textShadow': return <ShadowControl {...props} />;
    case 'repeater': return <RepeaterControl {...props} />;
    case 'formFields': return <FormFieldsControl {...props} />;
    case 'menu': return <MenuControl {...props} />;
    case 'category': return <CategoryControl {...props} />;
    case 'formEmail': return <FormEmailControl {...props} />;
    case 'asyncSelect': return <AsyncSelectControl {...props} />;
    case 'gallery': return <GalleryControl {...props} />;
    default: return null;
  }
}
