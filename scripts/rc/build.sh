#!/usr/bin/env bash
set -euo pipefail
source_dir=$(realpath "${1:?Source checkout required}")
output=$(realpath -m "${2:?Output directory required}")
mkdir -p "$output/evidence" "$output/recipes"
[[ "$(git -C "$source_dir" rev-parse HEAD)" = "$RC_SOURCE_SHA" ]]
# Override inherited values too; these commands must never use live bindings.
export SUPABASE_URL=https://example.supabase.co SUPABASE_ANON_KEY=test-anon-key SUPABASE_SERVICE_ROLE_KEY=
export VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=test-anon-key VITE_API_BASE_URL=/api
export WP_MANAGER_CONTROLLED_WRITES_ENABLED=false VITE_WP_CONTROLLED_ACTION_UI_ENABLED=false
export DEPLOY_REVISION="$RC_SOURCE_SHA"
for part in backend frontend; do
  (cd "$source_dir/$part" && npm ci --no-fund && npm test && npm run build && npm audit --audit-level=high) 2>&1 | tee "$output/evidence/$part-checks.log"
done
(cd "$source_dir" && node --test scripts/*.test.mjs && find wp-manager-plugin -name '*.php' -print0 | xargs -0 -n1 php -l) 2>&1 | tee "$output/evidence/guards-php.log"
for tag in node:22-alpine nginxinc/nginx-unprivileged:1.28-alpine caddy:2-alpine; do docker pull "$tag"; done
python3 - "$source_dir" "$output" <<'PY'
import json,subprocess,sys
from pathlib import Path
source,out=map(Path,sys.argv[1:])
bases={tag:json.loads(subprocess.check_output(['docker','image','inspect',tag]))[0]['RepoDigests'][0] for tag in ['node:22-alpine','nginxinc/nginx-unprivileged:1.28-alpine','caddy:2-alpine']}
(out/'base-images.json').write_text(json.dumps(bases,indent=2)+'\n')
for part in ['backend','frontend']:
 text=(source/part/'Dockerfile').read_text()
 for tag,digest in bases.items():text=text.replace('FROM '+tag,'FROM '+digest)
 (out/'recipes'/(part+'.Dockerfile')).write_text(text)
PY
for part in backend frontend; do
  args=()
  if [[ "$part" = frontend ]]; then args+=(--build-arg VITE_SUPABASE_URL --build-arg VITE_SUPABASE_ANON_KEY --build-arg VITE_API_BASE_URL); fi
  docker build "${args[@]}" --label "org.opencontainers.image.revision=$RC_SOURCE_SHA" --label "org.opencontainers.image.version=$RC_VERSION" --label io.atozgrowth.validation-only=true \
    -f "$output/recipes/$part.Dockerfile" -t "atoz-rc-$part:$RC_VERSION" "$source_dir/$part" 2>&1 | tee "$output/evidence/$part-image-build.log"
done
cat > "$source_dir/backend/.env" <<'ENV'
SUPABASE_URL=https://example.supabase.co
SUPABASE_ANON_KEY=test-anon-key
SUPABASE_SERVICE_ROLE_KEY=
WP_MANAGER_CONTROLLED_WRITES_ENABLED=false
HOST=0.0.0.0
PORT=3000
ENV
cat > "$output/compose.images.yml" <<EOF2
services:
  backend:
    image: atoz-rc-backend:$RC_VERSION
  frontend:
    image: atoz-rc-frontend:$RC_VERSION
EOF2
# Each production Compose file has only one of these services: separate overrides.
printf 'services:\n  backend:\n    image: atoz-rc-backend:%s\n' "$RC_VERSION" > "$output/backend.override.yml"
printf 'services:\n  frontend:\n    image: atoz-rc-frontend:%s\n' "$RC_VERSION" > "$output/frontend.override.yml"
docker network create atoz_net
backend=(docker compose -f "$source_dir/backend/docker-compose.yml" -f "$output/backend.override.yml")
frontend=(docker compose -f "$source_dir/proxy/docker-compose.yml" -f "$output/frontend.override.yml")
"${backend[@]}" config --quiet
"${frontend[@]}" config --quiet
"${backend[@]}" up -d --no-build --wait --wait-timeout 120 backend
"${frontend[@]}" up -d --no-build --wait --wait-timeout 120 frontend
caddy=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["caddy:2-alpine"])' "$output/base-images.json")
docker run --rm -v "$source_dir/proxy/Caddyfile:/etc/caddy/Caddyfile:ro" "$caddy" caddy validate --config /etc/caddy/Caddyfile
sed -e 's/atozgrowth.net, www.atozgrowth.net {/http:\/\/:18080 {/' -e 's/^api.atozgrowth.net {/http:\/\/:18081 {/' "$source_dir/proxy/Caddyfile" > "$output/Caddyfile.validation"
docker run -d --name atoz_route_check --network atoz_net -e NO_PROXY=atoz_backend,atoz_frontend,localhost,127.0.0.1 -e no_proxy=atoz_backend,atoz_frontend,localhost,127.0.0.1 \
  -v "$output/Caddyfile.validation:/etc/caddy/Caddyfile:ro" "$caddy"
ready=false
for attempt in {1..30}; do
  if docker exec atoz_route_check wget -Y off -qO- http://127.0.0.1:18080/dashboard | grep -q '<div id="root"></div>'; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
for endpoint in 18080/api/me 18080/api/profile 18080/api/wp-manager/sites 18081/api/me; do
  response=$(docker exec atoz_route_check wget -Y off -S -O /dev/null "http://127.0.0.1:$endpoint" 2>&1 || true)
  grep -q 'HTTP/1.1 401' <<< "$response"
  printf '%s: HTTP 401\n' "$endpoint" >> "$output/evidence/routing.log"
done
docker exec atoz_frontend wget -Y off -qO- http://127.0.0.1:8080/healthz | grep -qx ok
python3 - "$output" <<'PY'
import json,subprocess,sys,os
from pathlib import Path
out=Path(sys.argv[1]);checks={}
for name in ['backend','frontend']:
 d=json.loads(subprocess.check_output(['docker','inspect','atoz_'+name]))[0]
 uid=subprocess.check_output(['docker','exec','atoz_'+name,'id','-u'],text=True).strip()
 assert uid!='0' and d['HostConfig']['ReadonlyRootfs'] and 'ALL' in d['HostConfig']['CapDrop']
 assert 'no-new-privileges:true' in d['HostConfig']['SecurityOpt']
 assert d['State']['Health']['Status']=='healthy'
 checks[name]={'image_config_digest':d['Image'],'uid':uid,'read_only':True,'cap_drop':['ALL'],'no_new_privileges':True,'health':'healthy'}
health=json.loads(subprocess.check_output(['docker','exec','atoz_backend','node','-e',"fetch('http://127.0.0.1:3000/health').then(async r=>console.log(JSON.stringify(await r.json())))"],text=True))
assert health['success'] is True and health['status']=='running'
checks['health']=health
for missing in ['SUPABASE_URL','SUPABASE_ANON_KEY']:
 values={'SUPABASE_URL':'https://example.supabase.co','SUPABASE_ANON_KEY':'test-anon-key'};values.pop(missing)
 cmd=['docker','run','--rm','--network','none']
 for k,v in values.items():cmd+=['-e',k+'='+v]
 result=subprocess.run(cmd+['atoz-rc-backend:'+os.environ['RC_VERSION']],capture_output=True,text=True,timeout=15)
 assert result.returncode!=0 and 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' in result.stderr
 checks['missing_'+missing]='startup rejected'
(out/'evidence/runtime-validation.json').write_text(json.dumps(checks,indent=2)+'\n')
PY
# Overrides contain runner paths and mutable local aliases; do not ship them.
rm "$output/compose.images.yml" "$output/backend.override.yml" "$output/frontend.override.yml"
