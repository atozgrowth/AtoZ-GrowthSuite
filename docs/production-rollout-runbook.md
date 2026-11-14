# Future production rollout runbook — documentation only

Nothing here has been executed. This is not deployment authorization. No production automation is added. Owner must approve a concrete release and change window after the [readiness gates](operational-readiness.md) pass.

## Preflight gates

- Reviewed/merged exact source revision, passing application/browser/container/security CI, immutable release manifest/checksums, backend/frontend image digests, previous known-good image digests and configuration hashes recorded privately. Verify downloaded SHA256 sums before use. Build frontend with approved public Supabase configuration and `/api`; never promote fixture-configured images.
- Separately authorize, apply and verify profiles privilege remediation only after [security review](profiles-security-readiness.md). Effective authenticated TRUNCATE/TRIGGER/MAINTAIN/REFERENCES must all be false, including inherited/ownership paths; RLS does not protect TRUNCATE. Reuse bounded private review #5898846738 and verify its definition fingerprint has not drifted before guarded baseline adoption; never blindly replace the function or auto-attest its fingerprint. Reconcile existing profiles schema/signup provisioning, all WordPress migration/RPC/RLS contracts and Auth redirects/email configuration. No automatic migration in app startup. Any schema remediation needs its own reviewed migration/change authorization and backward-compatibility/rollback plan.
- Read-only VPS inventory reviewed: actual Docker/systemd backend ownership and consumers, port 3000 binding, reverse proxy upstream and external Docker network. Select one authoritative backend with explicit recovery plan before any service retirement. Do not disable/remove systemd in this runbook.
- Verify non-root SSH recovery and provider console access, trusted host fingerprint, responsible operator, maintenance communication and escalation. No root-only deployment dependency.
- Verified recent VPS/config/certificate backup and Supabase backup/PITR metadata, recovery point/retention/access controls, dated isolated restore evidence, adequate disk space and rollback time budget. Snapshot existence alone is insufficient. Separate authorization required to create or restore backups.
- Secure backend env file outside repository, owner-restricted permissions, no keys in frontend/build logs/CLI arguments/artifacts. Compare project identities privately. Confirm controlled actions remain off unless separately reviewed. Preserve Caddy certificate volumes and previous configuration. Verify log retention/alerts, backend/frontend health and error metrics.

## Approved rollout sequence (future operator only)

Record actual absolute paths and Compose project names from inventory, not guessed names. Prepare reviewed override files referencing `image: registry/name@sha256:<digest>` for backend and frontend and the approved Caddy digest. Source Compose build sections may remain but **never use --build**. Set required public build interpolation variables from the reviewed nonsecret manifest even when not building. Backend source Compose resolves its env_file relative to the source file; prepare an approved override pointing to the secure existing file. Do not copy secrets into Git or print rendered configuration.

The following are command templates, not a ready-to-run deployment script. Each `<...>` must be replaced in a privately reviewed change plan. Do not run until owner approval. Keep Docker contexts and remote endpoints explicit and verified.

```sh
# Read-only syntax/render gate. --quiet avoids printing resolved secrets.
docker compose -p '<existing-backend-project>' -f '<absolute-backend-compose>' -f '<approved-backend-digest-override>' config --quiet
docker compose -p '<existing-proxy-project>' -f '<absolute-proxy-compose>' -f '<approved-proxy-digest-override>' config --quiet
# After separate rollout approval and backup gates; artifacts preloaded/verified:
docker compose -p '<existing-backend-project>' -f '<absolute-backend-compose>' -f '<approved-backend-digest-override>' up -d --no-build --pull never --wait --wait-timeout 120 backend
docker compose -p '<existing-proxy-project>' -f '<absolute-proxy-compose>' -f '<approved-proxy-digest-override>' up -d --no-build --pull never --wait --wait-timeout 120 frontend
```

Validate exact proposed Caddy configuration in an isolated container before rollout (CI does this with synthetic routing). Then, after healthy upstream checks, activate approved proxy configuration/image using the inventoried Compose project, retaining the existing data/config volume names. Caddy is a separate gate: no healthcheck is currently defined for it, so `--wait` alone cannot establish routing readiness.

```sh
docker compose -p '<existing-proxy-project>' -f '<absolute-proxy-compose>' -f '<approved-proxy-digest-override>' up -d --no-build --pull never caddy
```

Do not change DNS, Cloudflare, SSH, database schema, Auth settings or service ownership as a side effect. An unhealthy backend stops the sequence before frontend/proxy changes. Do not run `down --volumes`, prune images or remove rollback artifacts.

## Smoke tests and abort criteria

Use the approved existing application hostname, TLS verification enabled, no tokens in command arguments or logs. GET `https://<approved-api-hostname>/health` on the existing API hostname must return JSON status running; this is liveness only. Same-origin `/api/me` and protected workspace/admin APIs without credentials must return 401 (not SPA HTML/200). `/login`, `/signup`, `/dashboard` must serve SPA assets; unauthenticated browser navigation must redirect to login. Verify `/api` path preservation (the backend owns the `/api/*` routes) and the separate API hostname against Caddyfile; retain the existing backend route contract. Healthcheck 200 cannot substitute for database/Auth readiness.

A separately approved designated-account smoke plan must check real login/email callback, session restoration/logout, own inventory/settings, cross-account denial and admin denial/authorization. No new signup or WordPress action without explicit scope. No privileged tokens in screenshots. Abort on failing auth/isolation, 5xx, routing errors, missing assets or elevated error rates. Operator observes bounded redacted metrics, not customer payload logs.

## Rollback (future approved action)

Record failed revision/time and stop progression. Restore previously reviewed proxy configuration and its hash using the approved configuration-management mechanism, preserving volumes. Use the saved previous immutable image/env-compatible overrides and the **same inventoried project names**:

```sh
docker compose -p '<existing-backend-project>' -f '<absolute-backend-compose>' -f '<previous-backend-digest-override>' up -d --no-build --pull never --wait --wait-timeout 120 backend
docker compose -p '<existing-proxy-project>' -f '<absolute-proxy-compose>' -f '<previous-proxy-digest-override>' up -d --no-build --pull never --wait --wait-timeout 120 frontend
docker compose -p '<existing-proxy-project>' -f '<absolute-proxy-compose>' -f '<previous-proxy-digest-override>' up -d --no-build --pull never caddy
```

Repeat routing/auth smoke tests and verify running image digests. Application rollback does not reverse database changes, Auth state or WordPress actions. No database rollback command is supplied: recovery requires a separately approved restore plan. Do not resurrect an unreviewed overlapping systemd service or weaken authentication to recover availability. Escalate to the designated owner if previous compatible images/configuration fail.
