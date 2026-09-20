-- rwp-code-snippets: drop everything plugins/rwp-code-snippets/schema.sql creates.
--
-- Run by POST /api/plugins/uninstall when the administrator chooses "wipe data".
-- Safe to re-run; runs inside one transaction.
--
-- Every row of code_snippets is CSS, JavaScript or HTML the site injects into visitors'
-- browsers, so wiping this table also stops that injection. Take the backup first: a
-- hand-written snippet is not recoverable from anywhere else.

drop trigger if exists code_snippets_touch on public.code_snippets;

drop table if exists public.code_snippets cascade;

drop function if exists public.code_snippets_touch();

notify pgrst, 'reload schema';
