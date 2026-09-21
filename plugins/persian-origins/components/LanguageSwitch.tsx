import { localeDefinition } from '../../../src/lib/i18n';
import { useBilingual } from '../BilingualContext';

/**
 * [language_switch mode="inline|floating" class="" link_class="" outer_class="" flags="no"]
 *
 * Two overlapping circles, the active language on top; a click swaps them and switches the whole
 * site through core's setLocale(). The wrapper carries `.po-switch-wrap.is-<lang>` like the
 * WordPress plugin, so existing CSS keeps working.
 *
 * The circles show the language's short name (EN, فا) rather than a flag by default: a flag
 * names a country, not a language, and Windows renders flag emoji as two letters anyway.
 * flags="yes" uses core's flag for each locale instead.
 *
 * Always dir="ltr": mirrored, the overlap and the slide would run the wrong way on an RTL page.
 */

export interface LanguageSwitchProps {
  mode?: 'inline' | 'floating';
  className?: string;
  linkClass?: string;
  outerClass?: string;
  flags?: boolean;
}

const shortNames: Record<string, string> = { en: 'EN', fa: 'فا', ar: 'ع', he: 'עב', ur: 'اُ' };
const badgeText = (code: string, flags: boolean) =>
  (flags && localeDefinition(code).flag) || shortNames[code] || code.slice(0, 2).toUpperCase();

export default function LanguageSwitch({ mode = 'inline', className = '', linkClass = '', outerClass = '', flags = false }: LanguageSwitchProps) {
  const { lang, languages, otherLanguage, toggleLanguage, t } = useBilingual();
  const target = localeDefinition(otherLanguage);
  // The active language of the pair; the first one when the site is in a third language.
  const active = languages.includes(lang) ? lang : languages[0];
  const label = t('po.switch.to', 'Switch to {language}', { language: target.nativeName });

  return (
    <div className={`po-switch-outer po-switch-outer--${mode} ${outerClass}`.trim()} dir="ltr">
      <div className={`po-switch-wrap is-${active} ${className}`.trim()}>
        <button type="button" className={`po-switch ${linkClass}`.trim()} onClick={toggleLanguage} aria-label={label} title={label}>
          <span className="po-switch__badges" aria-hidden="true">
            {languages.map((code) => (
              <span key={code} lang={code} className={`po-switch__badge ${code === active ? 'is-active' : ''}`}>
                {badgeText(code, flags)}
              </span>
            ))}
          </span>
          {/* The name of where the click leads, in that language: people look for their own. */}
          <span className="po-switch__label" lang={target.code} dir={target.dir}>{target.nativeName}</span>
        </button>
      </div>
    </div>
  );
}
