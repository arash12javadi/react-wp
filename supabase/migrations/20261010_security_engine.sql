-- Security, anti-bot, rate limiting, caching and the native SEO routes. Core, not a plugin:
-- server.mjs reads these before any plugin is loaded, and the sitemap and robots.txt are served
-- for a site that has no plugins at all. Safe to re-run.
--
-- Everything here is one of two kinds of setting, and which kind decides where it is stored:
--
--   * Public knobs go in public.options, one row each, because server.mjs reads them with the
--     publishable key on a timer (server/middleware/securitySettings.mjs) and because the browser
--     needs the CAPTCHA site key before the app has loaded anything else. Exactly the reasoning
--     behind the four language rows and the floating_login_* rows.
--
--   * The CAPTCHA secret key does NOT go in options. public.options is world-readable by design
--     ("Allow public read access on options" in schema.sql) — the public site reads site_title
--     before anyone signs in — so a secret in it is a file every visitor can download. It lives in
--     public.rwp_security_secrets, which has RLS on and no policy at all, exactly like
--     plugins/rwp-chat's chat_secrets: only the server's secret key reaches the row, and the admin
--     screen goes through rwp_security_save_secrets / rwp_security_secrets_status, which reports
--     set / not set and never a value.
--
-- The counters themselves (request buckets, flagged addresses, cached pages) are deliberately NOT
-- tables. They are per-process memory in server.mjs. A rate limiter that writes a row per request
-- turns every request into a database round trip, which is the latency this engine exists to
-- avoid; and a self-hosted React-WP is one Node process, so one process's memory is the whole
-- picture. Behind several processes each one limits its own share — documented, not hidden.

-- 1. Public settings ---------------------------------------------------------------------------
-- on conflict do nothing: a re-run must never overwrite what an administrator has chosen.

insert into public.options (option_name, option_value) values
  -- Sessions. Supabase Auth owns the real JWT lifetime (Dashboard → Authentication → Sessions);
  -- these drive the app's own idle/absolute expiry and the cookie attributes server.mjs sets.
  ('session_max_age_hours', '24'),
  ('session_remember_me_days', '30'),
  ('session_cookie_samesite', 'Lax'),
  -- Rate limiting. One window shared by both tiers, two ceilings.
  ('rate_limit_window_minutes', '15'),
  ('rate_limit_auth_max', '5'),
  ('rate_limit_api_max', '100'),
  -- Anti-bot. The secret key is NOT here; see the header.
  ('anti_bot_provider', 'none'),
  ('anti_bot_site_key', ''),
  ('anti_bot_honeypot', 'true'),
  -- Which public forms must carry a verified token. Comma separated, from
  -- login, register, lost_password, comment, contact.
  ('anti_bot_forms', 'register,comment'),
  -- How long an address stays flagged after tripping a honeypot, in minutes.
  ('anti_bot_flag_minutes', '60'),
  -- Caching.
  ('cache_enabled', 'false'),
  ('cache_ttl_seconds', '3600'),
  ('cache_stale_while_revalidate_seconds', '86400'),
  ('cache_static_max_age_seconds', '31536000'),
  -- SEO. An empty robots_txt_content means "serve the generated default", which is not the same
  -- as an empty file: a site that saved an empty box would otherwise silently allow everything.
  ('robots_txt_content', ''),
  ('sitemap_enabled', 'true')
on conflict (option_name) do nothing;

-- 2. Private credentials -------------------------------------------------------------------------

create table if not exists public.rwp_security_secrets (
  id boolean primary key default true check (id),
  -- Cloudflare Turnstile secret, or Google reCAPTCHA v3 secret, depending on anti_bot_provider.
  anti_bot_secret_key text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.rwp_security_secrets add column if not exists anti_bot_secret_key text not null default '';

alter table public.rwp_security_secrets drop constraint if exists rwp_security_secrets_size_check;
alter table public.rwp_security_secrets add constraint rwp_security_secrets_size_check
  check (char_length(anti_bot_secret_key) <= 400);

insert into public.rwp_security_secrets (id) values (true) on conflict (id) do nothing;

create or replace function public.rwp_security_secrets_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists rwp_security_secrets_touch on public.rwp_security_secrets;
create trigger rwp_security_secrets_touch
  before insert or update on public.rwp_security_secrets
  for each row execute function public.rwp_security_secrets_touch();

/**
 * Writes the CAPTCHA secret. A null or absent key keeps what is stored, so the admin screen can
 * save the rest of the form without having to re-type a secret it is never shown.
 */
create or replace function public.rwp_security_save_secrets(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.user_has_cap('manage_options') then
    raise exception using errcode = '42501',
      message = 'Saving the CAPTCHA secret needs the “Manage settings” capability (Administrator), and your role does not have it.';
  end if;
  update public.rwp_security_secrets s set
    anti_bot_secret_key = left(coalesce(p_payload->>'anti_bot_secret_key', s.anti_bot_secret_key), 400),
    updated_by = auth.uid()
  where s.id;
  return public.rwp_security_secrets_status();
end;
$$;

/** Whether the secret is set — never its value, the rule the setup checklist already follows. */
create or replace function public.rwp_security_secrets_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_row public.rwp_security_secrets;
begin
  if not public.user_has_cap('manage_options') then
    raise exception using errcode = '42501',
      message = 'Viewing the CAPTCHA secret status needs the “Manage settings” capability (Administrator).';
  end if;
  select * into v_row from public.rwp_security_secrets limit 1;
  return jsonb_build_object(
    'anti_bot_secret_key', coalesce(v_row.anti_bot_secret_key, '') <> '',
    'updated_at', v_row.updated_at
  );
end;
$$;

-- 3. Row level security ----------------------------------------------------------------------------
-- RLS on and no policy: neither anon nor authenticated can read the secret even by accident. The
-- server reads it with SUPABASE_SECRET_KEY, which bypasses RLS.

alter table public.rwp_security_secrets enable row level security;

drop policy if exists "Security managers read secrets" on public.rwp_security_secrets;
drop policy if exists "Security managers write secrets" on public.rwp_security_secrets;

-- 4. Grants ------------------------------------------------------------------------------------------

revoke all on table public.rwp_security_secrets from anon, authenticated;

-- New public functions are executable by anon by default (Supabase default privileges).
revoke execute on function public.rwp_security_secrets_touch() from public, anon, authenticated;
revoke execute on function public.rwp_security_save_secrets(jsonb) from public, anon;
revoke execute on function public.rwp_security_secrets_status() from public, anon;

grant execute on function public.rwp_security_save_secrets(jsonb) to authenticated;
grant execute on function public.rwp_security_secrets_status() to authenticated;

-- 5. Sitemap source ------------------------------------------------------------------------------------
-- server/sitemap.mjs reads published rows with the publishable key, so it sees exactly what a
-- visitor sees — there is no privileged path that could leak a draft into the sitemap. This index
-- is what keeps that query cheap on a large site.

create index if not exists pages_sitemap_idx
  on public.pages (status, updated_at desc)
  where status = 'published';

-- Without this PostgREST keeps serving the old column list and every new column reads as missing.
notify pgrst, 'reload schema';
