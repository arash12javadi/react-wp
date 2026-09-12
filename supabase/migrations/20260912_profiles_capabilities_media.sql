-- Roles move out of auth.users.raw_user_meta_data (which users can rewrite themselves
-- via supabase.auth.updateUser) and into public.profiles, which only administrators may change.
-- Every policy below reads the role from profiles instead of the JWT.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'subscriber'
    check (role in ('administrator', 'editor', 'author', 'contributor', 'subscriber', 'super_admin')),
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- New sign-ups always start as subscriber. Reading the role out of the sign-up payload
-- would re-open the escalation path this table exists to close.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- One-time backfill. Existing roles came from the installer, so they are trusted here.
insert into public.profiles (id, email, display_name, role)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1)),
  case
    when u.raw_user_meta_data ->> 'role' in ('administrator', 'editor', 'author', 'contributor', 'subscriber', 'super_admin')
      then u.raw_user_meta_data ->> 'role'
    when u.raw_user_meta_data ->> 'role' in ('superadmin', 'super-admin') then 'super_admin'
    else 'subscriber'
  end
from auth.users u
on conflict (id) do nothing;

-- security definer so policies can read profiles without recursing through its own RLS.
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.user_has_cap(capability text)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.current_user_role()
    when 'super_admin' then true
    when 'administrator' then true
    when 'editor' then capability in (
      'read', 'edit_posts', 'delete_posts', 'publish_posts', 'upload_files',
      'edit_others_posts', 'delete_others_posts', 'edit_pages', 'publish_pages',
      'manage_categories', 'moderate_comments')
    when 'author' then capability in ('read', 'edit_posts', 'delete_posts', 'publish_posts', 'upload_files')
    when 'contributor' then capability in ('read', 'edit_posts', 'delete_posts')
    when 'subscriber' then capability = 'read'
    else false
  end;
$$;

grant execute on function public.current_user_role() to anon, authenticated;
grant execute on function public.user_has_cap(text) to anon, authenticated;

-- A trigger rather than a policy: RLS WITH CHECK cannot reliably compare the old and new
-- role within a single statement.
create or replace function public.profiles_guard_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role then
    -- auth.uid() is null for the installer and service-role connections.
    if auth.uid() is null then
      return new;
    end if;
    if public.current_user_role() not in ('administrator', 'super_admin') then
      raise exception 'Only administrators can change user roles.';
    end if;
    if new.id = auth.uid() then
      raise exception 'You cannot change your own role.';
    end if;
  end if;
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists profiles_guard_role_trigger on public.profiles;
create trigger profiles_guard_role_trigger
  before update on public.profiles
  for each row execute function public.profiles_guard_role();

alter table public.profiles enable row level security;

drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Authenticated users can read profiles"
  on public.profiles for select to authenticated using (true);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "Administrators can update any profile" on public.profiles;
create policy "Administrators can update any profile"
  on public.profiles for update to authenticated
  using (public.user_has_cap('edit_users')) with check (public.user_has_cap('edit_users'));

-- Media library ---------------------------------------------------------------

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  title varchar(255),
  alt_text text,
  url text not null,
  provider varchar(50) not null default 'external'
    check (provider in ('cloudinary', 'imagekit', 'external')),
  file_name varchar(255),
  -- Cloudinary public_id / ImageKit fileId. Deleting the asset at the provider needs this.
  provider_file_id text,
  width integer,
  height integer,
  bytes bigint,
  mime_type varchar(100),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.media add column if not exists provider_file_id text;

alter table public.media enable row level security;

drop policy if exists "Public can read media" on public.media;
create policy "Public can read media"
  on public.media for select to anon, authenticated using (true);

drop policy if exists "Uploaders can add media" on public.media;
create policy "Uploaders can add media"
  on public.media for insert to authenticated
  with check (public.user_has_cap('upload_files'));

drop policy if exists "Uploaders can update media" on public.media;
create policy "Uploaders can update media"
  on public.media for update to authenticated
  using (public.user_has_cap('upload_files')) with check (public.user_has_cap('upload_files'));

drop policy if exists "Uploaders can delete media" on public.media;
create policy "Uploaders can delete media"
  on public.media for delete to authenticated
  using (public.user_has_cap('upload_files'));

-- Harden the previously permissive policies -----------------------------------

-- Every policy is dropped before being created, including the new names, so this file can
-- be re-run safely after a partial failure.

drop policy if exists "Authenticated users can manage pages" on public.pages;
drop policy if exists "Public can read published pages" on public.pages;
drop policy if exists "Readers can see published or own pages" on public.pages;
create policy "Readers can see published or own pages"
  on public.pages for select to anon, authenticated
  using (status = 'published' or author_id = auth.uid() or public.user_has_cap('edit_others_posts'));
drop policy if exists "Contributors can create content" on public.pages;
create policy "Contributors can create content"
  on public.pages for insert to authenticated
  with check (
    public.user_has_cap('edit_posts')
    and (status = 'draft' or public.user_has_cap('publish_posts'))
  );
drop policy if exists "Authors edit own content, editors edit all" on public.pages;
create policy "Authors edit own content, editors edit all"
  on public.pages for update to authenticated
  using (
    (author_id = auth.uid() and public.user_has_cap('edit_posts'))
    or public.user_has_cap('edit_others_posts')
  )
  with check (status = 'draft' or public.user_has_cap('publish_posts'));
drop policy if exists "Authors delete own content, editors delete all" on public.pages;
create policy "Authors delete own content, editors delete all"
  on public.pages for delete to authenticated
  using (
    (author_id = auth.uid() and public.user_has_cap('delete_posts'))
    or public.user_has_cap('delete_others_posts')
  );

drop policy if exists "Administrators and editors manage posts" on public.posts;
drop policy if exists "Authors and contributors manage own posts" on public.posts;
drop policy if exists "Authenticated users can manage posts" on public.posts;
drop policy if exists "Public can read published posts" on public.posts;
drop policy if exists "Readers can see published or own posts" on public.posts;
create policy "Readers can see published or own posts"
  on public.posts for select to anon, authenticated
  using (status = 'published' or author_id = auth.uid() or public.user_has_cap('edit_others_posts'));
drop policy if exists "Capability-based post writes" on public.posts;
create policy "Capability-based post writes"
  on public.posts for all to authenticated
  using (
    (author_id = auth.uid() and public.user_has_cap('edit_posts'))
    or public.user_has_cap('edit_others_posts')
  )
  with check (
    public.user_has_cap('edit_posts')
    and (status = 'draft' or public.user_has_cap('publish_posts'))
  );

drop policy if exists "Authenticated users can manage categories" on public.categories;
drop policy if exists "Category managers can write categories" on public.categories;
create policy "Category managers can write categories"
  on public.categories for all to authenticated
  using (public.user_has_cap('manage_categories'))
  with check (public.user_has_cap('manage_categories'));

drop policy if exists "Authenticated users can manage comments" on public.comments;
drop policy if exists "Public can read approved comments" on public.comments;
create policy "Public can read approved comments"
  on public.comments for select to anon, authenticated
  using (status = 'approved' or public.user_has_cap('moderate_comments'));
drop policy if exists "Anyone can submit a comment" on public.comments;
create policy "Anyone can submit a comment"
  on public.comments for insert to anon, authenticated
  with check (status = 'pending');
drop policy if exists "Moderators can manage comments" on public.comments;
create policy "Moderators can manage comments"
  on public.comments for update to authenticated
  using (public.user_has_cap('moderate_comments')) with check (public.user_has_cap('moderate_comments'));
drop policy if exists "Moderators can delete comments" on public.comments;
create policy "Moderators can delete comments"
  on public.comments for delete to authenticated
  using (public.user_has_cap('moderate_comments'));

-- Options stay publicly readable: the public site needs site_title and menu_links.
drop policy if exists "Allow authenticated full access on options" on public.options;
drop policy if exists "Settings managers can write options" on public.options;
create policy "Settings managers can write options"
  on public.options for all to authenticated
  using (public.user_has_cap('manage_options'))
  with check (public.user_has_cap('manage_options'));

drop policy if exists "Authenticated users can manage menus" on public.menus;
drop policy if exists "Public can read menus" on public.menus;
create policy "Public can read menus"
  on public.menus for select to anon, authenticated using (true);
drop policy if exists "Settings managers can write menus" on public.menus;
create policy "Settings managers can write menus"
  on public.menus for all to authenticated
  using (public.user_has_cap('manage_options'))
  with check (public.user_has_cap('manage_options'));

drop policy if exists "Authenticated users can manage plugins" on public.plugins;
drop policy if exists "Public can read plugins" on public.plugins;
create policy "Public can read plugins"
  on public.plugins for select to anon, authenticated using (true);
drop policy if exists "Plugin managers can write plugins" on public.plugins;
create policy "Plugin managers can write plugins"
  on public.plugins for all to authenticated
  using (public.user_has_cap('activate_plugins'))
  with check (public.user_has_cap('activate_plugins'));

-- PostgREST caches the schema, so a newly created table stays invisible to the API until
-- it reloads. Without this, the admin reports the media table as missing even though it exists.
notify pgrst, 'reload schema';
