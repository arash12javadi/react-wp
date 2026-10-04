-- React-WP universal core schema — SQLite / LibSQL.
-- Idempotent: re-run to add whatever an existing database is missing. Requires SQLite 3.31+ for
-- the `default (expr)` columns. JSON is stored as TEXT; the options API encodes/decodes JSON itself.

create table if not exists profiles (
  id text primary key,
  email text,
  display_name text,
  avatar_url text,
  bio text,
  role text not null default 'subscriber',
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists posts (
  id integer primary key autoincrement,
  title text not null,
  slug text unique not null,
  content text default '',
  excerpt text default '',
  status text default 'draft',
  author_id text,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists categories (
  id text primary key default (lower(hex(randomblob(16)))),
  name text not null,
  slug text unique not null,
  description text
);

create table if not exists pages (
  id integer primary key autoincrement,
  title text not null,
  slug text unique not null,
  content text default '',
  excerpt text default '',
  status text default 'draft',
  is_post integer not null default 0,
  category_id text,
  featured_category_id text,
  posts_limit integer not null default 6,
  display_layout text not null default 'grid',
  layout text not null default 'boxed',
  show_sidebar integer not null default 0,
  seo_title text,
  meta_description text,
  focus_keyword text,
  canonical_url text,
  noindex integer not null default 0,
  og_title text,
  og_description text,
  og_image text,
  twitter_card text not null default 'summary_large_image',
  comments_open integer not null default 1,
  meta_keywords text,
  author_id text,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists comments (
  id integer primary key autoincrement,
  page_id integer,
  parent_id integer,
  author_id text,
  author_name text,
  author_email text,
  content text not null,
  status text default 'pending',
  created_at text not null default (datetime('now'))
);

create table if not exists options (
  option_name text primary key,
  option_value text not null
);

create table if not exists menus (
  id integer primary key autoincrement,
  name text not null,
  slug text unique not null,
  location text not null default 'primary',
  items text not null default '[]',
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists plugins (
  plugin_id text primary key,
  name text not null,
  version text not null,
  author text,
  description text default '',
  folder text,
  source text not null default 'bundled',
  active integer not null default 0,
  installed_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists media (
  id text primary key default (lower(hex(randomblob(16)))),
  title text,
  alt_text text,
  url text not null,
  provider text not null default 'external',
  file_name text,
  provider_file_id text,
  width integer,
  height integer,
  bytes integer,
  mime_type text,
  uploaded_by text,
  created_at text not null default (datetime('now')),
  folder text not null default 'general'
);

create table if not exists rwp_users (
  id text primary key,
  email text unique not null,
  password_hash text not null,
  role text not null default 'subscriber',
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists theme_settings (
  id text primary key default (lower(hex(randomblob(16)))),
  singleton integer not null default 1,
  active_theme text not null default 'default',
  layout_structure text not null default '{}',
  custom_header_code text not null default '',
  custom_header_html text not null default '',
  custom_footer_code text not null default '',
  custom_footer_html text not null default '',
  custom_sidebar_code text not null default '',
  custom_comments_css text not null default '',
  custom_css text not null default '',
  updated_at text not null default (datetime('now')),
  unique (singleton)
);

create table if not exists profile_details (
  id text primary key,
  first_name text,
  last_name text,
  pronouns text,
  job_title text,
  company text,
  website text,
  location text,
  timezone text,
  phone text,
  birth_date text,
  social_links text not null default '{}',
  updated_at text not null default (datetime('now'))
);

create table if not exists rwp_translations (
  id text primary key default (lower(hex(randomblob(16)))),
  translation_key text not null,
  locale text not null,
  translation_value text,
  source_text text,
  group_name text not null default 'general',
  updated_by text,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  unique (translation_key, locale)
);

create index if not exists rwp_translations_locale_idx
  on rwp_translations (locale) where translation_value is not null;

create table if not exists bookmarks (
  id text primary key default (lower(hex(randomblob(16)))),
  user_id text not null,
  target_id text not null,
  target_type text not null,
  collection_name text not null default 'Saved Items',
  created_at text not null default (datetime('now')),
  unique (user_id, target_type, target_id, collection_name)
);

create index if not exists bookmarks_user_collection_idx on bookmarks (user_id, collection_name, created_at);
create index if not exists bookmarks_target_idx on bookmarks (target_type, target_id);

create table if not exists schema_migrations (
  name text primary key,
  applied_at text not null default (datetime('now'))
);
