-- Page builder widget pack: Template, Loop Grid/Carousel, Mega Menu, Off-Canvas and Author Box.
-- Safe to re-run: only "create or replace function", revoke and grant.
--
-- elementor_templates is readable only by signed-in builders (edit_posts), so a visitor viewing
-- a page with a Template widget could not load the template. builder_template_public() returns
-- a template's layout to anyone, but only when a published builder page uses it, directly or
-- through one template that page uses. Unused or draft-only templates stay private.
-- Custom HTML in a template is safe to render: builder_guard_html_templates already refuses
-- template saves that add or change Custom HTML code without manage_options.

create or replace function public.builder_template_public(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select t.builder_data
  from public.elementor_templates t
  where t.id = p_id
    and (
      public.user_has_cap('edit_posts')
      or exists (
        select 1 from public.pages pg
        where pg.status = 'published' and pg.is_builder_enabled
          and position(p_id::text in coalesce(pg.builder_data::text, '')) > 0
      )
      or exists (
        select 1
        from public.elementor_templates parent
        join public.pages pg
          on pg.status = 'published' and pg.is_builder_enabled
          and position(parent.id::text in coalesce(pg.builder_data::text, '')) > 0
        where parent.id <> p_id
          and position(p_id::text in parent.builder_data::text) > 0
      )
    );
$$;

-- Author Box: the name, avatar and bio of a page's author. profiles is readable only when
-- signed in (it holds emails), so this returns those three fields for one page, and only when
-- the page is published or the caller can edit it.
create or replace function public.builder_author_profile(p_page_id bigint)
returns table (display_name text, avatar_url text, bio text)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(pr.display_name, ''), 'Author'), pr.avatar_url, pr.bio
  from public.pages pg
  join public.profiles pr on pr.id = pg.author_id
  where pg.id = p_page_id
    and (pg.status = 'published' or public.builder_can_edit_page(pg.id));
$$;

revoke execute on function public.builder_template_public(uuid) from public;
revoke execute on function public.builder_author_profile(bigint) from public;
grant execute on function public.builder_template_public(uuid) to anon, authenticated;
grant execute on function public.builder_author_profile(bigint) to anon, authenticated;

notify pgrst, 'reload schema';
