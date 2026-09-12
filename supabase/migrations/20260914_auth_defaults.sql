-- New accounts take the role configured in the `default_user_role` option.
--
-- This is enforced here rather than in the browser on purpose. The sign-up payload is
-- entirely attacker-controlled, so reading a role from it would restore exactly the
-- escalation path the profiles table was introduced to close. Administrator and
-- super_admin are rejected outright: auto-granting them to anyone who submits a signup
-- form is a site-takeover vector with no legitimate use.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  configured text;
begin
  select option_value into configured
  from public.options
  where option_name = 'default_user_role';

  if configured not in ('subscriber', 'contributor', 'author', 'editor') then
    configured := 'subscriber';
  end if;

  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    configured
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.options (option_name, option_value)
values ('default_user_role', 'subscriber'), ('users_can_register', 'true'), ('show_auth_links', 'true')
on conflict (option_name) do nothing;

notify pgrst, 'reload schema';
