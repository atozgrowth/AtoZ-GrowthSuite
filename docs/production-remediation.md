# Production remediation runbook

This runbook is deliberately **preparation only**. It must not be treated as authority to deploy, restart a service, change DNS, alter SSH, or apply database changes. Each implementation phase below requires separate explicit production approval.

## Audit facts and traffic ownership

The A2Z VPS currently runs two backend processes:

- `atoz_backend`, the Docker Compose service on the `atoz_net` network.
- `atoz-backend.service`, a systemd unit that runs `node /opt/atoz/app/backend/dist/index.js` as `atozadmin` and listens on the host's port 3000.

The current Caddy configuration routes `api.atozgrowth.net` to `atoz_backend:3000`. Therefore the configured public API path reaches the Docker backend, not the systemd service. This is not proof that there are no other clients of the host-level listener, so the systemd service must remain running until the validation gate below is completed.

The main domains currently return a proxy status response. This branch prepares a separate frontend container and changes the *future* Caddy configuration to proxy the main domains to it. Applying that configuration changes production behavior and is outside this PR's authority.

## Required evidence before any production change

Capture and attach all of the following to the implementation approval:

1. A fresh Hostinger VPS backup/snapshot identifier and a documented restore owner. A VPS snapshot does not replace an application or database restore test.
2. An independent backup and restore plan for the production Supabase project. This branch does not make, migrate, query, or restore databases.
3. The current Caddy and Docker Compose files, container image IDs, `docker compose ps`, `docker ps`, `systemctl status atoz-backend`, and public HTTP response headers/statuses for the main and API domains.
4. A pinned release revision and artifact checksum. Set `DEPLOY_REVISION` to the exact Git commit before a Compose build; `untracked` is a local-development fallback only.
5. A maintenance owner, rollback owner, and an explicit go/no-go approval. Successful CI, a merged PR, or an available backup is not approval to change production.

## Duplicate-backend remediation plan

### Pre-change validation

With both services still running, collect a short observation window of Caddy access logs and confirm the upstream is `atoz_backend`. The future Caddyfile in this branch emits structured access logs to container stdout; enable and observe it only in an approved change. At the same time, verify whether any external monitor, localhost client, cron job, or service connects directly to host port 3000. Do not infer this from the Caddyfile alone.

Record these non-mutating checks:

```bash
docker compose -f /opt/atoz/app/proxy/docker-compose.yml ps
docker compose -f /opt/atoz/app/backend/docker-compose.yml ps
docker exec atoz_caddy wget -S -O - http://atoz_backend:3000/health
systemctl status atoz-backend.service --no-pager
ss -ltnp '( sport = :3000 )'
```

Before removal, deploy the same approved immutable backend image through Compose, wait for its health check, and smoke-test the public API through Caddy. Keep the systemd unit enabled and running during that test.

### Approval checkpoint: retire systemd ownership

Only after the validation evidence establishes that nothing depends on the host-level listener:

1. Stop the systemd service during an approved maintenance window.
2. Re-run public API and authenticated application smoke tests through Caddy.
3. Keep the systemd unit file and the last known-good release intact for the agreed observation period; do not delete them in the same change.

### Rollback

If the Docker backend fails health checks or public API smoke tests, restore the prior approved container image/configuration and start `atoz-backend.service` again. Do not roll back or alter database schema as part of this application rollback.

## SSH hardening and recovery-access plan

The audit found public SSH exposure with root and password authentication enabled. The existing registered key was accepted for root, but a non-root SSH test for `atozadmin` was not accepted. Non-root recovery access is therefore **not yet verified**.

Perform the following only in a separately approved SSH-hardening change:

1. Create a dedicated non-root recovery administrator with a separate, passphrase-protected public key. Do not reuse the deployment identity.
2. Restrict ownership and permissions for the account's `~/.ssh` directory and `authorized_keys` before testing access.
3. Open a new SSH session using that recovery key while retaining the existing root session. Confirm `id`, required `sudo` access, and a harmless read of the application status. Keep both sessions open.
4. Independently confirm Hostinger's browser console/recovery path is accessible to the designated operators.
5. Test a second fresh non-root login using strict host-key verification and the recorded host key fingerprint.
6. Only after all recovery paths work, change `sshd_config` to disable root and password login. Validate configuration with `sshd -t`, reload rather than reboot SSH, and retain the tested session until another fresh login succeeds.

Rollback for an unsuccessful SSH hardening change is performed from the still-open recovery session or the verified Hostinger console. Restore the previous SSH configuration, validate it with `sshd -t`, reload SSH, and retest both access methods.

## Container and frontend preparation in this branch

- The backend Dockerfile is multi-stage, installs production dependencies only in the runtime image, runs as `node`, and declares a `/health` check.
- The backend Compose definition adds a read-only root filesystem, temporary filesystem, dropped Linux capabilities, no-new-privileges, process/memory/CPU limits, health checks, and revision labels.
- The proxy Compose definition adds an internal `atoz_frontend` service. The future Caddyfile routes `atozgrowth.net` and `www.atozgrowth.net` to it, while preserving the API route to `atoz_backend`.
- The frontend container is static, listens only on the internal Docker network, and supports single-page-app route fallback.

Before any future use, validate locally and in a disposable environment:

```bash
(cd backend && npm ci && npm test && npm run build)
(cd frontend && npm ci && npm run build)
DEPLOY_REVISION=local-test docker compose -f backend/docker-compose.yml config
docker compose -f proxy/docker-compose.yml config
```

Then build the approved revision, verify backend and frontend health checks, visit `/`, `/dashboard`, and the API health endpoint through Caddy, and confirm unauthenticated API requests are rejected. Do not expose the backend port on the host.

## CI/CD boundary

Draft PR #1 remains a draft. Its staging workflow must stay in packaging-only mode: invoke it with `deploy=false`, require protected-environment review, and do not configure staging or production SSH/Supabase deployment credentials until a distinct staging host and project are verified.

This remediation PR contains no deployment workflow and no deployment credential. It prepares the runtime definitions and runbook only. Production deployment remains manual and requires the approval checkpoints in this document.
