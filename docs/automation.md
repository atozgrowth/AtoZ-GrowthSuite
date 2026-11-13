# Environments and automation

## Current integration status

The repository does not identify a Supabase project ref or the target Hostinger VPS. Do not infer these from naming or reuse the first project returned. Verify project refs using authorized Supabase project metadata and the existing application's VPS configuration **without printing secrets**. Identify the production project first, then select a distinct development/staging project or branch. If the inventory leaves multiple plausible targets, ask for a target selection.

Connectivity rechecked on 2026-11-13 using the attached published configuration version `cecfgver_6af73e7b85d48199acb64e08eb620e11`: observed revision matches revision 1, observations are current, and the network policy is enforced. The status API does not expose the publication history, so whether this is the latest published version could not be independently established. Required runtime variable bindings report ready; this does not establish that their values target a separate staging project.

GitHub API access works. Existing Draft PR #1 targets `main` from `codex/development-automation`, with automation commit `306b73c17a6abf071781d88d42e1f2adc840f76b`. Its Development checks run `43458709666` completed successfully: both builds/tests, both dependency audits, PHP syntax and deployment guards passed. No new PR is needed. The repository environment inventory is empty. Reading Actions permissions and main branch protection returns `403 Resource not accessible by integration`; an administrator must verify or configure these controls before deployment is enabled.

The environment MCP registrations use `https://mcp.hostinger.com` and `https://mcp.supabase.com/mcp`. Fresh curl probes reach Supabase with HTTP 401 and a Hostinger MCP initialize request with HTTP 401; both require authentication. Supabase OAuth initiation succeeds with read-only organization/project/database scopes, but the shared-browser tool failed before opening the authorization page. Re-run `codex mcp login supabase --scopes organizations:read,projects:read,database:read` and complete sign-in in this environment's browser. Hostinger OAuth initiation fails at metadata discovery because `auth.hostinger.com` is denied by the network policy. Add that authentication hostname through environment settings, preserving the current allowed hosts, then retry `codex mcp login hostinger`. Further redirect hosts may need review after discovery succeeds. Reconnect the session after authentication so the environment MCP tools can load.

The separately connected Supabase plugin is authenticated and can list the healthy project `vigfmclcbibesrorjmut` (A to Z Growth Suite). Its role as production or development is not established, and no distinct staging project has been verified. Do not apply migrations or bind deployment credentials to it until that separation is confirmed. Hostinger account inventory remains blocked by OAuth. No remote database or VPS was modified.

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

`Prepare staging release` is manual and **packaging-only**. It has no GitHub environment, deployment credentials, SSH key, VPS target, or deploy job. It uses synthetic Supabase fixtures solely to validate that the frontend and backend build and that the staging-boundary guard rejects an unsafe configuration. Its uploaded archive is a validation artifact, not an authorized deployment artifact.

Do not add a deployment job or staging environment credentials to this workflow. Any future staging design must be separately reviewed after a distinct staging VPS and Supabase project are verified. It will need a dedicated non-root deploy user, a confirmed recovery path, a pinned host key, protected environment review, isolated data, a rollback test, and explicit user approval.

Before activation, confirm the staging DB is backed up if a change could affect data. For manual application rollback, rerun the previous release's `deploy/activate-staging.sh` with the same private env file and state directory; it uses the same staging Compose project. Application rollback never rolls back a database migration. Preserve prior release artifacts and verify backup restore procedures separately.

## Production gate

There is intentionally no automatic production deployment or database migration workflow. Before requesting explicit approval, prepare the exact commit/artifact checksum, infrastructure/configuration diff, affected project/server identifiers, verified backup/snapshot identifiers and recovery evidence, maintenance impact, smoke tests, and rollback commands. Only an explicit user approval authorizes live production deployment or destructive database changes. A GitHub button, successful CI run, or staging approval is not that authorization.
