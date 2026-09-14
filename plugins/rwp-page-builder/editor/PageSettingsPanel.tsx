import { useState } from 'react';
import { disableBuilder } from '../lib/api';
import { ColorInput, Row } from './Controls';
import { isDirty, useEditor, useStore } from './store';
import styles from './editor.module.css';

export default function PageSettingsPanel() {
  const store = useStore();
  const { actions } = store;
  const settings = useEditor((state) => state.doc.settings);
  const layout = useEditor((state) => state.layout);
  const page = useEditor((state) => state.page);
  const [error, setError] = useState('');

  const switchToClassic = async () => {
    const message = isDirty(store.getState())
      ? 'Switch this page back to the classic editor? Your unsaved builder changes will be lost; the saved layout is kept and can be re-enabled later.'
      : 'Switch this page back to the classic editor? Visitors will see the classic content again. The layout is kept and can be re-enabled later.';
    if (!window.confirm(message)) return;
    try {
      await disableBuilder(page.id);
      window.location.href = `/admin?section=content&edit=${page.id}`;
    } catch (disableError) {
      setError(disableError instanceof Error ? disableError.message : 'Could not switch editors.');
    }
  };

  return (
    <div className={styles.panel}>
      <h3 className={styles.panelTitle}>Page settings</h3>
      <Row label="Page width" help="Full width lets sections span the screen. Boxed and Wide keep the site's content column around the layout.">
        <select className={styles.input} value={layout} onChange={(event) => store.setState({ layout: event.target.value })}>
          <option value="full">Full width (recommended)</option>
          <option value="wide">Wide</option>
          <option value="boxed">Boxed</option>
        </select>
      </Row>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={Boolean(settings.showTitle)} onChange={(event) => actions.setDocumentSetting('showTitle', event.target.checked)} />
        Show the page title above the layout
      </label>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={Boolean(settings.showComments)} onChange={(event) => actions.setDocumentSetting('showComments', event.target.checked)} />
        Show comments below the layout
      </label>
      <p className={styles.controlHelp}>Comments also need to be enabled in Settings and allowed on this page.</p>
      <Row label="Page background">
        <ColorInput value={settings.background} onChange={(value) => actions.setDocumentSetting('background', value)} />
      </Row>
      <Row label="Page custom CSS" help='"selector" targets the whole layout. Applies to this page only.'>
        <textarea className={styles.code} rows={6} spellCheck={false} value={settings.customCss || ''} onChange={(event) => actions.setDocumentSetting('customCss', event.target.value)} />
      </Row>
      <p className={styles.hint}>Slug, excerpt, category and SEO fields are edited in the classic editor and are kept when you save here.</p>
      <div className={styles.buttonRow}>
        <a className={styles.secondaryButton} href={`/admin?section=content&edit=${page.id}`}>Open SEO &amp; page details</a>
      </div>
      <h4 className={styles.controlHeading}>Editor</h4>
      {error && <p className={styles.errorText} role="alert">{error}</p>}
      <button type="button" className={styles.dangerButton} onClick={() => void switchToClassic()}>Switch back to the classic editor</button>
    </div>
  );
}
