-- Account pages and capability grants. Safe to re-run.
--
-- 1. Capability grants (Settings -> Roles). Any known capability can be added to a role
--    (rwp_role_capabilities) or to one person (rwp_user_capabilities), and user_has_cap()
--    honours both. They replace the four fixed toggles that used to live in the public
--    rwp_app_settings option; those are copied into rwp_role_capabilities below and removed
--    from the option.
--
--    Only an Administrator or Super Admin (profiles.role, not a capability) may write either
--    table. A capability check would be circular: granting manage_options to a role must not
--    let that role grant itself the rest. Changing roles and resetting the site keep checking
--    profiles.role too, so no grant can reach them.
--
-- 2. Default content (rwp_install_default_content) gains the 'account' group: Log In, Register,
--    Lost Password, User Profile and Dashboard pages, each built from a shortcode, whose ids are
--    stored in the login_page_id / register_page_id / lost_password_page_id / profile_page_id /
--    dashboard_page_id options. Core now installs the 'site' group itself (it used to need the
--    Page Builder), including a Sample Post, and makes the new Home page the front page. The
--    'site' group only runs on a site with no pages yet, so upgrading never replaces a chosen
--    front page.

-- Tables ------------------------------------------------------------------------------------------

create table if not exists public.rwp_role_capabilities (
  role text not null check (role in ('shop_manager', 'editor', 'author', 'contributor', 'subscriber')),
  capability text not null check (capability ~ '^[a-z][a-z0-9_]{1,63}$'),
  created_at timestamptz default timezone('utc'::text, now()) not null,
  primary key (role, capability)
);

create table if not exists public.rwp_user_capabilities (
  user_id uuid not null references public.profiles(id) on delete cascade,
  capability text not null check (capability ~ '^[a-z][a-z0-9_]{1,63}$'),
  granted_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default timezone('utc'::text, now()) not null,
  primary key (user_id, capability)
);

-- The old App Settings toggles become rows. Before the option is rewritten below, so a re-run
-- (which finds no 'roles' key any more) inserts nothing.
insert into public.rwp_role_capabilities (role, capability)
select g.role, g.capability
from (values
  ('subscriber_upload_files', 'subscriber', 'upload_files'),
  ('subscriber_edit_posts', 'subscriber', 'edit_posts'),
  ('subscriber_edit_posts', 'subscriber', 'delete_posts'),
  ('contributor_upload_files', 'contributor', 'upload_files'),
  ('contributor_publish_posts', 'contributor', 'publish_posts')
) as g(grant_key, role, capability)
where public.rwp_app_settings() #> array['roles', g.grant_key] = 'true'::jsonb
on conflict do nothing;

update public.options
set option_value = (public.rwp_app_settings() - 'roles')::text
where option_name = 'rwp_app_settings' and public.rwp_app_settings() ? 'roles';

-- Capabilities --------------------------------------------------------------------------------------

-- Mirrors roleCapabilities + the grants in src/lib/roles.ts. $1 rather than the parameter name:
-- inside the subqueries "capability" would mean the column, and compare it with itself.
create or replace function public.user_has_cap(capability text)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.current_user_role()
    when 'super_admin' then true
    when 'administrator' then true
    when 'shop_manager' then $1 in (
      'read', 'edit_posts', 'delete_posts', 'publish_posts', 'upload_files',
      'edit_others_posts', 'delete_others_posts', 'edit_pages', 'publish_pages',
      'manage_categories', 'moderate_comments', 'manage_shop', 'list_users')
    when 'editor' then $1 in (
      'read', 'edit_posts', 'delete_posts', 'publish_posts', 'upload_files',
      'edit_others_posts', 'delete_others_posts', 'edit_pages', 'publish_pages',
      'manage_categories', 'moderate_comments')
    when 'author' then $1 in ('read', 'edit_posts', 'delete_posts', 'publish_posts', 'upload_files')
    when 'contributor' then $1 in ('read', 'edit_posts', 'delete_posts')
    when 'subscriber' then $1 = 'read'
    else false
  end
  or exists (
    select 1 from public.rwp_role_capabilities rc
    where rc.role = public.current_user_role() and rc.capability = $1
  )
  or (auth.uid() is not null and exists (
    select 1 from public.rwp_user_capabilities uc
    where uc.user_id = auth.uid() and uc.capability = $1
  ));
$$;

grant execute on function public.user_has_cap(text) to anon, authenticated;

-- Policies ----------------------------------------------------------------------------------------

alter table public.rwp_role_capabilities enable row level security;
alter table public.rwp_user_capabilities enable row level security;

-- Like roleCapabilities in the public bundle: what a role may do is not a secret.
drop policy if exists "Everyone reads role capabilities" on public.rwp_role_capabilities;
create policy "Everyone reads role capabilities"
  on public.rwp_role_capabilities for select to anon, authenticated using (true);

drop policy if exists "Administrators manage role capabilities" on public.rwp_role_capabilities;
create policy "Administrators manage role capabilities"
  on public.rwp_role_capabilities for all to authenticated
  using (public.current_user_role() in ('administrator', 'super_admin'))
  with check (public.current_user_role() in ('administrator', 'super_admin'));

drop policy if exists "People read their own capabilities, user managers read all" on public.rwp_user_capabilities;
create policy "People read their own capabilities, user managers read all"
  on public.rwp_user_capabilities for select to authenticated
  using (user_id = auth.uid() or public.user_has_cap('list_users'));

drop policy if exists "Administrators manage user capabilities" on public.rwp_user_capabilities;
create policy "Administrators manage user capabilities"
  on public.rwp_user_capabilities for all to authenticated
  using (public.current_user_role() in ('administrator', 'super_admin'))
  with check (public.current_user_role() in ('administrator', 'super_admin'));

revoke all on table public.rwp_user_capabilities from anon;

-- Default content -----------------------------------------------------------------------------------

-- p_items: [{ "key": "home", "title": "Home", "slug": "home", "template_type": null | "header",
--             "content": "<p>…</p>", "builder_data": {…} | null, "is_post": false,
--             "category": { "name": "Uncategorized", "slug": "uncategorized" } | null,
--             "comments_open": false, "noindex": false, "option": "home_page_id" | null }]
-- Items whose slug or template type already exists are skipped. "option" names a Reading or
-- account option that gets the new page's id, but only while it is unset. p_reading is kept for
-- older callers: it gives "home" and "blog" their options when they name none.
-- The 'site' group only installs on a site without pages; elsewhere it is recorded as done and
-- skipped, because it would add pages nobody asked for and could change the front page.
-- Returns { installed: bool, skipped?: text, created: [{ key, id }] }.
create or replace function public.rwp_install_default_content(p_group text, p_items jsonb, p_reading boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_done jsonb;
  v_item jsonb;
  v_type text;
  v_slug text;
  v_option text;
  v_category uuid;
  v_id bigint;
  v_created jsonb := '[]'::jsonb;
  v_options constant text[] := array['home_page_id', 'posts_page_id', 'login_page_id', 'register_page_id',
                                     'lost_password_page_id', 'profile_page_id', 'dashboard_page_id'];
begin
  if p_group is null or p_group not in ('site', 'account', 'shop') then
    raise exception using errcode = '22023', message = format('Unknown default content group "%s".', p_group);
  end if;
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Installing default content needs a signed-in user.';
  end if;
  if p_group in ('site', 'account') and not public.user_has_cap('manage_options') then
    raise exception using errcode = '42501', message = format('Installing the default %s pages needs an Administrator (manage_options).', p_group);
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Default content items must be a JSON array.';
  end if;
  -- Templates need manage_shop, exactly as builder_create_site_template does.
  if exists (select 1 from jsonb_array_elements(p_items) i where nullif(i ->> 'template_type', '') is not null)
     and not public.user_has_cap('manage_shop') then
    raise exception using errcode = '42501', message = 'Installing default templates needs an Administrator or Shop Manager (manage_shop).';
  end if;

  -- One install per group, even when two admins open the dashboard at once.
  perform pg_advisory_xact_lock(hashtext('rwp_install_default_content'));
  select coalesce((select option_value::jsonb from public.options where option_name = 'rwp_default_content'), '[]'::jsonb) into v_done;
  if v_done ? p_group then
    return jsonb_build_object('installed', false, 'created', '[]'::jsonb);
  end if;

  if p_group = 'site' and exists (select 1 from public.pages where not is_site_template) then
    insert into public.options (option_name, option_value) values ('rwp_default_content', (v_done || to_jsonb(p_group))::text)
      on conflict (option_name) do update set option_value = excluded.option_value;
    return jsonb_build_object('installed', false, 'skipped', 'The site already has pages.', 'created', '[]'::jsonb);
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_type := nullif(v_item ->> 'template_type', '');
    v_slug := nullif(trim(v_item ->> 'slug'), '');
    v_option := coalesce(nullif(v_item ->> 'option', ''), case
      when p_reading and v_item ->> 'key' = 'home' then 'home_page_id'
      when p_reading and v_item ->> 'key' = 'blog' then 'posts_page_id'
    end);
    if v_type is not null and not (v_type = any(public.rwp_template_types())) then
      raise exception using errcode = '22023', message = format('Unknown template type "%s" in default content.', v_type);
    end if;
    if p_group = 'shop' and (v_type is null or v_type not in ('shop', 'product', 'product_category', 'cart', 'checkout', 'my_account')) then
      raise exception using errcode = '22023', message = 'The shop default content may only contain shop templates.';
    end if;
    if p_group = 'account' and v_type is not null then
      raise exception using errcode = '22023', message = 'The account default content may only contain pages.';
    end if;
    if v_type is null and v_slug is null then
      raise exception using errcode = '22023', message = 'A default page needs a slug.';
    end if;
    if v_option is not null and not (v_option = any(v_options)) then
      raise exception using errcode = '22023', message = format('Default content cannot set the option "%s".', v_option);
    end if;
    if (v_type is not null and exists (select 1 from public.pages where template_type = v_type))
       or (v_type is null and exists (select 1 from public.pages where slug = v_slug)) then
      continue;
    end if;

    v_category := null;
    if v_type is null and coalesce(v_item -> 'is_post' = 'true'::jsonb, false) and nullif(trim(v_item #>> '{category,slug}'), '') is not null then
      insert into public.categories (name, slug)
      values (coalesce(nullif(trim(v_item #>> '{category,name}'), ''), trim(v_item #>> '{category,slug}')), trim(v_item #>> '{category,slug}'))
      on conflict (slug) do nothing;
      select id into v_category from public.categories where slug = trim(v_item #>> '{category,slug}');
    end if;

    -- Runs as the definer, so the Custom HTML and template guards still see auth.uid() of the caller.
    insert into public.pages (title, slug, content, status, is_post, category_id, is_site_template, template_type,
                              builder_data, is_builder_enabled, author_id, noindex, comments_open)
    values (
      coalesce(nullif(trim(v_item ->> 'title'), ''), coalesce(v_type, v_slug)),
      case when v_type is not null then public.rwp_free_slug('template-' || replace(v_type, '_', '-')) else v_slug end,
      coalesce(v_item ->> 'content', ''),
      'published',
      -- A missing key compares as null, and these columns are not null.
      v_type is null and coalesce(v_item -> 'is_post' = 'true'::jsonb, false),
      v_category,
      v_type is not null, v_type,
      case when jsonb_typeof(v_item -> 'builder_data') = 'object' then v_item -> 'builder_data' else null end,
      coalesce(jsonb_typeof(v_item -> 'builder_data') = 'object', false),
      auth.uid(),
      v_type is not null or coalesce(v_item -> 'noindex' = 'true'::jsonb, false),
      v_type is null and coalesce(v_item -> 'comments_open' = 'true'::jsonb, false)
    )
    returning id into v_id;
    v_created := v_created || jsonb_build_object('key', v_item ->> 'key', 'id', v_id);

    if v_option is not null
       and coalesce((select option_value from public.options where option_name = v_option), '') = '' then
      insert into public.options (option_name, option_value) values (v_option, v_id::text)
        on conflict (option_name) do update set option_value = excluded.option_value;
    end if;
  end loop;

  insert into public.options (option_name, option_value) values ('rwp_default_content', (v_done || to_jsonb(p_group))::text)
    on conflict (option_name) do update set option_value = excluded.option_value;

  return jsonb_build_object('installed', true, 'created', v_created);
end;
$$;

revoke execute on function public.rwp_install_default_content(text, jsonb, boolean) from public, anon;
grant execute on function public.rwp_install_default_content(text, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
