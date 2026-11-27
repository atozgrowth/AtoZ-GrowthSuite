# Product integration boundaries and next increments

This document describes architecture and approval dependencies, not completed provider integrations. Existing personal workspaces are account-owned (`workspaceId = verified user id`); shared organization membership, teams and delegated provider scopes must not be inferred from editable client metadata. Unavailable product modules must remain labelled unavailable. No billing, payment, message sending, ads changes or provider publishing is activated.

## Shared adapter contract

A future provider adapter receives a server-created execution context: verified principal/workspace identity, server-resolved connection identity, allowed capabilities, deadline, request ID and bounded usage budget. Models choose only registered tool names and schema-validated arguments; they cannot select tenant IDs, tokens, arbitrary URLs, SQL/PHP/shell or approval state. Connections reference secrets in server-only storage; data returned to the model must be bounded/redacted and treated as untrusted evidence, never instructions.

Read path: verified request → tenant/connection authorization → feature availability/entitlement check → fixed read tool → bounded provider response → structured report/audit. Write path adds canonical exact-payload proposal, independently issued short-lived approval, atomic single-use reservation, controlled execution, readback verification and redacted audit. A framework or in-memory POC is not a substitute for durable cross-process approval and idempotency records. Uncertain writes must enter reconciliation, not automatic retry.

Use one lightweight orchestration service with reusable configurations (content/maintenance/security/ads/reporting/communications) before introducing agent-specific processes. Queue infrastructure requires measured need. Scheduling, billing and organization permissions remain future work; do not provision Redis or provider infrastructure for placeholders.

## Module readiness and integration dependencies

| Module | Current batch status | Official API/auth requirements and next development step | Closed gates |
| --- | --- | --- | --- |
| WordPress AI Manager | Existing pairing, expiring-grant inventory and controlled-action architecture is the first product priority; see separate WordPress capability audit/PR | Preserve WordPress capabilities, site identity, opaque expiring single-use grants and owner authorization; expose only already-tested site tools. Native block editor can provide a future Gutenberg-compatible preview rather than embedding a new editor | No live connection, plugin install, maintenance write or production controlled action |
| Google Ads MCP | Accessible existing repository recovered; 23 selected offline boundary/report tests passed; [audit](google-ads-recovery.md) | Use Google Ads official API; Google Cloud OAuth consent/access approval and developer-token tier required. Reconcile legacy project/account assumptions and confirm current API version. Server allowlist must enforce read-only despite write-capable OAuth scope | No account access, spend, campaign writes, validate-only call or token issuance |
| Meta Ads / Business Suite | Architecture only; no connected accounts, working OAuth adapter or live insights claimed | Official Meta Graph/Marketing APIs; reviewed app/business verification, App Review/advanced access where required. Request only reviewed permissions such as ads_read for reporting and asset-specific permissions; confirm exact current API/product permission requirements before implementation. Server-bind business/ad-account selection | No posts, creative uploads, campaign writes or ads spend |
| Google Business Profile | Architecture only; no location/review adapter or OAuth flow claimed | Official Business Profile APIs, approved API access and Google OAuth `business.manage` scope where applicable. Server-bound location registry; review current supported endpoints, quotas and account restrictions. Read inventory first; review replies/posts remain proposals | No profile edits, review replies or business posts |
| WhatsApp Business | Architecture only; no onboarding, contacts store, webhook or sender claimed | Official WhatsApp Cloud API, Meta business/app permissions and business-number onboarding. Verify current whatsapp_business_management / whatsapp_business_messaging requirements and app access. Webhook signature verification, deduplication, explicit opt-in ledger, opt-out suppression, template eligibility and delivery event correlation precede campaigns | No messages, paid operations, number registration, template submission or bulk sending |

Scopes above are planning references, not claims that an application has permission or passed App Review. Provider requirements change; consult official documentation and request account-specific approval before any real integration. Do not scrape unsupported endpoints or use unofficial WhatsApp/browser automation. Existing-number coexistence is eligibility/provider dependent and is not promised.

## Useful next independent increments

- WordPress: finish tested read-only technical health/inventory and deterministic installable plugin packaging; then bounded content draft/edit proposals with exact-payload preview and durable approval, not publishing.
- Agent foundation: use synthetic tools to prove auth isolation, unknown tool rejection, prompt-injection-resistant argument validation, deadlines, usage limits and redacted outcomes. A real model SDK is justified only when it saves measured work while retaining these controls.
- Google Ads: reviewed pure reporting-contract extraction and mock transport adapter from the recovered revision; no legacy database migrations or routing copied wholesale.
- Meta/GBP/WhatsApp: one genuine read-only/synthetic contract at a time after the main WordPress MVP; avoid generating large speculative scaffold trees for incomplete products.
- Shared platform: feature availability stays server-controlled; module cards must not show fabricated connection success, customers, metrics, subscriptions or usage. Add durable authorization/audit/usage persistence only through reviewed schema proposals and isolated tests.

## Operational prerequisites

Before any live rollout: resolve the profiles privilege review in PR #19; inspect the existing deployment topology and Docker/systemd overlap under separate authorization; verify recovery and backups; approve immutable production-configured images; verify secrets isolation and redacted telemetry. Provider token rotation, live OAuth, webhooks, real account tests and all production writes require separate explicit authorization. Development PR approval alone does not open those gates.
