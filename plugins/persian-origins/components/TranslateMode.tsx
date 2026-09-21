import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { getSupabaseClient } from '../../../src/lib/db';
import { localeDefinition, lookupTranslation } from '../../../src/lib/i18n';
import { useBilingual } from '../BilingualContext';
import { isInsidePageTranslation, sourceOfAttribute, sourceOfText } from '../lib/pageTranslator';
import { deletePhrase, describePhraseError, phraseKey, phraseTarget, savePhrase } from '../lib/phrases';
import { getCanTranslate, subscribeViewer } from '../lib/viewer';

/**
 * Translate this page in place (administrators only).
 *
 * With the mode on, every translatable text is outlined under the pointer and a click opens an
 * editor for it instead of following the link. Saving writes the phrase to core's translations
 * table and the page updates at once, everywhere the same text appears — every menu, widget and
 * page — because a phrase is matched by its text.
 */

interface Picked {
  source: string;
  x: number;
  y: number;
  /** Set when the click landed in a translated page body, which is edited elsewhere. */
  pageTranslation?: boolean;
}

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/** The text node under the pointer, if the pointer is really over its glyphs. */
function textAt(x: number, y: number): Text | null {
  const doc = document as CaretDocument;
  const node = doc.caretPositionFromPoint?.(x, y)?.offsetNode ?? doc.caretRangeFromPoint?.(x, y)?.startContainer ?? null;
  if (!node || node.nodeType !== Node.TEXT_NODE || !/\S/.test(node.nodeValue || '')) return null;
  const range = document.createRange();
  range.selectNodeContents(node);
  const inside = [...range.getClientRects()].some((rect) => x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2);
  return inside ? node as Text : null;
}

const attributeOrder = ['placeholder', 'alt', 'aria-label', 'title', 'value'];

/** What a pointer position offers for translation: its text, else a placeholder, label or alt text. */
function pick(x: number, y: number, target: EventTarget | null): { source: string; rect: DOMRect; pageTranslation: boolean } | null {
  const node = textAt(x, y);
  if (node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    if (isInsidePageTranslation(node)) return { source: '', rect: range.getBoundingClientRect(), pageTranslation: true };
    const source = sourceOfText(node);
    if (source) return { source, rect: range.getBoundingClientRect(), pageTranslation: false };
  }
  let element = target instanceof Element ? target : null;
  while (element && element !== document.body) {
    for (const name of attributeOrder) {
      if (!element.hasAttribute(name)) continue;
      const source = sourceOfAttribute(element, name);
      if (source) return { source, rect: element.getBoundingClientRect(), pageTranslation: false };
    }
    element = element.parentElement;
  }
  return null;
}

function Editor({ picked, onClose }: { picked: Picked; onClose: (message?: string) => void }) {
  const { t } = useBilingual();
  const target = phraseTarget();
  const definition = localeDefinition(target);
  const current = lookupTranslation(target, phraseKey(picked.source)) ?? '';
  const [value, setValue] = useState(current === picked.source ? '' : current);
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const frame = useRef<HTMLFormElement>(null);

  // Whether this site saved its own translation (as opposed to the bundled one), for "Reset".
  useEffect(() => {
    let active = true;
    void getSupabaseClient().from('rwp_translations').select('translation_value')
      .eq('translation_key', phraseKey(picked.source)).eq('locale', target).maybeSingle()
      .then(({ data }) => { if (active) setSaved(data ? data.translation_value : null); });
    return () => { active = false; };
  }, [picked.source, target]);

  const left = Math.min(Math.max(12, picked.x - 180), window.innerWidth - 372);
  const top = picked.y + 16 + 260 > window.innerHeight ? Math.max(12, picked.y - 276) : picked.y + 16;

  const submit = async (event: Pick<FormEvent, 'preventDefault'>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await savePhrase(picked.source, target, value);
      onClose(value.trim()
        ? t('po.translator.saved', 'Saved. Everywhere this text appears now shows the translation.')
        : t('po.translator.cleared', 'Saved as untranslated.'));
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : describePhraseError(saveError));
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError('');
    try {
      await deletePhrase(picked.source, target);
      onClose(t('po.translator.reset', 'Your translation was removed; the default one shows again.'));
    } catch (resetError: unknown) {
      setError(resetError instanceof Error ? resetError.message : describePhraseError(resetError));
      setBusy(false);
    }
  };

  return (
    <form ref={frame} className="po-translator__editor" style={{ left, top }} dir="ltr" onSubmit={(event) => void submit(event)}
      role="dialog" aria-label={t('po.translator.editorTitle', 'Translate this text')}>
      <div className="po-translator__label">{t('po.translator.original', 'Original')}</div>
      <p className="po-translator__source" dir="auto">{picked.source}</p>
      <label className="po-translator__label" htmlFor="po-translator-value">
        {t('po.translator.into', 'In {language}', { language: definition.nativeName })}
      </label>
      <textarea id="po-translator-value" autoFocus rows={3} value={value} lang={target} dir={definition.dir}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit(event);
        }} />
      {error && <p className="po-translator__error" role="alert">{error}</p>}
      <div className="po-translator__actions">
        <button type="submit" className="po-translator__primary" disabled={busy}>{busy ? '…' : t('po.translator.save', 'Save')}</button>
        {saved !== undefined && saved !== null && (
          <button type="button" disabled={busy} onClick={() => void reset()}>{t('po.translator.resetButton', 'Reset')}</button>
        )}
        <button type="button" disabled={busy} onClick={() => onClose()}>{t('po.settings.close', 'Close')}</button>
      </div>
      <p className="po-translator__hint">{t('po.translator.hint', 'Applies everywhere this exact text appears. Ctrl+Enter saves.')}</p>
    </form>
  );
}

export default function TranslateMode() {
  const { t, settings } = useBilingual();
  const canTranslate = useSyncExternalStore(subscribeViewer, getCanTranslate, getCanTranslate);
  const [active, setActive] = useState(false);
  const [box, setBox] = useState<DOMRect | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!active) return undefined;
    document.body.classList.add('po-translating');
    const insideUi = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('.po-translator'));
    const move = (event: MouseEvent) => {
      if (insideUi(event.target) || picked) return;
      setBox(pick(event.clientX, event.clientY, event.target)?.rect ?? null);
    };
    const click = (event: MouseEvent) => {
      if (insideUi(event.target)) return;
      // Links and buttons must not act while choosing text.
      event.preventDefault();
      event.stopPropagation();
      const found = pick(event.clientX, event.clientY, event.target);
      if (!found) return;
      setPicked({ source: found.source, x: event.clientX, y: event.clientY, pageTranslation: found.pageTranslation });
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (picked) setPicked(null); else setActive(false);
    };
    const scroll = () => setBox(null);
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.body.classList.remove('po-translating');
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
      setBox(null);
    };
  }, [active, picked]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!canTranslate || !settings.translate_site) return null;

  return (
    <div className="po-translator" dir="ltr">
      <button type="button" className={`po-translator__toggle ${active ? 'is-active' : ''}`} aria-pressed={active}
        onClick={() => { setActive((value) => !value); setPicked(null); }}>
        <span aria-hidden="true">{active ? '✓' : '文'}</span>{' '}
        {active ? t('po.translator.done', 'Done translating') : t('po.translator.start', 'Translate this page')}
      </button>
      {active && !picked && <div className="po-translator__tip" role="status">{t('po.translator.tip', 'Click any text to translate it. Esc to stop.')}</div>}
      {active && box && !picked && (
        <div className="po-translator__highlight" aria-hidden="true"
          style={{ left: box.left - 3, top: box.top - 3, width: box.width + 6, height: box.height + 6 }} />
      )}
      {picked && (picked.pageTranslation ? (
        <div className="po-translator__editor" style={{ left: Math.min(Math.max(12, picked.x - 180), window.innerWidth - 372), top: picked.y + 16 }} role="dialog">
          <p className="po-translator__source">
            {t('po.translator.pageBody', 'This is a translated page body. Edit it under Persian Origins → Pages & posts.')}
          </p>
          <div className="po-translator__actions">
            <a className="po-translator__primary" href="/admin?section=persian-origins&tab=content">{t('po.translator.openAdmin', 'Open')}</a>
            <button type="button" onClick={() => setPicked(null)}>{t('po.settings.close', 'Close')}</button>
          </div>
        </div>
      ) : (
        <Editor picked={picked} onClose={(message) => { setPicked(null); if (message) setToast(message); }} />
      ))}
      {toast && <div className="po-translator__toast" role="status">{toast}</div>}
    </div>
  );
}
