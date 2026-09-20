/**
 * Where uploaded files live at the provider, and which prefixes belong to whom.
 *
 * Plain JavaScript, not TypeScript, because server.mjs imports it directly (the same reason
 * src/lib/scriptSanitizer.js is plain JS). The browser and the server must agree on these
 * prefixes exactly: one writes them at upload time, the other deletes by them.
 *
 * Layout:
 *   media/<library folder>          general Media Library uploads (media/general, media/blog/2026)
 *   plugins/<plugin id>/<sub>       assets a plugin owns and may delete when it is uninstalled
 *
 * The provider folder is deliberately NOT the same thing as media.folder. media.folder is the
 * library folder shown in the admin and can be changed by moving an item, which never touches
 * the provider file (in Cloudinary's fixed folder mode that would change the delivery URL). The
 * provider folder is fixed at upload time and is what public ids are built from.
 */

/** Everything the general Media Library uploads goes under this. */
export const SITE_MEDIA_PREFIX = 'media';

/** Everything a plugin uploads goes under plugins/<id>/. */
export const PLUGIN_MEDIA_PREFIX = 'plugins';

const clean = (value) => String(value || '')
  .replace(/\\/g, '/')
  .split('/')
  .map((part) => part.trim())
  // "." and ".." would let a caller climb out of its own prefix, which is the whole point of
  // having prefixes: a plugin uninstall must not be able to reach the Media Library.
  .filter((part) => part && part !== '.' && part !== '..')
  .join('/');

/** The provider folder for a general Media Library upload: media/general, media/blog/2026. */
export const siteMediaFolder = (libraryFolder) => {
  const folder = clean(libraryFolder);
  return folder ? `${SITE_MEDIA_PREFIX}/${folder}` : SITE_MEDIA_PREFIX;
};

/** Everything plugin <id> owns: plugins/rwp-shop. Deleted wholesale when it is uninstalled. */
export const pluginMediaPrefix = (pluginId) => `${PLUGIN_MEDIA_PREFIX}/${clean(pluginId)}`;

/** The provider folder for a plugin upload: plugins/rwp-shop/products. */
export const pluginMediaFolder = (pluginId, subFolder) => {
  const sub = clean(subFolder);
  const base = pluginMediaPrefix(pluginId);
  return sub ? `${base}/${sub}` : base;
};

/**
 * True when a public id belongs to the general Media Library rather than to a plugin. Used by
 * plugin uninstall, which must leave library assets alone even when the plugin references them.
 */
export const isSiteMedia = (publicId) => String(publicId || '').startsWith(`${SITE_MEDIA_PREFIX}/`);

/** True when a public id belongs to this specific plugin. */
export const isPluginMedia = (publicId, pluginId) =>
  String(publicId || '').startsWith(`${pluginMediaPrefix(pluginId)}/`);

/**
 * The prefixes a site reset should clear. Sites installed before this convention existed have
 * assets at the bare library folder (general/abc, blog/2026/xyz) with no media/ prefix, so a
 * reset cannot rely on prefixes alone — it deletes by the public ids recorded in the media
 * table as well. This list is what catches anything the table has already lost track of.
 */
export const siteMediaPrefixes = () => [SITE_MEDIA_PREFIX, PLUGIN_MEDIA_PREFIX];
