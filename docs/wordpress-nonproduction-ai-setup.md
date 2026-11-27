# WordPress AI Manager nonproduction configuration

PR #29 adds an optional server-side OpenAI Responses adapter and a durable usage ledger. It is **disabled by default**, and the backend refuses to instantiate it unless `APP_STAGE` is exactly `development` or `staging`. `APP_STAGE=production`, missing stage, missing provider selection or incomplete configuration cannot enable paid transport. No live provider credentials or customer prompt data are used in tests.

## Runtime configuration contract

The existing backend Supabase URL, anon key and service-role key remain server-only configuration. The service-role key is required for the usage RPC and private quota rows; never prefix it with `VITE_`, return it in status, or place it in browser configuration.

For a staging backend, use placeholders until the owner provisions the intended nonproduction environment:

```dotenv
APP_STAGE=staging
WP_MANAGER_DRAFT_WORKFLOW_ENABLED=true
WP_MANAGER_CONTROLLED_WRITES_ENABLED=true
WP_MANAGER_AI_PROVIDER=openai-responses
OPENAI_API_KEY=<server-only-secret-from-approved-secret-store>
WP_MANAGER_AI_MODEL=<reviewed-model-id>
WP_MANAGER_AI_ALLOWED_MODELS=<same-reviewed-model-id>
WP_MANAGER_AI_MAX_INPUT_TOKENS=8000
WP_MANAGER_AI_MAX_OUTPUT_TOKENS=2000
WP_MANAGER_AI_MAX_TOTAL_TOKENS=10000
WP_MANAGER_AI_MAX_ATTEMPTS=1
WP_MANAGER_AI_TIMEOUT_MS=15000
WP_MANAGER_AI_MAX_COST_MICROS=<worst-case-per-generation-ceiling>
WP_MANAGER_AI_INPUT_RATE_MICROS_PER_MILLION=<provider-price-in-microusd>
WP_MANAGER_AI_OUTPUT_RATE_MICROS_PER_MILLION=<provider-price-in-microusd>
```

The provider endpoint is fixed to `https://api.openai.com/v1/responses`; model IDs must appear in the server allowlist. `store:false`, no tools, strict structured output, a 64 KiB response cap, redirect rejection and the request abort signal are enforced. Prompts and generated content are not inserted into the usage ledger. Only owner/connection IDs, model, reserved/actual tokens and costs, status and timestamps are persisted. A verified 429 releases its reservation; uncertain transport/response outcomes are charged at the full reservation. Configured worst-case attempt cost must fit `WP_MANAGER_AI_MAX_COST_MICROS`.

If the provider variable is unset, the backend uses the deterministic offline mock. The staging UI reports which mode is active. There is no frontend API key and no client control over model, owner, site, quota or approval. The mock remains the only provider used by the disposable WordPress integration.

## Tenant quota provisioning

Migration `20261128090000_add_wordpress_ai_usage_ledger.sql` creates RLS-protected private tables and two `service_role`-only security-definer RPCs. It seeds no tenant quota, so model calls are denied until the owner separately reviews and provisions limits. Example **review-only** SQL (not executed here):

```sql
insert into private.wordpress_ai_tenant_quotas
  (user_id, monthly_limit_micros, per_request_limit_micros, max_requests_per_minute)
values
  ('<verified-auth-user-uuid>', <monthly-microusd-limit>, <per-request-microusd-limit>, <requests-per-minute>);
```

The RPC serializes a tenant's reservation, verifies the connected site belongs to that tenant, enforces the per-request/monthly cost ceilings and rate limit, and records each provider attempt before dispatch. Settlement is one-time and rejects token usage above the reservation. Usage rows have no prompt, response, token or API credential content. Quota administration is not exposed through customer or admin HTTP routes; updates require a separately reviewed privileged database operation.

## WordPress staging gates

The plugin's staging mode additionally requires `WP_ENVIRONMENT_TYPE=staging`, `ATOZ_GROWTH_NONPRODUCTION_MODE=true`, a configured HTTPS origin under `*.staging.atozgrowth.net`, and the explicit nonproduction write flag. Its outbound HTTP allowlist is limited to that backend prefix; production mode rejects the staging flags. Publishing needs separate backend and plugin flags and is disabled by default. The exact staging host, quota values, backup/recovery steps and supported test site remain owner decisions before any staging setup. No staging service or live WordPress site was changed for this PR.

## Migration and production blockers

The usage migration and PR #19 profile-security SQL remain proposals only. The usage migration adds two private tables, indexes, RLS, one quota reservation RPC and one settlement RPC, with execute access only to `service_role`; it does not modify existing profile/Auth privileges. The new `20261128100000_add_wp_taxonomy_media_and_revisions.sql` migration is additive: it extends the existing workflow action check and service-only grant/workflow RPC allowlists for `restore_revision`. It intentionally follows `20261128090000_add_wordpress_ai_usage_ledger.sql`, which also replaces the operation-grant RPC. It does not create public tables, change existing Auth/RLS policies or weaken exact owner/site checks. Apply only to a separately designated empty staging database after backup verification and owner review. Do not apply it to the existing hosted project or production without explicit approval.

No live provider credentials, Supabase database, customer WordPress site, VPS or production secret was accessed. A future authorized staging trial must still verify a real model response, measured provider billing, quota provisioning, staging Auth and site pairing, backup restore, provider data retention, and the actual runtime secret store. Exact staging preflight, secrets, migrations, rollback and approval record are in `docs/wordpress-staging-installation-runbook.md`. This PR does not establish a production entitlement or cost estimate; the owner must choose rates from the configured provider's current price sheet before setting limits.
