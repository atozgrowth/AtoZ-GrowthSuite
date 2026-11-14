# Offline agent/tool foundation

This branch adds an **offline proof of concept**, not a connected AI product. No model/provider SDK, MCP server, OAuth connection, customer-data access, persistent job service or public route is activated. Current dashboards continue to label unfinished modules unavailable. Existing personal account workspace boundaries remain unchanged.

## Execution seam

`backend/src/agents/read-only-runner.ts` accepts a model-portable `InterpretationProvider`, server-owned principal/resource bindings and two explicitly named read adapters. The model returns an untrusted candidate plan; exact-key validation, tool allowlisting, UUID/account validation and resource ownership run after interpretation. Extra approval/tenant flags and unknown/write tools are rejected. Copied bindings prevent mutation during interpretation from granting access. Prompt-injected website text cannot grant a tool or resource. Requests/results are bounded and the deadline covers interpretation and up to two attempts for explicitly transient **read** errors. Abort signals require cooperative real adapters; timeout is not a guarantee of stopping an arbitrary third-party process. Error details and raw prompts/results never enter the audit event.

The caller must construct the principal from existing server-verified Auth and authoritative ownership records, never body headers, model claims, cached roles or editable metadata. The runner is not an authentication mechanism and is intentionally not wired to an HTTP handler. A real route must independently authenticate and revalidate ownership on every request. Actual adapter payloads require selected-field sanitization; the runner's JSON size limit is not a secret scrubber.

Audit events include only generated execution ID, tool, outcome and attempt count; request-local elapsed time and attempts are usage foundations, not billing. The injected audit callback has no storage implementation. Audit failure returns failure. No durable history, distributed retries, billing counters, queue lease, scheduler or production metrics is claimed. Read retries are bounded; writes must never reuse this retry mechanism.

## Write/approval boundary

All tools in this proof are read-only. Even a model-supplied `approved:true` is denied. Future WordPress write tools must delegate to the existing controlled-action service and durable database proposal/approval records: user+site+exact payload digest, expiry, single-use/atomic state transition, idempotency and post-execution verification. The model never approves actions. Existing live writes remain disabled. No parallel homemade approval store is added.

Proposed shared agent configurations (content/design/maintenance/security, ads analysis, business profile, WhatsApp) should reuse this seam in one bounded worker process, not separate processes for every persona. Before any live adapter: authoritative entitlement checks, encrypted per-tenant token storage, provider/API approval, durable audit/job ownership, cancellation and rate limits, tested result verification and deployment approval are required. Model-provider portability is an interface only; no model was called in this proof.

## Google Ads report contract

`integrations/google-ads-report.ts` validates selected campaign/metrics rows with at most 500 rows, strict IDs/statuses, unique campaign IDs, finite nonnegative conversions and string int64 counters/micros. It drops other response fields, preserving micros beyond JavaScript's safe integer range. It does not supply an OAuth client, GAQL injection surface or live transport. A future adapter must use server-bound customer/account selection, fixed reviewed report builders, date validation and pagination before this parser. It cannot reuse a legacy global MCP credential as tenant authorization. See the recovery audit for repository evidence and blockers.

## Reproduce

With existing development dependencies: `npm --prefix backend test`, `npm --prefix backend run build`, then `node backend/dist/agents/demo.js`. The demo uses synthetic principal, mock interpreter and mock tools only; it checks two authorized reads and rejects foreign-site and shell-tool plans. Its JSON explicitly says synthetic and zero live/model calls. GitHub's Agent offline proof workflow stores the same report with read-only permissions and no production secrets.

Regression coverage includes prompt-injection tool/tenant boundaries, mutable resource bindings, malformed plans, request limits, redacted audit, bounded retries, provider/adapter timeout, output size/serialization and audit failure. This is boundary testing, not a claim that a real LLM is generally immune to prompt injection. No competing agent framework is installed without a validated need; see dependency evaluation.
