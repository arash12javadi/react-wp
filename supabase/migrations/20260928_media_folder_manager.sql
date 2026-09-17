-- Media folder manager: folders as real rows, so they can be created empty, renamed and deleted
-- from the Media Library. Requires 20260927_media_folders.sql (the media.folder column).
--
-- - public.media_folders holds every folder path, including empty ones.
-- - A trigger records the folder (and its parents) whenever media is put in one, so the table
--   never misses a folder that holds media.
-- - Renaming and deleting go through rwp_rename_media_folder / rwp_delete_media_folder. They run
--   as the caller (SECURITY INVOKER), so the existing media RLS decides which items may change,
--   and they are all-or-nothing: if any item in the folder cannot be changed, nothing is.
-- Safe to re-run.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'media' and column_name = 'folder'
  ) then
    raise exception 'Run supabase/migrations/20260927_media_folders.sql first: public.media has no folder column yet.';
  end if;
end $$;

create table if not exists public.media_folders (
  path varchar(255) primary key
    constraint media_folders_path_format check (path ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$' and char_length(path) <= 255),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- "blog/2026/may" -> blog, blog/2026, blog/2026/may. Called by the invoker functions below,
-- so authenticated users need execute; it only splits a string.
create or replace function public.rwp_media_folder_lineage(p_path text)
returns setof text language sql immutable set search_path = public as $$
  select array_to_string((string_to_array(p_path, '/'))[1:depth], '/')
  from generate_series(1, coalesce(array_length(string_to_array(p_path, '/'), 1), 0)) as depth;
$$;
revoke execute on function public.rwp_media_folder_lineage(text) from public, anon;
grant execute on function public.rwp_media_folder_lineage(text) to authenticated;

-- True when p_folder is p_root or inside it. LIKE is avoided because "_" is a wildcard there.
create or replace function public.rwp_media_folder_in(p_folder text, p_root text)
returns boolean language sql immutable set search_path = public as $$
  select p_folder = p_root or left(p_folder, char_length(p_root) + 1) = p_root || '/';
$$;
revoke execute on function public.rwp_media_folder_in(text, text) from public, anon;
grant execute on function public.rwp_media_folder_in(text, text) to authenticated;

-- Backfill: the default folder plus every folder media already uses, with its parents.
insert into public.media_folders (path, created_by)
select distinct lineage, null::uuid
from (
  select 'general'::text as folder
  union
  select distinct folder from public.media
) used
cross join lateral public.rwp_media_folder_lineage(used.folder) as lineage
on conflict (path) do nothing;

-- Keeps media_folders in step with media.folder. SECURITY DEFINER because it writes folder rows
-- the caller's own RLS may not cover; the path is already validated by media_folder_format.
create or replace function public.media_record_folder()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.media_folders (path, created_by)
  select lineage, auth.uid() from public.rwp_media_folder_lineage(new.folder) as lineage
  on conflict (path) do nothing;
  return new;
end;
$$;
revoke execute on function public.media_record_folder() from public, anon, authenticated;

drop trigger if exists media_record_folder on public.media;
create trigger media_record_folder
  after insert or update of folder on public.media
  for each row execute function public.media_record_folder();

alter table public.media_folders enable row level security;

drop policy if exists "Uploaders can read media folders" on public.media_folders;
create policy "Uploaders can read media folders"
  on public.media_folders for select to authenticated using (true);
drop policy if exists "Uploaders can create media folders" on public.media_folders;
create policy "Uploaders can create media folders"
  on public.media_folders for insert to authenticated
  with check (public.user_has_cap('upload_files'));
-- Same ownership rule as media: your own folders, or everyone's when media is not limited to
-- its uploader (or you have edit_others_posts). rwp_can_manage_media() only exists once
-- 20260920_app_settings.sql has been run, so this looks it up when called rather than when the
-- policy is created: before that migration any uploader may manage any media (the same as the
-- media policies then), and afterwards the ownership rule applies without re-running this file.
-- PL/pgSQL resolves the call on first execution, which is what makes the lookup safe.
create or replace function public.rwp_can_manage_media_folder(p_created_by uuid)
returns boolean language plpgsql stable security invoker set search_path = public as $$
begin
  if not coalesce(public.user_has_cap('upload_files'), false) then
    return false;
  end if;
  -- Folders with no creator (backfilled from existing media) are shared.
  if p_created_by is null then
    return true;
  end if;
  if to_regprocedure('public.rwp_can_manage_media(uuid)') is null then
    return true;
  end if;
  return public.rwp_can_manage_media(p_created_by);
end;
$$;
revoke execute on function public.rwp_can_manage_media_folder(uuid) from public, anon;
grant execute on function public.rwp_can_manage_media_folder(uuid) to authenticated;

-- The media inside a folder stays protected by the media policies, because renaming or deleting
-- a non-empty folder has to update those rows too. The default folder is never deleted.
drop policy if exists "Uploaders can delete media folders" on public.media_folders;
create policy "Uploaders can delete media folders"
  on public.media_folders for delete to authenticated
  using (path <> 'general' and public.rwp_can_manage_media_folder(created_by));

-- Rename / move a folder --------------------------------------------------------------------------
create or replace function public.rwp_rename_media_folder(p_from text, p_to text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  src text := trim(both '/' from coalesce(p_from, ''));
  dst text := trim(both '/' from coalesce(p_to, ''));
  total integer;
  moved integer;
  folder_total integer;
  folder_removed integer;
begin
  if not public.user_has_cap('upload_files') then
    raise exception using errcode = '42501', message = 'Renaming folders needs the upload_files capability.';
  end if;
  if src = 'general' then
    raise exception 'The "general" folder is where new media goes by default, so it cannot be renamed.';
  end if;
  if dst !~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$' or char_length(dst) > 255 then
    raise exception 'The folder name "%" is not valid. Use letters, digits, "-" and "_", with "/" between levels.', dst;
  end if;
  if src = dst then
    return jsonb_build_object('moved', 0);
  end if;
  if public.rwp_media_folder_in(dst, src) then
    raise exception 'The folder "%" cannot be moved inside itself ("%").', src, dst;
  end if;
  if not exists (select 1 from public.media_folders where public.rwp_media_folder_in(path, src))
     and not exists (select 1 from public.media where public.rwp_media_folder_in(folder, src)) then
    raise exception 'The folder "%" does not exist. Reload the Media Library.', src;
  end if;

  -- Media rows are readable by everyone, so this counts items the caller may not be able to change.
  select count(*) into total from public.media where public.rwp_media_folder_in(folder, src);
  update public.media
  set folder = dst || substr(folder, char_length(src) + 1)
  where public.rwp_media_folder_in(folder, src);
  get diagnostics moved = row_count;
  if moved < total then
    raise exception using errcode = '42501', message = format(
      'The folder "%s" was not renamed: %s of its %s items were uploaded by someone else, and your role can only change its own media (Settings → General limits media to its uploader). Nothing was changed.',
      src, total - moved, total);
  end if;

  -- Carry empty subfolders over, then remove the old paths.
  insert into public.media_folders (path)
  select distinct lineage
  from public.media_folders f
  cross join lateral public.rwp_media_folder_lineage(dst || substr(f.path, char_length(src) + 1)) as lineage
  where public.rwp_media_folder_in(f.path, src)
  on conflict (path) do nothing;

  select count(*) into folder_total from public.media_folders where public.rwp_media_folder_in(path, src);
  delete from public.media_folders where public.rwp_media_folder_in(path, src);
  get diagnostics folder_removed = row_count;
  if folder_removed < folder_total then
    raise exception using errcode = '42501', message = format(
      'The folder "%s" was not renamed: it contains folders created by someone else, which your role cannot remove. Nothing was changed.', src);
  end if;

  return jsonb_build_object('moved', moved, 'folder', dst);
end;
$$;
revoke execute on function public.rwp_rename_media_folder(text, text) from public, anon;
grant execute on function public.rwp_rename_media_folder(text, text) to authenticated;

-- Delete a folder -----------------------------------------------------------------------------------
-- With p_move_to, the folder's media (including subfolders) moves there first. Without it, the
-- folder must be empty: deleting the media itself goes through /api/media-delete, because the
-- files also have to be removed at Cloudinary or ImageKit.
create or replace function public.rwp_delete_media_folder(p_path text, p_move_to text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  target text := trim(both '/' from coalesce(p_path, ''));
  dst text := nullif(trim(both '/' from coalesce(p_move_to, '')), '');
  total integer;
  moved integer := 0;
  folder_total integer;
  folder_removed integer;
begin
  if not public.user_has_cap('upload_files') then
    raise exception using errcode = '42501', message = 'Deleting folders needs the upload_files capability.';
  end if;
  if target = 'general' then
    raise exception 'The "general" folder is where new media goes by default, so it cannot be deleted.';
  end if;

  select count(*) into total from public.media where public.rwp_media_folder_in(folder, target);
  if total > 0 then
    if dst is null then
      raise exception 'The folder "%" still holds % item(s). Move them to another folder or delete them first.', target, total;
    end if;
    if dst !~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$' or char_length(dst) > 255 then
      raise exception 'The folder name "%" is not valid. Use letters, digits, "-" and "_", with "/" between levels.', dst;
    end if;
    if public.rwp_media_folder_in(dst, target) then
      raise exception 'Media cannot be moved into "%", because that folder is being deleted.', dst;
    end if;
    update public.media set folder = dst where public.rwp_media_folder_in(folder, target);
    get diagnostics moved = row_count;
    if moved < total then
      raise exception using errcode = '42501', message = format(
        'The folder "%s" was not deleted: %s of its %s items were uploaded by someone else, and your role can only change its own media. Nothing was changed.',
        target, total - moved, total);
    end if;
  end if;

  select count(*) into folder_total from public.media_folders where public.rwp_media_folder_in(path, target);
  delete from public.media_folders where public.rwp_media_folder_in(path, target);
  get diagnostics folder_removed = row_count;
  if folder_removed < folder_total then
    raise exception using errcode = '42501', message = format(
      'The folder "%s" was not deleted: it contains folders created by someone else, which your role cannot remove. Nothing was changed.', target);
  end if;

  return jsonb_build_object('moved', moved, 'folders', folder_removed);
end;
$$;
revoke execute on function public.rwp_delete_media_folder(text, text) from public, anon;
grant execute on function public.rwp_delete_media_folder(text, text) to authenticated;

notify pgrst, 'reload schema';
