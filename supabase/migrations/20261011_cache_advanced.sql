-- Two more knobs for the security/caching engine (20261010_security_engine.sql): whether saving
-- content auto-purges the page cache, and whether responses are compressed. Safe to re-run.
--
-- Both are ordinary options rows, read by the same server/middleware/securitySettings.mjs snapshot
-- as everything else from 20261010 — see that migration's header for why these live in `options`
-- and not somewhere else. Nothing here needs a new table, policy or function.

insert into public.options (option_name, option_value) values
  -- Off means an admin's edit is invisible until cache_ttl_seconds runs out; the manual "Purge the
  -- whole page cache" button in Settings → Security always works regardless of this setting.
  ('cache_auto_purge_on_save', 'true'),
  -- Brotli/gzip on HTML, JSON and JS/CSS responses. Independent of cache_enabled — a pure
  -- transport optimisation with none of the staleness/privacy trade-offs that keep the page cache
  -- itself opt-in, so unlike cache_enabled this defaults on.
  ('cache_enable_compression', 'true')
on conflict (option_name) do nothing;

-- Without this PostgREST keeps serving the old column list and every new column reads as missing.
notify pgrst, 'reload schema';
