-- Engagement: likes, follows, category follows, saved items (bookmarks) and page views. Safe to re-run.
--
-- Core owns the generic parts: who liked, followed or saved what, how often something was viewed,
-- and the counters on public.pages. Anything else that can be liked or saved (the shop's products)
-- plugs in through a resolver function instead of core knowing about it:
--
--   public.rwp_engagement_target_<type>(p_id text) returns jsonb
--
-- returns null when the item does not exist or is not public, and otherwise
--   { title, url, image, excerpt, author_id, published_at, views_count, likes_count }.
-- Core ships rwp_engagement_target_page. A plugin that creates rwp_engagement_target_product makes
-- products likeable and saveable, and drops the function again in its uninstall.sql, so core never
-- references a plugin object. A plugin can add items to the Following feed the same way, with
--   public.rwp_engagement_feed_<type>(p_user uuid, p_limit integer, p_before timestamptz) returns jsonb
-- (an array of feed items, see rwp_following_feed below).
--
-- Counters: pages.likes_count and pages.views_count are maintained by triggers on likes and
-- page_views, and nothing else may write them (pages_guard_engagement_counts). Visitors never write
-- page_views directly: rwp_record_view() deduplicates and rate-limits.
--
-- Privacy of page views: no IP address, user id or visitor token is stored. session_hash and ip_hash
-- are md5 hashes salted with a random value that changes every day and is deleted the day after
-- (rwp_view_salts), so a stored hash cannot be linked back to a browser or an address once that salt
-- is gone. They exist only to count one view per browser per item every 30 minutes, and to stop one
-- browser or one address from inflating the numbers.

-- 1. Counter columns -------------------------------------------------------------------------------

alter table public.pages add column if not exists views_count integer not null default 0;
alter table public.pages add column if not exists likes_count integer not null default 0;

alter table public.pages drop constraint if exists pages_engagement_counts_nonnegative;
alter table public.pages add constraint pages_engagement_counts_nonnegative
  check (views_count >= 0 and likes_count >= 0);

-- Popular content ranks by these.
create index if not exists pages_engagement_score_idx
  on public.pages ((views_count + likes_count * 3) desc) where status = 'published';

-- 2. Tables ----------------------------------------------------------------------------------------

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Text, because pages have bigint ids and products uuid ids. Checked by the resolver on insert.
  target_id text not null,
  target_type text not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint likes_user_target_key unique (user_id, target_id, target_type)
);

-- follower_id and following_id reference profiles (itself a reference to auth.users) so PostgREST
-- can embed either side's display name.
create table if not exists public.follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint follows_pair_key unique (follower_id, following_id)
);

create table if not exists public.taxonomy_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint taxonomy_follows_user_category_key unique (user_id, category_id)
);

-- One row per item per collection: the same post can be in "Recipes" and "Weekend".
create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_id text not null,
  target_type text not null,
  collection_name text not null default 'Saved Items',
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint bookmarks_user_target_collection_key unique (user_id, target_type, target_id, collection_name)
);

create table if not exists public.page_views (
  id uuid primary key default gen_random_uuid(),
  target_id text not null,
  target_type text not null,
  session_hash text not null,
  ip_hash text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

-- The daily salt for page_views hashes. Private: no policies, no grants.
create table if not exists public.rwp_view_salts (
  day date primary key,
  salt text not null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

-- Constraints (dropped first so a re-run can change them) ------------------------------------------

alter table public.follows drop constraint if exists follows_not_self;
alter table public.follows add constraint follows_not_self check (follower_id <> following_id);

alter table public.likes drop constraint if exists likes_target_format;
alter table public.likes add constraint likes_target_format
  check (target_type ~ '^[a-z][a-z0-9_]{1,30}$' and char_length(target_id) between 1 and 64);

alter table public.bookmarks drop constraint if exists bookmarks_target_format;
alter table public.bookmarks add constraint bookmarks_target_format
  check (target_type ~ '^[a-z][a-z0-9_]{1,30}$' and char_length(target_id) between 1 and 64);

alter table public.bookmarks drop constraint if exists bookmarks_collection_name_format;
alter table public.bookmarks add constraint bookmarks_collection_name_format
  check (collection_name = btrim(collection_name) and char_length(collection_name) between 1 and 60);

alter table public.page_views drop constraint if exists page_views_target_format;
alter table public.page_views add constraint page_views_target_format
  check (target_type ~ '^[a-z][a-z0-9_]{1,30}$' and char_length(target_id) between 1 and 64);

-- Indexes -----------------------------------------------------------------------------------------

create index if not exists likes_target_idx on public.likes (target_type, target_id);
create index if not exists likes_created_idx on public.likes (created_at);
create index if not exists follows_following_idx on public.follows (following_id);
create index if not exists taxonomy_follows_category_idx on public.taxonomy_follows (category_id);
create index if not exists bookmarks_user_collection_idx on public.bookmarks (user_id, collection_name, created_at desc);
create index if not exists bookmarks_target_idx on public.bookmarks (target_type, target_id);
create index if not exists page_views_target_idx on public.page_views (target_type, target_id, created_at desc);
create index if not exists page_views_created_idx on public.page_views (created_at);
create index if not exists page_views_session_idx on public.page_views (session_hash, created_at desc);
create index if not exists page_views_ip_idx on public.page_views (ip_hash, created_at desc) where ip_hash is not null;

-- 3. Targets --------------------------------------------------------------------------------------

-- A published post or page. Site templates are never content, so they cannot be liked or saved.
create or replace function public.rwp_engagement_target_page(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'title', p.title,
    'url', '/' || p.slug,
    'image', nullif(p.og_image, ''),
    'excerpt', nullif(p.excerpt, ''),
    'author_id', p.author_id,
    'published_at', p.created_at,
    'is_post', p.is_post,
    'category_id', p.category_id,
    'views_count', p.views_count,
    'likes_count', p.likes_count
  )
  from public.pages p
  where p_id ~ '^[0-9]{1,18}$'
    and p.id = p_id::bigint
    and p.status = 'published'
    and not coalesce(p.is_site_template, false);
$$;

-- Dispatches to rwp_engagement_target_<type>. The type is checked against a strict pattern before
-- it is put into a function name, and only functions that already exist are called.
create or replace function public.rwp_engagement_target(p_type text, p_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if p_type is null or p_type !~ '^[a-z][a-z0-9_]{1,30}$'
     or p_id is null or char_length(p_id) not between 1 and 64 then
    return null;
  end if;
  if to_regprocedure(format('public.rwp_engagement_target_%s(text)', p_type)) is null then
    return null;
  end if;
  execute format('select public.%I($1)', 'rwp_engagement_target_' || p_type) into v_result using p_id;
  return v_result;
end;
$$;

-- 4. Counters -------------------------------------------------------------------------------------

-- Nobody sets the counters by editing a page. They change only inside the triggers below (nested,
-- so pg_trigger_depth() > 1) or from a connection without a session (SQL Editor, service role).
-- Backup restores switch user triggers off, so restored counters are kept as they were.
create or replace function public.pages_guard_engagement_counts()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.views_count := 0;
    new.likes_count := 0;
  else
    new.views_count := old.views_count;
    new.likes_count := old.likes_count;
  end if;
  return new;
end;
$$;

drop trigger if exists pages_guard_engagement_counts on public.pages;
create trigger pages_guard_engagement_counts
  before insert or update of views_count, likes_count on public.pages
  for each row execute function public.pages_guard_engagement_counts();

create or replace function public.likes_maintain_counts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.target_type = 'page' and new.target_id ~ '^[0-9]{1,18}$' then
    update public.pages set likes_count = likes_count + 1 where id = new.target_id::bigint;
  elsif tg_op = 'DELETE' and old.target_type = 'page' and old.target_id ~ '^[0-9]{1,18}$' then
    update public.pages set likes_count = greatest(likes_count - 1, 0) where id = old.target_id::bigint;
  end if;
  return null;
end;
$$;

drop trigger if exists likes_maintain_counts on public.likes;
create trigger likes_maintain_counts
  after insert or delete on public.likes
  for each row execute function public.likes_maintain_counts();

-- Views are lifetime totals: pruning old page_views rows (see rwp_record_view) does not lower them.
create or replace function public.page_views_maintain_counts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.target_type = 'page' and new.target_id ~ '^[0-9]{1,18}$' then
    update public.pages set views_count = views_count + 1 where id = new.target_id::bigint;
  end if;
  return null;
end;
$$;

drop trigger if exists page_views_maintain_counts on public.page_views;
create trigger page_views_maintain_counts
  after insert on public.page_views
  for each row execute function public.page_views_maintain_counts();

-- A deleted page takes its likes, saves and views with it (there is no foreign key to do it, because
-- target_id also holds other kinds of ids).
create or replace function public.pages_forget_engagement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.likes where target_type = 'page' and target_id = old.id::text;
  delete from public.bookmarks where target_type = 'page' and target_id = old.id::text;
  delete from public.page_views where target_type = 'page' and target_id = old.id::text;
  return null;
end;
$$;

drop trigger if exists pages_forget_engagement on public.pages;
create trigger pages_forget_engagement
  after delete on public.pages
  for each row execute function public.pages_forget_engagement();

-- Recounts likes from the likes table, for an administrator who suspects drift. Views cannot be
-- recounted: old page_views rows are pruned, and the counter is the only lifetime total.
create or replace function public.rwp_recount_likes()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_changed integer;
begin
  if not public.user_has_cap('manage_options') then
    raise exception using errcode = '42501',
      message = 'Only administrators can recount likes. It needs the manage_options capability, and your role does not have it.';
  end if;
  update public.pages p set likes_count = coalesce(c.total, 0)
  from (
    select p2.id, (select count(*) from public.likes l where l.target_type = 'page' and l.target_id = p2.id::text)::integer as total
    from public.pages p2
  ) c
  where c.id = p.id and p.likes_count is distinct from coalesce(c.total, 0);
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

-- 5. Recording a view -----------------------------------------------------------------------------

-- Today's salt, created on first use. Yesterday's is kept so a view just after midnight still finds
-- the dedupe window; anything older is deleted, which unlinks the hashes made with it.
create or replace function public.rwp_view_salt()
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_salt text;
begin
  select salt into v_salt from public.rwp_view_salts where day = current_date;
  if v_salt is null then
    insert into public.rwp_view_salts (day, salt)
    values (current_date, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
    on conflict (day) do nothing;
    select salt into v_salt from public.rwp_view_salts where day = current_date;
    delete from public.rwp_view_salts where day < current_date - 1;
  end if;
  return v_salt;
end;
$$;

-- Counts one view of a published item. Returns true when it was counted. Callable by anon: every
-- visitor is a potential view. What bounds it:
--   * nothing happens while Settings -> Engagement has "Count views" off (engagement.track_views);
--   * only items the resolver says are public;
--   * the author reading their own item is not counted;
--   * one view per browser per item every 30 minutes;
--   * at most 120 counted views per browser, and 600 per IP address, per hour.
-- Refusals return false rather than raising, because a visitor can do nothing about them.
create or replace function public.rwp_record_view(p_target_type text, p_target_id text, p_session text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_target jsonb;
  v_salt text;
  v_ip text;
  v_session_hash text;
  v_ip_hash text;
begin
  if coalesce(public.rwp_app_settings() #>> '{engagement,track_views}', 'true') = 'false' then
    return false;
  end if;
  if p_session is null or p_session !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception using errcode = '22023',
      message = 'The view was not recorded: the visitor token must be 16 to 64 letters, digits, "-" or "_".';
  end if;

  v_target := public.rwp_engagement_target(p_target_type, p_target_id);
  if v_target is null then
    return false;
  end if;
  if auth.uid() is not null and v_target ->> 'author_id' = auth.uid()::text then
    return false;
  end if;

  v_salt := public.rwp_view_salt();
  begin
    -- Set by PostgREST; the first x-forwarded-for entry is the client. Absent in the SQL Editor.
    v_ip := nullif(btrim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)), '');
  exception when others then
    v_ip := null;
  end;
  v_session_hash := md5(v_salt || ':session:' || p_session);
  v_ip_hash := case when v_ip is null then null else md5(v_salt || ':ip:' || v_ip) end;

  if exists (
    select 1 from public.page_views
    where session_hash = v_session_hash and target_type = p_target_type and target_id = p_target_id
      and created_at > now() - interval '30 minutes'
  ) then
    return false;
  end if;
  if (select count(*) from public.page_views
      where session_hash = v_session_hash and created_at > now() - interval '1 hour') >= 120 then
    return false;
  end if;
  if v_ip_hash is not null and (select count(*) from public.page_views
      where ip_hash = v_ip_hash and created_at > now() - interval '1 hour') >= 600 then
    return false;
  end if;

  insert into public.page_views (target_id, target_type, session_hash, ip_hash)
  values (p_target_id, p_target_type, v_session_hash, v_ip_hash);

  -- Raw rows are only needed for the week/month rankings and Dashboard -> Analytics; lifetime totals
  -- are on the counters. Pruned a little at a time, on about one call in a hundred.
  if random() < 0.01 then
    delete from public.page_views
    where id in (select id from public.page_views where created_at < now() - interval '400 days' limit 1000);
  end if;
  return true;
end;
$$;

-- 6. Likes, follows and saves ---------------------------------------------------------------------
-- set_* rather than toggle_*: the browser sends the state it wants, so two quick clicks whose
-- requests arrive out of order still end in the state the visitor last chose.

create or replace function public.rwp_set_like(p_target_type text, p_target_id text, p_liked boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Please sign in to like this.';
  end if;
  if coalesce(p_liked, true) then
    if public.rwp_engagement_target(p_target_type, p_target_id) is null then
      raise exception using errcode = '22023',
        message = format('There is no published %s with id %s to like.', coalesce(p_target_type, 'item'), coalesce(p_target_id, '(none)'));
    end if;
    insert into public.likes (user_id, target_type, target_id)
    values (v_uid, p_target_type, p_target_id)
    on conflict (user_id, target_id, target_type) do nothing;
  else
    delete from public.likes where user_id = v_uid and target_type = p_target_type and target_id = p_target_id;
  end if;
  return jsonb_build_object(
    'liked', exists (select 1 from public.likes where user_id = v_uid and target_type = p_target_type and target_id = p_target_id),
    'likes_count', (select count(*) from public.likes where target_type = p_target_type and target_id = p_target_id)
  );
end;
$$;

create or replace function public.rwp_set_follow(p_user uuid, p_following boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Please sign in to follow people.';
  end if;
  if p_user is null or p_user = v_uid then
    raise exception using errcode = '22023', message = 'You cannot follow yourself.';
  end if;
  if coalesce(p_following, true) then
    if not exists (select 1 from public.profiles where id = p_user) then
      raise exception using errcode = '22023', message = 'That account no longer exists, so it cannot be followed.';
    end if;
    insert into public.follows (follower_id, following_id) values (v_uid, p_user)
    on conflict (follower_id, following_id) do nothing;
  else
    delete from public.follows where follower_id = v_uid and following_id = p_user;
  end if;
  return jsonb_build_object(
    'following', exists (select 1 from public.follows where follower_id = v_uid and following_id = p_user),
    'followers', (select count(*) from public.follows where following_id = p_user)
  );
end;
$$;

create or replace function public.rwp_set_category_follow(p_category uuid, p_following boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Please sign in to follow categories.';
  end if;
  if coalesce(p_following, true) then
    if not exists (select 1 from public.categories where id = p_category) then
      raise exception using errcode = '22023', message = 'That category no longer exists, so it cannot be followed.';
    end if;
    insert into public.taxonomy_follows (user_id, category_id) values (v_uid, p_category)
    on conflict (user_id, category_id) do nothing;
  else
    delete from public.taxonomy_follows where user_id = v_uid and category_id = p_category;
  end if;
  return jsonb_build_object(
    'following', exists (select 1 from public.taxonomy_follows where user_id = v_uid and category_id = p_category),
    'followers', (select count(*) from public.taxonomy_follows where category_id = p_category)
  );
end;
$$;

-- Saves to (or removes from) one collection. Removing with p_collection null removes the item from
-- every collection, which is what the Save button's "Saved" state undoes.
create or replace function public.rwp_set_bookmark(p_target_type text, p_target_id text, p_collection text, p_saved boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_collection text := nullif(btrim(coalesce(p_collection, '')), '');
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Please sign in to save items.';
  end if;
  if coalesce(p_saved, true) then
    v_collection := coalesce(v_collection, 'Saved Items');
    if char_length(v_collection) > 60 then
      raise exception using errcode = '22023', message = 'A collection name can be at most 60 characters long.';
    end if;
    if public.rwp_engagement_target(p_target_type, p_target_id) is null then
      raise exception using errcode = '22023',
        message = format('There is no published %s with id %s to save.', coalesce(p_target_type, 'item'), coalesce(p_target_id, '(none)'));
    end if;
    if (select count(*) from public.bookmarks where user_id = v_uid) >= 5000 then
      raise exception using errcode = '54000', message = 'You have saved 5,000 items, the most one account can keep. Remove some first.';
    end if;
    insert into public.bookmarks (user_id, target_type, target_id, collection_name)
    values (v_uid, p_target_type, p_target_id, v_collection)
    on conflict (user_id, target_type, target_id, collection_name) do nothing;
  else
    delete from public.bookmarks
    where user_id = v_uid and target_type = p_target_type and target_id = p_target_id
      and (v_collection is null or collection_name = v_collection);
  end if;
  return jsonb_build_object(
    'collections', coalesce((
      select jsonb_agg(collection_name order by collection_name) from public.bookmarks
      where user_id = v_uid and target_type = p_target_type and target_id = p_target_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Renames a collection, or merges it into another one that already exists. SECURITY DEFINER with
-- every statement limited to auth.uid(): as the caller, the insert policy would refuse to move an
-- item that has been unpublished since it was saved.
create or replace function public.rwp_rename_bookmark_collection(p_from text, p_to text)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_to text := btrim(coalesce(p_to, ''));
  v_moved integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Please sign in to organise your saved items.';
  end if;
  if char_length(v_to) not between 1 and 60 then
    raise exception using errcode = '22023', message = 'A collection name must be 1 to 60 characters long.';
  end if;
  if p_from = v_to then
    return 0;
  end if;
  insert into public.bookmarks (user_id, target_type, target_id, collection_name, created_at)
  select user_id, target_type, target_id, v_to, created_at from public.bookmarks
  where user_id = auth.uid() and collection_name = p_from
  on conflict (user_id, target_type, target_id, collection_name) do nothing;
  delete from public.bookmarks where user_id = auth.uid() and collection_name = p_from;
  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

-- 7. Reading engagement ---------------------------------------------------------------------------

-- Counts and the signed-in person's own state for up to 100 items of one type, in one request.
-- { "<id>": { likes, views, liked, collections: [..], author_id } }. Items that are not public are
-- left out, which the browser reads as "hide the buttons".
create or replace function public.rwp_engagement_state(p_target_type text, p_target_ids text[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb := '{}'::jsonb;
  v_id text;
  v_target jsonb;
begin
  if coalesce(cardinality(p_target_ids), 0) > 100 then
    raise exception using errcode = '22023', message = 'Engagement can be read for at most 100 items at once.';
  end if;
  foreach v_id in array coalesce(p_target_ids, '{}'::text[]) loop
    continue when v_id is null or v_result ? v_id;
    v_target := public.rwp_engagement_target(p_target_type, v_id);
    continue when v_target is null;
    v_result := v_result || jsonb_build_object(v_id, jsonb_build_object(
      'likes', (select count(*) from public.likes l where l.target_type = p_target_type and l.target_id = v_id),
      'views', coalesce((v_target ->> 'views_count')::bigint, 0),
      'author_id', v_target -> 'author_id',
      'liked', v_uid is not null and exists (
        select 1 from public.likes l where l.user_id = v_uid and l.target_type = p_target_type and l.target_id = v_id),
      'collections', coalesce((
        select jsonb_agg(b.collection_name order by b.collection_name) from public.bookmarks b
        where b.user_id = v_uid and b.target_type = p_target_type and b.target_id = v_id), '[]'::jsonb)
    ));
  end loop;
  return v_result;
end;
$$;

-- Follower counts and the signed-in person's own follows, for authors and categories. Names are only
-- returned for people with published content (the same exposure as builder_author_names), because
-- profiles itself is readable only when signed in.
create or replace function public.rwp_follow_state(p_user_ids uuid[] default '{}', p_category_ids uuid[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if coalesce(cardinality(p_user_ids), 0) + coalesce(cardinality(p_category_ids), 0) > 100 then
    raise exception using errcode = '22023', message = 'Follow state can be read for at most 100 authors and categories at once.';
  end if;
  return jsonb_build_object(
    'users', coalesce((
      select jsonb_object_agg(pr.id, jsonb_build_object(
        'followers', (select count(*) from public.follows f where f.following_id = pr.id),
        'following', v_uid is not null and exists (select 1 from public.follows f where f.follower_id = v_uid and f.following_id = pr.id),
        'name', case when pr.id = v_uid or exists (
            select 1 from public.pages pg where pg.author_id = pr.id and pg.status = 'published')
          then coalesce(nullif(pr.display_name, ''), 'Author') end,
        'self', pr.id = v_uid
      ))
      from public.profiles pr where pr.id = any(coalesce(p_user_ids, '{}'::uuid[]))
    ), '{}'::jsonb),
    'categories', coalesce((
      select jsonb_object_agg(c.id, jsonb_build_object(
        'followers', (select count(*) from public.taxonomy_follows t where t.category_id = c.id),
        'following', v_uid is not null and exists (select 1 from public.taxonomy_follows t where t.user_id = v_uid and t.category_id = c.id),
        'name', c.name,
        'slug', c.slug
      ))
      from public.categories c where c.id = any(coalesce(p_category_ids, '{}'::uuid[]))
    ), '{}'::jsonb)
  );
end;
$$;

-- Trending items: score = views + likes * 3, counted inside the timeframe ('week' = 7 days,
-- 'month' = 30 days). 'all' uses the lifetime counters on pages (the formula on the columns
-- themselves) and all retained events for other types. p_target_types limits the types; null is all.
create or replace function public.rwp_popular_content(p_limit integer default 5, p_timeframe text default 'week', p_target_types text[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 50);
  v_since timestamptz;
  v_result jsonb := '[]'::jsonb;
  v_target jsonb;
  candidate record;
begin
  if p_timeframe = 'week' then
    v_since := now() - interval '7 days';
  elsif p_timeframe = 'month' then
    v_since := now() - interval '30 days';
  elsif p_timeframe = 'all' then
    v_since := null;
  else
    raise exception using errcode = '22023', message = format('Unknown timeframe "%s": use week, month or all.', p_timeframe);
  end if;

  for candidate in
    with events as (
      select v.target_type, v.target_id, count(*)::bigint as views, 0::bigint as likes
      from public.page_views v
      where (v_since is null or v.created_at >= v_since)
        and (v_since is not null or v.target_type <> 'page')
        and (p_target_types is null or v.target_type = any(p_target_types))
      group by 1, 2
      union all
      select l.target_type, l.target_id, 0, count(*)::bigint
      from public.likes l
      where (v_since is null or l.created_at >= v_since)
        and (v_since is not null or l.target_type <> 'page')
        and (p_target_types is null or l.target_type = any(p_target_types))
      group by 1, 2
      union all
      -- 'all' for pages: the lifetime counters.
      select 'page', p.id::text, p.views_count::bigint, p.likes_count::bigint
      from public.pages p
      where v_since is null and p.status = 'published' and not coalesce(p.is_site_template, false)
        and (p_target_types is null or 'page' = any(p_target_types))
        and p.views_count + p.likes_count > 0
    )
    select target_type, target_id, sum(views)::bigint as views, sum(likes)::bigint as likes,
      (sum(views) + sum(likes) * 3)::bigint as score
    from events
    group by target_type, target_id
    order by score desc, target_id
    limit v_limit * 4
  loop
    exit when jsonb_array_length(v_result) >= v_limit;
    v_target := public.rwp_engagement_target(candidate.target_type, candidate.target_id);
    continue when v_target is null;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'target_type', candidate.target_type,
      'target_id', candidate.target_id,
      'title', v_target ->> 'title',
      'url', v_target ->> 'url',
      'image', v_target ->> 'image',
      'excerpt', v_target ->> 'excerpt',
      'published_at', v_target ->> 'published_at',
      'views', candidate.views,
      'likes', candidate.likes,
      'score', candidate.score
    ));
  end loop;
  return v_result;
end;
$$;

-- The signed-in person's saved items, newest first, with what the browser needs to show them.
-- Items that were unpublished or deleted since are returned with missing: true, so they can be
-- removed rather than silently disappearing.
create or replace function public.rwp_my_bookmarks(p_collection text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_items jsonb := '[]'::jsonb;
  v_target jsonb;
  row_ record;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Please sign in to see your saved items.';
  end if;
  for row_ in
    select b.id, b.target_type, b.target_id, b.collection_name, b.created_at
    from public.bookmarks b
    where b.user_id = v_uid and (p_collection is null or b.collection_name = p_collection)
    order by b.created_at desc
    limit 500
  loop
    v_target := public.rwp_engagement_target(row_.target_type, row_.target_id);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'id', row_.id,
      'target_type', row_.target_type,
      'target_id', row_.target_id,
      'collection_name', row_.collection_name,
      'saved_at', row_.created_at,
      'missing', v_target is null,
      'title', v_target ->> 'title',
      'url', v_target ->> 'url',
      'image', v_target ->> 'image',
      'excerpt', v_target ->> 'excerpt',
      'published_at', v_target ->> 'published_at'
    ));
  end loop;
  return jsonb_build_object(
    'collections', coalesce((
      select jsonb_agg(jsonb_build_object('name', c.collection_name, 'count', c.total) order by c.collection_name)
      from (select collection_name, count(*) as total from public.bookmarks where user_id = v_uid group by 1) c
    ), '[]'::jsonb),
    'items', v_items
  );
end;
$$;

-- Newly published posts from the authors and categories the signed-in person follows, newest first,
-- plus whatever plugins add through rwp_engagement_feed_<type>(user, limit, before). p_before pages
-- backwards through the feed. A plugin feed that fails is skipped with a warning, so one broken
-- plugin does not empty the whole feed.
create or replace function public.rwp_following_feed(p_limit integer default 20, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_items jsonb;
  v_extra jsonb;
  v_feed record;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Please sign in to see the posts from people and categories you follow.';
  end if;

  select coalesce(jsonb_agg(item order by (item ->> 'published_at')::timestamptz desc), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'target_type', 'page',
      'target_id', p.id::text,
      'title', p.title,
      'url', '/' || p.slug,
      'image', nullif(p.og_image, ''),
      'excerpt', nullif(p.excerpt, ''),
      'published_at', p.created_at,
      'author_id', p.author_id,
      'author_name', coalesce(nullif(pr.display_name, ''), 'Author'),
      'category_name', c.name,
      'reason', case when f.following_id is not null then 'author' else 'category' end
    ) as item
    from public.pages p
    left join public.profiles pr on pr.id = p.author_id
    left join public.categories c on c.id = p.category_id
    left join public.follows f on f.follower_id = v_uid and f.following_id = p.author_id
    left join public.taxonomy_follows t on t.user_id = v_uid and t.category_id = p.category_id
    where p.status = 'published' and p.is_post and not coalesce(p.is_site_template, false)
      and (f.id is not null or t.id is not null)
      and (p.author_id is distinct from v_uid)
      and (p_before is null or p.created_at < p_before)
    order by p.created_at desc
    limit v_limit
  ) posts;

  for v_feed in
    select pp.proname::text as name
    from pg_proc pp join pg_namespace n on n.oid = pp.pronamespace
    where n.nspname = 'public' and pp.proname ~ '^rwp_engagement_feed_[a-z][a-z0-9_]{1,30}$' and pp.pronargs = 3
  loop
    begin
      execute format('select public.%I($1, $2, $3)', v_feed.name) into v_extra using v_uid, v_limit, p_before;
      if jsonb_typeof(v_extra) = 'array' then
        v_items := v_items || v_extra;
      end if;
    exception when others then
      raise warning 'Following feed provider % failed and was skipped: %', v_feed.name, sqlerrm;
    end;
  end loop;

  return coalesce((
    select jsonb_agg(item order by (item ->> 'published_at')::timestamptz desc)
    from (
      select item from jsonb_array_elements(v_items) item
      order by (item ->> 'published_at')::timestamptz desc
      limit v_limit
    ) newest
  ), '[]'::jsonb);
end;
$$;

-- Dashboard -> Analytics. Editors and above (edit_others_posts), because it reports on everyone's
-- content. p_days is clamped to 1..365.
create or replace function public.rwp_engagement_report(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
  v_top jsonb := '[]'::jsonb;
  v_target jsonb;
  candidate record;
begin
  if not public.user_has_cap('edit_others_posts') then
    raise exception using errcode = '42501',
      message = 'Only Editors and above can see engagement analytics. It needs the edit_others_posts capability, and your role does not have it.';
  end if;

  for candidate in
    select target_type, target_id, sum(views)::bigint as views, sum(likes)::bigint as likes, sum(saves)::bigint as saves
    from (
      select target_type, target_id, count(*) as views, 0 as likes, 0 as saves from public.page_views
      where created_at >= v_since group by 1, 2
      union all
      select target_type, target_id, 0, count(*), 0 from public.likes where created_at >= v_since group by 1, 2
      union all
      select target_type, target_id, 0, 0, count(*) from public.bookmarks where created_at >= v_since group by 1, 2
    ) e
    group by 1, 2
    order by sum(views) + sum(likes) * 3 desc, target_id
    limit 40
  loop
    exit when jsonb_array_length(v_top) >= 10;
    v_target := public.rwp_engagement_target(candidate.target_type, candidate.target_id);
    continue when v_target is null;
    v_top := v_top || jsonb_build_array(jsonb_build_object(
      'target_type', candidate.target_type, 'target_id', candidate.target_id,
      'title', v_target ->> 'title', 'url', v_target ->> 'url',
      'views', candidate.views, 'likes', candidate.likes, 'saves', candidate.saves
    ));
  end loop;

  return jsonb_build_object(
    'days', v_days,
    'since', v_since,
    'totals', jsonb_build_object(
      'views', (select count(*) from public.page_views where created_at >= v_since),
      'likes', (select count(*) from public.likes where created_at >= v_since),
      'saves', (select count(*) from public.bookmarks where created_at >= v_since),
      'follows', (select count(*) from public.follows where created_at >= v_since),
      'category_follows', (select count(*) from public.taxonomy_follows where created_at >= v_since)
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d.day, 'views', coalesce(v.total, 0), 'likes', coalesce(l.total, 0)) order by d.day), '[]'::jsonb)
      from generate_series(v_since::date, now()::date, interval '1 day') as d(day)
      left join (select created_at::date as day, count(*) as total from public.page_views where created_at >= v_since group by 1) v on v.day = d.day::date
      left join (select created_at::date as day, count(*) as total from public.likes where created_at >= v_since group by 1) l on l.day = d.day::date
    ),
    'top', v_top,
    'top_authors', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.following_id, 'name', coalesce(nullif(pr.display_name, ''), 'Author'), 'followers', a.total) order by a.total desc), '[]'::jsonb)
      from (select following_id, count(*) as total from public.follows group by 1 order by 2 desc limit 5) a
      join public.profiles pr on pr.id = a.following_id
    )
  );
end;
$$;

-- 8. Row level security ---------------------------------------------------------------------------

alter table public.likes enable row level security;
alter table public.follows enable row level security;
alter table public.taxonomy_follows enable row level security;
alter table public.bookmarks enable row level security;
alter table public.page_views enable row level security;
alter table public.rwp_view_salts enable row level security;

-- Likes: your own rows. Totals come from the counters and rwp_engagement_state, not from reading
-- other people's likes.
drop policy if exists "Members read their own likes" on public.likes;
create policy "Members read their own likes"
  on public.likes for select to authenticated using (user_id = auth.uid());
drop policy if exists "Members like published items" on public.likes;
create policy "Members like published items"
  on public.likes for insert to authenticated
  with check (user_id = auth.uid() and public.rwp_engagement_target(target_type, target_id) is not null);
drop policy if exists "Members remove their own likes" on public.likes;
create policy "Members remove their own likes"
  on public.likes for delete to authenticated using (user_id = auth.uid());

-- Follows: both sides of a follow can see it.
drop policy if exists "Members read follows they are part of" on public.follows;
create policy "Members read follows they are part of"
  on public.follows for select to authenticated
  using (follower_id = auth.uid() or following_id = auth.uid());
drop policy if exists "Members follow others" on public.follows;
create policy "Members follow others"
  on public.follows for insert to authenticated with check (follower_id = auth.uid());
drop policy if exists "Members unfollow" on public.follows;
create policy "Members unfollow"
  on public.follows for delete to authenticated using (follower_id = auth.uid());

drop policy if exists "Members manage their category follows" on public.taxonomy_follows;
create policy "Members manage their category follows"
  on public.taxonomy_follows for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Saved items are private to their owner.
drop policy if exists "Members read their saved items" on public.bookmarks;
create policy "Members read their saved items"
  on public.bookmarks for select to authenticated using (user_id = auth.uid());
drop policy if exists "Members save published items" on public.bookmarks;
create policy "Members save published items"
  on public.bookmarks for insert to authenticated
  with check (user_id = auth.uid() and public.rwp_engagement_target(target_type, target_id) is not null);
drop policy if exists "Members organise their saved items" on public.bookmarks;
create policy "Members organise their saved items"
  on public.bookmarks for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Members remove their saved items" on public.bookmarks;
create policy "Members remove their saved items"
  on public.bookmarks for delete to authenticated using (user_id = auth.uid());

-- page_views and rwp_view_salts have no policies: only the SECURITY DEFINER functions above touch them.

revoke all on table public.likes from anon;
revoke all on table public.follows from anon;
revoke all on table public.taxonomy_follows from anon;
revoke all on table public.bookmarks from anon;
revoke all on table public.page_views from anon, authenticated;
revoke all on table public.rwp_view_salts from anon, authenticated;
grant select, insert, delete on table public.likes to authenticated;
grant select, insert, delete on table public.follows to authenticated;
grant select, insert, delete on table public.taxonomy_follows to authenticated;
grant select, insert, update, delete on table public.bookmarks to authenticated;

-- 9. Function privileges --------------------------------------------------------------------------
-- New public functions are executable by anon by default. Internal helpers are revoked outright.

revoke execute on function public.pages_guard_engagement_counts() from public, anon, authenticated;
revoke execute on function public.likes_maintain_counts() from public, anon, authenticated;
revoke execute on function public.page_views_maintain_counts() from public, anon, authenticated;
revoke execute on function public.pages_forget_engagement() from public, anon, authenticated;
revoke execute on function public.rwp_view_salt() from public, anon, authenticated;
revoke execute on function public.rwp_engagement_target_page(text) from public, anon, authenticated;

-- rwp_engagement_target is used inside the insert policies, which run as the caller, so it must stay
-- executable. It only returns what is already public.
grant execute on function public.rwp_engagement_target(text, text) to anon, authenticated;
grant execute on function public.rwp_record_view(text, text, text) to anon, authenticated;
grant execute on function public.rwp_engagement_state(text, text[]) to anon, authenticated;
grant execute on function public.rwp_follow_state(uuid[], uuid[]) to anon, authenticated;
grant execute on function public.rwp_popular_content(integer, text, text[]) to anon, authenticated;

revoke execute on function public.rwp_set_like(text, text, boolean) from public, anon;
revoke execute on function public.rwp_set_follow(uuid, boolean) from public, anon;
revoke execute on function public.rwp_set_category_follow(uuid, boolean) from public, anon;
revoke execute on function public.rwp_set_bookmark(text, text, text, boolean) from public, anon;
revoke execute on function public.rwp_rename_bookmark_collection(text, text) from public, anon;
revoke execute on function public.rwp_my_bookmarks(text) from public, anon;
revoke execute on function public.rwp_following_feed(integer, timestamptz) from public, anon;
revoke execute on function public.rwp_engagement_report(integer) from public, anon;
revoke execute on function public.rwp_recount_likes() from public, anon;
grant execute on function public.rwp_set_like(text, text, boolean) to authenticated;
grant execute on function public.rwp_set_follow(uuid, boolean) to authenticated;
grant execute on function public.rwp_set_category_follow(uuid, boolean) to authenticated;
grant execute on function public.rwp_set_bookmark(text, text, text, boolean) to authenticated;
grant execute on function public.rwp_rename_bookmark_collection(text, text) to authenticated;
grant execute on function public.rwp_my_bookmarks(text) to authenticated;
grant execute on function public.rwp_following_feed(integer, timestamptz) to authenticated;
grant execute on function public.rwp_engagement_report(integer) to authenticated;
grant execute on function public.rwp_recount_likes() to authenticated;

-- 10. Realtime ------------------------------------------------------------------------------------
-- The Following feed refreshes when a post is published. Supabase Realtime only streams tables in
-- the supabase_realtime publication, and row level security still decides who receives a row.
-- Skipped where the publication does not exist (plain Postgres); the feed then polls instead.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pages') then
    execute 'alter publication supabase_realtime add table public.pages';
  end if;
end;
$$;

notify pgrst, 'reload schema';
