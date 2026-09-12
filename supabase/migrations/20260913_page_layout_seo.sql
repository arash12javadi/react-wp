-- Per-page layout control and Yoast-style SEO fields.
-- Safe to re-run: every column is added conditionally.

alter table public.pages add column if not exists layout varchar(20) not null default 'boxed';
alter table public.pages add column if not exists show_sidebar boolean not null default false;

alter table public.pages add column if not exists seo_title text;
alter table public.pages add column if not exists meta_description text;
alter table public.pages add column if not exists focus_keyword text;
alter table public.pages add column if not exists canonical_url text;
alter table public.pages add column if not exists noindex boolean not null default false;
alter table public.pages add column if not exists og_title text;
alter table public.pages add column if not exists og_description text;
alter table public.pages add column if not exists og_image text;
alter table public.pages add column if not exists twitter_card varchar(30) not null default 'summary_large_image';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pages_layout_check') then
    alter table public.pages add constraint pages_layout_check check (layout in ('boxed', 'wide', 'full'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pages_twitter_card_check') then
    alter table public.pages add constraint pages_twitter_card_check check (twitter_card in ('summary', 'summary_large_image'));
  end if;
end $$;

-- PostgREST caches the schema; without this the new columns stay invisible to the API.
notify pgrst, 'reload schema';
