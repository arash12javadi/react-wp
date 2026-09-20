-- rwp-page-builder: drop everything plugins/rwp-page-builder/schema.sql creates.
--
-- Run by POST /api/plugins/uninstall when the administrator chooses "wipe data".
-- Safe to re-run; runs inside one transaction.
--
-- Deliberately NOT dropped, because they are core columns on a core table that core itself
-- writes (rwp_install_default_content, builder_create_site_template, saveBuilderPage):
--   * public.pages.builder_data, .builder_data_i18n, .is_builder_enabled
--   * public.pages.is_site_template, .template_type and public.rwp_template_types()
-- Dropping those would delete every saved layout and every site template, including the
-- header and footer the public site renders through <SiteTemplate>. A page whose
-- is_builder_enabled is true simply falls back to its `content` HTML once the plugin is gone.
--
-- Also kept: form_submissions rows are exported in the backup before this runs, because a
-- contact form's submissions are business records, not plugin state.

-- Triggers on the core pages table, and on the plugin's own tables.
drop trigger if exists builder_guard_html_pages on public.pages;
drop trigger if exists builder_record_revision on public.pages;
drop trigger if exists builder_guard_html_templates on public.elementor_templates;
drop trigger if exists builder_templates_touch on public.elementor_templates;

-- Tables. builder_form_settings first: it is the one holding private form recipients.
drop table if exists public.builder_form_settings cascade;
drop table if exists public.page_builder_revisions cascade;
drop table if exists public.form_submissions cascade;
drop table if exists public.elementor_templates cascade;

drop function if exists public.builder_author_profile(bigint);
drop function if exists public.builder_template_public(uuid);
drop function if exists public.builder_author_names(uuid[]);
drop function if exists public.builder_submit_form(bigint, text, jsonb);
drop function if exists public.builder_templates_touch();
drop function if exists public.builder_record_revision();
drop function if exists public.builder_guard_html();
drop function if exists public.builder_html_fingerprint(jsonb);
drop function if exists public.builder_can_edit_page(bigint);

-- Global colours and fonts chosen in the builder.
delete from public.options where option_name = 'builder_global_styles';

notify pgrst, 'reload schema';
