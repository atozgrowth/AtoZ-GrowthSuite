-- Extend the existing read-only connection directory with pairing lifecycle data.
-- This migration intentionally leaves site_id nullable for legacy rows.

alter table public.wordpress_site_connections
  add column if not exists site_id uuid,
  add column if not exists status text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists connected_at timestamptz,
  add column if not exists revoked_at timestamptz;

-- Existing rows predate pairing states and already represent connected sites.
update public.wordpress_site_connections
set
  status = coalesce(status, 'connected'),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

update public.wordpress_site_connections
set connected_at = coalesce(connected_at, created_at, now())
where status = 'connected';

alter table public.wordpress_site_connections
  alter column status set default 'pending',
  alter column status set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wordpress_site_connections'::regclass
      and conname = 'wordpress_site_connections_status_check'
  ) then
    alter table public.wordpress_site_connections
      add constraint wordpress_site_connections_status_check
      check (status in ('pending', 'connected', 'revoked'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wordpress_site_connections'::regclass
      and conname = 'wordpress_site_connections_lifecycle_timestamps_check'
  ) then
    alter table public.wordpress_site_connections
      add constraint wordpress_site_connections_lifecycle_timestamps_check
      check (
        (
          (status = 'pending' and connected_at is null and revoked_at is null)
          or (status = 'connected' and connected_at is not null and revoked_at is null)
          or (status = 'revoked' and revoked_at is not null)
        )
        and (connected_at is null or connected_at >= created_at)
        and (revoked_at is null or revoked_at >= created_at)
      );
  end if;
end
$migration$;

create unique index if not exists wordpress_site_connections_site_id_key
  on public.wordpress_site_connections (site_id) where site_id is not null;
create index if not exists wordpress_site_connections_user_status_idx
  on public.wordpress_site_connections (user_id, status);

-- Challenge material is isolated from the browser-facing public schema.
create schema if not exists private;
create table if not exists private.wordpress_pairing_challenges (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.wordpress_site_connections(id) on delete cascade,
  challenge_digest bytea not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint wordpress_pairing_challenges_digest_key unique (challenge_digest),
  constraint wordpress_pairing_challenges_expiry_check
    check (expires_at > created_at),
  constraint wordpress_pairing_challenges_consumed_check
    check (consumed_at is null or consumed_at >= created_at)
);

comment on column private.wordpress_pairing_challenges.consumed_at is
  'Consume with one atomic server-side UPDATE filtered by challenge_digest, consumed_at IS NULL, and expires_at > now(), using RETURNING to detect success.';

create index if not exists wordpress_pairing_challenges_connection_created_idx
  on private.wordpress_pairing_challenges (connection_id, created_at desc);
create index if not exists wordpress_pairing_challenges_active_expiry_idx
  on private.wordpress_pairing_challenges (expires_at) where consumed_at is null;
alter table private.wordpress_pairing_challenges enable row level security;

-- Preserve the existing browser read path and remove browser write access.
alter table public.wordpress_site_connections enable row level security;
drop policy if exists "Users can read their own WordPress site connections"
  on public.wordpress_site_connections;
create policy "Users can read their own WordPress site connections"
  on public.wordpress_site_connections
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all privileges on table public.wordpress_site_connections
  from anon, authenticated;
grant select on table public.wordpress_site_connections to authenticated;
grant select, insert, update, delete
  on table public.wordpress_site_connections to service_role;

-- Challenge rows are server-only. No browser role receives schema or table access.
revoke all privileges on schema private from public, anon, authenticated;
revoke all privileges on table private.wordpress_pairing_challenges
  from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete
  on table private.wordpress_pairing_challenges to service_role;
