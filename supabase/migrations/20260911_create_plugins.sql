create table if not exists public.plugins (
  plugin_id text primary key,
  name text not null,
  version text not null,
  author text,
  description text default '',
  folder text,
  source text not null default 'bundled',
  active boolean not null default false,
  installed_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.plugins enable row level security;

drop policy if exists "Authenticated users can manage plugins" on public.plugins;
create policy "Authenticated users can manage plugins"
  on public.plugins for all to authenticated using (true) with check (true);
