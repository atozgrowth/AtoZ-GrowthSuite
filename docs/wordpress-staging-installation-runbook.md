# WordPress AI Manager staging trial runbook

This runbook describes a future, owner-approved nonproduction trial. No staging system, hosted database, VPS, customer WordPress site, provider account, DNS record, or secret was accessed or changed while preparing it.

## Current readiness

The local disposable integration path now covers exact-approved draft creation/editing, post taxonomy and existing-image assignment, revision listing/restoration, publishing gates, readback, replay resistance, and uncertain-result reconciliation. The current package remains staging-disabled by default. A staging trial is **NO-GO** until every prerequisite below is assigned and verified.

## Prerequisites the owner must arrange

1. **Isolated identity and database:** designate an empty, nonproduction Supabase project or isolated Postgres/Auth deployment for staging. The application’s existing project `vigfmclcbibesrorjmut` has not been queried or changed and must not be used for a staging migration unless the owner separately authorizes that exact project. No new project was created as part of this work.
2. **Staging application:** choose one exact API hostname under the approved staging domain, terminate TLS, and ensure its network can reach only the designated staging database and approved WordPress test host.
3. **Disposable WordPress:** provide a fresh staging-only installation and synthetic editor account, with verified backup and restore access. Never reuse a customer site.
4. **Backups:** take a pretrial database and uploads backup; record timestamps, retention, encryption, and restore test output. Verify the backup by restoring into a separate disposable environment before enabling writes.
5. **AI budget:** select the model from the reviewed server allowlist and approve per-request, daily/monthly tenant quotas and current input/output price rates. Start with small ceilings and no retry beyond configured maximum. No paid request is made until the owner explicitly approves the budget and stores the secret.
6. **Recovery owner:** name the operator who can disable staging flags, revoke the synthetic WordPress connection, restore the backup, and inspect uncertain receipts.

## Secrets and configuration (placeholders only)

Store only in the staging secret manager. Never put server keys in frontend build variables, PR text, screenshots, logs, or the plugin ZIP.

Backend private variables:

```dotenv
APP_STAGE=staging
SUPABASE_URL=<isolated-staging-project-url>
SUPABASE_ANON_KEY=<staging-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<staging-service-role-key>
WP_MANAGER_DRAFT_WORKFLOW_ENABLED=true
WP_MANAGER_CONTROLLED_WRITES_ENABLED=true
WP_MANAGER_AI_PROVIDER=openai-responses
OPENAI_API_KEY=<owner-approved-staging-only-secret>
WP_MANAGER_AI_MODEL=<approved-model-id>
WP_MANAGER_AI_ALLOWED_MODELS=<approved-model-id>
WP_MANAGER_AI_MAX_INPUT_TOKENS=<small-limit>
WP_MANAGER_AI_MAX_OUTPUT_TOKENS=<small-limit>
WP_MANAGER_AI_MAX_TOTAL_TOKENS=<small-limit>
WP_MANAGER_AI_MAX_ATTEMPTS=1
WP_MANAGER_AI_TIMEOUT_MS=<approved-timeout>
WP_MANAGER_AI_MAX_COST_MICROS=<approved-per-request-ceiling>
WP_MANAGER_AI_INPUT_RATE_MICROS_PER_MILLION=<current-provider-rate>
WP_MANAGER_AI_OUTPUT_RATE_MICROS_PER_MILLION=<current-provider-rate>
```

Frontend public variables, only if a separate frontend preview is required:

```dotenv
VITE_SUPABASE_URL=<isolated-staging-project-url>
VITE_SUPABASE_ANON_KEY=<staging-anon-key>
VITE_API_BASE_URL=/api
```

The WordPress staging `wp-config.php` flags are independent:

```php
define('WP_ENVIRONMENT_TYPE', 'staging');
define('ATOZ_GROWTH_NONPRODUCTION_MODE', true);
define('ATOZ_GROWTH_STAGING_BACKEND_URL', 'https://<approved-api-host>.staging.atozgrowth.net');
define('ATOZ_GROWTH_NONPRODUCTION_WRITES_ENABLED', true);
// Leave false/undefined for the first draft-only trial.
// define('ATOZ_GROWTH_NONPRODUCTION_PUBLISH_ENABLED', true);
```

The API hostname must be a single reviewed HTTPS origin and the backend’s outbound WordPress allowlist must be limited to the disposable site. Staging flags do not grant production authorization; production stage and production WordPress installations must continue to reject these operations.

## Database migration procedure

Review the complete ordered set in `backend/supabase/migrations/` against the designated **empty staging database**. The additive capability migration `20261128100000_add_wp_taxonomy_media_and_revisions.sql` extends the existing action-type constraint and service-only grant/workflow RPC for safe revision restoration while preserving RLS and exact owner/site bindings. It intentionally follows `20261128090000_add_wordpress_ai_usage_ledger.sql`, which also replaces the operation-grant RPC. It must run after the base durable workflow and isolated publish migrations. Do not skip or hand-edit migration history.

Before any application, the owner reviews the diff, backup verification, target project ID/hostname, and generated migration list. Apply only through the approved staging change process, then verify migration history and that the service role is the only role able to execute privileged RPCs. This runbook does not authorize applying migrations to the existing hosted project or production.

## Controlled trial sequence

1. Confirm the exact project ID, API hostname, WordPress hostname, backup restore evidence, owner/recovery contact, and budget in a recorded approval.
2. Deploy the reviewed backend/frontend/plugin build to the designated staging systems only. Keep publishing disabled.
3. Apply reviewed migrations to the isolated staging database; verify RLS, RPC privileges, connected-site ownership and quota rows.
4. Configure the synthetic WordPress account, HTTPS backend callback, and staging-only flags. Pair only the disposable site.
5. Verify read-only inventory first. Create one synthetic post with selected existing categories, tags and an existing image. Review the exact proposal; approve and execute once. Verify terms, thumbnail, status and content by independent readback.
6. Inspect its revisions. Propose restoration of one selected revision, compare its exact title/content and digest, approve, execute once, and independently verify draft status and restored content. Confirm the previous state remains available as a new WordPress revision.
7. Verify replay attempts, stale timestamps, foreign-site IDs, unsupported media, missing capabilities, quota denial and provider failure all fail closed. Publishing remains disabled in this first trial.
8. Review usage reservations and settlement in the isolated ledger; confirm actual cost remains under approved caps. Do not use customer content or real user accounts.
9. Disable staging write flags, revoke the synthetic connection, and verify read-only mode. Retain receipt/audit records and evidence.

## Stop and rollback

Stop immediately on wrong project/site identity, missing backup verification, permission mismatch, unexpected publish, digest/readback mismatch, duplicate action, uncapped provider usage, or any production hostname. Disable `WP_MANAGER_CONTROLLED_WRITES_ENABLED` and `WP_MANAGER_DRAFT_WORKFLOW_ENABLED`, set the plugin staging write flag false, revoke the test connection, and preserve logs/receipts. Restore the disposable WordPress/database backup only after reviewing external side effects and obtaining the recovery owner’s go-ahead. Never auto-replay an uncertain action, delete receipts, or run destructive SQL as a rollback shortcut.

## Approval record required before the trial

- Exact staging Supabase/Postgres project ID and confirmation it contains no customer data.
- Exact API hostname and disposable WordPress hostname.
- Backup and restore verification artifact.
- Approved migration commit and migration list.
- Synthetic editor identity and recovery operator.
- Model ID, per-request and aggregate spend limits, rates, and secret-store location.
- Explicit approval to enable draft writes for the stated time window.
- Explicit separate approval if staging publishing is ever requested.

Production remains NO-GO. This runbook does not authorize production flags, live database changes, VPS changes, DNS changes, deployment, or publishing.
