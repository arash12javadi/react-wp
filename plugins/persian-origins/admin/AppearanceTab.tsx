import { useState, type FormEvent } from 'react';
import { currentI18nSettings, localeDefinition } from '../../../src/lib/i18n';
import settingsStyles from '../../../src/components/SiteSettings.module.css';
import { discoveredFonts, fontCatalog } from '../fontLoader';
import { getPoSettings, savePoSettings, type PoSettings, type ThemeDefault } from '../lib/settings';
import styles from './admin.module.css';

/** Persian Origins → Appearance: the language pair, the floating controls, and the defaults. */
export default function AppearanceTab({ navigate }: { navigate: (section: string, subsection?: string) => void }) {
  const [form, setForm] = useState<PoSettings>(getPoSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const supported = currentI18nSettings().supported_languages;
  const offered = [...new Set([...supported, ...form.languages])];
  const unsupported = form.languages.filter((code) => !supported.includes(code));
  const local = discoveredFonts();

  const set = <K extends keyof PoSettings>(key: K, value: PoSettings[K]) => setForm((current) => ({ ...current, [key]: value }));
  const setLanguage = (index: 0 | 1, code: string) => {
    const next: [string, string] = [...form.languages];
    next[index] = code;
    set('languages', next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      if (form.languages[0] === form.languages[1]) throw new Error('Choose two different languages for the switch.');
      setForm(await savePoSettings(form));
      setFeedback('Saved. Open pages pick it up straight away in this browser, and for visitors on their next page load.');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.panel} onSubmit={(event) => void submit(event)}>
      {error && <div className={settingsStyles.error} role="alert"><span>{error}</span></div>}
      {feedback && <div className={settingsStyles.success} role="status">{feedback}</div>}

      <fieldset className={settingsStyles.fieldset}>
        <legend>Languages</legend>
        <div className={styles.twoColumns}>
          {([0, 1] as const).map((index) => (
            <label key={index}>
              {index === 0 ? 'First language' : 'Second language'}
              <select value={form.languages[index]} onChange={(event) => setLanguage(index, event.target.value)}>
                {offered.map((code) => <option key={code} value={code}>{localeDefinition(code).name} ({code})</option>)}
              </select>
            </label>
          ))}
        </div>
        {unsupported.length > 0 && (
          <div className={settingsStyles.warning} role="status">
            The site does not offer {unsupported.map((code) => localeDefinition(code).name).join(' or ')} yet, so switching to it does not stick
            after a reload.{' '}
            <button type="button" className={styles.linkButton} onClick={() => navigate('settings', 'languages')}>Add it under Settings → Languages</button>
          </div>
        )}
        <span className={settingsStyles.help}>
          The switch toggles between these two. It changes the same language as core&rsquo;s header switcher and <code>?lang=</code>,
          so the direction, the interface strings and Page Builder layouts all follow it.
        </span>
      </fieldset>

      <fieldset className={settingsStyles.fieldset}>
        <legend>Translating the whole site</legend>
        <label className={settingsStyles.checkboxRow}>
          <input type="checkbox" checked={form.translate_site} onChange={(event) => set('translate_site', event.target.checked)} />
          Translate every text on the public site (menus, header, footer, sidebar, buttons, forms, messages)
        </label>
        <label className={settingsStyles.checkboxRow}>
          <input type="checkbox" checked={form.collect_text} disabled={!form.translate_site}
            onChange={(event) => set('collect_text', event.target.checked)} />
          List untranslated text under Site text while an administrator browses the site
        </label>
        <label className={settingsStyles.checkboxRow}>
          <input type="checkbox" checked={form.localize_dates} onChange={(event) => set('localize_dates', event.target.checked)} />
          Dates in the language&rsquo;s own calendar (the Solar Hijri calendar for Persian)
        </label>
        <label className={settingsStyles.checkboxRow}>
          <input type="checkbox" checked={form.persian_digits} onChange={(event) => set('persian_digits', event.target.checked)} />
          Persian digits (۱۲۳) while Persian is active
        </label>
        <span className={settingsStyles.help}>
          Text is matched by its wording, so a menu item, a widget title and a button with the same words share one translation.
          Interface text from core, the theme, the Page Builder and the shop comes translated; your own text (site title, menu
          items, footer, widgets) is translated under Site text or with the <strong>Translate this page</strong> button that
          administrators see on the site. Comments, form input and code are never touched.
        </span>
      </fieldset>

      <fieldset className={settingsStyles.fieldset}>
        <legend>On every public page</legend>
        <label className={settingsStyles.checkboxRow}>
          <input type="checkbox" checked={form.floating_switch} onChange={(event) => set('floating_switch', event.target.checked)} />
          Floating language switch on the left edge
        </label>
        <label className={settingsStyles.checkboxRow}>
          <input type="checkbox" checked={form.floating_settings} onChange={(event) => set('floating_settings', event.target.checked)} />
          Floating display settings button (theme, fonts, text size) in the corner
        </label>
        <label className={settingsStyles.checkboxRow}>
          <input type="checkbox" checked={form.header_switch} onChange={(event) => set('header_switch', event.target.checked)} />
          Language switch in the header, next to the login links
        </label>
        <span className={settingsStyles.help}>
          Core&rsquo;s own header language switcher (Settings → Languages) is separate; turn one of them off if both show. Anywhere
          else, use the shortcodes <code>[language_switch]</code> and <code>[site_settings]</code>.
        </span>
      </fieldset>

      <fieldset className={settingsStyles.fieldset}>
        <legend>Defaults for visitors who have not chosen</legend>
        <label>
          Theme
          <select value={form.default_theme} onChange={(event) => set('default_theme', event.target.value as ThemeDefault)}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">Follow the visitor&rsquo;s system setting</option>
          </select>
        </label>
        <div className={styles.twoColumns}>
          {form.languages.map((language) => (
            <label key={language}>
              {localeDefinition(language).name} font
              <select value={form.default_fonts[language] || 'default'}
                onChange={(event) => set('default_fonts', { ...form.default_fonts, [language]: event.target.value })}>
                {fontCatalog(language).map((choice) => (
                  <option key={choice.slug} value={choice.slug}>
                    {choice.label}{choice.source === 'local' ? ' (uploaded)' : choice.source === 'google' ? ' (Google Fonts)' : ''}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <span className={settingsStyles.help}>
          The dark theme recolours the default theme (header, footer, sidebar, post cards, text and links). Page Builder sections
          and Theme Editor blocks with colours of their own keep them.
        </span>
      </fieldset>

      <fieldset className={settingsStyles.fieldset}>
        <legend>Font files</legend>
        {Object.keys(local).length === 0 ? (
          <p className={settingsStyles.help}>
            No font files yet. Put <code>.woff2</code> (or .woff, .ttf, .otf) files in{' '}
            <code>plugins/persian-origins/assets/fonts/fa/&lt;family&gt;/</code> or <code>…/en/&lt;family&gt;/</code> and rebuild
            (<code>npm start</code>). File names like <code>Vazirmatn-Bold.woff2</code> set the weight; Thin, Light, Regular, Medium,
            SemiBold, Bold, Black and Italic are recognised. Until then the Google Fonts choices above are offered.
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Language</th><th>Family</th><th>Weights</th></tr></thead>
              <tbody>
                {Object.entries(local).flatMap(([language, choices]) => choices.map((choice) => (
                  <tr key={`${language}/${choice.slug}`}>
                    <td>{localeDefinition(language).name}</td>
                    <td><span style={{ fontFamily: choice.stack }}>{choice.label}</span> <small>{choice.slug}</small></td>
                    <td>{[...new Set(choice.faces!.map((face) => `${face.weight}${face.style === 'italic' ? ' italic' : ''}`))].join(', ')}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
      </fieldset>

      <div className={settingsStyles.actions}>
        <button type="submit" className={settingsStyles.saveButton} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
      </div>
    </form>
  );
}
