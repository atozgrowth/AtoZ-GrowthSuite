-- Server-only RPC bridge into private WordPress pairing challenge storage.
-- Plaintext pairing challenges must never be passed to or stored by these functions.

drop function if exists public.wp_manager_create_pairing_challenge(
  uuid,
  uuid,
  bytea,
  timestamptz
);

create function public.wp_manager_create_pairing_challenge(
  p_connection_id uuid,
  p_user_id uuid,
  p_challenge_digest bytea,
  p_expires_at timestamptz
)
returns table (
  out_connection_id uuid,
  out_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_connection_id is null
    or p_user_id is null
    or p_challenge_digest is null
    or pg_catalog.octet_length(p_challenge_digest) <> 32
    or p_expires_at is null
    or p_expires_at <= v_now
    or p_expires_at > v_now + interval '15 minutes'
  then
    return;
  end if;

  perform 1
  from public.wordpress_site_connections as connection
  where connection.id = p_connection_id
    and connection.user_id = p_user_id
    and connection.status = 'pending'
    and connection.site_id is null
  for update;

  if not found then
    return;
  end if;

  update private.wordpress_pairing_challenges as challenge
  set consumed_at = v_now
  where challenge.connection_id = p_connection_id
    and challenge.consumed_at is null;

  insert into private.wordpress_pairing_challenges (
    connection_id,
    challenge_digest,
    expires_at
  )
  values (
    p_connection_id,
    p_challenge_digest,
    p_expires_at
  );

  return query
  select p_connection_id, p_expires_at;
end
$function$;

revoke all on function public.wp_manager_create_pairing_challenge(
  uuid,
  uuid,
  bytea,
  timestamptz
) from public;
revoke all on function public.wp_manager_create_pairing_challenge(
  uuid,
  uuid,
  bytea,
  timestamptz
) from anon;
revoke all on function public.wp_manager_create_pairing_challenge(
  uuid,
  uuid,
  bytea,
  timestamptz
) from authenticated;
grant execute on function public.wp_manager_create_pairing_challenge(
  uuid,
  uuid,
  bytea,
  timestamptz
) to service_role;


drop function if exists public.wp_manager_confirm_pairing_challenge(
  uuid,
  uuid,
  text,
  bytea
);

create function public.wp_manager_confirm_pairing_challenge(
  p_connection_id uuid,
  p_site_id uuid,
  p_site_url text,
  p_challenge_digest bytea
)
returns table (
  outcome text,
  out_connection_id uuid,
  out_user_id uuid,
  out_site_url text,
  out_site_id uuid,
  out_status text,
  out_connected_at timestamptz,
  out_revoked_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_connection public.wordpress_site_connections%rowtype;
  v_challenge_id uuid;
begin
  if p_connection_id is null
    or p_site_id is null
    or p_site_url is null
    or pg_catalog.length(p_site_url) = 0
    or p_challenge_digest is null
    or pg_catalog.octet_length(p_challenge_digest) <> 32
  then
    return query
    select
      'invalid_or_expired'::text,
      null::uuid,
      null::uuid,
      null::text,
      null::uuid,
      null::text,
      null::timestamptz,
      null::timestamptz;
    return;
  end if;

  select connection.*
  into v_connection
  from public.wordpress_site_connections as connection
  where connection.id = p_connection_id
  for update;

  if not found
    or v_connection.status <> 'pending'
    or v_connection.site_id is not null
    or v_connection.site_url <> p_site_url
  then
    return query
    select
      'invalid_state'::text,
      null::uuid,
      null::uuid,
      null::text,
      null::uuid,
      null::text,
      null::timestamptz,
      null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from public.wordpress_site_connections as existing
    where existing.site_id = p_site_id
      and existing.id <> p_connection_id
  ) then
    return query
    select
      'site_conflict'::text,
      null::uuid,
      null::uuid,
      null::text,
      null::uuid,
      null::text,
      null::timestamptz,
      null::timestamptz;
    return;
  end if;

  begin
    update private.wordpress_pairing_challenges as challenge
    set consumed_at = v_now
    where challenge.connection_id = p_connection_id
      and challenge.challenge_digest = p_challenge_digest
      and challenge.consumed_at is null
      and challenge.expires_at > v_now
    returning challenge.id into v_challenge_id;

    if not found then
      return query
      select
        'invalid_or_expired'::text,
        null::uuid,
        null::uuid,
        null::text,
        null::uuid,
        null::text,
        null::timestamptz,
        null::timestamptz;
      return;
    end if;

    update public.wordpress_site_connections as connection
    set
      site_id = p_site_id,
      status = 'connected',
      connected_at = v_now,
      revoked_at = null,
      updated_at = v_now
    where connection.id = p_connection_id
      and connection.status = 'pending'
      and connection.site_id is null
    returning connection.* into v_connection;
  exception
    when unique_violation then
      return query
      select
        'site_conflict'::text,
        null::uuid,
        null::uuid,
        null::text,
        null::uuid,
        null::text,
        null::timestamptz,
        null::timestamptz;
      return;
  end;

  if v_connection.status <> 'connected' then
    return query
    select
      'invalid_state'::text,
      null::uuid,
      null::uuid,
      null::text,
      null::uuid,
      null::text,
      null::timestamptz,
      null::timestamptz;
    return;
  end if;

  return query
  select
    'connected'::text,
    v_connection.id,
    v_connection.user_id,
    v_connection.site_url,
    v_connection.site_id,
    v_connection.status,
    v_connection.connected_at,
    v_connection.revoked_at;
end
$function$;

revoke all on function public.wp_manager_confirm_pairing_challenge(
  uuid,
  uuid,
  text,
  bytea
) from public;
revoke all on function public.wp_manager_confirm_pairing_challenge(
  uuid,
  uuid,
  text,
  bytea
) from anon;
revoke all on function public.wp_manager_confirm_pairing_challenge(
  uuid,
  uuid,
  text,
  bytea
) from authenticated;
grant execute on function public.wp_manager_confirm_pairing_challenge(
  uuid,
  uuid,
  text,
  bytea
) to service_role;
