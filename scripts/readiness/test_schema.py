"""Run only against a fresh local Docker fixture; no DSN, remote daemon or project support."""
import json
from pathlib import Path
import subprocess
import os
import time
root = Path(__file__).resolve().parents[2]
docker = ['docker', '--host=unix:///var/run/docker.sock']
name = 'atoz-schema-fixture-' + str(os.getpid())
def run(args, **kwargs):
    return subprocess.run(docker + args, check=True, capture_output=True, text=True, **kwargs).stdout.strip()
def sql(query, role=None):
    return run(['exec', '-i', name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'fixture'], input=query)
def denied(query):
    result = subprocess.run(docker + ['exec', '-i', name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'fixture'], input=query, text=True, capture_output=True)
    assert result.returncode != 0 and 'permission denied' in result.stderr
contract = json.loads((root/'scripts/readiness/contracts.json').read_text())
try:
    run(['run', '-d', '--name', name, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_PASSWORD=synthetic-local-only', '-e', 'POSTGRES_DB=fixture', 'postgres:17-alpine'])
    for attempt in range(30):
        try: sql('SELECT 1;'); break
        except subprocess.CalledProcessError:
            if attempt == 29: raise
            time.sleep(1)
    sql((root/'scripts/readiness/bootstrap-fixture.sql').read_text())
    migrations = sorted((root/'backend/supabase/migrations').glob('*.sql'))
    for number, migration in enumerate(migrations):
        sql(migration.read_text())
        if number == 0:
            # Genuine pre-lifecycle rows, not invented post-migration states.
            sql("INSERT INTO public.wordpress_site_connections(id,user_id,site_url) VALUES ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','https://legacy.example.test'),('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','https://foreign.example.test');")
    missing = []
    for table, columns in contract['tables'].items():
        schema, relation = table.split('.')
        actual = sql(f"SELECT column_name FROM information_schema.columns WHERE table_schema='{schema}' AND table_name='{relation}';").splitlines()
        if not actual: missing.append(table); continue
        assert set(columns) <= set(actual), (table, set(columns)-set(actual))
        assert sql(f"SELECT relrowsecurity FROM pg_class WHERE oid='{table}'::regclass;") == 't', table
    assert missing == contract['known_repository_gaps'], missing
    for rpc, arguments in contract['rpcs'].items():
        data = json.loads(sql(f"SELECT json_build_object('args',proargnames[1:pronargs],'definer',prosecdef,'path',proconfig,'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),'service',has_function_privilege('service_role',oid,'EXECUTE')) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='{rpc}';"))
        assert data['args'] == arguments, (rpc, data['args'])
        assert data['definer'] and 'search_path=pg_catalog' in data['path']
        assert not data['anon'] and not data['authenticated'] and data['service'], rpc
    assert sql("SELECT count(*) FROM public.wordpress_site_connections WHERE status='connected' AND site_id IS NULL AND connected_at IS NOT NULL;") == '2'
    owner = "SET ROLE authenticated; SET request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';"
    assert sql(owner + 'SELECT count(*) FROM public.wordpress_site_connections;') == '1'
    assert sql(owner + "SELECT count(*) FROM public.wordpress_site_connections WHERE user_id='10000000-0000-4000-8000-000000000002';") == '0'
    denied(owner + "INSERT INTO public.wordpress_site_connections(user_id,site_url) VALUES ('10000000-0000-4000-8000-000000000002','https://forged.example.test');")
    for table in ['private.wordpress_pairing_challenges', 'private.wordpress_action_payloads']:
        denied('SET ROLE authenticated; SELECT * FROM ' + table + ';')
        assert sql(f"SELECT has_table_privilege('service_role','{table}','SELECT');") == 't'
    print(json.dumps({'offline_migrations_applied':len(migrations),'rpc_contracts_verified':len(contract['rpcs']),'rls_owner_isolation':True,'browser_writes_and_private_reads_denied':True,'historical_null_site_ids_preserved':True,'missing_repository_contracts':missing,'deployment_ready':False,'live_database_access':False},indent=2))
finally:
    subprocess.run(docker + ['rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
