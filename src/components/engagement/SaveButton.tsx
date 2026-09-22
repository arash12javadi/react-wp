import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bookmark, ChevronDown } from 'lucide-react';
import { useAppSettings } from '../../lib/appSettings';
import {
  defaultCollection, engagementVisible, fetchMyBookmarks, useEngagement, type EngagementPlacement, type EngagementTargetType,
} from '../../lib/engagement';
import { getSupabaseClient } from '../../lib/db';
import { loginHref } from '../../lib/account';
import { useTranslation } from '../../context/I18nContext';
import './engagement.css';

export interface SaveButtonProps {
  targetId: string | number;
  targetType?: EngagementTargetType;
  placement?: EngagementPlacement;
  /** The ▾ menu for choosing collections. Off: the button only saves to "Saved Items". */
  collections?: boolean;
  className?: string;
}

/**
 * <SaveButton targetId={id} targetType="page|product" />. The main button saves to "Saved Items" (or
 * removes the item from every collection); the menu beside it puts it in any collection, or a new one.
 */
export default function SaveButton({ targetId, targetType = 'page', placement = 'manual', collections = true, className = '' }: SaveButtonProps) {
  const { settings, loaded } = useAppSettings();
  const { t } = useTranslation();
  const visible = loaded && engagementVisible(settings.engagement, 'save', { targetType, placement });
  const { item, toggleSave, saveTo, removeFrom, error } = useEngagement(targetType, visible ? targetId : null);
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [menuError, setMenuError] = useState('');
  const wrapper = useRef<HTMLDivElement>(null);

  // Closes on a click outside or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!visible || item === null) return null;
  const saved = Boolean(item?.collections.length);
  const label = saved ? t('engagement.saved', 'Saved') : t('engagement.save', 'Save');

  const openMenu = async () => {
    if (open) { setOpen(false); return; }
    const { data } = await getSupabaseClient().auth.getSession();
    if (!data.session) { window.location.href = loginHref(); return; }
    setMenuError('');
    setOpen(true);
    try {
      const result = await fetchMyBookmarks();
      setNames(result.collections.map((collection) => collection.name));
    } catch (loadError: unknown) {
      setMenuError(loadError instanceof Error ? loadError.message : 'Your collections could not be loaded.');
    }
  };

  const addCollection = async (event: FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;
    if (name.length > 60) { setMenuError('A collection name can be at most 60 characters long.'); return; }
    await saveTo(name);
    setNames((current) => [...new Set([...current, name])].sort());
    setDraft('');
  };

  const choices = [...new Set([defaultCollection, ...names, ...(item?.collections || [])])].sort();

  return (
    <>
      <div className="rwp-save" ref={wrapper}>
        <button
          type="button"
          className={`rwp-engagement-button rwp-save-button${saved ? ' is-active' : ''} ${className}`.trim()}
          aria-pressed={saved}
          disabled={item === undefined}
          title={saved ? item?.collections.join(', ') : undefined}
          onClick={() => void toggleSave()}
        >
          <Bookmark aria-hidden="true" />
          <span>{label}</span>
        </button>
        {collections && (
          <button type="button" className="rwp-engagement-button rwp-save-menu-toggle" aria-expanded={open}
            aria-label={t('engagement.chooseCollection', 'Choose a collection')} disabled={item === undefined} onClick={() => void openMenu()}>
            <ChevronDown aria-hidden="true" />
          </button>
        )}
        {open && (
          <div className="rwp-save-menu" role="dialog" aria-label={t('engagement.saveTo', 'Save to a collection')}>
            <h4>{t('engagement.saveTo', 'Save to a collection')}</h4>
            {menuError && <p className="rwp-engagement-error" role="alert">{menuError}</p>}
            <ul>
              {choices.map((name) => {
                const checked = Boolean(item?.collections.includes(name));
                return (
                  <li key={name}>
                    <label>
                      <input type="checkbox" checked={checked} onChange={() => void (checked ? removeFrom(name) : saveTo(name))} />
                      {name}
                    </label>
                  </li>
                );
              })}
            </ul>
            <form onSubmit={(event) => void addCollection(event)}>
              <input type="text" value={draft} maxLength={60} placeholder={t('engagement.newCollection', 'New collection')}
                aria-label={t('engagement.newCollection', 'New collection')} onChange={(event) => setDraft(event.target.value)} />
              <button type="submit">{t('engagement.add', 'Add')}</button>
            </form>
          </div>
        )}
      </div>
      {error && <p className="rwp-engagement-error" role="alert">{error}</p>}
    </>
  );
}
