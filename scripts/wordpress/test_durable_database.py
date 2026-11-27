"""Disposable local PostgreSQL only. No DSN, remote Docker, Supabase or live credentials."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
ROOT=Path(__file__).resolve().parents[2]
DOCKER=['docker','--host=unix:///var/run/docker.sock']
NAME='atoz-draft-db-'+str(os.getpid())
USER='10000000-0000-4000-8000-000000000001'
OTHER='10000000-0000-4000-8000-000000000002'
CONNECTION='20000000-0000-4000-8000-000000000001'
CONNECTION_OTHER='20000000-0000-4000-8000-000000000002'
SITE='30000000-0000-4000-8000-000000000001'
SITE_OTHER='30000000-0000-4000-8000-000000000002'
URL='https://one.example.test'
def run(args,**kwargs):
 return subprocess.run(DOCKER+args,capture_output=True,text=True,check=True,**kwargs).stdout.strip()
def query(sql):
 return run(['exec','-i',NAME,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','fixture'],input=sql)
def denied(sql):
 r=subprocess.run(DOCKER+['exec','-i',NAME,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','fixture'],input=sql,text=True,capture_output=True)
 assert r.returncode and 'permission denied' in r.stderr
H=lambda s:hashlib.sha256(s.encode()).hexdigest()
def issue(label,scope='inspection',extra=''):
 d=H(label)
 assert query(f"select public.wp_manager_issue_operation_grant('{USER}','{CONNECTION}','{scope}',decode('{d}','hex'),clock_timestamp()+interval '30 seconds'{extra});")=='t'
 return d
def consume(d,scope='inspection',extra=''):
 return f"select public.wp_manager_consume_operation_grant(decode('{d}','hex'),'{SITE}','{URL}','{scope}'{extra});"
try:
 run(['run','-d','--name',NAME,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_PASSWORD=synthetic-only','-e','POSTGRES_DB=fixture','postgres:17-alpine'])
 for attempt in range(30):
  try:query('select 1;');break
  except subprocess.CalledProcessError:
   if attempt==29:raise
   time.sleep(1)
 query(f"create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;insert into auth.users values('{USER}'),('{OTHER}');")
 migrations=sorted((ROOT/'backend/supabase/migrations').glob('*.sql'))
 for m in migrations:query(m.read_text())
 query(f"insert into public.wordpress_site_connections(id,user_id,site_url,site_id,status,connected_at) values('{CONNECTION}','{USER}','{URL}','{SITE}','connected',clock_timestamp());")
 query(f"insert into public.wordpress_site_connections(id,user_id,site_url,site_id,status,connected_at) values('{CONNECTION_OTHER}','{OTHER}','https://two.example.test','{SITE_OTHER}','connected',clock_timestamp());")
 query(f"insert into private.wordpress_ai_tenant_quotas(user_id,monthly_limit_micros,per_request_limit_micros,max_requests_per_minute) values('{USER}',5000,3000,20);")
 query(f"insert into private.wordpress_ai_tenant_quotas(user_id,monthly_limit_micros,per_request_limit_micros,max_requests_per_minute) values('{OTHER}',10000,3000,1);")
 reserve_sql=lambda rid,owner=USER,conn=CONNECTION,inp=1000,out=1000:f"select public.wp_manager_reserve_ai_usage('{owner}','{conn}','{rid}','openai-responses','reviewed-model',{inp},{out},1000000,2000000);"
 settle_sql=lambda rid,outcome='settled',inp=100,out=100:f"select public.wp_manager_settle_ai_usage('{USER}','{rid}','{outcome}',{inp if outcome=='settled' else 'null'},{out if outcome=='settled' else 'null'});"
 ai_a='40000000-0000-4000-8000-000000000001';ai_b='40000000-0000-4000-8000-000000000002';ai_c='40000000-0000-4000-8000-000000000003'
 assert query(reserve_sql(ai_a))=='t'
 assert query(reserve_sql(ai_a))=='f' # idempotent request reservation
 assert query(reserve_sql(ai_b))=='f' # tenant monthly reserve cap
 assert query(settle_sql(ai_a))=='t' and query(settle_sql(ai_a))=='f'
 assert query(reserve_sql(ai_c))=='t' # settlement releases unused reservation using reported usage
 assert query(settle_sql(ai_c,'no_charge'))=='t'
 ai_d='40000000-0000-4000-8000-000000000004';ai_e='40000000-0000-4000-8000-000000000005'
 query(f"update private.wordpress_ai_tenant_quotas set monthly_limit_micros=3300,per_request_limit_micros=3000 where user_id='{USER}';")
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  reservations=list(pool.map(query,[reserve_sql(ai_d),reserve_sql(ai_e)]))
 assert sorted(reservations)==['f','t'] # serialized concurrent tenant spend reservations
 assert query(f"select public.wp_manager_reserve_ai_usage('{OTHER}','{CONNECTION}','40000000-0000-4000-8000-000000000006','openai-responses','reviewed-model',1000,1000,1000000,2000000);")== 'f'
 assert query(f"select public.wp_manager_reserve_ai_usage('{OTHER}','{CONNECTION_OTHER}','40000000-0000-4000-8000-000000000008','openai-responses','reviewed-model',1000,1000,1000000,2000000);")== 't'
 assert query(f"select public.wp_manager_reserve_ai_usage('{OTHER}','{CONNECTION_OTHER}','40000000-0000-4000-8000-000000000009','openai-responses','reviewed-model',1000,1000,1000000,2000000);")== 'f' # per-tenant requests/minute
 assert query(f"select public.wp_manager_reserve_ai_usage('{USER}','{CONNECTION}','40000000-0000-4000-8000-000000000007','openai-responses','reviewed-model',32769,1000,1000000,2000000);")== 'f'
 d=issue('single')
 assert query(consume(d).replace(URL,'https://foreign.example.test'))=='f'
 assert query(consume(d))=='t' and query(consume(d))=='f'
 d=issue('concurrent')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  assert sorted(pool.map(query,[consume(d),consume(d)]))==['f','t']
 d=issue('terms','categories',',1,20')
 assert query(consume(d,'categories',',1,20'))=='t' and query(consume(d,'tags',',1,20'))=='f'
 d=issue('revoked');query(f"update public.wordpress_site_connections set status='revoked',revoked_at=clock_timestamp() where id='{CONNECTION}';")
 assert query(consume(d))=='f'
 query(f"update public.wordpress_site_connections set status='connected',revoked_at=null where id='{CONNECTION}';")
 assert query(f"select public.wp_manager_issue_operation_grant('{OTHER}','{CONNECTION}','inspection',decode('{H('foreign')}','hex'),clock_timestamp()+interval '30 seconds');")=='f'
 assert query(f"select public.wp_manager_issue_operation_grant('{USER}','{CONNECTION}','inspection',decode('{H('long')}','hex'),clock_timestamp()+interval '5 minutes');")=='f'
 d=issue('expired');query(f"update private.wordpress_operation_grants set created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' where digest=decode('{d}','hex');")
 assert query(consume(d))=='f'
 payload={'title':'Synthetic title','content':'<p>Safe synthetic content</p>'}
 encoded=json.dumps(payload,separators=(',',':'));ph=H(encoded)
 action=json.loads(query(f"select public.wp_manager_create_draft_workflow('{USER}','{CONNECTION}','create_post_draft','{encoded}'::jsonb,decode('{ph}','hex'));"));aid=action['id']
 assert query(f"select public.wp_manager_get_draft_workflow('{OTHER}','{aid}');")==''
 transition=lambda state,digest=ph:f"select public.wp_manager_transition_draft_workflow('{USER}','{aid}',decode('{digest}','hex'),'{state}');"
 assert query(transition('executing'))==''
 assert query(transition('approved',H('tamper'))) == ''
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  results=list(pool.map(query,[transition('approved'),transition('approved')]))
 assert sum(bool(r) for r in results)==1
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  results=list(pool.map(query,[transition('executing'),transition('executing')]))
 assert sum(bool(r) for r in results)==1
 d=issue('execution','draft_execute',f",null,null,null,'{aid}',decode('{ph}','hex')")
 good=consume(d,'draft_execute',f",null,null,null,'{aid}',decode('{ph}','hex'),'create_post_draft'")
 assert query(good.replace("'create_post_draft'","'create_page_draft'"))=='f'
 assert query(good)=='t' and query(good)=='f'
 assert json.loads(query(transition('succeeded').replace("'succeeded');","'succeeded',12);")))['status']=='succeeded'
 assert query(transition('executing'))==''
 assert query(f"select string_agg(event_type,',' order by occurred_at) from private.wordpress_draft_audit where action_id='{aid}';")=='proposed,approved,executing,succeeded'
 cancel_action=json.loads(query(f"select public.wp_manager_create_draft_workflow('{USER}','{CONNECTION}','create_post_draft','{encoded}'::jsonb,decode('{ph}','hex'));"));cancel_id=cancel_action['id']
 assert json.loads(query(f"select public.wp_manager_transition_draft_workflow('{USER}','{cancel_id}',decode('{ph}','hex'),'cancelled');"))['status']=='cancelled'
 assert query(f"select public.wp_manager_transition_draft_workflow('{USER}','{cancel_id}',decode('{ph}','hex'),'approved');")==''
 assert query(f"select string_agg(event_type,',' order by occurred_at) from private.wordpress_draft_audit where action_id='{cancel_id}';")=='proposed,cancelled'
 for table in ['wordpress_operation_grants','wordpress_draft_workflows','wordpress_draft_audit','wordpress_ai_tenant_quotas','wordpress_ai_usage']:
  assert query(f"select relrowsecurity from pg_class where oid='private.{table}'::regclass;")=='t'
  denied(f'set role authenticated;select * from private.{table};')
 for fn in ['wp_manager_issue_operation_grant','wp_manager_consume_operation_grant','wp_manager_revoke_operation_grant','wp_manager_create_draft_workflow','wp_manager_get_draft_workflow','wp_manager_list_draft_workflows','wp_manager_transition_draft_workflow','wp_manager_reserve_ai_usage','wp_manager_settle_ai_usage']:
  assert query(f"select bool_and(not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('authenticated',oid,'EXECUTE') and has_function_privilege('service_role',oid,'EXECUTE') and prosecdef and 'search_path=pg_catalog'=any(proconfig)) from pg_proc where proname='{fn}';")=='t'
 # Reapplying the new review proposal must preserve completed history and receipts.
 query((ROOT/'backend/supabase/migrations/20261114130148_durable_wordpress_grants_and_draft_workflows.sql').read_text())
 assert json.loads(query(f"select public.wp_manager_get_draft_workflow('{USER}','{aid}');"))['status']=='succeeded'
 print(json.dumps({'postgres_version':17,'migrations':len(migrations),'durable_single_use':True,'concurrent_consumption_and_claim':True,'action_type_tamper_denied':True,'owner_revocation_expiry_and_replay':True,'proposal_cancellation_audit':True,'private_rls_and_service_rpc':True,'durable_ai_reservations_and_tenant_quotas':True,'concurrent_spend_serialization':True,'per_tenant_rate_limit':True,'persistent_audit':True,'live_database_access':False},indent=2))
finally:
 subprocess.run(DOCKER+['rm','-f',NAME],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
