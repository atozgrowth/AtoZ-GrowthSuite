-- Phase 1 controlled-write foundation. This migration is intentionally unapplied.
-- WordPress execution is not part of this phase.

create schema if not exists private;

create table if not exists public.wordpress_action_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null
    references public.wordpress_site_connections(id) on delete cascade,
  site_id uuid not null,
  site_url text not null,
  action_type text not null,
  status text not null default 'proposed',
  payload_digest bytea not null,
  actor_source text not null default 'user',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz,
  executing_at timestamptz,
  execution_consumed_at timestamptz,
  completed_at timestamptz,
  result_post_id bigint,
  failure_code text,
  constraint wordpress_action_requests_action_type_check
    check (action_type = 'create_post_draft'),
  constraint wordpress_action_requests_status_check
    check (status in (
      'proposed', 'approved', 'executing', 'succeeded', 'failed',
      'expired', 'cancelled'
    )),
  constraint wordpress_action_requests_actor_source_check
    check (actor_source in ('user', 'approved_ai')),
  constraint wordpress_action_requests_digest_check
    check (octet_length(payload_digest) = 32),
  constraint wordpress_action_requests_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '1 hour'),
  constraint wordpress_action_requests_timestamp_order_check
    check (
      (approved_at is null or approved_at >= created_at)
      and (executing_at is null or (approved_at is not null and executing_at >= approved_at))
      and (
        execution_consumed_at is null
        or (executing_at is not null and execution_consumed_at >= executing_at)
      )
      and (
        completed_at is null
        or completed_at >= coalesce(executing_at, approved_at, created_at)
      )
    ),
  constraint wordpress_action_requests_lifecycle_check
    check (
      (status = 'proposed'
        and approved_at is null and executing_at is null
        and execution_consumed_at is null and completed_at is null)
      or (status = 'approved'
        and approved_at is not null and executing_at is null
        and execution_consumed_at is null and completed_at is null)
      or (status = 'executing'
        and approved_at is not null and executing_at is not null
        and execution_consumed_at is not null and completed_at is null)
      or (status in ('succeeded', 'failed')
        and approved_at is not null and executing_at is not null
        and execution_consumed_at is not null and completed_at is not null)
      or (status in ('expired', 'cancelled')
        and executing_at is null and execution_consumed_at is null
        and completed_at is not null)
    ),
  constraint wordpress_action_requests_result_check
    check (
      (result_post_id is null or (status = 'succeeded' and result_post_id > 0))
      and (failure_code is null or status = 'failed')
      and (failure_code is null or failure_code ~ '^[a-z0-9_]{1,64}$')
    )
);

comment on table public.wordpress_action_requests is
  'Owner-readable controlled-action metadata only. Protected title/content is stored in private.wordpress_action_payloads.';
comment on column public.wordpress_action_requests.execution_consumed_at is
  'Reserved for the later one-time execution claim. It remains null throughout Phase 1.';

create index if not exists wordpress_action_requests_user_created_idx
  on public.wordpress_action_requests (user_id, created_at desc);
create index if not exists wordpress_action_requests_connection_created_idx
  on public.wordpress_action_requests (connection_id, created_at desc);
create index if not exists wordpress_action_requests_active_expiry_idx
  on public.wordpress_action_requests (expires_at)
  where status in ('proposed', 'approved');

create table if not exists private.wordpress_action_payloads (
  action_id uuid primary key
    references public.wordpress_action_requests(id) on delete cascade,
  payload jsonb not null,
  payload_digest bytea not null,
  canonical_version smallint not null default 1,
  created_at timestamptz not null default now(),
  constraint wordpress_action_payloads_digest_check
    check (octet_length(payload_digest) = 32),
  constraint wordpress_action_payloads_version_check
    check (canonical_version = 1),
  constraint wordpress_action_payloads_shape_check
    check (
      jsonb_typeof(payload) = 'object'
      and payload ? 'title'
      and payload ? 'content'
      and (payload - 'title' - 'content') = '{}'::jsonb
      and jsonb_typeof(payload -> 'title') = 'string'
      and jsonb_typeof(payload -> 'content') = 'string'
      and length(payload ->> 'title') between 1 and 200
      and length(payload ->> 'content') between 1 and 100000
    )
);

comment on table private.wordpress_action_payloads is
  'Server-only exact proposed payload. Never grant browser roles access to this table or schema.';

create table if not exists public.wordpress_action_audit_events (
  id bigint generated always as identity primary key,
  action_id uuid not null
    references public.wordpress_action_requests(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  connection_id uuid not null
    references public.wordpress_site_connections(id) on delete restrict,
  action_type text not null,
  event_type text not null,
  actor_source text not null,
  occurred_at timestamptz not null default now(),
  safe_result_post_id bigint,
  failure_code text,
  constraint wordpress_action_audit_action_type_check
    check (action_type = 'create_post_draft'),
  constraint wordpress_action_audit_event_type_check
    check (event_type in (
      'proposed', 'approved', 'cancelled', 'expired',
      'execution_started', 'succeeded', 'failed'
    )),
  constraint wordpress_action_audit_actor_source_check
    check (actor_source in ('user', 'approved_ai', 'system')),
  constraint wordpress_action_audit_safe_result_check
    check (safe_result_post_id is null or safe_result_post_id > 0),
  constraint wordpress_action_audit_failure_code_check
    check (failure_code is null or failure_code ~ '^[a-z0-9_]{1,64}$')
);

comment on table public.wordpress_action_audit_events is
  'Append-only safe lifecycle events. No content, tokens, credentials, or secret material.';

create index if not exists wordpress_action_audit_user_occurred_idx
  on public.wordpress_action_audit_events (user_id, occurred_at desc);
create index if not exists wordpress_action_audit_action_occurred_idx
  on public.wordpress_action_audit_events (action_id, occurred_at);
create index if not exists wordpress_action_audit_connection_occurred_idx
  on public.wordpress_action_audit_events (connection_id, occurred_at desc);

create or replace function private.prevent_wordpress_action_audit_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'wordpress action audit events are append-only';
end
$function$;

drop trigger if exists wordpress_action_audit_append_only
  on public.wordpress_action_audit_events;
create trigger wordpress_action_audit_append_only
before update or delete on public.wordpress_action_audit_events
for each row execute function private.prevent_wordpress_action_audit_mutation();

revoke all on function private.prevent_wordpress_action_audit_mutation()
  from public, anon, authenticated;

alter table public.wordpress_action_requests enable row level security;
alter table public.wordpress_action_audit_events enable row level security;
alter table private.wordpress_action_payloads enable row level security;

drop policy if exists "Owners can read their WordPress action requests"
  on public.wordpress_action_requests;
create policy "Owners can read their WordPress action requests"
  on public.wordpress_action_requests
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Owners can read their WordPress action audit events"
  on public.wordpress_action_audit_events;
create policy "Owners can read their WordPress action audit events"
  on public.wordpress_action_audit_events
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all privileges on table public.wordpress_action_requests
  from public, anon, authenticated;
revoke all privileges on table public.wordpress_action_audit_events
  from public, anon, authenticated;
grant select on table public.wordpress_action_requests to authenticated;
grant select on table public.wordpress_action_audit_events to authenticated;
grant select, insert, update, delete on table public.wordpress_action_requests
  to service_role;
grant select, insert on table public.wordpress_action_audit_events
  to service_role;
grant usage, select on sequence public.wordpress_action_audit_events_id_seq
  to service_role;

revoke all privileges on schema private from public, anon, authenticated;
revoke all privileges on table private.wordpress_action_payloads
  from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on table private.wordpress_action_payloads
  to service_role;

create or replace function public.wp_manager_create_action_request(
  p_user_id uuid,
  p_connection_id uuid,
  p_action_type text,
  p_payload_digest bytea,
  p_payload jsonb,
  p_actor_source text,
  p_created_at timestamptz,
  p_expires_at timestamptz
)
returns public.wordpress_action_requests
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_connection public.wordpress_site_connections%rowtype;
  v_action public.wordpress_action_requests%rowtype;
begin
  if p_user_id is null
    or p_connection_id is null
    or p_action_type <> 'create_post_draft'
    or p_payload_digest is null
    or pg_catalog.octet_length(p_payload_digest) <> 32
    or p_payload is null
    or p_actor_source not in ('user', 'approved_ai')
    or p_created_at is null
    or p_expires_at <= p_created_at
    or p_expires_at > p_created_at + interval '1 hour'
  then
    return null;
  end if;

  select connection.*
  into v_connection
  from public.wordpress_site_connections as connection
  where connection.id = p_connection_id
    and connection.user_id = p_user_id
    and connection.status = 'connected'
    and connection.site_id is not null;

  if not found then
    return null;
  end if;

  insert into public.wordpress_action_requests (
    user_id, connection_id, site_id, site_url, action_type, status,
    payload_digest, actor_source, created_at, expires_at
  ) values (
    p_user_id, p_connection_id, v_connection.site_id, v_connection.site_url,
    p_action_type, 'proposed', p_payload_digest, p_actor_source,
    p_created_at, p_expires_at
  ) returning * into v_action;

  insert into private.wordpress_action_payloads (
    action_id, payload, payload_digest, canonical_version, created_at
  ) values (
    v_action.id, p_payload, p_payload_digest, 1, p_created_at
  );

  insert into public.wordpress_action_audit_events (
    action_id, user_id, connection_id, action_type,
    event_type, actor_source, occurred_at
  ) values (
    v_action.id, p_user_id, p_connection_id, p_action_type,
    'proposed', p_actor_source, p_created_at
  );

  return v_action;
end
$function$;

create or replace function public.wp_manager_get_action_payload(
  p_action_id uuid,
  p_user_id uuid
)
returns table (payload jsonb, payload_digest bytea)
language sql
security definer
set search_path = pg_catalog
stable
as $function$
  select protected.payload, protected.payload_digest
  from public.wordpress_action_requests as action
  join private.wordpress_action_payloads as protected
    on protected.action_id = action.id
  where action.id = p_action_id
    and action.user_id = p_user_id;
$function$;

create or replace function public.wp_manager_approve_action_request(
  p_action_id uuid,
  p_user_id uuid,
  p_payload_digest bytea,
  p_now timestamptz
)
returns table (outcome text, changed boolean, action_record jsonb)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_action public.wordpress_action_requests%rowtype;
begin
  select action.* into v_action
  from public.wordpress_action_requests as action
  where action.id = p_action_id and action.user_id = p_user_id
  for update;

  if not found then
    return query select 'not_found'::text, false, null::jsonb;
    return;
  end if;

  if v_action.payload_digest <> p_payload_digest then
    return query select 'invalid_state'::text, false, null::jsonb;
    return;
  end if;

  if v_action.expires_at <= p_now then
    if v_action.status in ('proposed', 'approved') then
      update public.wordpress_action_requests
      set status = 'expired', completed_at = p_now
      where id = v_action.id
      returning * into v_action;
      insert into public.wordpress_action_audit_events (
        action_id, user_id, connection_id, action_type,
        event_type, actor_source, occurred_at
      ) values (
        v_action.id, v_action.user_id, v_action.connection_id,
        v_action.action_type, 'expired', 'system', p_now
      );
    end if;
    return query select 'expired'::text, false, to_jsonb(v_action);
    return;
  end if;

  if v_action.status = 'approved' then
    return query select 'approved'::text, false, to_jsonb(v_action);
    return;
  end if;
  if v_action.status <> 'proposed' then
    return query select 'invalid_state'::text, false, to_jsonb(v_action);
    return;
  end if;

  update public.wordpress_action_requests
  set status = 'approved', approved_at = p_now
  where id = v_action.id
  returning * into v_action;

  insert into public.wordpress_action_audit_events (
    action_id, user_id, connection_id, action_type,
    event_type, actor_source, occurred_at
  ) values (
    v_action.id, v_action.user_id, v_action.connection_id,
    v_action.action_type, 'approved', 'user', p_now
  );

  return query select 'approved'::text, true, to_jsonb(v_action);
end
$function$;

create or replace function public.wp_manager_cancel_action_request(
  p_action_id uuid,
  p_user_id uuid,
  p_now timestamptz
)
returns table (outcome text, changed boolean, action_record jsonb)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_action public.wordpress_action_requests%rowtype;
begin
  select action.* into v_action
  from public.wordpress_action_requests as action
  where action.id = p_action_id and action.user_id = p_user_id
  for update;

  if not found then
    return query select 'not_found'::text, false, null::jsonb;
    return;
  end if;
  if v_action.expires_at <= p_now then
    if v_action.status in ('proposed', 'approved') then
      update public.wordpress_action_requests
      set status = 'expired', completed_at = p_now
      where id = v_action.id
      returning * into v_action;
      insert into public.wordpress_action_audit_events (
        action_id, user_id, connection_id, action_type,
        event_type, actor_source, occurred_at
      ) values (
        v_action.id, v_action.user_id, v_action.connection_id,
        v_action.action_type, 'expired', 'system', p_now
      );
    end if;
    return query select 'expired'::text, false, to_jsonb(v_action);
    return;
  end if;
  if v_action.status = 'cancelled' then
    return query select 'cancelled'::text, false, to_jsonb(v_action);
    return;
  end if;
  if v_action.status not in ('proposed', 'approved') then
    return query select 'invalid_state'::text, false, to_jsonb(v_action);
    return;
  end if;

  update public.wordpress_action_requests
  set status = 'cancelled', completed_at = p_now
  where id = v_action.id
  returning * into v_action;

  insert into public.wordpress_action_audit_events (
    action_id, user_id, connection_id, action_type,
    event_type, actor_source, occurred_at
  ) values (
    v_action.id, v_action.user_id, v_action.connection_id,
    v_action.action_type, 'cancelled', 'user', p_now
  );

  return query select 'cancelled'::text, true, to_jsonb(v_action);
end
$function$;

revoke all on function public.wp_manager_create_action_request(
  uuid, uuid, text, bytea, jsonb, text, timestamptz, timestamptz
) from public, anon, authenticated;
revoke all on function public.wp_manager_get_action_payload(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.wp_manager_approve_action_request(
  uuid, uuid, bytea, timestamptz
) from public, anon, authenticated;
revoke all on function public.wp_manager_cancel_action_request(
  uuid, uuid, timestamptz
) from public, anon, authenticated;

grant execute on function public.wp_manager_create_action_request(
  uuid, uuid, text, bytea, jsonb, text, timestamptz, timestamptz
) to service_role;
grant execute on function public.wp_manager_get_action_payload(uuid, uuid)
  to service_role;
grant execute on function public.wp_manager_approve_action_request(
  uuid, uuid, bytea, timestamptz
) to service_role;
grant execute on function public.wp_manager_cancel_action_request(
  uuid, uuid, timestamptz
) to service_role;
