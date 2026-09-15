-- Optional profile details (Admin → Profile → More about you). Safe to re-run.
--
-- A separate table, not more columns on profiles, for two reasons:
--   * profiles is readable by every signed-in user (it drives author names and the Users
--     screen), and a phone number or birth date must not be. This table is readable only by
--     the person themselves and by roles with list_users.
--   * rwp_backup_export() skips profiles but backs up every other public table, and its
--     restore re-points id (a foreign key to profiles) by email. So these rows are backed up
--     and restored with no change to the backup functions.
--
-- Everything is optional. The Dashboard's setup checklist only suggests filling it in.

create table if not exists public.profile_details (
  id uuid primary key references public.profiles(id) on delete cascade,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.profile_details add column if not exists first_name text;
alter table public.profile_details add column if not exists last_name text;
alter table public.profile_details add column if not exists pronouns text;
alter table public.profile_details add column if not exists job_title text;
alter table public.profile_details add column if not exists company text;
alter table public.profile_details add column if not exists website text;
alter table public.profile_details add column if not exists location text;
alter table public.profile_details add column if not exists timezone text;
alter table public.profile_details add column if not exists phone text;
alter table public.profile_details add column if not exists birth_date date;
alter table public.profile_details add column if not exists social_links jsonb not null default '{}'::jsonb;

-- Dropped first so a re-run replaces them instead of failing on "already exists".
alter table public.profile_details drop constraint if exists profile_details_lengths_check;
alter table public.profile_details add constraint profile_details_lengths_check check (
  char_length(coalesce(first_name, '')) <= 100
  and char_length(coalesce(last_name, '')) <= 100
  and char_length(coalesce(pronouns, '')) <= 40
  and char_length(coalesce(job_title, '')) <= 120
  and char_length(coalesce(company, '')) <= 120
  and char_length(coalesce(website, '')) <= 300
  and char_length(coalesce(location, '')) <= 120
  and char_length(coalesce(timezone, '')) <= 60
  and char_length(coalesce(phone, '')) <= 40
);

-- Websites are rendered as links, so only http(s) URLs: no javascript: URLs.
alter table public.profile_details drop constraint if exists profile_details_website_check;
alter table public.profile_details add constraint profile_details_website_check
  check (website is null or website ~* '^https?://[^\s]+$');

alter table public.profile_details drop constraint if exists profile_details_social_links_check;
alter table public.profile_details add constraint profile_details_social_links_check
  check (jsonb_typeof(social_links) = 'object' and pg_column_size(social_links) <= 4000);

alter table public.profile_details drop constraint if exists profile_details_birth_date_check;
alter table public.profile_details add constraint profile_details_birth_date_check
  check (birth_date is null or birth_date >= date '1900-01-01');

alter table public.profile_details enable row level security;

drop policy if exists "People read their own details, user managers read all" on public.profile_details;
create policy "People read their own details, user managers read all"
  on public.profile_details for select to authenticated
  using (id = auth.uid() or public.user_has_cap('list_users'));

drop policy if exists "People add their own details" on public.profile_details;
create policy "People add their own details"
  on public.profile_details for insert to authenticated
  with check (id = auth.uid() or public.user_has_cap('edit_users'));

drop policy if exists "People update their own details" on public.profile_details;
create policy "People update their own details"
  on public.profile_details for update to authenticated
  using (id = auth.uid() or public.user_has_cap('edit_users'))
  with check (id = auth.uid() or public.user_has_cap('edit_users'));

drop policy if exists "People delete their own details" on public.profile_details;
create policy "People delete their own details"
  on public.profile_details for delete to authenticated
  using (id = auth.uid() or public.user_has_cap('edit_users'));

-- Anon has no policy, so RLS already returns nothing; this makes it explicit.
revoke all on table public.profile_details from anon;

notify pgrst, 'reload schema';
