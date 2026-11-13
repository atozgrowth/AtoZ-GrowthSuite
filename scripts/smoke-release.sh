#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
release=$(mktemp -d)
export RELEASE_ID="smoke-$$"
# Always use fixtures, even when the caller has real credentials configured.
export SUPABASE_URL=https://example.supabase.co
export SUPABASE_ANON_KEY=test-anon-key
export SUPABASE_SERVICE_ROLE_KEY=
export STAGING_BIND_PORT=0
compose=(docker compose --project-name "atoz-smoke-$$" -f "$release/deploy/compose.staging.yml")
cleanup() {
  "${compose[@]}" down --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$release"
}
trap cleanup EXIT
mkdir -p "$release/backend" "$release/frontend"
cp backend/package.json backend/package-lock.json "$release/backend/"
cp -r backend/dist "$release/backend/"
cp -r frontend/dist "$release/frontend/"
cp -r deploy "$release/"
build_options=()
if [[ -n "${CODEX_PROXY_CERT:-}" ]]; then build_options+=(--secret "id=proxy_ca,src=$CODEX_PROXY_CERT"); fi
docker build "${build_options[@]}" -f "$release/deploy/backend.Dockerfile" -t "atoz-staging-backend:$RELEASE_ID" "$release"
docker build -f "$release/deploy/web.Dockerfile" -t "atoz-staging-web:$RELEASE_ID" "$release"
"${compose[@]}" up -d --no-build --wait --wait-timeout 90
address=$("${compose[@]}" port web 8080)
[[ "$address" == 127.0.0.1:* ]]
status=$(curl --max-time 10 --silent --show-error -o /dev/null -w '%{http_code}' "http://$address/api/me")
[[ "$status" == 401 ]]
curl --max-time 10 --fail --silent --show-error "http://$address/dashboard" | grep -q '<div id="root"></div>'
echo 'PASS: release containers healthy, SPA fallback works, same-origin API requires authentication.'
