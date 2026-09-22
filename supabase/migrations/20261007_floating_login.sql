-- Settings → Floating Login: the default settings, as rows in public.options.
--
-- Optional: the site already uses these defaults when a row is missing. Safe to re-run: a setting
-- that already has a value (including one saved while Floating Login was a plugin) is never
-- overwritten. No tables, policies or functions: options is publicly readable and only
-- manage_options can write it, which is exactly who edits these.
--
-- Kept identical to the Floating Login block in supabase/schema.sql.

insert into public.options (option_name, option_value) values
  ('floating_login_enabled', 'true'),
  ('floating_login_position', 'bottom-right'),
  ('floating_login_button_text', 'Login / Register'),
  ('floating_login_allow_registration', 'true'),
  ('floating_login_redirect_url', '/'),
  ('floating_login_theme', 'dark')
on conflict (option_name) do nothing;

notify pgrst, 'reload schema';
