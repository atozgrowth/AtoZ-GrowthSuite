#!/usr/bin/env bash
set -euo pipefail
# Execute on the verified staging VPS only; never sources shell code from .env.
release_dir=$(realpath "${1:?Pass the extracted release directory}")
env_file=$(realpath "${2:?Pass the staging environment file}")
state_dir=$(realpath "${3:?Pass the staging state directory}")
[[ "$release_dir" != *$'\n'* && "$release_dir" != *' '* ]]
exec 9>"$state_dir/deploy.lock"
flock -n 9 || { echo 'Another staging deployment is active.' >&2; exit 1; }
release_id=$(cat "$release_dir/COMMIT")
[[ "$release_id" =~ ^[a-f0-9]{40}$ ]]
if [[ -f "$release_dir/RELEASE" ]]; then
  release_id=$(cat "$release_dir/RELEASE")
  [[ "$release_id" =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]]
fi
export RELEASE_ID="$release_id"
# Preload the real file before module imports and verify staging isolation.
node --env-file="$env_file" "$release_dir/deploy/check-staging.mjs"
compose=(docker compose --project-name atoz-staging --env-file "$env_file" -f "$release_dir/deploy/compose.staging.yml")
"${compose[@]}" build --pull
previous=$(readlink -f "$state_dir/current" || true)
rollback() {
  if [[ -n "$previous" && "$previous" != "$release_dir" && -f "$previous/COMMIT" ]]; then
    export RELEASE_ID="$(cat "$previous/RELEASE" 2>/dev/null || cat "$previous/COMMIT")"
    docker compose --project-name atoz-staging --env-file "$env_file" -f "$previous/deploy/compose.staging.yml" up -d --no-build --wait --wait-timeout 90
    echo 'Previous staging release restored.' >&2
  else
    echo 'No previous release available; inspect staging containers.' >&2
  fi
}
if ! "${compose[@]}" up -d --no-build --wait --wait-timeout 90; then
  rollback
  exit 1
fi
# /api/me must reject unauthenticated users with 401.
status=$(curl --max-time 10 --silent --show-error -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/me) || { rollback; exit 1; }
if [[ "$status" != 401 ]]; then
  echo 'Authentication boundary failed.' >&2
  rollback
  exit 1
fi
curl --max-time 10 --fail --silent --show-error http://127.0.0.1:8080/ | grep -q '<div id="root"></div>' || { rollback; exit 1; }
ln -sfn "$release_dir" "$state_dir/current"
echo "Staging release $release_id activated. No database migrations were executed."
