export {
  parseShortcodes,
  rwp,
  type RwpActionName,
  type RwpAdminPage,
  type RwpDashboardWidget,
  type RwpFilterName,
  type RwpPlugin,
  type RwpPluginManifest,
  type RwpPluginContext,
  type RwpShortcode,
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
