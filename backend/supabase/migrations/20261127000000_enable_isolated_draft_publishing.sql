-- Review-only migration: exact-approval publishing is usable only in the isolated
-- disposable test fixture. The server and plugin require separate explicit gates.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table private.wordpress_draft_workflows
  drop constraint if exists wordpress_draft_workflows_action_type_check;
alter table private.wordpress_draft_workflows
  add constraint wordpress_draft_workflows_action_type_check
  check(action_type in ('create_post_draft','create_page_draft','edit_draft','publish_draft'));

alter table private.wordpress_operation_grants
  drop constraint if exists wordpress_operation_grants_scope_check;
alter table private.wordpress_operation_grants
  add constraint wordpress_operation_grants_scope_check
  check(scope in ('inspection','posts','pages','media','plugins','themes','draft_read','draft_execute','draft_receipt','published_read'));

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
 if p_scope in ('draft_execute','draft_receipt','published_read') then
  select * into a from private.wordpress_draft_workflows where id=p_action_id and user_id=p_user_id and connection_id=c.id and ((p_scope='draft_execute' and status='executing' and expires_at>clock_timestamp()) or (p_scope in ('draft_receipt','published_read') and status in ('executing','uncertain'))) and payload_digest=p_payload_digest and ((p_scope='published_read' and action_type='publish_draft') or (p_scope<>'published_read' and action_type in ('create_post_draft','create_page_draft','edit_draft','publish_draft'))) for share;
  if not found or a.site_id<>c.site_id or a.site_url<>c.site_url then return false;end if;
  if p_scope='published_read' and (p_post_id is null or p_post_id<=0 or a.payload->>'post_id'<>p_post_id::text or p_payload_digest is null or octet_length(p_payload_digest)<>32) then return false;end if;
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
 and (p_scope not in ('draft_execute','draft_receipt','published_read') or exists(select 1 from private.wordpress_draft_workflows a where a.id=g.action_id and a.user_id=g.user_id and a.connection_id=g.connection_id and ((p_scope='draft_execute' and a.status='executing' and a.expires_at>clock_timestamp()) or (p_scope in ('draft_receipt','published_read') and a.status in ('executing','uncertain'))) and a.action_type=p_action_type and (p_scope<>'published_read' or a.action_type='publish_draft') and a.payload_digest=g.payload_digest))
 returning g.digest into used;return used is not null;
end $$;

create or replace function public.wp_manager_create_draft_workflow(p_user_id uuid,p_connection_id uuid,p_action_type text,p_payload jsonb,p_payload_digest bytea)
 returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.wordpress_site_connections;a private.wordpress_draft_workflows;
begin
 select * into c from public.wordpress_site_connections where id=p_connection_id and user_id=p_user_id and status='connected' and site_id is not null for share;
 if not found or p_action_type not in ('create_post_draft','create_page_draft','edit_draft','publish_draft') or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload_digest)<>32 then return null;end if;
 insert into private.wordpress_draft_workflows(user_id,connection_id,site_id,site_url,action_type,payload,payload_digest,expires_at) values(p_user_id,c.id,c.site_id,c.site_url,p_action_type,p_payload,p_payload_digest,clock_timestamp()+interval '15 minutes') returning * into a;
 insert into private.wordpress_draft_audit(action_id,event_type) values(a.id,'proposed');return to_jsonb(a);
end $$;

revoke all on function public.wp_manager_issue_operation_grant(uuid,uuid,text,bytea,timestamptz,integer,integer,bigint,uuid,bytea) from public,anon,authenticated;
revoke all on function public.wp_manager_consume_operation_grant(bytea,uuid,text,text,integer,integer,bigint,uuid,bytea,text) from public,anon,authenticated;
revoke all on function public.wp_manager_create_draft_workflow(uuid,uuid,text,jsonb,bytea) from public,anon,authenticated;
grant execute on function public.wp_manager_issue_operation_grant(uuid,uuid,text,bytea,timestamptz,integer,integer,bigint,uuid,bytea) to service_role;
grant execute on function public.wp_manager_consume_operation_grant(bytea,uuid,text,text,integer,integer,bigint,uuid,bytea,text) to service_role;
grant execute on function public.wp_manager_create_draft_workflow(uuid,uuid,text,jsonb,bytea) to service_role;
commit;
