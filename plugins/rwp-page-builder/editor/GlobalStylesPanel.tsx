import { useEffect, useState } from 'react';
import { fontChoices, globalColorLabels, saveGlobalStyles, useGlobalStyles } from '../lib/globals';
import type { GlobalStyles } from '../lib/types';
import { ColorInput, Row } from './Controls';
import { useEditor } from './store';
import styles from './editor.module.css';

/** Site-wide colours and fonts. Widgets pick them as "Global: Primary" and follow later changes. */
export default function GlobalStylesPanel() {
  const saved = useGlobalStyles();
  const canManageOptions = useEditor((state) => state.canManageOptions);
  const [draft, setDraft] = useState<GlobalStyles>(saved);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(saved); }, [saved]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const setColor = (key: keyof GlobalStyles['colors'], value: string | undefined) =>
    setDraft((current) => ({ ...current, colors: { ...current.colors, [key]: value || '' } }));

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await saveGlobalStyles(draft);
      setStatus({ kind: 'success', text: 'Site styles saved. Every builder page now uses them.' });
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Saving failed.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.panel}>
      <h3 className={styles.panelTitle}>Site styles</h3>
      <p className={styles.hint}>Shared by every builder page. Changes preview here straight away but only reach visitors once saved.</p>
      {!canManageOptions && <p className={styles.warning}>Only administrators can change site styles. You can preview values, but saving will be refused.</p>}

      <h4 className={styles.controlHeading}>Global colours</h4>
      {(Object.keys(globalColorLabels) as Array<keyof GlobalStyles['colors']>).map((key) => (
        <Row key={key} label={globalColorLabels[key]}>
          <ColorInput value={draft.colors[key]} allowGlobal={false} onChange={(value) => setColor(key, value)} />
        </Row>
      ))}

      <h4 className={styles.controlHeading}>Global fonts</h4>
      {(['primary', 'headings'] as const).map((key) => (
        <Row key={key} label={key === 'primary' ? 'Body font' : 'Headings font'}>
          <select className={styles.input} value={draft.fonts[key]} onChange={(event) => setDraft((current) => ({ ...current, fonts: { ...current.fonts, [key]: event.target.value } }))}>
            {fontChoices.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
          </select>
        </Row>
      ))}
      <label className={styles.checkRow}>
        <input type="checkbox" checked={draft.loadGoogleFonts} onChange={(event) => setDraft((current) => ({ ...current, loadGoogleFonts: event.target.checked }))} />
        Load fonts from Google Fonts
      </label>
      <p className={styles.controlHelp}>Turn this off to avoid requests to Google (for example for GDPR); visitors then see the nearest installed font.</p>

      {/* Draft values are previewed by pushing them to the canvas through the same CSS variables. */}
      <style>{`.rwpb-root,[data-rwpb-shell]{--rwpb-primary:${draft.colors.primary.replace(/[;{}<>]/g, '')};--rwpb-secondary:${draft.colors.secondary.replace(/[;{}<>]/g, '')};--rwpb-text:${draft.colors.text.replace(/[;{}<>]/g, '')};--rwpb-accent:${draft.colors.accent.replace(/[;{}<>]/g, '')}}`}</style>

      {status && <p className={status.kind === 'error' ? styles.errorText : styles.successText} role={status.kind === 'error' ? 'alert' : 'status'}>{status.text}</p>}
      <div className={styles.buttonRow}>
        <button type="button" className={styles.primaryButton} disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save site styles'}</button>
        {dirty && <button type="button" className={styles.secondaryButton} onClick={() => setDraft(saved)}>Discard</button>}
      </div>
    </div>
  );
}
