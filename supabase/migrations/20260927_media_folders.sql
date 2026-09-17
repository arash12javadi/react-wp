-- Media folders: every library item belongs to a folder ("general" unless chosen), used to
-- filter the Media Library, upload into provider folders and clean up images in bulk.
--
-- Folder paths are segments of letters, digits, "-" and "_" separated by "/" (e.g. blog/2026),
-- the subset both Cloudinary and ImageKit accept. The client normalises input to this format
-- (src/lib/mediaFolders.ts); the check below is the guarantee.
--
-- No policy changes: moving an item is an UPDATE, already limited by "Uploaders can update media"
-- and rwp_can_manage_media(). media_enforce_upload_rules does not touch this column.
-- Safe to re-run, including after running a hand-written "add column folder" first.

alter table public.media add column if not exists folder varchar(255) default 'general';

-- Blank, null or malformed values (possible if the column was added by hand) become valid paths,
-- the same way normalizeMediaFolder() does: spaces become "-", other characters are dropped.
update public.media
set folder = coalesce(
  nullif(trim(both '/' from left(
    regexp_replace(
      regexp_replace(regexp_replace(trim(folder), '\s+', '-', 'g'), '[^A-Za-z0-9_/-]+', '', 'g'),
      '/+', '/', 'g'),
    255)), ''),
  'general')
where folder is null
   or folder !~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$';

alter table public.media alter column folder set default 'general';
alter table public.media alter column folder set not null;

alter table public.media drop constraint if exists media_folder_format;
alter table public.media add constraint media_folder_format
  check (folder ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$' and char_length(folder) <= 255);

create index if not exists idx_media_folder on public.media (folder);

notify pgrst, 'reload schema';
