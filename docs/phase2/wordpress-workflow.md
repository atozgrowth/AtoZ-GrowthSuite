# Phase 2 WordPress draft workflow

This feature is stacked on the existing WordPress workflow branches and is not merged into main. Review the exact PR base/dependency chain before landing. Production gates stay closed.

## Working development flow

The existing authenticated Manager exposes inspection, posts/pages/media/plugins/themes, the offline mock assistant and a server-side OpenAI Responses adapter for an explicitly configured nonproduction stage. The configured adapter is model allowlisted, tool-free, structured-output-only, time-limited and uses a fixed HTTPS host. Proposals are tenant/site bound, escaped and require exact approval. Existing drafts bind ID/type, modified timestamp and content digest. Publishing is off by default and requires separate backend and plugin test/staging flags, post-type capability, unchanged target, exact approval and independent readback. No live provider credentials or paid requests were used by this development batch.

PostgreSQL private tables persist workflow payload/digest/status, redacted event history and digest-only short-lived grants. Server-only fixed-search-path RPCs issue/consume/revoke grants and create/get/list/transition actions. Grant consumption and execution claim are atomic; browser roles have no private-table/RPC access. Current owner/site/connection/scope/page/post/action/type/digest conditions are checked on consumption. No service key means read services fail closed, not an in-memory production fallback. Existing in-memory stores remain injectable unit fixtures only. New object grants explicitly reset service defaults to minimal table access; this does not mutate existing profiles privileges.

Backend writes require all three: NODE_ENV=test, WP_MANAGER_DRAFT_TEST_MODE=isolated, WP_MANAGER_CONTROLLED_WRITES_ENABLED=true. Plugin writes additionally require WP_ENVIRONMENT_TYPE=local, explicit isolated mode/backend URL/write flag and a valid configured local WordPress actor with edit capabilities. Production read configuration is preserved; malformed isolated configuration never falls back to a production URL. Test callbacks allow only the fixed backend origin/path, with no credentials, arbitrary ports or redirects. Actual tests use no external WordPress site or live Supabase account.

## Plugin 0.7.0 safety

Restricted endpoints create unpublished posts/pages and inspect/edit existing drafts with wp_kses_post equality, capabilities, canonical payload verification and independent backend one-use authorization. Publish remains disabled unless the backend and WordPress independently opt into the disposable test or a WordPress `staging` environment; publishing a draft also requires edit and publish capability, exact approval, unchanged-content checks and independent readback. Staging uses a configured HTTPS backend subdomain under `*.staging.atozgrowth.net` and denies the production WordPress environment type. HTML is not silently changed after approval. Generated content always passes the same plain-text-to-paragraph sanitizer, regardless of mock or model provider.

A durable unique option receipt is claimed with INSERT IGNORE and rows_affected=1. WordPress add_option's UPSERT was rejected as a concurrent claim primitive. Existing receipts bind action/digest/type/connection and current draft state. Edits use InnoDB transaction/row locking, stale timestamp/content checks and a per-post claim. Receipt/audit history is not an absolute promise that arbitrary third-party WordPress hooks or external side effects can be rolled back. No automatic write retry occurs after uncertainty.

The plugin now provides an authenticated, nonce-protected local reconnect reset preserving site UUID; backend revoked connections still cannot be silently reassigned. **Automatic backend reconnect/re-pair completion is not implemented**: a reviewed owner-bound challenge transition strategy remains follow-up work. No claim of complete reconnection is made.

## Receipt reconciliation and failure recovery

POST /api/wp-manager/drafts/:id/reconcile is read-only with respect to WordPress. Only the verified owner of a current connected site can use it for executing/uncertain actions, with the exact digest. A fresh scope/action/type/digest-bound receipt grant authorizes GET /drafts/receipts/:id. Backend validates receipt identity and content, independently reads the actual draft again, and only then marks succeeded. Missing receipts, changed content, revoked connections and unverifiable results stay uncertain. The UI offers Verify existing receipt, never automatic resend. Real lost-response testing proves no second write.

Cancellation/reservation retention, automatic cleanup of expired grant records, distributed scheduling, content revisions/rollback UI and general rich HTML remain incomplete. Do not delete receipts or grant history as an automatic recovery mechanism. A human-reviewed reconciliation/retention policy is needed before production enablement.

## Validation distinction

PHP standalone fixtures validate local configuration, capabilities, unsafe input and receipt contracts. Browser tests intercept synthetic Auth/API responses and prove navigation/preview/approval/error/mobile behavior. PostgreSQL17 tests execute actual migrations and concurrent claims/consumption. The separate integration/wordpress harness installs **actual WordPress7.1.4/PHP8.3 with MariaDB**, activates this plugin, serves actual Fastify routes/PG primitives and performs HTTP draft operations/readback. Auth prehandler, deterministic content provider and fixed internal WordPress origin mapping are synthetic; no live Supabase JWT/email/provider test is claimed.

The PR #28 development run passed 20 actual WordPress 7.1.4 scenarios across seven local migrations. PR #29 adds a real-Postgres quota/usage ledger test and controlled fake-provider transport tests; it does not use external model credentials. Final per-head evidence enumerates exact scenarios and records source revision/dirty state, core version and image digests. Only clean final CI artifacts should be treated as revision-bound evidence.

## Security and rollout gates

Original assets remain absent at frontend/public/branding/logo-primary.png and logo-horizontal.png; public R2 requests were not retried/bypassed. PR20 supplies current canonical branding/accessibility separately. OS scans found critical/high package findings in the isolated WordPress/Node fixture images; see fixture-os-scan.json. They are not production candidates or a clean scan. No live privilege remediation occurred. Existing recovery/backups, Docker/systemd ownership, immutable production configuration, exact migration review/application and designated real Auth/WordPress verification gates remain required. Merge approval is not live SQL or deployment authorization.

Rollback is code/image rollback to the preceding reviewed read-only plugin/backend, leaving durable records for investigation. Do not drop tables, restore dangerous browser grants, automatically resend uncertain actions or change production callback configuration. Any live data/schema recovery needs separately approved backups and exact commands. No automatic deployment or migration workflow was added.
