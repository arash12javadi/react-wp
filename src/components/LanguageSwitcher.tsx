import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Globe } from 'lucide-react';
import { useTranslation } from '../context/I18nContext';
import type { LocaleDefinition } from '../lib/i18n';
import styles from './LanguageSwitcher.module.css';

/**
 * The public language switcher.
 *
 * Hidden entirely when the site offers a single language, or when Settings → Languages turns
 * "Show the language switcher" off — checking the setting here rather than at every call site
 * means a plugin that drops one into its own header gets the same behaviour for free.
 *
 * Switching does not reload: setLocale() updates the i18n store, every consumer re-renders and
 * the page builder picks the layout for the new locale. An in-progress comment or form is kept.
 */

export interface LanguageSwitcherProps {
  /** 'dropdown' is the header default; 'inline' lays the languages out as a row of buttons. */
  variant?: 'dropdown' | 'inline';
  /** Show 🇮🇷-style flags next to the names. A flag is a country, not a language, so this is off by default. */
  showFlags?: boolean;
  /** Ignore the site setting. For the admin preview and for plugins that place their own switcher. */
  force?: boolean;
  className?: string;
}

const label = (locale: LocaleDefinition, showFlags: boolean) =>
  `${showFlags && locale.flag ? `${locale.flag} ` : ''}${locale.nativeName}`;

export default function LanguageSwitcher({ variant = 'dropdown', showFlags = false, force = false, className = '' }: LanguageSwitcherProps) {
  const { locale, locales, settings, setLocale, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, [open]);

  if (!force && !settings.show_header_language_switcher) return null;
  // Nothing to switch between.
  if (locales.length < 2) return null;

  const active = locales.find((entry) => entry.code === locale) || locales[0];
  // Each language is listed in its own language (so people can find theirs); the hint names it in
  // the interface language: "Persian" on an English page, "فارسی" once language.name.fa is
  // translated under Settings → Translations.
  const hint = (entry: LocaleDefinition) => t(`language.name.${entry.code}`, entry.name);

  const choose = (code: string) => {
    setLocale(code);
    setOpen(false);
    buttonRef.current?.focus();
  };

  if (variant === 'inline') {
    return (
      <div className={`${styles.inline} rwp-language-switcher ${className}`} role="group" aria-label={t('language.chooseLanguage', 'Choose a language')}>
        {locales.map((entry) => (
          <button
            key={entry.code}
            type="button"
            lang={entry.code}
            title={hint(entry)}
            className={entry.code === active.code ? styles.inlineActive : styles.inlineOption}
            aria-current={entry.code === active.code ? 'true' : undefined}
            onClick={() => choose(entry.code)}
          >
            {label(entry, showFlags)}
          </button>
        ))}
      </div>
    );
  }

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const options = Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []);
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown'
      ? options[(index + 1) % options.length]
      : options[(index - 1 + options.length) % options.length];
    next?.focus();
  };

  return (
    <div className={`${styles.switcher} rwp-language-switcher ${className}`} ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('language.current', 'Current language: {language}', { language: active.nativeName })}
        title={t('language.change', 'Change language')}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Globe size={16} aria-hidden="true" />
        <span className={styles.triggerLabel} lang={active.code}>{label(active, showFlags)}</span>
        <span className={styles.caret} aria-hidden="true">▾</span>
      </button>

      {open && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div className={styles.menu} role="listbox" aria-label={t('language.chooseLanguage', 'Choose a language')} onKeyDown={onListKeyDown}>
          {locales.map((entry) => {
            const selected = entry.code === active.code;
            return (
              <button
                key={entry.code}
                type="button"
                role="option"
                lang={entry.code}
                dir={entry.dir}
                aria-selected={selected}
                title={hint(entry)}
                className={selected ? styles.optionSelected : styles.option}
                onClick={() => choose(entry.code)}
              >
                <span>{label(entry, showFlags)}</span>
                {selected && <Check size={14} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
