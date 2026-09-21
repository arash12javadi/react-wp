import { useBilingual } from '../BilingualContext';
import LanguageSwitch from './LanguageSwitch';
import SiteSettingsPanel from './SiteSettingsPanel';
import TranslateMode from './TranslateMode';

/**
 * The switch and the settings button fixed to the page, when Persian Origins → Appearance turns
 * them on, and the Translate button for administrators. Added to core's after_footer slot, so
 * every public page built on PublicLayout has them without a shortcode.
 */
export default function FloatingControls() {
  const { settings } = useBilingual();
  return (
    <>
      {settings.floating_switch && <LanguageSwitch mode="floating" />}
      {settings.floating_settings && <SiteSettingsPanel mode="panel" />}
      <TranslateMode />
    </>
  );
}

/** The switch in core's header, next to the login links, when turned on. */
export function HeaderSwitch() {
  const { settings } = useBilingual();
  return settings.header_switch ? <LanguageSwitch mode="inline" outerClass="po-switch-outer--header" /> : null;
}
