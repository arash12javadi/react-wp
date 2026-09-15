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
} from './rwp';

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
