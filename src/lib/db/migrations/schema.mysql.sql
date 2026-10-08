-- React-WP universal core schema — MySQL / MariaDB.
-- Idempotent: re-run to add whatever an existing database is missing. Requires MySQL 8.0.13+ /
-- MariaDB 10.7+ for the `default (uuid())` expression columns.

create table if not exists profiles (
  id varchar(191) primary key,
  email varchar(191),
  display_name varchar(255),
  avatar_url text,
  bio text,
  role varchar(20) not null default 'subscriber',
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp
);

create table if not exists posts (
  id bigint not null auto_increment primary key,
  title varchar(255) not null,
  slug varchar(255) not null,
  content longtext,
  excerpt text,
  status varchar(20) default 'draft',
  author_id varchar(191),
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp,
  unique key posts_slug_unique (slug)
);

create table if not exists categories (
  id char(36) primary key default (uuid()),
  name varchar(255) not null,
  slug varchar(255) not null,
  description text,
  unique key categories_slug_unique (slug)
);

create table if not exists pages (
  id bigint not null auto_increment primary key,
  title varchar(255) not null,
  slug varchar(255) not null,
  content longtext,
  excerpt text,
  status varchar(20) default 'draft',
  is_post boolean not null default false,
  category_id char(36),
  featured_category_id char(36),
  posts_limit int not null default 6,
  display_layout varchar(20) not null default 'grid',
  layout varchar(20) not null default 'boxed',
  show_sidebar boolean not null default false,
  seo_title text,
  meta_description text,
  focus_keyword text,
  canonical_url text,
  noindex boolean not null default false,
  og_title text,
  og_description text,
  og_image text,
  twitter_card varchar(30) not null default 'summary_large_image',
  comments_open boolean not null default true,
  meta_keywords text,
  author_id varchar(191),
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp,
  unique key pages_slug_unique (slug)
);

create table if not exists comments (
  id bigint not null auto_increment primary key,
  page_id bigint,
  parent_id bigint,
  author_id varchar(191),
  author_name varchar(255),
  author_email varchar(255),
  content text not null,
  status varchar(20) default 'pending',
  created_at timestamp not null default current_timestamp
);

create table if not exists options (
  option_name varchar(191) primary key,
  option_value text not null
);

create table if not exists system_settings (
  setting_key varchar(191) primary key,
  setting_value text not null
);

create table if not exists menus (
  id bigint not null auto_increment primary key,
  name varchar(255) not null,
  slug varchar(255) not null,
  location varchar(50) not null default 'primary',
  items json not null,
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp,
  unique key menus_slug_unique (slug)
);

create table if not exists plugins (
  plugin_id varchar(191) primary key,
  name varchar(255) not null,
  version varchar(50) not null,
  author varchar(255),
  description text,
  folder varchar(255),
  source varchar(50) not null default 'bundled',
  active boolean not null default false,
  installed_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp
);

create table if not exists media (
  id char(36) primary key default (uuid()),
  title varchar(255),
  alt_text text,
  url text not null,
  provider varchar(50) not null default 'external',
  file_name varchar(255),
  provider_file_id text,
  width int,
  height int,
  bytes bigint,
  mime_type varchar(100),
  uploaded_by varchar(191),
  created_at timestamp not null default current_timestamp,
  folder varchar(255) not null default 'general'
);

create table if not exists rwp_users (
  id varchar(191) primary key,
  email varchar(191) not null,
  password_hash varchar(255) not null,
  role varchar(20) not null default 'subscriber',
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp,
  unique key rwp_users_email_unique (email)
);

create table if not exists theme_settings (
  id char(36) primary key default (uuid()),
  singleton boolean not null default true,
  active_theme varchar(64) not null default 'default',
  layout_structure json not null,
  custom_header_code mediumtext not null,
  custom_header_html mediumtext not null,
  custom_footer_code mediumtext not null,
  custom_footer_html mediumtext not null,
  custom_sidebar_code mediumtext not null,
  custom_comments_css mediumtext not null,
  custom_css mediumtext not null,
  updated_at timestamp not null default current_timestamp,
  unique key theme_settings_singleton_key (singleton)
);

create table if not exists profile_details (
  id varchar(191) primary key,
  first_name varchar(100),
  last_name varchar(100),
  pronouns varchar(40),
  job_title varchar(120),
  company varchar(120),
  website varchar(300),
  location varchar(120),
  timezone varchar(60),
  phone varchar(40),
  birth_date varchar(10),
  social_links json not null,
  updated_at timestamp not null default current_timestamp
);

create table if not exists rwp_translations (
  id char(36) primary key default (uuid()),
  translation_key varchar(191) not null,
  locale varchar(10) not null,
  translation_value mediumtext,
  source_text text,
  group_name varchar(50) not null default 'general',
  updated_by varchar(191),
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp,
  unique key rwp_translations_key_locale_key (translation_key, locale),
  key rwp_translations_locale_idx (locale)
);

create table if not exists bookmarks (
  id char(36) primary key default (uuid()),
  user_id varchar(191) not null,
  target_id varchar(191) not null,
  target_type varchar(50) not null,
  collection_name varchar(191) not null default 'Saved Items',
  created_at timestamp not null default current_timestamp,
  unique key bookmarks_user_target_collection_key (user_id, target_type, target_id, collection_name),
  key bookmarks_user_collection_idx (user_id, collection_name, created_at),
  key bookmarks_target_idx (target_type, target_id)
);

create table if not exists schema_migrations (
  name varchar(191) primary key,
  applied_at timestamp not null default current_timestamp
);
