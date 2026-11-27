-- Review-only: durable per-tenant model usage reservations and quotas.
-- No quota rows are seeded; model calls remain unavailable until explicitly provisioned.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table private.wordpress_operation_grants
 drop constraint if exists wordpress_operation_grants_scope_check;
alter table private.wordpress_operation_grants
 add constraint wordpress_operation_grants_scope_check
 check(scope in ('inspection','posts','pages','media','plugins','themes','draft_read','draft_execute','draft_receipt','published_read','categories','tags'));

create or replace function public.wp_manager_issue_operation_grant(p_user_id uuid,p_connection_id uuid,p_scope text,p_digest bytea,p_expires_at timestamptz,p_page integer default null,p_per_page integer default null,p_post_id bigint default null,p_action_id uuid default null,p_payload_digest bytea default null)
 returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare c public.wordpress_site_connections;a private.wordpress_draft_workflows;
begin
 select * into c from public.wordpress_site_connections where id=p_connection_id and user_id=p_user_id and status='connected' and site_id is not null for share;
 if not found or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '60 seconds' or octet_length(p_digest)<>32 then return false;end if;
 if p_page is not null and (p_page<1 or p_page>1000000) then return false;end if;
 if p_per_page is not null and (p_per_page<1 or p_per_page>50) then return false;end if;
 if p_scope in ('posts','pages','media','categories','tags') and (p_page is null or p_per_page is null) then return false;end if;
 if p_scope not in ('posts','pages','media','categories','tags') and (p_page is not null or p_per_page is not null) then return false;end if;
 if p_scope in ('draft_execute','draft_receipt','published_read') then
  select * into a from private.wordpress_draft_workflows where id=p_action_id and user_id=p_user_id and connection_id=c.id and ((p_scope='draft_execute' and status='executing' and expires_at>clock_timestamp()) or (p_scope in ('draft_receipt','published_read') and status in ('executing','uncertain'))) and payload_digest=p_payload_digest and ((p_scope='published_read' and action_type='publish_draft') or (p_scope<>'published_read' and action_type in ('create_post_draft','create_page_draft','edit_draft','publish_draft'))) for share;
  if not found or a.site_id<>c.site_id or a.site_url<>c.site_url then return false;end if;
  if p_scope='published_read' and (p_post_id is null or p_post_id<=0 or a.payload->>'post_id'<>p_post_id::text or p_payload_digest is null or octet_length(p_payload_digest)<>32) then return false;end if;
 elsif p_scope='draft_read' then if p_post_id is null or p_post_id<=0 then return false;end if;
 elsif p_scope not in ('inspection','posts','pages','media','plugins','themes','categories','tags') then return false;end if;
 insert into private.wordpress_operation_grants(digest,user_id,connection_id,site_id,site_url,scope,page,per_page,post_id,action_id,payload_digest,expires_at) values(p_digest,p_user_id,c.id,c.site_id,c.site_url,p_scope,p_page,p_per_page,p_post_id,p_action_id,p_payload_digest,p_expires_at);return true;
end $$;
revoke all on function public.wp_manager_issue_operation_grant(uuid,uuid,text,bytea,timestamptz,integer,integer,bigint,uuid,bytea) from public,anon,authenticated;
grant execute on function public.wp_manager_issue_operation_grant(uuid,uuid,text,bytea,timestamptz,integer,integer,bigint,uuid,bytea) to service_role;

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
   if a.status in ('proposed','approved') then update private.wordpress_draft_workflows set status='expired',completed_at=clock_timestamp() where id=a.id;insert into private.wordpress_draft_audit(action_id,event_type)values(a.id,'expired');end if;return null;
  end if;
 end if;
 if p_transition='approved' and a.status='proposed' then update private.wordpress_draft_workflows set status='approved',approved_at=clock_timestamp() where id=a.id returning * into a;
 elsif p_transition='executing' and a.status='approved' then update private.wordpress_draft_workflows set status='executing',executing_at=clock_timestamp() where id=a.id returning * into a;
 elsif p_transition='cancelled' and a.status in ('proposed','approved') and a.expires_at>clock_timestamp() then update private.wordpress_draft_workflows set status='cancelled',completed_at=clock_timestamp() where id=a.id returning * into a;
 elsif p_transition in ('succeeded','failed','uncertain') and (a.status='executing' or (p_transition='succeeded' and a.status='uncertain')) then
  if p_transition='succeeded' and (p_result_post_id is null or p_result_post_id<=0) then return null;end if;
  if p_failure_code is not null and p_failure_code not in ('wordpress_rejected','verification_failed','execution_uncertain','transport_failed') then return null;end if;
  update private.wordpress_draft_workflows set status=p_transition,completed_at=clock_timestamp(),result_post_id=p_result_post_id,failure_code=p_failure_code where id=a.id returning * into a;
 else return null;end if;
 insert into private.wordpress_draft_audit(action_id,event_type) values(a.id,a.status);return to_jsonb(a);
end $$;
revoke all on function public.wp_manager_transition_draft_workflow(uuid,uuid,bytea,text,bigint,text) from public,anon,authenticated;
grant execute on function public.wp_manager_transition_draft_workflow(uuid,uuid,bytea,text,bigint,text) to service_role;

create table private.wordpress_ai_tenant_quotas (
 user_id uuid primary key references auth.users(id) on delete cascade,
 monthly_limit_micros numeric(24,0) not null check(monthly_limit_micros>=0),
 per_request_limit_micros numeric(24,0) not null check(per_request_limit_micros>=0),
 max_requests_per_minute integer not null check(max_requests_per_minute between 1 and 120),
 enabled boolean not null default true,
 updated_at timestamptz not null default clock_timestamp()
);

create table private.wordpress_ai_usage (
 request_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 connection_id uuid not null,
 provider text not null check(provider='openai-responses'),
 model text not null check(length(model) between 1 and 80),
 reserved_input_tokens integer not null check(reserved_input_tokens between 1 and 32768),
 reserved_output_tokens integer not null check(reserved_output_tokens between 1 and 8192),
 input_rate_micros_per_million numeric(24,0) not null check(input_rate_micros_per_million>=0),
 output_rate_micros_per_million numeric(24,0) not null check(output_rate_micros_per_million>=0),
 reserved_cost_micros numeric(24,0) not null check(reserved_cost_micros>=0),
 reported_input_tokens integer,
 reported_output_tokens integer,
 charged_cost_micros numeric(24,0) not null default 0 check(charged_cost_micros>=0),
 outcome text not null check(outcome in ('reserved','settled','unknown','no_charge')),
 created_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 check((reported_input_tokens is null and reported_output_tokens is null) or
       (reported_input_tokens between 0 and reserved_input_tokens and reported_output_tokens between 0 and reserved_output_tokens))
);
create index wordpress_ai_usage_monthly on private.wordpress_ai_usage(user_id,created_at);
create index wordpress_ai_usage_rate on private.wordpress_ai_usage(user_id,created_at desc);

alter table private.wordpress_ai_tenant_quotas enable row level security;
alter table private.wordpress_ai_usage enable row level security;
revoke all on private.wordpress_ai_tenant_quotas,private.wordpress_ai_usage from public,anon,authenticated,service_role;
grant usage on schema private to service_role;

create or replace function public.wp_manager_reserve_ai_usage(
 p_user_id uuid,p_connection_id uuid,p_request_id uuid,p_provider text,p_model text,
 p_input_tokens integer,p_output_tokens integer,p_input_rate numeric,p_output_rate numeric
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare q private.wordpress_ai_tenant_quotas; cost numeric; spent numeric; month_start timestamptz;
begin
 if p_user_id is null or p_connection_id is null or p_request_id is null or p_provider<>'openai-responses' or
    p_model is null or p_model !~ '^[A-Za-z0-9._-]{1,80}$' or
    p_input_tokens not between 1 and 32768 or p_output_tokens not between 1 and 8192 or
    p_input_tokens+p_output_tokens>40960 or p_input_rate<0 or p_input_rate>1000000000000 or p_output_rate<0 or p_output_rate>1000000000000 then return false;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
 select * into q from private.wordpress_ai_tenant_quotas where user_id=p_user_id and enabled for update;
 if not found then return false;end if;
 if not exists(select 1 from public.wordpress_site_connections c where c.id=p_connection_id and c.user_id=p_user_id and c.status='connected' and c.site_id is not null) then return false;end if;
 if exists(select 1 from private.wordpress_ai_usage where request_id=p_request_id) then return false;end if;
 if (select count(*) from private.wordpress_ai_usage where user_id=p_user_id and created_at>clock_timestamp()-interval '1 minute') >= q.max_requests_per_minute then return false;end if;
 cost:=ceil((p_input_tokens::numeric*p_input_rate+p_output_tokens::numeric*p_output_rate)/1000000);
 if cost>q.per_request_limit_micros then return false;end if;
 month_start:=date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
 select coalesce(sum(case when outcome='settled' then charged_cost_micros when outcome='no_charge' then 0 else reserved_cost_micros end),0)
 into spent from private.wordpress_ai_usage where user_id=p_user_id and created_at>=month_start;
 if spent+cost>q.monthly_limit_micros then return false;end if;
 insert into private.wordpress_ai_usage(request_id,user_id,connection_id,provider,model,reserved_input_tokens,reserved_output_tokens,input_rate_micros_per_million,output_rate_micros_per_million,reserved_cost_micros,outcome)
 values(p_request_id,p_user_id,p_connection_id,p_provider,p_model,p_input_tokens,p_output_tokens,p_input_rate,p_output_rate,cost,'reserved');
 return true;
end $$;

create or replace function public.wp_manager_settle_ai_usage(
 p_user_id uuid,p_request_id uuid,p_outcome text,p_input_tokens integer default null,p_output_tokens integer default null
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare u private.wordpress_ai_usage; charge numeric;
begin
 if p_outcome not in ('settled','unknown','no_charge') then return false;end if;
 select * into u from private.wordpress_ai_usage where request_id=p_request_id and user_id=p_user_id and outcome='reserved' for update;
 if not found then return false;end if;
 if p_outcome='settled' then
  if p_input_tokens is null or p_output_tokens is null or p_input_tokens<0 or p_output_tokens<0 or p_input_tokens>u.reserved_input_tokens or p_output_tokens>u.reserved_output_tokens then return false;end if;
  charge:=ceil((p_input_tokens::numeric*u.input_rate_micros_per_million+p_output_tokens::numeric*u.output_rate_micros_per_million)/1000000);
  if charge>u.reserved_cost_micros then return false;end if;
 elsif p_input_tokens is not null or p_output_tokens is not null then return false;
 elsif p_outcome='unknown' then charge:=u.reserved_cost_micros;
 else charge:=0;
 end if;
 update private.wordpress_ai_usage set outcome=p_outcome,reported_input_tokens=p_input_tokens,reported_output_tokens=p_output_tokens,charged_cost_micros=charge,completed_at=clock_timestamp()
 where request_id=p_request_id and outcome='reserved';
 return found;
end $$;

revoke all on function public.wp_manager_reserve_ai_usage(uuid,uuid,uuid,text,text,integer,integer,numeric,numeric) from public,anon,authenticated;
revoke all on function public.wp_manager_settle_ai_usage(uuid,uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.wp_manager_reserve_ai_usage(uuid,uuid,uuid,text,text,integer,integer,numeric,numeric) to service_role;
grant execute on function public.wp_manager_settle_ai_usage(uuid,uuid,text,integer,integer) to service_role;
grant select,insert,update on private.wordpress_ai_tenant_quotas,private.wordpress_ai_usage to service_role;
commit;
