-- Trash for pages/posts and shop products, used by the bulk actions in Pages & Posts,
-- Page Builder → Site Pages and Shop → Products.
--
-- Trashed rows are hidden from visitors without any other change: every public query and
-- policy already requires status = 'published' (pages) or status = 'publish' (products).
-- Safe to re-run.

-- pages.status ---------------------------------------------------------------------------------------
-- The original check was declared inline, so its name depends on how the table was created.
-- Drop every check on the status column itself (not template_type or other checks), then add
-- one with a known name.
do $$
declare
  existing record;
begin
  for existing in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.pages'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ '[( ]status[) ]'
      and pg_get_constraintdef(c.oid) like '%''draft''%'
  loop
    execute format('alter table public.pages drop constraint %I', existing.conname);
  end loop;
end $$;

alter table public.pages
  add constraint pages_status_check check (status in ('draft', 'published', 'trash'));

-- Moving your own content to or from the Trash is not publishing, so it does not need
-- publish_posts. Who may edit a row is unchanged (the USING clauses are the same as before).
drop policy if exists "Contributors can create content" on public.pages;
create policy "Contributors can create content"
  on public.pages for insert to authenticated
  with check (
    public.user_has_cap('edit_posts')
    and (status in ('draft', 'trash') or public.user_has_cap('publish_posts'))
  );

drop policy if exists "Authors edit own content, editors edit all" on public.pages;
create policy "Authors edit own content, editors edit all"
  on public.pages for update to authenticated
  using (
    (author_id = auth.uid() and public.user_has_cap('edit_posts'))
    or public.user_has_cap('edit_others_posts')
  )
  with check (status in ('draft', 'trash') or public.user_has_cap('publish_posts'));

-- shop_products.status -------------------------------------------------------------------------------
-- The regex skips stock_status and tax_status checks: the character before "status" must be
-- "(" or a space, not "_".
do $$
declare
  existing record;
begin
  for existing in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.shop_products'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ '[( ]status[) ]'
      and pg_get_constraintdef(c.oid) like '%''publish''%'
  loop
    execute format('alter table public.shop_products drop constraint %I', existing.conname);
  end loop;
exception
  -- The shop plugin's tables only exist once its migration has been run.
  when undefined_table then null;
end $$;

do $$
begin
  if to_regclass('public.shop_products') is not null then
    alter table public.shop_products
      add constraint shop_products_status_check check (status in ('draft', 'pending', 'private', 'publish', 'trash'));
  end if;
end $$;

notify pgrst, 'reload schema';
