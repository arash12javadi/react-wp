-- comments.author_id pointed at auth.users, so PostgREST could not embed public.profiles
-- through it and every comment read failed while inserts still succeeded. profiles.id is
-- itself a reference to auth.users(id), so pointing at profiles is equivalent and lets the
-- author be fetched in one request.
--
-- Safe to re-run.

alter table public.comments drop constraint if exists comments_author_id_fkey;
alter table public.comments
  add constraint comments_author_id_fkey
  foreign key (author_id) references public.profiles(id) on delete cascade;

-- Anonymous visitors cannot read public.profiles (it holds email addresses), so the display
-- name is stored on the comment itself. Without this, signed-out readers see every comment
-- attributed to "Someone".
update public.comments c
set author_name = coalesce(p.display_name, split_part(p.email, '@', 1))
from public.profiles p
where c.author_id = p.id and (c.author_name is null or c.author_name = '');

notify pgrst, 'reload schema';
