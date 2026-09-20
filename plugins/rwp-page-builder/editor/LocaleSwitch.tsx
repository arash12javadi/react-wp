import { useEffect, useRef, useState } from 'react';
import { Check, Languages, Trash2 } from 'lucide-react';
import { localeDefinition, supportedLocales } from '../../../src/lib/i18n';
import { useEditor, useStore } from './store';
import styles from './editor.module.css';

/**
 * Picks which language's layout the canvas shows.
 *
 * Only the layout changes — the title, status, SEO fields and the page row itself are shared by
 * every language of this page, because they are columns on one row. A language that has no
 * layout yet starts as a copy of the one on screen (see setEditorLocale in store.ts).
 *
 * Renders nothing when the site offers one language, or when the database predates
 * 20260929_i18n_hooks.sql and has nowhere to put the extra layouts.
 */
export default function LocaleSwitch() {
  const store = useStore();
  const locale = useEditor((state) => state.locale);
  const canTranslate = useEditor((state) => state.canTranslate);
  const otherDocs = useEditor((state) => state.otherDocs);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const locales = supportedLocales();
  if (!canTranslate || locales.length < 2) return null;

  const active = localeDefinition(locale);

  return (
    <div className={styles.saveGroup} ref={containerRef}>
      <button
        type="button"
        className={styles.iconButton}
        title={`Editing the ${active.name} layout`}
        aria-label={`Language: ${active.name}. Change which layout you are editing.`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <Languages size={18} aria-hidden="true" />
        <span lang={active.code}>{active.code.toUpperCase()}</span>
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          {locales.map((entry) => {
            const isActive = entry.code === locale;
            // "started" means this language has a layout of its own rather than falling back.
            const started = isActive || Boolean(otherDocs[entry.code]);
            return (
              <button
                key={entry.code}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => { store.actions.setEditorLocale(entry.code); setOpen(false); }}
              >
                {isActive ? <Check size={14} aria-hidden="true" /> : null}
                <span lang={entry.code}>{entry.nativeName}</span>
                <small>{started ? `${entry.dir.toUpperCase()}` : 'start from this layout'}</small>
              </button>
            );
          })}
          {Object.keys(otherDocs).length > 0 && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const codes = Object.keys(otherDocs);
                const code = codes.length === 1 ? codes[0] : window.prompt(`Remove which language's layout? (${codes.join(', ')})`) || '';
                if (!otherDocs[code]) return;
                if (!window.confirm(`Delete the ${localeDefinition(code).name} layout of this page? It is removed when you next save.`)) return;
                store.actions.removeLocale(code);
                setOpen(false);
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
              <span>Remove a language&rsquo;s layout…</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
