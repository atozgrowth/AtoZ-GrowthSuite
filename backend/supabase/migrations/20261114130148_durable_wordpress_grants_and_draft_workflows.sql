-- Restored CLI-generated review proposal. No live application is authorized.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create schema if not exists private;
create table if not exists private.wordpress_draft_workflows (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 connection_id uuid not null references public.wordpress_site_connections(id),site_id uuid not null,site_url text not null,
 action_type text not null check(action_type in ('create_post_draft','create_page_draft','edit_draft')),
 status text not null default 'proposed' check(status in ('proposed','approved','executing','succeeded','failed','uncertain','cancelled','expired')),
 payload jsonb not null check(jsonb_typeof(payload)='object'),payload_digest bytea not null check(octet_length(payload_digest)=32),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 approved_at timestamptz,executing_at timestamptz,completed_at timestamptz,result_post_id bigint,failure_code text,check(expires_at>created_at)
);
create index if not exists wordpress_draft_owner_history on private.wordpress_draft_workflows(user_id,connection_id,created_at desc);
create table if not exists private.wordpress_draft_audit(id uuid primary key default gen_random_uuid(),action_id uuid not null references private.wordpress_draft_workflows(id),event_type text not null check(event_type in ('proposed','approved','executing','succeeded','failed','uncertain','cancelled','expired')),occurred_at timestamptz not null default clock_timestamp());
create table if not exists private.wordpress_operation_grants (
 digest bytea primary key check(octet_length(digest)=32),user_id uuid not null references auth.users(id) on delete cascade,
 connection_id uuid not null references public.wordpress_site_connections(id),site_id uuid not null,site_url text not null,
 scope text not null check(scope in ('inspection','posts','pages','media','plugins','themes','draft_read','draft_execute','draft_receipt')),
 page integer,per_page integer,post_id bigint,action_id uuid references private.wordpress_draft_workflows(id),payload_digest bytea,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,consumed_at timestamptz,
 check(expires_at>created_at),check(payload_digest is null or octet_length(payload_digest)=32)
);
create index if not exists wordpress_grant_expiry on private.wordpress_operation_grants(expires_at);
alter table private.wordpress_draft_workflows enable row level security;
alter table private.wordpress_draft_audit enable row level security;
alter table private.wordpress_operation_grants enable row level security;
revoke all on private.wordpress_draft_workflows,private.wordpress_draft_audit,private.wordpress_operation_grants from public,anon,authenticated,service_role;
grant usage on schema private to service_role;
grant select,insert,update on private.wordpress_draft_workflows,private.wordpress_operation_grants to service_role;
grant select,insert on private.wordpress_draft_audit to service_role;
create or replace function public.wp_manager_issue_operation_grant(p_user_id uuid,p_connection_id uuid,p_scope text,p_digest bytea,p_expires_at timestamptz,p_page integer default null,p_per_page integer default null,p_post_id bigint default null,p_action_id uuid default null,p_payload_digest bytea default null)
 returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare c public.wordpress_site_connections;a private.wordpress_draft_workflows;
begin
 select * into c from public.wordpress_site_connections where id=p_connection_id and user_id=p_user_id and status='connected' and site_id is not null for share;
 if not found or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '60 seconds' or octet_length(p_digest)<>32 then return false;end if;
 if p_page is not null and (p_page<1 or p_page>1000000) then return false;end if;
 if p_per_page is not null and (p_per_page<1 or p_per_page>50) then return false;end if;
 if p_scope in ('posts','pages','media') and (p_page is null or p_per_page is null) then return false;end if;
 if p_scope not in ('posts','pages','media') and (p_page is not null or p_per_page is not null) then return false;end if;
 if p_scope in ('draft_execute','draft_receipt') then
  select * into a from private.wordpress_draft_workflows where id=p_action_id and user_id=p_user_id and connection_id=c.id and ((p_scope='draft_execute' and status='executing' and expires_at>clock_timestamp()) or (p_scope='draft_receipt' and status in ('executing','uncertain'))) and payload_digest=p_payload_digest for share;
  if not found or a.site_id<>c.site_id or a.site_url<>c.site_url then return false;end if;
 elsif p_scope='draft_read' then if p_post_id is null or p_post_id<=0 then return false;end if;
 elsif p_scope not in ('inspection','posts','pages','media','plugins','themes') then return false;end if;
 insert into private.wordpress_operation_grants(digest,user_id,connection_id,site_id,site_url,scope,page,per_page,post_id,action_id,payload_digest,expires_at) values(p_digest,p_user_id,c.id,c.site_id,c.site_url,p_scope,p_page,p_per_page,p_post_id,p_action_id,p_payload_digest,p_expires_at);return true;
end $$;
create or replace function public.wp_manager_consume_operation_grant(p_digest bytea,p_site_id uuid,p_site_url text,p_scope text,p_page integer default null,p_per_page integer default null,p_post_id bigint default null,p_action_id uuid default null,p_payload_digest bytea default null,p_action_type text default null)
 returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare used bytea;
begin
 update private.wordpress_operation_grants g set consumed_at=clock_timestamp() from public.wordpress_site_connections c
 where g.digest=p_digest and g.consumed_at is null and g.expires_at>clock_timestamp() and g.site_id=p_site_id and g.site_url=p_site_url and g.scope=p_scope
 and g.page is not distinct from p_page and g.per_page is not distinct from p_per_page and g.post_id is not distinct from p_post_id and g.action_id is not distinct from p_action_id and g.payload_digest is not distinct from p_payload_digest
 and c.id=g.connection_id and c.user_id=g.user_id and c.status='connected' and c.site_id=g.site_id and c.site_url=g.site_url
 and (p_scope not in ('draft_execute','draft_receipt') or exists(select 1 from private.wordpress_draft_workflows a where a.id=g.action_id and a.user_id=g.user_id and a.connection_id=g.connection_id and ((p_scope='draft_execute' and a.status='executing' and a.expires_at>clock_timestamp()) or (p_scope='draft_receipt' and a.status in ('executing','uncertain'))) and a.action_type=p_action_type and a.payload_digest=g.payload_digest))
 returning g.digest into used;return used is not null;
end $$;
create or replace function public.wp_manager_revoke_operation_grant(p_digest bytea) returns void language sql security definer set search_path=pg_catalog as $$update private.wordpress_operation_grants set consumed_at=coalesce(consumed_at,clock_timestamp()) where digest=p_digest;$$;
create or replace function public.wp_manager_create_draft_workflow(p_user_id uuid,p_connection_id uuid,p_action_type text,p_payload jsonb,p_payload_digest bytea)
 returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.wordpress_site_connections;a private.wordpress_draft_workflows;
begin
 select * into c from public.wordpress_site_connections where id=p_connection_id and user_id=p_user_id and status='connected' and site_id is not null for share;
 if not found or p_action_type not in ('create_post_draft','create_page_draft','edit_draft') or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload_digest)<>32 then return null;end if;
 insert into private.wordpress_draft_workflows(user_id,connection_id,site_id,site_url,action_type,payload,payload_digest,expires_at) values(p_user_id,c.id,c.site_id,c.site_url,p_action_type,p_payload,p_payload_digest,clock_timestamp()+interval '15 minutes') returning * into a;
 insert into private.wordpress_draft_audit(action_id,event_type) values(a.id,'proposed');return to_jsonb(a);
end $$;
create or replace function public.wp_manager_get_draft_workflow(p_user_id uuid,p_action_id uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as $$select to_jsonb(a) from private.wordpress_draft_workflows a where id=p_action_id and user_id=p_user_id;$$;
create or replace function public.wp_manager_list_draft_workflows(p_user_id uuid,p_connection_id uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as $$select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]'::jsonb) from(select * from private.wordpress_draft_workflows where user_id=p_user_id and connection_id=p_connection_id order by created_at desc limit 100)a;$$;
create or replace function public.wp_manager_transition_draft_workflow(p_user_id uuid,p_action_id uuid,p_payload_digest bytea,p_transition text,p_result_post_id bigint default null,p_failure_code text default null)
 returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a private.wordpress_draft_workflows;c public.wordpress_site_connections;
begin
 select * into a from private.wordpress_draft_workflows where id=p_action_id and user_id=p_user_id for update;
 if not found or a.payload_digest<>p_payload_digest then return null;end if;
 if p_transition in ('approved','executing') then
  select * into c from public.wordpress_site_connections where id=a.connection_id and user_id=p_user_id and status='connected' and site_id=a.site_id and site_url=a.site_url for share;
  if not found then return null;end if;
  if a.expires_at<=clock_timestamp() then
   if a.status in ('proposed','approved') then update private.wordpress_draft_workflows set status='expired' where id=a.id;insert into private.wordpress_draft_audit(action_id,event_type)values(a.id,'expired');end if;return null;
  end if;
 end if;
 if p_transition='approved' and a.status='proposed' then update private.wordpress_draft_workflows set status='approved',approved_at=clock_timestamp() where id=a.id returning * into a;
 elsif p_transition='executing' and a.status='approved' then update private.wordpress_draft_workflows set status='executing',executing_at=clock_timestamp() where id=a.id returning * into a;
 elsif p_transition in ('succeeded','failed','uncertain') and (a.status='executing' or (p_transition='succeeded' and a.status='uncertain')) then
  if p_transition='succeeded' and(p_result_post_id is null or p_result_post_id<=0)then return null;end if;
  if p_failure_code is not null and p_failure_code not in ('wordpress_rejected','verification_failed','execution_uncertain','transport_failed')then return null;end if;
  update private.wordpress_draft_workflows set status=p_transition,completed_at=clock_timestamp(),result_post_id=p_result_post_id,failure_code=p_failure_code where id=a.id returning * into a;
 else return null;end if;
 insert into private.wordpress_draft_audit(action_id,event_type)values(a.id,a.status);return to_jsonb(a);
end $$;
revoke all on function public.wp_manager_issue_operation_grant(uuid,uuid,text,bytea,timestamptz,integer,integer,bigint,uuid,bytea) from public,anon,authenticated;
revoke all on function public.wp_manager_consume_operation_grant(bytea,uuid,text,text,integer,integer,bigint,uuid,bytea,text) from public,anon,authenticated;
revoke all on function public.wp_manager_revoke_operation_grant(bytea) from public,anon,authenticated;
revoke all on function public.wp_manager_create_draft_workflow(uuid,uuid,text,jsonb,bytea) from public,anon,authenticated;
revoke all on function public.wp_manager_get_draft_workflow(uuid,uuid) from public,anon,authenticated;
revoke all on function public.wp_manager_list_draft_workflows(uuid,uuid) from public,anon,authenticated;
revoke all on function public.wp_manager_transition_draft_workflow(uuid,uuid,bytea,text,bigint,text) from public,anon,authenticated;
grant execute on function public.wp_manager_issue_operation_grant(uuid,uuid,text,bytea,timestamptz,integer,integer,bigint,uuid,bytea) to service_role;
grant execute on function public.wp_manager_consume_operation_grant(bytea,uuid,text,text,integer,integer,bigint,uuid,bytea,text) to service_role;
grant execute on function public.wp_manager_revoke_operation_grant(bytea) to service_role;
grant execute on function public.wp_manager_create_draft_workflow(uuid,uuid,text,jsonb,bytea) to service_role;
grant execute on function public.wp_manager_get_draft_workflow(uuid,uuid) to service_role;
grant execute on function public.wp_manager_list_draft_workflows(uuid,uuid) to service_role;
grant execute on function public.wp_manager_transition_draft_workflow(uuid,uuid,bytea,text,bigint,text) to service_role;
commit;
