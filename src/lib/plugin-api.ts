export {
  rwp,
  type RwpActionName,
  type RwpAdminPage,
  type RwpAdminPageProps,
  type RwpAdminSubmenuItem,
  type RwpDashboardWidget,
  type RwpSetupCheck,
  type RwpSetupLevel,
  type RwpSetupNotice,
  type RwpFilterName,
  type RwpPlugin,
  type RwpPluginManifest,
  type RwpPluginContext,
  type RwpShortcode,
  type RwpRoute,
  type RwpRouteProps,
  type RwpHeaderItem,
  type RwpContentRenderer,
  type RwpContentRendererProps,
  type RwpContentAction,
  type RwpArchive,
  type RwpTemplateProvider,
  type RwpTemplateRenderProps,
} from './rwp';

// The hook registry, for plugins that want priorities or hook names core does not declare.
export {
  addAction, addFilter, applyFilters, doAction, removeAction, removeFilter,
  hasAction, hasFilter, listHooks, DEFAULT_PRIORITY,
  type SlotName,
} from '../core/hooks';

// Layout zones and the React bindings.
export {
  HookSlot, addSlotContent, useApplyFilters, useDoAction, useAction, useFilter, useHooks,
  type HookSlotProps, type SlotContribution,
} from '../core/HookSlot';

// Translations and text direction.
export {
  registerPluginTranslations, isRtlLocale, directionOf, getLocale, getDirection, setLocale,
  formatDate, formatNumber, t, translate,
  type LocaleDefinition, type TextDirection, type TranslationDictionary,
} from './i18n';
export { useTranslation, useDirection } from '../context/I18nContext';
export { default as LanguageSwitcher } from '../components/LanguageSwitcher';

import { rwp, type RwpPluginManifest, type RwpPluginContext } from './rwp';

export const defineRwpPlugin = (
  manifest: RwpPluginManifest,
  register: (context: RwpPluginContext) => void | (() => void),
) => rwp.registerPlugin({
  id: manifest.id,
  name: manifest.name,
  version: manifest.version,
  author: manifest.author,
  description: manifest.description,
  register,
});
