# Phase 2 consolidated development report — 14 November 2026

## Outcome and branch dependencies

Development GO for code review and isolated testing; production NO-GO. All PRs remain Draft/open, main is unchanged, and no deployment, merge, live SQL/Auth/customer/provider/VPS/DNS/Cloudflare/R2 operation occurred. Lost uncommitted files after an environment restart were reconstructed from saved tool history, then tested again; interrupted tests were not counted as success. The successful first15 actual-core checks and extended18-check results were preserved. No project setup or onboarding was restarted.

| PR | Exact reviewed head | Result |
| --- | --- | --- |
| #19 security | 6bbc1958e8b151bfbc5b8d3af354d2a6570132c8 | Independent code review: no new blocker; nine CI checks passed; live remediation still unauthorized/unperformed |
| #20 branding | 58bf9e5332e3a74e356db11bc3f0fd36396d5641 | Fixed real keyboard-focus contrast issue; frontend11/browser41/build and eight CI checks passed |
| #21 read-only plugin | 2924f3a504e42fc478cbb2b46f9c1b83873c41f9 | Fixed IPv6-literal resolution/TLS identity; backend49/build and eleven CI checks passed |
| #22 shared agents | 00bd58402078eb71e299e34ceae042462d45fa0f | Independently reviewed immutable plan boundary; nine CI checks passed |
| #23 tenant Ads adapter | fae3a854ad7d29d6b2fc97b816927413fcd4c91a | New stacked PR on #22; backend64 (11 new mocked contracts), build/audit and nine CI checks passed |
| #24 durable WP drafts | Final exact head recorded in PR24 and final report | New stacked PR on #21; actual core, persistent authorization, content UI and receipt reconciliation |

Recommended **conditional** merge sequence after explicit owner authorization: #19 → #21 → #22 → #23; #20 can proceed independently but before final #24 integration; #24 last after current-head review/revalidation and retargeting as necessary. None was merged. Four original diffs apply together; the shared lockfile patch is identical and applied once. The expanded six-branch check needed a clean automatic three-way application of WordPressManagerPage to preserve branding plus new controls, not a PR merge. Combined validation: backend79/frontend14/browser48, both builds, eight ordered migrations, old six RPCs plus new seven durable RPC contracts passed. These are local combined results, not an invented merged-main CI run.

## Completed genuine WordPress workflow

Plugin0.5.0 and Fastify support post/page drafts and approved draft editing: authorized connected site → offline instruction → structured proposal → exact text preview → explicit checkbox/approval request → atomic execution claim → restricted plugin operation → independent actual draft readback → persistent activity/audit. Editing binds current timestamp and content digest; stale changes fail closed. No publishing, general HTML/editor, arbitrary PHP/shell/SQL, plugin updates or production writes are enabled.

Private PostgreSQL grant/action/audit tables replace production read-grant memory fallback. Tokens are stored as digests; owner/current connection/site/scope/pagination/post/action/type/payload/expiry are bound. Concurrent consumption/claims are atomic. Private tables and fixed-search-path server RPCs deny browser roles. Missing privileged storage returns unavailable, never silent in-memory production authorization. New schema remains a review-only migration; no live migration executed.

WordPress-side receipts use unique INSERT IGNORE, not add_option UPSERT; draft edits check InnoDB and lock the post row. Capabilities, safe HTML equality, wp_slash, digest verification and current identity are enforced. A simulated lost response is repaired by a **read-only** exact-bound receipt plus another draft readback, with zero repeat writes. Missing/changed/invalid receipts remain uncertain. The UI exposes Verify existing receipt and never automatically retries a write.

Explicit test-only switches are required independently in backend and plugin. Plugin malformed test configuration cannot fall back to production and blocks other outbound HTTP. The actual fixture uses a new internal Docker network, no published host ports, cleared proxies, synthetic users/database credentials and disposable storage. Fixture-only admin control is excluded from the plugin ZIP and production images.

## Actual core evidence versus mocks

The extended real WordPress7.1.4/PHP8.3 + MariaDB + PostgreSQL17 test passed **18 scenarios**: activation/external HTTP block; real plugin pairing/PG challenge; pairing replay/unauthorized access; inspection and posts/pages/media/plugins/themes; durable replica/concurrent grant consume; expiry/private denial; exact approval/concurrent post execution; unpublished page/readback; foreign owner denial; draft inspection/edit; stale edit/uncertainty; published/missing-grant rejection; actual WordPress capability denial; persistent history; lost-response reconciliation with no second write; concurrent plugin receipts with one created draft; post/page action-type tampering; revocation invalidation.

Actual core, PHP plugin HTTP and both databases are real. Auth prehandler, deterministic model provider and fixed internal transport origin mapping are synthetic. No live Supabase/JWT/email/model or external site was tested. Browser44 tests intercept synthetic Auth/API and are distinct from core evidence. PHP standalone checks: legacy21 + draft50 + reconnect7 on PHP7.4/8.3; PHP7.4 is only a legacy syntax/contract target, not a production recommendation. Package2 tests prove deterministic ZIP and tamper rejection. PostgreSQL tests exercise real parallel consume/claim, exact action type, owner/expiry/revocation/RLS and audit contracts.

Plugin ZIP, actual-core JSON/checksum/source evidence and nine-screen desktop/mobile gallery are downloadable Actions artifacts linked in PR24. Hosted upload/download/checksum/source verification is required; initial download-name/ID-directory failures were corrected without weakening verification. Artifact URLs/IDs and final CI conclusions are recorded in the PR after completion. Artifacts expire and are not published production releases. Inner ZIP SHA256 is also recorded in final report and manifest.

## Security review and scans

See independent-review.md and redacted JSON. Original private function review is reused; no sensitive definition is published or auto-attested live. #19's TRUNCATE/TRIGGER/MAINTAIN/REFERENCES changes remain proposals and live privileges are not reported fixed. IPv6 literal transport now preserves certificate checks/IP SAN identity and original Host; focus contrast is fixed without a risky full-theme rewrite.

Fresh Gitleaks8.30.1 scan of all accessible local refs/history: **55 commits, zero findings** at the application-scan checkpoint; final scan count is recorded in PR24. This is not proof against unfetched remote refs or all entropy-based secrets. Both application npm audits and isolated pg test-dependency audit report zero. No new runtime framework was introduced; pg8.16.3 is pinned test-only/MIT.

OS scans were performed, not skipped. WordPress fixture:5critical/154high; Node24 fixture:1critical/34high; MariaDB:0critical/high; PostgreSQL:0findings. New application backend:0critical/high,1medium. Inherited frontend runtime had4critical/78high; updating to maintained digest-pinned Nginx1.30.6 reduced it to **1critical/12high** (plus4medium/44low). These unresolved package findings remain production blockers, not claimed fixed or exploitable proofs. application-os-scan.json records exact local image IDs, Dockerfile hash, scan source scope and package findings; full raw image metadata/environment was not published. Fixture images must never be promoted. Vite ~542KB chunk and inherited action-runtime annotations remain warnings. Docker's key-name warning concerns synthetic/public frontend build input, not a secret-key deployment.

## Other work and honest limits

Official logo files remain absent in repository and current main contents API (404): frontend/public/branding/logo-primary.png and frontend/public/branding/logo-horizontal.png. No network bypass or generated substitute was used. Exact display name and accessible pink/teal system are maintained by #20; full dark theme remains unavailable, readable light rendering under dark preference is tested.

#23 adds tenant/revision-bound OAuth state, PKCE and encrypted vault contracts (AES-GCM tenant/connection/purpose/revision AAD), atomic consumption/storage interfaces, account allowlists, bounded fixed-query reporting, deadlines and revocation checks. All new tests mock those persistence/provider contracts; no durable production OAuth repository, live route, refresh workflow or Google account activity is claimed. It does not require paid credentials.

Incomplete: automatic backend reconnect challenge transition (plugin admin nonce/capability reset preserves site UUID, revoked backend connections cannot silently reassign); automatic uncertain-state resolution without a valid receipt; grant/receipt retention cleanup; distributed scheduling; general revisions/rollback UI; broad rich HTML; external account/model/auth testing; production enablement. Shared provider interfaces and durable approvals are in place, but real model and merged #22 runner integration still need a separately reviewed adapter. No fake provider success or metrics were added to production screens.

## Owner decisions and next batch

Review current heads and dependency order. Separately authorize exact live privilege/migration remediation only after backup, engine/version/schema/drift/lock and non-destructive postcheck review. No repeat of the completed private provisioning review is requested unless its definition changed. Resolve remaining OS findings and supply/permit official original assets. Verify Docker/systemd ownership, non-root recovery and backup/restore evidence before any rollout. Any real designated WordPress/Auth/provider tests require their own bounded authorization.

Next development batch: owner-bound durable backend reconnect, cleanup/retention and receipt reconciliation policy, revisions/readback rollback foundations, container package remediation, and only then a real provider adapter on designated non-production identities. Do not activate publishing, billing, paid messaging or advertising while these gates are closed.
