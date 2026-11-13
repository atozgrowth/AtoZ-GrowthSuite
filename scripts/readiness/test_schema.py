"""Run only against a fresh local Docker fixture; no DSN, remote daemon or project support."""
import json
from pathlib import Path
import subprocess
import os
import time
root = Path(__file__).resolve().parents[2]
docker = ['docker', '--host=unix:///var/run/docker.sock']
name = 'atoz-schema-fixture-' + str(os.getpid())
database = 'fixture'
def run(args, **kwargs):
    return subprocess.run(docker + args, check=True, capture_output=True, text=True, **kwargs).stdout.strip()
def sql(query):
    return run(['exec', '-i', name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database], input=query)
def denied(query):
    result = subprocess.run(docker + ['exec', '-i', name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database], input=query, text=True, capture_output=True)
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
    denied('SET ROLE anon; SELECT * FROM public.wordpress_site_connections;')
    denied(owner + "UPDATE public.wordpress_site_connections SET site_url='https://forged.example.test';")
    denied(owner + 'DELETE FROM public.wordpress_site_connections;')
    # Validate the owner-only catalog plan on this fixture, never a live connection.
    sql((root/'scripts/readiness/live-schema-readonly.sql').read_text())
    for table in ['private.wordpress_pairing_challenges', 'private.wordpress_action_payloads']:
        denied('SET ROLE authenticated; SELECT * FROM ' + table + ';')
        assert sql(f"SELECT has_table_privilege('service_role','{table}','SELECT');") == 't'
    # Fresh signup provisions only display metadata, never authorization claims.
    sql("INSERT INTO auth.users(id,raw_user_meta_data) VALUES ('30000000-0000-4000-8000-000000000001','{\"full_name\":\"Synthetic Name\",\"role\":\"admin\"}');")
    assert sql("SELECT full_name FROM public.profiles WHERE id='30000000-0000-4000-8000-000000000001';") == 'Synthetic Name'
    assert sql("SELECT proconfig=ARRAY['search_path=\"\"']::text[] FROM pg_proc WHERE oid='private.atoz_provision_profile()'::regprocedure;") == 't'
    for browser in ['anon','authenticated','service_role']:
        assert sql(f"SELECT has_function_privilege('{browser}','private.atoz_provision_profile()','EXECUTE');") == 'f'
    # Synthetic trigger harness exercises conflict handling without live Auth.
    sql("CREATE TABLE public.fixture_signup(id uuid,raw_user_meta_data jsonb); CREATE TRIGGER fixture_signup AFTER INSERT ON public.fixture_signup FOR EACH ROW EXECUTE FUNCTION private.atoz_provision_profile(); INSERT INTO public.fixture_signup VALUES ('30000000-0000-4000-8000-000000000001','{\"full_name\":\"Do not overwrite\"}');")
    assert sql("SELECT full_name FROM public.profiles WHERE id='30000000-0000-4000-8000-000000000001';") == 'Synthetic Name'
    assert sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name IN ('role','is_admin');") == '0'
    sql(owner + "INSERT INTO public.profiles(id,full_name) VALUES ('10000000-0000-4000-8000-000000000001','Owner'); UPDATE public.profiles SET full_name='Updated' WHERE id=auth.uid();")
    assert sql(owner + 'SELECT full_name FROM public.profiles;') == 'Updated'
    assert sql(owner + "SELECT count(*) FROM public.profiles WHERE id='30000000-0000-4000-8000-000000000001';") == '0'
    assert sql(owner + "WITH changed AS (UPDATE public.profiles SET full_name='forged' WHERE id='30000000-0000-4000-8000-000000000001' RETURNING id) SELECT count(*) FROM changed;") == '0'
    def rejected(query, message):
        result = subprocess.run(docker + ['exec','-i',name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],input=query,text=True,capture_output=True)
        assert result.returncode != 0 and message in result.stderr, result.stderr
    rejected(owner + "INSERT INTO public.profiles(id) VALUES ('10000000-0000-4000-8000-000000000002');", 'row-level security')
    rejected(owner + "UPDATE public.profiles SET id='10000000-0000-4000-8000-000000000002' WHERE id=auth.uid();", 'row-level security')
    denied('SET ROLE anon; SELECT * FROM public.profiles;')
    def safe_privileges():
        for browser in ['anon','authenticated']:
            for privilege in ['TRUNCATE','TRIGGER','DELETE']:
                assert sql(f"SELECT has_table_privilege('{browser}','public.profiles','{privilege}');") == 'f'
    safe_privileges()
    hardening = next(m for m in migrations if 'harden_profiles_browser' in m.name).read_text()
    baseline = next(m for m in migrations if 'baseline_profiles' in m.name).read_text()
    def attest():
        return "SELECT set_config('atoz.reviewed_profiles_trigger_md5',(SELECT md5(pg_get_functiondef(tgfoid)) FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created'),false);"
    # Reapplication with the same reviewed definition is idempotent.
    sql(hardening)
    sql(attest() + baseline)
    assert sql("SELECT count(*) FROM public.profiles;") == '2'
    # Compatible existing table/trigger adoption; no guessed live body is imported.
    run(['exec',name,'createdb','-U','postgres','existing_fixture'])
    database = 'existing_fixture'
    sql((root/'scripts/readiness/bootstrap-fixture.sql').read_text())
    sql((root/'scripts/readiness/profile-fixture.sql').read_text())
    original_hash = sql("SELECT md5(pg_get_functiondef('public.handle_new_user()'::regprocedure));")
    assert sql("SELECT has_table_privilege('authenticated','public.profiles','TRUNCATE');") == 't'
    sql(hardening)
    safe_privileges()
    rejected(baseline, 'exact existing trigger definition needs owner security review')
    assert sql("SELECT count(*) FROM pg_policies WHERE policyname LIKE 'atoz_profiles_%';") == '0'
    # A stale acknowledgement must not approve a changed function definition.
    sql('ALTER FUNCTION public.handle_new_user() SET search_path=pg_catalog;')
    rejected("SELECT set_config('atoz.reviewed_profiles_trigger_md5','" + original_hash + "',false);" + baseline, 'exact existing trigger definition needs owner security review')
    sql('ALTER FUNCTION public.handle_new_user() SET search_path=public;')
    sql(attest() + baseline)
    sql(attest() + baseline)
    assert sql("SELECT md5(pg_get_functiondef('public.handle_new_user()'::regprocedure));") == original_hash
    assert sql("SELECT fixture_extra FROM public.profiles;") == 'preserve-me'
    sql("INSERT INTO auth.users(id) VALUES ('30000000-0000-4000-8000-000000000002');")
    assert sql("SELECT count(*) FROM public.profiles;") == '2'
    safe_privileges()
    # A broad old permissive policy cannot override repository restrictive guards.
    sql('CREATE POLICY fixture_broad ON public.profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);')
    assert sql(owner + 'SELECT count(*) FROM public.profiles;') == '1'
    rejected(owner + "INSERT INTO public.profiles(id) VALUES ('10000000-0000-4000-8000-000000000002');", 'row-level security')
    # Direct/PUBLIC revokes are successful, repeatable, and preserve necessary DML.
    sql('GRANT TRUNCATE,TRIGGER ON public.profiles TO PUBLIC;')
    sql(hardening)
    safe_privileges()
    for privilege in ['SELECT','INSERT','UPDATE']:
        assert sql(f"SELECT has_table_privilege('authenticated','public.profiles','{privilege}');") == 't'
    # Inherited and NOINHERIT membership grants cannot be fixed with a leaf revoke.
    sql('CREATE ROLE fixture_privileged; GRANT TRUNCATE ON public.profiles TO fixture_privileged; GRANT fixture_privileged TO authenticated; GRANT TRIGGER ON public.profiles TO authenticated;')
    rejected(hardening, 'browser privilege hardening blocked')
    assert sql("SELECT has_table_privilege('authenticated','public.profiles','TRIGGER');") == 't' # rollback was atomic
    sql('ALTER ROLE authenticated NOINHERIT; REVOKE TRIGGER ON public.profiles FROM authenticated;')
    rejected(hardening, 'browser privilege hardening blocked')
    sql('REVOKE fixture_privileged FROM authenticated; ALTER ROLE authenticated INHERIT;')
    # Ownership implies capabilities and cannot be removed using REVOKE alone.
    sql('ALTER TABLE public.profiles OWNER TO authenticated;')
    rejected(hardening, 'browser privilege hardening blocked')
    sql('ALTER TABLE public.profiles OWNER TO postgres;')
    sql(hardening)
    safe_privileges()
    # Incompatible column types fail closed without coercion/data rewrites.
    sql('ALTER TABLE public.profiles ALTER COLUMN avatar_url TYPE varchar(200);')
    rejected(attest() + baseline, 'required column type mismatch')
    assert sql("SELECT format_type(atttypid,atttypmod) FROM pg_attribute WHERE attrelid='public.profiles'::regclass AND attname='avatar_url';") == 'character varying(200)'
    print(json.dumps({'offline_migrations_applied':len(migrations),'rpc_contracts_verified':len(contract['rpcs']),'rls_owner_isolation':True,'browser_writes_and_private_reads_denied':True,'historical_null_site_ids_preserved':True,'missing_repository_contracts':missing,'profile_baseline_and_privilege_scenarios':True,'repository_contracts_complete':not missing,'deployment_ready':False,'live_database_access':False},indent=2))
finally:
    subprocess.run(docker + ['rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
