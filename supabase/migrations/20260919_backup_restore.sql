-- Full-site backup and restore (Settings → Backup).
-- Safe to re-run: this migration only creates or replaces functions.
-- Kept identical to the "Backup and restore" section at the end of supabase/schema.sql.

-- Every table in public except profiles is backed up, so tables added by later migrations
-- or plugins are included without touching this file. profiles is special: its rows belong
-- to auth.users accounts, which a backup cannot recreate (it never contains passwords).
-- Accounts are matched by email on restore instead.

create or replace function public.rwp_backup_export()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  table_row record;
  table_rows jsonb;
  tables jsonb := '{}'::jsonb;
begin
  if not public.user_has_cap('manage_options') then
    raise exception 'Only administrators can export a backup. It needs the manage_options capability, and your role does not have it.'
      using errcode = '42501';
  end if;

  for table_row in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'profiles'
    order by c.relname
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t', table_row.relname)
      into table_rows;
    tables := tables || jsonb_build_object(table_row.relname, table_rows);
  end loop;

  return jsonb_build_object(
    'format', 'react-wp-backup',
    'version', 1,
    'created_at', timezone('utc'::text, now()),
    'tables', tables,
    'users', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'email', coalesce(u.email, p.email),
        'display_name', p.display_name,
        'avatar_url', p.avatar_url,
        'bio', p.bio,
        'role', p.role
      )), '[]'::jsonb)
      from public.profiles p
      left join auth.users u on u.id = p.id
    )
  );
end;
$$;

-- Replaces every backed-up table with the backup's rows, in one transaction: if any row
-- fails, nothing is changed. User references (columns with a foreign key to profiles or
-- auth.users) are re-pointed to the account with the same email on this site, or cleared.
create or replace function public.rwp_backup_import(p_backup jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  backup_tables jsonb := p_backup -> 'tables';
  backup_users jsonb := coalesce(p_backup -> 'users', '[]'::jsonb);
  user_map jsonb;
  pending text[];
  ready text[];
  ordered text[] := '{}';
  table_name text;
  table_rows jsonb;
  column_list text;
  ref record;
  identity_col record;
  inserted bigint;
  dropped bigint;
  counts jsonb := '{}'::jsonb;
  warnings jsonb := '[]'::jsonb;
  unmatched jsonb;
  installed_value text;
begin
  if not public.user_has_cap('manage_options') then
    raise exception 'Only administrators can restore a backup. It needs the manage_options capability, and your role does not have it.'
      using errcode = '42501';
  end if;
  if p_backup ->> 'format' is distinct from 'react-wp-backup' then
    raise exception 'This file is not a React-WP backup (its "format" field is missing or wrong).';
  end if;
  if coalesce((p_backup ->> 'version')::int, 0) <> 1 then
    raise exception 'This backup uses format version %, but this site only understands version 1. Update this site to the version that made the backup.',
      coalesce(p_backup ->> 'version', 'none');
  end if;
  if jsonb_typeof(backup_tables) is distinct from 'object' then
    raise exception 'The backup has no "tables" object, so there is nothing to restore.';
  end if;
  if jsonb_typeof(backup_users) <> 'array' then
    raise exception 'The backup''s "users" field must be an array.';
  end if;

  -- Old account id -> this site's account id, matched by email.
  select coalesce(jsonb_object_agg(bu ->> 'id', u.id), '{}'::jsonb) into user_map
  from jsonb_array_elements(backup_users) bu
  join auth.users u on lower(u.email) = lower(bu ->> 'email')
  where bu ->> 'id' is not null;

  select jsonb_agg(bu ->> 'email' order by bu ->> 'email') into unmatched
  from jsonb_array_elements(backup_users) bu
  where not (user_map ? (bu ->> 'id'));
  if unmatched is not null then
    warnings := warnings || jsonb_build_array(format(
      '%s account(s) in the backup have no account with the same email on this site, so their content was kept without an author: %s. Once they sign up, reassign their content by hand.',
      jsonb_array_length(unmatched),
      (select string_agg(value, ', ') from jsonb_array_elements_text(unmatched))
    ));
  end if;

  -- Profile details for matched accounts. Your own role is never changed, so a restore cannot
  -- lock you out, and only a super admin can hand out super_admin.
  update public.profiles p set
    display_name = coalesce(bu ->> 'display_name', p.display_name),
    avatar_url = bu ->> 'avatar_url',
    bio = bu ->> 'bio',
    role = case
      when p.id = auth.uid() then p.role
      when bu ->> 'role' in ('administrator', 'shop_manager', 'editor', 'author', 'contributor', 'subscriber') then bu ->> 'role'
      when bu ->> 'role' = 'super_admin' and public.current_user_role() = 'super_admin' then 'super_admin'
      else p.role
    end
  from jsonb_array_elements(backup_users) bu
  where user_map ->> (bu ->> 'id') = p.id::text;

  -- Restore order: a table goes after the tables its foreign keys point to.
  pending := array(
    select c.relname::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'profiles'
  );
  while cardinality(pending) > 0 loop
    ready := array(
      select t from unnest(pending) t
      where not exists (
        select 1 from pg_constraint con
        join pg_class ref_table on ref_table.oid = con.confrelid
        join pg_namespace ref_ns on ref_ns.oid = ref_table.relnamespace
        where con.contype = 'f'
          and con.conrelid = format('public.%I', t)::regclass
          and con.confrelid <> con.conrelid
          and ref_ns.nspname = 'public'
          and ref_table.relname = any(pending)
      )
    );
    if cardinality(ready) = 0 then
      raise exception 'These tables reference each other in a cycle, so no restore order exists: %', array_to_string(pending, ', ');
    end if;
    ordered := ordered || ready;
    pending := array(select unnest(pending) except select unnest(ready));
  end loop;

  for table_name in
    select key from jsonb_object_keys(backup_tables) key
    where key <> 'profiles' and not (key = any(ordered))
  loop
    warnings := warnings || jsonb_build_array(format(
      'The backup has a table "%s" that this database does not have, so it was skipped. Run the missing migrations in supabase/migrations/ and restore again to include it.',
      table_name));
  end loop;

  select option_value into installed_value from public.options where option_name = 'installed';

  execute 'truncate table ' || (select string_agg(format('public.%I', t), ', ') from unnest(ordered) t) || ' restart identity';

  foreach table_name in array ordered loop
    table_rows := backup_tables -> table_name;
    counts := counts || jsonb_build_object(table_name, 0);
    continue when table_rows is null or jsonb_typeof(table_rows) <> 'array' or jsonb_array_length(table_rows) = 0;

    for ref in
      select a.attname::text as col, a.attnotnull as required
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
      where con.contype = 'f'
        and con.conrelid = format('public.%I', table_name)::regclass
        and con.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
        and cardinality(con.conkey) = 1
    loop
      select coalesce(jsonb_agg(case
          when r ? ref.col then r || jsonb_build_object(ref.col, user_map -> (r ->> ref.col))
          else r
        end), '[]'::jsonb)
      into table_rows
      from jsonb_array_elements(table_rows) r;

      if ref.required then
        select count(*) into dropped from jsonb_array_elements(table_rows) r where r -> ref.col = 'null'::jsonb;
        if dropped > 0 then
          select coalesce(jsonb_agg(r), '[]'::jsonb) into table_rows
          from jsonb_array_elements(table_rows) r where r -> ref.col is distinct from 'null'::jsonb;
          warnings := warnings || jsonb_build_array(format(
            '%s row(s) of %s were skipped because they belong to accounts that do not exist on this site.',
            dropped, table_name));
        end if;
      end if;
    end loop;
    continue when jsonb_array_length(table_rows) = 0;

    -- Only columns both the backup and this table have, so an older backup still restores
    -- and newer columns take their defaults.
    select string_agg(format('%I', a.attname), ', ' order by a.attnum) into column_list
    from pg_attribute a
    where a.attrelid = format('public.%I', table_name)::regclass
      and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
      and (table_rows -> 0) ? a.attname;
    continue when column_list is null;

    -- Triggers are off while the rows go in: they would stamp new timestamps, write extra
    -- builder revisions, re-run stock and review bookkeeping, and the backup already holds
    -- the results of all of that.
    execute format('alter table public.%I disable trigger user', table_name);
    begin
      execute format(
        'insert into public.%1$I (%2$s) overriding system value select %2$s from jsonb_populate_recordset(null::public.%1$I, $1)',
        table_name, column_list)
      using table_rows;
      get diagnostics inserted = row_count;
    exception when others then
      raise exception 'Restoring table "%" failed: %', table_name, sqlerrm using errcode = sqlstate;
    end;
    execute format('alter table public.%I enable trigger user', table_name);
    counts := counts || jsonb_build_object(table_name, inserted);

    for identity_col in
      select a.attname::text as col, pg_get_serial_sequence(format('public.%I', table_name), a.attname) as seq
      from pg_attribute a
      where a.attrelid = format('public.%I', table_name)::regclass and a.attnum > 0 and not a.attisdropped
        and pg_get_serial_sequence(format('public.%I', table_name), a.attname) is not null
    loop
      execute format('select setval(%L, coalesce((select max(%I) from public.%I), 0) + 1, false)',
        identity_col.seq, identity_col.col, table_name);
    end loop;
  end loop;

  -- The installed flag describes this database, not the one the backup came from.
  if installed_value is not null then
    insert into public.options (option_name, option_value) values ('installed', installed_value)
    on conflict (option_name) do update set option_value = excluded.option_value;
  end if;

  return jsonb_build_object(
    'counts', counts,
    'warnings', warnings,
    'users_matched', (select count(*) from jsonb_object_keys(user_map)),
    'users_unmatched', coalesce(jsonb_array_length(unmatched), 0)
  );
end;
$$;

-- New public functions are executable by anon by default; both check manage_options
-- themselves, but anon has no reason to reach them at all.
revoke execute on function public.rwp_backup_export() from public, anon;
revoke execute on function public.rwp_backup_import(jsonb) from public, anon;
grant execute on function public.rwp_backup_export() to authenticated;
grant execute on function public.rwp_backup_import(jsonb) to authenticated;

notify pgrst, 'reload schema';
