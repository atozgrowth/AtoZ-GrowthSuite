#!/usr/bin/env python3
"""Isolated PostgreSQL actual persistence tests, fixed local Docker only."""
import json,os,subprocess,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
D=['docker','--host=unix:///var/run/docker.sock']
NAME='atoz-ads-pg-'+str(os.getpid())
PG='postgres:17-alpine@sha256:d3244e8ce3f165ee3c93d9c4a4b1d0fe48b3a89e2287b717fdcbbde92d405065'
NODE='node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5'
def run(*args,check=True):
 r=subprocess.run(D+list(args),capture_output=True,text=True,timeout=600)
 if check and r.returncode:raise RuntimeError('Isolated Docker '+args[0]+' failed')
 return r
try:
 for image in [PG,NODE]:
  if run('image','inspect',image,check=False).returncode:run('pull',image)
 run('network','create','--internal',NAME)
 run('run','-d','--name',NAME+'-db','--network',NAME,'--network-alias','postgres','--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_PASSWORD=synthetic-postgres','-e','POSTGRES_DB=fixture',PG)
 for attempt in range(60):
  if run('exec',NAME+'-db','pg_isready','-U','postgres','-d','fixture',check=False).returncode==0:break
  if attempt==59:raise RuntimeError('Fixture readiness failed')
  time.sleep(1)
 with tempfile.TemporaryDirectory(prefix='atoz-ads-evidence-') as tmp:
  migration=next((ROOT/'backend/supabase/migrations').glob('*tenant_ads_persistence.sql'))
  args=['run','--rm','--name',NAME+'-test','--network',NAME,'-e','HTTP_PROXY=','-e','HTTPS_PROXY=','-e','ALL_PROXY=','-e','NO_PROXY=*','--mount',f'type=bind,src={ROOT}/backend/dist,dst=/app/backend/dist,readonly','--mount',f'type=bind,src={ROOT}/integration/ads-postgres,dst=/app/integration/ads-postgres,readonly','--mount',f'type=bind,src={migration},dst=/app/migration.sql,readonly','--mount',f'type=bind,src={tmp},dst=/evidence',NODE,'node','/app/integration/ads-postgres/exercise.mjs']
  r=run(*args,check=False)
  if r.returncode:print(r.stderr[-1200:]);raise RuntimeError('Actual PostgreSQL assertions failed')
  evidence=json.loads((Path(tmp)/'evidence.json').read_text());evidence['source_revision']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip();evidence['source_dirty']=bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip());evidence['network_internal']=True
  (ROOT/'integration/ads-postgres/evidence.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence,indent=2))
finally:
 run('rm','-f',NAME+'-test',NAME+'-db',check=False)
 run('network','rm',NAME,check=False)
