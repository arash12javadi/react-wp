-- Comments repointed at the unified pages table, profile fields, and a retroactive
-- backfill of Cloudinary public ids. Safe to re-run.

-- Profiles --------------------------------------------------------------------

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text;

-- Media -----------------------------------------------------------------------

-- Rows uploaded before provider_file_id existed cannot be deleted at Cloudinary without
-- an id. It is recoverable from the delivery URL, so recover it rather than orphaning them.
-- URL shape: https://res.cloudinary.com/<cloud>/<type>/upload/[transforms/]v<n>/<public_id>.<ext>
update public.media
set provider_file_id = regexp_replace(
  regexp_replace(url, '^.*/upload/(?:[^/]*/)*?v[0-9]+/', ''),
  '\.[^./]+$', ''
)
where provider = 'cloudinary'
  and (provider_file_id is null or provider_file_id = '')
  and url like '%/upload/%';

-- Comments --------------------------------------------------------------------

alter table public.comments add column if not exists page_id bigint references public.pages(id) on delete cascade;
alter table public.comments add column if not exists author_id uuid references auth.users(id) on delete cascade;
alter table public.comments add column if not exists parent_id bigint references public.comments(id) on delete cascade;
alter table public.comments alter column author_name drop not null;
alter table public.comments alter column author_email drop not null;

-- Carry any existing comments across from the legacy posts table by matching slugs.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'comments' and column_name = 'post_id'
  ) then
    update public.comments c
    set page_id = p.id
    from public.posts old
    join public.pages p on p.slug = old.slug
    where c.post_id = old.id and c.page_id is null;

    alter table public.comments drop column post_id;
  end if;
end $$;

create index if not exists comments_page_id_idx on public.comments(page_id);
create index if not exists comments_parent_id_idx on public.comments(parent_id);

alter table public.pages add column if not exists comments_open boolean not null default true;

-- Comment policies. Commenting is for signed-in users, and the author is taken from the
-- session rather than the request body so a comment cannot be attributed to someone else.
alter table public.comments enable row level security;

drop policy if exists "Authenticated users can manage comments" on public.comments;
drop policy if exists "Public can read approved comments" on public.comments;
create policy "Public can read approved comments"
  on public.comments for select to anon, authenticated
  using (status = 'approved' or author_id = auth.uid() or public.user_has_cap('moderate_comments'));

drop policy if exists "Anyone can submit a comment" on public.comments;
drop policy if exists "Members can submit comments" on public.comments;
create policy "Members can submit comments"
  on public.comments for insert to authenticated
  with check (author_id = auth.uid() and status in ('pending', 'approved'));

drop policy if exists "Moderators can manage comments" on public.comments;
create policy "Moderators can manage comments"
  on public.comments for update to authenticated
  using (public.user_has_cap('moderate_comments'))
  with check (public.user_has_cap('moderate_comments'));

drop policy if exists "Moderators can delete comments" on public.comments;
drop policy if exists "Moderators and authors can delete comments" on public.comments;
create policy "Moderators and authors can delete comments"
  on public.comments for delete to authenticated
  using (public.user_has_cap('moderate_comments') or author_id = auth.uid());

-- Defaults --------------------------------------------------------------------

insert into public.options (option_name, option_value)
values
  ('comments_enabled', 'true'),
  ('comment_moderation', 'true'),
  ('comment_max_depth', '5')
on conflict (option_name) do nothing;

notify pgrst, 'reload schema';
