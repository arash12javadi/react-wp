-- Per-page header and footer switches (Pages & Posts editor → Show on this page). Safe to re-run.
--
-- Both default to true, so every existing page keeps its header and footer. A landing page can
-- switch either off; the public site then leaves out the Theme Editor header/footer (or the Page
-- Builder header/footer template) for that page only. The admin toolbar is not affected.

alter table public.pages add column if not exists show_header boolean not null default true;
alter table public.pages add column if not exists show_footer boolean not null default true;

notify pgrst, 'reload schema';
