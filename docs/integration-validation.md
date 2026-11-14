# Workspace integration validation

Baseline: main `b187c43c6e34da2fea21a1f9ad4ddecd5e87eef2`, squash merge of PR #17. This is development hardening of the existing React, Fastify and Supabase application. No project, schema, Auth setting, user, connection or production resource was inspected or changed.

The intended existing integration target is A to Z Growth Suite, ref `vigfmclcbibesrorjmut`. That identifier is not permission to access it. Live configuration, memberships/RLS, Auth/email delivery and WordPress connectivity remain **unverified in this task**. Do not substitute a different project or staging project.

## Contracts and changes

- Auth restoration always verifies the token with Auth. Every auth event invalidates earlier verification immediately; queued work runs after the SDK callback returns. Logout uses local session scope, matching the current-browser UI, and a delayed verification cannot reopen a signed-out workspace. Network logout errors are displayed rather than claiming successful revocation. Supabase access-token expiry/revocation semantics still apply; no token blacklist or database lookup is added.
- Email callbacks scrub code/hash parameters before configuration checks and validate the resulting user, including cached-session fallback, before reporting success. PKCE exchanges happen once under React StrictMode. Internal return paths accept only known routes and UUID-shaped workspace IDs; traversal/encoded separators are rejected.
- Workspace IDs represent the existing authenticated account owner, not shared organization memberships. `/api/workspaces/:workspaceId` requires exact verified ownership, even for admins. Admin APIs independently require server-returned `app_metadata.role === "admin"`; editable user metadata, URL parameters, headers and cached role claims are never authorization proof.
- Connected-site inventory uses `{ sites: [{ id: UUID, site_url: HTTPS URL }] }`, with an empty array meaning a successfully loaded empty inventory. The endpoint returns connected rows only. A legacy bare array and optional `status: "connected"` remain accepted. Bad/missing IDs, duplicates, credential-bearing/unsafe URLs and contradictory states fail the entire response; no partial or false-zero totals are shown. Root HTTPS URLs are normalized with a trailing slash. The manager and dashboard use the same parser.
- The per-request site reader still uses a public key plus the caller's verified bearer token, explicit user_id/status predicates and RLS. Synthetic HTTP transport tests exercise the actual Supabase query builder. Unexpected inventory transport exceptions return a sanitized 503. WordPress client helpers preserve missing-session 401 errors before any fetch, and connection/action identifiers use the same strict UUID contract.
- Account WordPress routes authenticate before calling their services. Synthetic tests cover listing, inspection, inventory, pairing initiation/revocation and controlled-action endpoints. The pairing confirmation and inspection authorization callbacks intentionally use existing short-lived proof/grant mechanisms instead of user bearer auth; their existing proof validation is preserved. No new operation is enabled. Controlled writes stay disabled by default.
- Frontend config is checked by Vite before bundling and reused by the client. Partial/malformed config, secret-key prefixes and legacy JWTs with a non-anon role fail with non-sensitive errors. Decoding a key's role here is only a misconfiguration check, not JWT verification or authorization. Already leaked keys cannot be made safe by this guard; this task accessed no actual key. Both missing public values still permit an explicitly unconfigured UI. The guard accepts synthetic fixture strings; it is not proof that a real key/project is valid.

## Environment contract — placeholders only

| Setting | Owner/scope | Requirement |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Public frontend build | `https://<existing-project-ref>.supabase.co`; verify the intended existing target securely before a live build |
| `VITE_SUPABASE_ANON_KEY` | Public frontend build | `<public-anon-or-publishable-key>`; never a secret/service-role key |
| `VITE_API_BASE_URL` | Public frontend build | `/api` for the existing same-origin Caddy/Vite routing; approved split origin only if separately reviewed |
| `SUPABASE_URL` | Backend runtime | Same verified existing project as the frontend |
| `SUPABASE_ANON_KEY` | Backend runtime | `<public-anon-or-publishable-key>` for user-token clients; required even if a privileged key exists |
| `SUPABASE_SERVICE_ROLE_KEY` | Private backend runtime only | `<privileged-backend-key>` when existing pairing/controlled-action services require it; never in Vite, artifacts, screenshots or source |
| `WP_MANAGER_CONTROLLED_WRITES_ENABLED` | Backend | `false` until a separate operation-specific review |
| `VITE_WP_CONTROLLED_ACTION_UI_ENABLED` | Frontend build | `false` until separately reviewed |

No env file containing real values is included. Do not copy configured values into review comments or logs. Frontend values are compiled into the bundle: changing them needs a new build and review. A successful fixture build is not evidence of live configuration readiness.

## Development evidence

Run backend/frontend tests and builds with explicit synthetic overrides. Unit workers use a generated empty dotenv file and an explicit empty privileged binding, so neither ambient environment variables nor incidental .env files can repopulate a service-role key. Startup subprocess tests clear that override only inside their own synthetic temporary directories. Browser tests intercept all remote Auth/API requests and abort other external destinations. The suite includes PKCE and legacy confirmation, invalid cached identities, cross-tab logout during delayed verification, unsafe returns, forged admin metadata, foreign workspaces, invalid inventories, retry/empty/loading states, and existing mobile/visual regressions. Backend tests include real query construction over a synthetic fetch transport and no-WordPress-call ownership denial. Existing controlled-action/grant tests continue to cover identity binding, replay and ownership.

The Frontend navigation workflow keeps read-only permissions, publishes fixture screenshots and records the actual GitHub-assigned PR number rather than assuming #17. Development checks and Container validation continue unchanged. Counts and run URLs are recorded in the PR after validation; no live test is claimed by these checks. Existing audit warnings include low/moderate backend dependency findings (no high/critical at the configured threshold), an oversized frontend chunk warning, and deprecated action-runtime annotations on inherited pins. OS-image CVE scanning and a live security assessment are not performed by these checks.

## Live-verification checklist — owner authorization required first

1. Approve a bounded read-only verification scope for the existing project and runtime configuration. Use trusted secret handling; record only names/readiness, project match and redacted conclusions. Do not reveal values.
2. Compare existing profiles/WordPress tables, RPC grants, RLS ownership and migration history to the source. Do not apply migrations or repair data automatically. Historical malformed/legacy inventory records may be rejected by the new parser; check shape/HTTPS/UUID contracts with separately authorized access, not an automatic cleanup.
3. Verify email/password provider, confirmation policy, SMTP/delivery and exact allowed `/auth/callback` redirects. Testing a real signup/email flow creates Auth state and needs explicit additional authorization, a designated account and cleanup plan; it is not authorized by this task or by merge approval.
4. Verify existing trusted admin role assignment and two distinct authorized test identities against personal workspace and WordPress ownership. A real data/RLS test needs a separate approved plan. Shared organizations remain unavailable.
5. If separately authorized, exercise an explicitly designated WordPress test connection, proof/grant expiry, read-only inspection and safe error handling. Never use an arbitrary live site. Controlled writes remain out of scope.
6. Record current service/image/config baselines, non-root recovery and backup/restore evidence before any later deployment request. Existing Docker/systemd overlap and production recovery prerequisites remain in docs/production-remediation.md.

## Rollback and owner decision

This PR has no database migration or production operation. Development rollback is a normal revert of the PR, not a database rollback. A later separately approved application rollout must retain previous image IDs and frontend build/configuration, use the existing backup/recovery review, and verify health, auth rejection, dashboard inventory and routing after either rollout or rollback. Do not change Auth settings, rotate keys, disable guards or rewrite historical data to make a test pass.

The immediate owner decision is whether to approve this development PR. Separately decide whether to authorize or defer the live-verification checklist, distinguishing read-only configuration/schema review from real test-account/email/WordPress exercises. Neither approval grants deployment permission. No live correctness claim can be made until that separate evidence exists.

## Subsequent operational readiness review

See [offline contract audit and owner-only verification plan](operational-readiness.md) and [future rollout runbook](production-rollout-runbook.md). The follow-up [profiles security review](profiles-security-readiness.md) incorporates owner-supplied verified live metadata: `public.profiles` exists live. Proposed migrations now provide the repository baseline; live privilege remediation and exact provisioning-body review remain blocking. No live execution or rollout was performed by this task.
