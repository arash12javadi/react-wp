-- App Settings (Admin → App Settings): display toggles, upload rules and disk quotas, media
-- scoping, SEO keywords and tracking scripts, and extra capabilities for lower roles.
-- Safe to re-run. Kept identical to the matching sections of supabase/schema.sql.
--
-- The settings themselves are one JSON document in public.options under rwp_app_settings.
-- options is publicly readable, which is fine for everything in that document. Per-user quota
-- overrides are keyed by email address, so they live in their own table that only settings
-- managers can read.

-- Page editor: meta keywords (shown only when enabled under App Settings → SEO).
alter table public.pages add column if not exists meta_keywords text;

-- Per-user disk quota overrides -----------------------------------------------------------
-- Keyed by email rather than profile id so an allowance can be set before the person signs
-- up, and not stored on profiles because users can update their own profile row.

create table if not exists public.rwp_quota_overrides (
  email text primary key check (email = lower(email) and position('@' in email) > 1),
  quota_mb integer not null check (quota_mb >= 0),
  created_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.rwp_quota_overrides enable row level security;

drop policy if exists "Settings managers manage quota overrides" on public.rwp_quota_overrides;
create policy "Settings managers manage quota overrides"
  on public.rwp_quota_overrides for all to authenticated
  using (public.user_has_cap('manage_options'))
  with check (public.user_has_cap('manage_options'));

-- Settings readers ---------------------------------------------------------------------------

-- Invalid JSON in the option must not break every capability check on the site, so it reads
-- as an empty document instead of raising.
create or replace function public.rwp_app_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  raw text;
begin
  select option_value into raw from public.options where option_name = 'rwp_app_settings';
  if raw is null or raw = '' then
    return '{}'::jsonb;
  end if;
  begin
    return coalesce(raw::jsonb, '{}'::jsonb);
  exception when others then
    return '{}'::jsonb;
  end;
end;
$$;

-- A number at a path in the settings document, or null when unset or not a number.
create or replace function public.rwp_app_setting_number(p_path text[])
returns numeric language sql stable security definer set search_path = public as $$
  select case
    when jsonb_typeof(public.rwp_app_settings() #> p_path) = 'number'
      then (public.rwp_app_settings() #>> p_path)::numeric
  end;
$$;

-- Capabilities -------------------------------------------------------------------------------
-- Mirrors roleCapabilities + applyCapabilityGrants in src/lib/roles.ts. Only the four grants
-- below can be switched on from settings; nothing above Author can be granted this way.

create or replace function public.user_has_cap(capability text)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.current_user_role()
    when 'super_admin' then true
    when 'administrator' then true
    when 'shop_manager' then capability in (
      'read', 'edit_posts', 'delete_posts', 'publish_posts', 'upload_files',
      'edit_others_posts', 'delete_others_posts', 'edit_pages', 'publish_pages',
      'manage_categories', 'moderate_comments', 'manage_shop', 'list_users')
    when 'editor' then capability in (
      'read', 'edit_posts', 'delete_posts', 'publish_posts', 'upload_files',
      'edit_others_posts', 'delete_others_posts', 'edit_pages', 'publish_pages',
      'manage_categories', 'moderate_comments')
    when 'author' then capability in ('read', 'edit_posts', 'delete_posts', 'publish_posts', 'upload_files')
    when 'contributor' then capability in ('read', 'edit_posts', 'delete_posts')
      or (capability = 'upload_files'
        and coalesce(public.rwp_app_settings() #> '{roles,contributor_upload_files}' = 'true'::jsonb, false))
      or (capability = 'publish_posts'
        and coalesce(public.rwp_app_settings() #> '{roles,contributor_publish_posts}' = 'true'::jsonb, false))
    when 'subscriber' then capability = 'read'
      or (capability = 'upload_files'
        and coalesce(public.rwp_app_settings() #> '{roles,subscriber_upload_files}' = 'true'::jsonb, false))
      or (capability in ('edit_posts', 'delete_posts')
        and coalesce(public.rwp_app_settings() #> '{roles,subscriber_edit_posts}' = 'true'::jsonb, false))
    else false
  end;
$$;

grant execute on function public.user_has_cap(text) to anon, authenticated;

-- Disk quotas --------------------------------------------------------------------------------

-- Bytes the user may store, or null for unlimited. An override by email wins; otherwise the
-- role's quota applies (Shop Manager uses the Editor quota). Administrators are unlimited
-- unless they have an override.
create or replace function public.rwp_user_quota_bytes(p_user uuid)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare
  user_email text;
  user_role text;
  override_mb integer;
  role_mb numeric;
begin
  select lower(u.email), p.role into user_email, user_role
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = p_user;

  select quota_mb into override_mb from public.rwp_quota_overrides where email = user_email;
  if found then
    return override_mb::bigint * 1048576;
  end if;

  if user_role = 'shop_manager' then
    user_role := 'editor';
  end if;
  if user_role is null or user_role not in ('editor', 'author', 'contributor', 'subscriber') then
    return null;
  end if;

  role_mb := public.rwp_app_setting_number(array['uploads', 'quota_mb', user_role]);
  return case when role_mb is null or role_mb < 0 then null else (role_mb * 1048576)::bigint end;
end;
$$;

-- What the signed-in user has used and may still upload, for the media screen and the
-- ImageKit signing endpoint.
create or replace function public.rwp_upload_allowance()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'can_upload', coalesce(public.user_has_cap('upload_files'), false),
    'used_bytes', (select coalesce(sum(m.bytes), 0) from public.media m where auth.uid() is not null and m.uploaded_by = auth.uid()),
    'quota_bytes', case when auth.uid() is null then 0 else public.rwp_user_quota_bytes(auth.uid()) end,
    'has_override', exists (
      select 1 from public.rwp_quota_overrides o join auth.users u on lower(u.email) = o.email
      where u.id = auth.uid()
    )
  );
$$;

-- Disk usage of every account, for App Settings → Uploads.
create or replace function public.rwp_disk_usage_report()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.user_has_cap('manage_options') then
    raise exception 'Only administrators can view disk usage. It needs the manage_options capability, and your role does not have it.'
      using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'email', lower(coalesce(u.email, p.email)),
      'display_name', p.display_name,
      'role', p.role,
      'used_bytes', (select coalesce(sum(m.bytes), 0) from public.media m where m.uploaded_by = p.id),
      'quota_bytes', public.rwp_user_quota_bytes(p.id)
    ) order by lower(coalesce(u.email, p.email))), '[]'::jsonb)
    from public.profiles p left join auth.users u on u.id = p.id
  );
end;
$$;

-- Media: upload rules and scoping ------------------------------------------------------------

-- Whether the signed-in user may edit or delete a media row uploaded by p_uploaded_by. With
-- general.scope_media_to_owner on, roles without edit_others_posts manage only their own.
-- Used by the media policies and by /api/media-delete, so both apply the same rule.
create or replace function public.rwp_can_manage_media(p_uploaded_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.user_has_cap('upload_files'), false) and (
    (auth.uid() is not null and p_uploaded_by = auth.uid())
    or public.user_has_cap('edit_others_posts')
    or coalesce(public.rwp_app_settings() #> '{general,scope_media_to_owner}' <> 'true'::jsonb, true)
  );
$$;

-- The size, dimension and quota values checked here are reported by the uploading browser,
-- because the file goes straight to Cloudinary or ImageKit. This stops honest clients and
-- keeps the library and quota accounting consistent; it is not a hard limit on what reaches
-- the provider. It also pins uploaded_by to the caller, so quota and scoping cannot be dodged
-- by attributing an upload to someone else.
create or replace function public.media_enforce_upload_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  caller uuid := auth.uid();
  max_kb numeric;
  min_w numeric;
  min_h numeric;
  max_w numeric;
  max_h numeric;
  quota bigint;
  used bigint;
begin
  -- Installer, service-role and SQL Editor connections have no auth.uid().
  if caller is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Only title and alt text are meant to change after upload.
    new.uploaded_by := old.uploaded_by;
    new.bytes := old.bytes;
    new.width := old.width;
    new.height := old.height;
    return new;
  end if;

  new.uploaded_by := caller;
  if new.provider = 'external' then
    return new;
  end if;

  max_kb := public.rwp_app_setting_number('{uploads,max_upload_kb}');
  quota := public.rwp_user_quota_bytes(caller);
  if (max_kb is not null or quota is not null) and new.bytes is null then
    raise exception 'Upload rejected: the file size is missing, and upload limits are enabled under App Settings → Uploads.';
  end if;
  if max_kb is not null and new.bytes > max_kb * 1024 then
    raise exception 'Upload rejected: this file is % KB, over the % KB limit set under App Settings → Uploads.',
      ceil(new.bytes / 1024.0), max_kb;
  end if;

  if coalesce(new.mime_type, '') like 'image/%' then
    min_w := public.rwp_app_setting_number('{uploads,min_width}');
    min_h := public.rwp_app_setting_number('{uploads,min_height}');
    max_w := public.rwp_app_setting_number('{uploads,max_width}');
    max_h := public.rwp_app_setting_number('{uploads,max_height}');
    if coalesce(min_w, min_h, max_w, max_h) is not null and (new.width is null or new.height is null) then
      raise exception 'Upload rejected: the image dimensions are missing, and dimension limits are enabled under App Settings → Uploads.';
    end if;
    if new.width < min_w or new.height < min_h then
      raise exception 'Upload rejected: the image is % × % px, smaller than the minimum of % × % px.',
        new.width, new.height, coalesce(min_w::text, 'any'), coalesce(min_h::text, 'any');
    end if;
    if new.width > max_w or new.height > max_h then
      raise exception 'Upload rejected: the image is % × % px, larger than the maximum of % × % px.',
        new.width, new.height, coalesce(max_w::text, 'any'), coalesce(max_h::text, 'any');
    end if;
  end if;

  if quota is not null then
    -- Serialises one user's concurrent uploads so two cannot both fit into the last megabyte.
    perform pg_advisory_xact_lock(hashtext('rwp_media_quota:' || caller::text));
    select coalesce(sum(bytes), 0) into used from public.media where uploaded_by = caller;
    if used + new.bytes > quota then
      raise exception 'Upload rejected: this file needs % MB, but you have % MB left of your % MB disk quota.',
        round(new.bytes / 1048576.0, 2), round(greatest(quota - used, 0) / 1048576.0, 2), round(quota / 1048576.0, 2);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists media_enforce_upload_rules on public.media;
create trigger media_enforce_upload_rules
  before insert or update on public.media
  for each row execute function public.media_enforce_upload_rules();

drop policy if exists "Uploaders can update media" on public.media;
create policy "Uploaders can update media"
  on public.media for update to authenticated
  using (public.rwp_can_manage_media(uploaded_by)) with check (public.rwp_can_manage_media(uploaded_by));
drop policy if exists "Uploaders can delete media" on public.media;
create policy "Uploaders can delete media"
  on public.media for delete to authenticated
  using (public.rwp_can_manage_media(uploaded_by));

-- Internal helpers are executable by anon by default; only the endpoints below are meant to
-- be called. rwp_can_manage_media stays callable because the media policies run it as the
-- signed-in user and /api/media-delete calls it over REST.
revoke execute on function public.rwp_app_settings() from public, anon, authenticated;
revoke execute on function public.rwp_app_setting_number(text[]) from public, anon, authenticated;
revoke execute on function public.rwp_user_quota_bytes(uuid) from public, anon, authenticated;
revoke execute on function public.media_enforce_upload_rules() from public, anon, authenticated;
revoke execute on function public.rwp_upload_allowance() from public, anon;
revoke execute on function public.rwp_disk_usage_report() from public, anon;
revoke execute on function public.rwp_can_manage_media(uuid) from public, anon;
grant execute on function public.rwp_upload_allowance() to authenticated;
grant execute on function public.rwp_disk_usage_report() to authenticated;
grant execute on function public.rwp_can_manage_media(uuid) to authenticated;

notify pgrst, 'reload schema';
