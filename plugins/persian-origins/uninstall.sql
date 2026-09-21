-- persian-origins: drop everything plugins/persian-origins/schema.sql creates.
--
-- Run only when an administrator chooses "wipe data" in the uninstall dialog, after the backup.
-- Safe to re-run; runs inside one transaction.
--
-- Deliberately kept:
--   * category names and descriptions in other languages: they are core translation keys in
--     rwp_translations (Settings → Translations), which core's widgets read with or without
--     this plugin;
--   * category images: the files stay in the Media Library, only the link to them goes;
--   * pages and posts themselves: only their per-language copies are dropped.

drop table if exists public.po_content_translations cascade;
drop table if exists public.po_category_meta cascade;
drop table if exists public.po_user_preferences cascade;

drop function if exists public.po_content_translations_touch();
drop function if exists public.po_category_meta_touch();

delete from public.options where option_name like 'po\_%';

notify pgrst, 'reload schema';
