import { useEffect, useId, useRef, useState } from 'react';
import { localeDefinition } from '../../../src/lib/i18n';
import { useBilingual } from '../BilingualContext';

/**
 * [site_settings mode="full|panel" class=""]
 *
 * Theme (light/dark), a font per language and text size (A− / % / A+ / Reset). `full` embeds the
 * controls where the shortcode is; `panel` is a round button fixed to the corner that opens them.
 *
 * dir="ltr" on the frame so the controls do not mirror; each label keeps dir="auto" so Persian
 * text inside still reads right to left.
 */

export interface SiteSettingsPanelProps {
  mode?: 'full' | 'panel';
  className?: string;
}

function Controls({ headingId }: { headingId: string }) {
  const {
    theme, setTheme, fontSize, fontSizeLimits, stepFontSize, resetFontSize, languages, fontCatalog, fontFor, setFont, lang, t,
  } = useBilingual();
  // The active language's font first: that is the one visibly in use.
  const ordered = [...languages].sort((a, b) => Number(b === lang) - Number(a === lang));

  return (
    <div className="po-settings__body">
      <h2 id={headingId} className="po-settings__title" dir="auto">{t('po.settings.title', 'Display settings')}</h2>

      <div className="po-settings__row">
        <span className="po-settings__label" dir="auto">{t('po.settings.theme', 'Theme')}</span>
        <div className="po-segmented" role="group" aria-label={t('po.settings.theme', 'Theme')}>
          {(['light', 'dark'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={theme === value}
              className={theme === value ? 'is-active' : ''} onClick={() => setTheme(value)}>
              <span aria-hidden="true">{value === 'light' ? '☀' : '☾'}</span>{' '}
              <span dir="auto">{value === 'light' ? t('po.settings.light', 'Light') : t('po.settings.dark', 'Dark')}</span>
            </button>
          ))}
        </div>
      </div>

      {ordered.map((language) => {
        const definition = localeDefinition(language);
        const selectId = `${headingId}-font-${language}`;
        return (
          <div className="po-settings__row" key={language}>
            <label className="po-settings__label" htmlFor={selectId} dir="auto">
              {t('po.settings.fontFor', '{language} font', { language: t(`language.name.${language}`, definition.name) })}
            </label>
            <select id={selectId} className="po-settings__select" value={fontFor(language).slug}
              onChange={(event) => setFont(language, event.target.value)}>
              {fontCatalog(language).map((choice) => (
                <option key={choice.slug} value={choice.slug}>
                  {choice.source === 'default' ? t('po.settings.siteDefault', 'Site default') : choice.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}

      <div className="po-settings__row">
        <span className="po-settings__label" dir="auto">{t('po.settings.textSize', 'Text size')}</span>
        <div className="po-size" role="group" aria-label={t('po.settings.textSize', 'Text size')}>
          <button type="button" onClick={() => stepFontSize(-1)} disabled={fontSize <= fontSizeLimits.min}
            aria-label={t('po.settings.smaller', 'Smaller text')}>A−</button>
          <output className="po-size__value" aria-live="polite">{fontSize}%</output>
          <button type="button" onClick={() => stepFontSize(1)} disabled={fontSize >= fontSizeLimits.max}
            aria-label={t('po.settings.larger', 'Larger text')}>A+</button>
          <button type="button" className="po-size__reset" onClick={resetFontSize} disabled={fontSize === fontSizeLimits.base}>
            <span dir="auto">{t('po.settings.reset', 'Reset')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SiteSettingsPanel({ mode = 'full', className = '' }: SiteSettingsPanelProps) {
  const { t } = useBilingual();
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => { if (!frame.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (mode === 'full') {
    return (
      <section className={`po-settings po-settings--full ${className}`.trim()} dir="ltr" aria-labelledby={headingId}>
        <Controls headingId={headingId} />
      </section>
    );
  }

  return (
    <div className={`po-settings po-settings--panel ${open ? 'is-open' : ''} ${className}`.trim()} dir="ltr" ref={frame}>
      <button ref={button} type="button" className="po-settings__toggle" aria-expanded={open}
        aria-label={open ? t('po.settings.close', 'Close display settings') : t('po.settings.open', 'Display settings')}
        onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true">{open ? '×' : 'Aa'}</span>
      </button>
      {open && (
        <div className="po-settings__popover" role="dialog" aria-labelledby={headingId}>
          <Controls headingId={headingId} />
        </div>
      )}
    </div>
  );
}
