#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
title=${1:?Pass the PR title}
body_file=$(realpath "${2:?Pass a Markdown body file}")
[[ -f "$body_file" ]]
branch=$(git branch --show-current)
[[ -n "$branch" && "$branch" != main && "$branch" != master ]] || { echo 'Use a feature branch.' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Commit and review changes first.' >&2; exit 1; }
for component in backend frontend; do
  (cd "$component" && npm test && npm run build && npm audit --audit-level=high)
done
node --test scripts/*.test.mjs
bash -n deploy/activate-staging.sh
git diff --check
git push --set-upstream origin "$branch"
if gh pr view "$branch" --json url --jq .url >/dev/null 2>&1; then
  gh pr view "$branch" --json url --jq .url
else
  gh pr create --draft --base main --head "$branch" --title "$title" --body-file "$body_file"
fi
