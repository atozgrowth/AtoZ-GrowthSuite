# Environments and automation

## Current integration status

The repository does not identify a Supabase project ref or the target Hostinger VPS. Do not infer these from naming or reuse the first project returned. Verify project refs using authorized Supabase project metadata and the existing application's VPS configuration **without printing secrets**. Identify the production project first, then select a distinct development/staging project or branch. If the inventory leaves multiple plausible targets, ask for a target selection.

Hostinger and Supabase MCP servers were registered with the official endpoints `https://mcp.hostinger.com` and `https://mcp.supabase.com/mcp`. Authentication was blocked by cloud network policy. Local registration does not make tools available in the active conversation: after network access and browser sign-in, reconnect the session. Scope Supabase to the development project and read-only access for initial discovery. Hostinger VPS operations must be enabled in connector settings.

Git reads through the platform's GitHub proxy work. GitHub API requests were blocked by network policy, so remote Actions settings, environment protection, secrets, and PR creation were not verified. No remote database or VPS was modified.

Local validation: both application builds, 33 backend tests, three API-configuration tests and two staging-boundary tests passed. Release containers, browser routing, staging activation and recovery of the previous container release after a simulated failure were tested locally with fixtures. PHP plugin lint passed. The frontend audit is clean after updating Vite to 7.3.8 and source-map-js to 1.2.2. The backend audit reports seven moderate findings in the fast-uri dependency chain; there are no high/critical findings. Cloud/live account integration and hosted CI execution remain unverified.

## Secure development configuration

Set these through Codex environment settings or existing ignored `.env` files. Never copy live keys into source, chat, build logs, or artifacts. Backend `.env` is loaded before authentication imports.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Verified development/staging project URL |
| `SUPABASE_ANON_KEY` | Public anon/publishable key for that same project |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend-only privileged key; required for pairing, never expose to Vite |
| `VITE_SUPABASE_URL` | Same development project URL |
| `VITE_SUPABASE_ANON_KEY` | Same public key, embedded in frontend output intentionally |
| `VITE_API_BASE_URL` | API root including `/api`; defaults to same-origin `/api` |
| `VITE_API_PROXY_TARGET` | Vite development-only proxy target; defaults to `http://127.0.0.1:3000` |

For a split frontend/API deployment, explicitly set `VITE_API_BASE_URL` to that environment's HTTPS API root. Vite values are build-time configuration: rebuild after changing them. Defaults never route development traffic to production. Do not put secret keys in any `VITE_` variable. Controlled WordPress writes remain disabled by default.

Application dependencies: Supabase Auth, `public.profiles`, WordPress connection tables, private pairing challenge storage, controlled-action request/payload/audit tables and associated RPCs/RLS policies. WordPress migrations are in `backend/supabase/migrations`; the base `profiles` schema is not supplied here. Verify actual schema and migration history through read-only discovery before applying anything. There is no automatic migration step in these workflows.

## CI and recurring checks

`Development checks` runs backend/frontend tests and builds, staging-boundary tests, PHP lint, and npm dependency audits on PRs, main pushes, manual dispatch, and Mondays at **08:00 Asia/Kolkata**. High/critical dependency findings fail security checks; moderate findings remain visible in audit output. Dependabot prepares weekly dependency and GitHub Actions update PRs. These schedules take effect only after merge to the default branch and activation of GitHub Actions/Dependabot. No recurring Codex task was registered because a scheduling connector was not available.

Use GitHub branch protection to require the checks and a review before merging. Enable GitHub secret scanning/push protection where supported. CI has read-only repository permissions and does not receive Supabase or SSH secrets for ordinary PRs. Do not use `pull_request_target` to execute contributor code with credentials.

For a development PR, commit on a feature branch and run `bash scripts/create-pr.sh 'PR title' /path/to/body.md`. It validates tests, builds, audits and deployment guards before pushing and opening a draft PR. Existing platform Git authentication is used; GitHub API access and PR write permission are additionally required. Do not merge or enable auto-merge without review.

## Staging release and Hostinger VPS deployment

`Prepare staging release` is manual and defaults to packaging only. Configure a protected GitHub **staging** environment with branch restrictions and required reviewers before enabling deployment. Its variables are:

- `SUPABASE_URL`, `SUPABASE_PROJECT_REF`: verified staging project.
- `PRODUCTION_SUPABASE_PROJECT_REF`: verified production ref, used only as a comparison guard.
- `SSH_HOST`, `SSH_USER`: verified staging VPS and a dedicated non-root deploy user.
- `PRODUCTION_SSH_HOST`: canonical production VPS host, used to reject a matching staging target.

Environment secrets: `SUPABASE_ANON_KEY` (staging public key), `SSH_PRIVATE_KEY` (dedicated staging deploy key), and `SSH_KNOWN_HOSTS` (host key verified through an authenticated Hostinger channel). Never obtain trust by disabling host verification or accepting a fresh `ssh-keyscan` result without independent verification. Use connector retrieval and supported secure bindings where available. Raw SSH private keys must be actual encrypted environment secrets, not HTTP proxy credential placeholders.

After the VPS is identified through Hostinger, inspect its current services, ports, firewall, DNS and storage before provisioning. The dedicated staging deploy user needs Docker/Compose, Node 24, curl, flock, and write access to `/srv/atoz-staging/releases` and `/srv/atoz-staging`. Docker group access is effectively privileged; restrict this identity to the staging host. If staging and production share a VPS, this workflow intentionally refuses deployment: prepare a separately reviewed isolation design instead.

Keep `/srv/atoz-staging/.env.staging` private (mode 0600), outside releases. It must contain the **staging** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, optional backend-only `SUPABASE_SERVICE_ROLE_KEY`, and both `STAGING_SUPABASE_PROJECT_REF` and `PRODUCTION_SUPABASE_PROJECT_REF`. The VPS guard validates these again before touching services. Neither the environment file nor privileged keys are packaged into release artifacts. Staging must have its own data and credentials; migrations require a separate reviewed plan.

The workflow verifies tests/builds/security, packages the exact commit and a checksum, then optionally transfers it over pinned SSH. Activation uses a unique release directory and image tag, a deployment lock, a separate Compose project/network, backend health checks and an anonymous-auth rejection check. It restores the previous container release on readiness failure and updates the current symlink only after success. It does not prune old images or releases. The web service listens on VPS loopback port 8080: configure the existing TLS reverse proxy for the verified staging hostname only after inspecting current proxy configuration. Existing production Caddy files are untouched.

Before activation, confirm the staging DB is backed up if a change could affect data. For manual application rollback, rerun the previous release's `deploy/activate-staging.sh` with the same private env file and state directory; it uses the same staging Compose project. Application rollback never rolls back a database migration. Preserve prior release artifacts and verify backup restore procedures separately.

## Production gate

There is intentionally no automatic production deployment or database migration workflow. Before requesting explicit approval, prepare the exact commit/artifact checksum, infrastructure/configuration diff, affected project/server identifiers, verified backup/snapshot identifiers and recovery evidence, maintenance impact, smoke tests, and rollback commands. Only an explicit user approval authorizes live production deployment or destructive database changes. A GitHub button, successful CI run, or staging approval is not that authorization.
