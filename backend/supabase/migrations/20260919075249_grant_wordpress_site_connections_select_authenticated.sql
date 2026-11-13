-- Local representation of the migration version already recorded in production.
-- Re-running the grant is harmless on local rebuilds and preserves browser read access.
grant select
  on table public.wordpress_site_connections
  to authenticated;
