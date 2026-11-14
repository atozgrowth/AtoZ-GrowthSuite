# Authorized content-provider bridge

This branch extends PR22 without copying PR24 or changing its approval/storage implementation. It is a proposal-only read tool, not an execution agent. The existing runner now permits optional `wordpress.contentProposal` only for server-authorized site bindings. Unconfigured adapters are denied. Existing WordPress inventory/Ads tools and tests remain functional.

## Integrate in an isolated combined checkout

`createAuthorizedContentProvider` in `backend/src/agents/content-provider.ts` returns a structural implementation of PR24's `DraftProvider`: `generate({ instruction, postType }) -> { title, content }`. Inject it into `DraftWorkflowService` in place of `OfflineDraftProvider`, leaving default offline behavior available. No route/provider is globally replaced by this branch.

The factory requires server-verified PR22 Principal, an authoritative `{ ownerId, workspaceId, connectionId, siteId, revision }`, a current-binding `authorize(binding, signal)` callback, model interface, limits and redacted audit callback. Validate DB ownership/revision/revocation through that callback before and after generation. Do not construct this context from a model, request body, cached role or editable user metadata. It is not Auth verification or a persistent entitlement store. The root combined test must inject its fixture SQL binding check; no production key/account is needed.

The server chooses the content tool. A model returns **only** title and plain-text paragraph arrays under the frozen explicit schema; extra fields, roles, tenant IDs, approvals, tool calls, HTML titles, malformed usage and oversized output fail closed. Paragraphs become escaped `<p>` text, not arbitrary rich HTML. Input page content/instructions are untrusted data. Immutable copied principal/binding/schema and the existing runner's canonical immutable tool plan prevent async mutation from granting a tool/resource. Generation never approves or executes a WordPress action. The unchanged durable workflow must preview, digest, approve and independently verify every later write.

## Budgets, retries and usage

Configure positive input/output maxima, cumulative reserved-token limit, one/two maximum attempts, deadline and server pricing as **decimal integer strings** of microcurrency units per million tokens. Costs use BigInt with ceiling, not imprecise JavaScript floating-point currency. The provider instance synchronously reserves the full configured input+output allowance and maximum cost before each model call, including a transient retry. Concurrent calls share that instance's reservations; provider-reported low usage never refunds or expands them. Failed/timed-out generations retain reservations. Usage events contain only execution ID, attempt, reserved and reported counts/cost, never prompt/output/key data. These are per-instance process-local safety counters, **not durable billing, cross-process metering or proof of a provider invoice**.

Input/output validation uses conservative UTF-8 byte caps in token-budget units, not a claimed exact tokenizer. The prepared adapter's input cap includes system/schema request overhead. Before paid use, select an audited model-specific tokenizer/context limit, current prices, durable per-tenant metering and provider spending caps. Do not assume arbitrary model tokenization has a universal byte equivalence. The max-output token request is sent to the provider; local validation checks reported counts and byte bounds again. No real-provider budget efficacy is claimed from mock tests.

Only explicit transient generation failures retry, at most once, within the original runner deadline and reservation budget. Generation is read-only with respect to WordPress but a future live model call can itself be billable: each retry must reserve its own maximum cost. Authentication, ownership and malformed output do not retry. Timers/AbortSignal are cooperative; they do not preempt synchronous hostile code or hard-limit memory before serialization. Future transports must bound response bytes before parsing and honor cancellation.

## Prepared real adapter — disabled

`createPreparedResponsesModel` fixes the endpoint to `https://api.openai.com/v1/responses`, server-allowlists the model, sends strict JSON-schema output, `store:false` and max-output tokens, accepts only completed assistant output-text messages, and rejects refusal/incomplete/tool-call responses. It receives an **injected transport**, never imports fetch, reads process.env or loads credentials. It is disabled unless explicitly enabled by trusted construction; unit tests enable only mock transport. No live or paid request is made or authorized.

Current request field structure was checked against `openai/openai-node` Responses TypeScript source through GitHub (max_output_tokens, text.format json_schema/strict). This is source-contract verification, not live provider/model availability, price, retention or API-access verification. Authentication, credential vault, model-specific tokenization, response-size streaming guard and real transport remain owner-reviewed integration work before activation. No production model ID or credential is hardcoded.

## Verification and boundaries

Tests cover owner/site/revision checks, mid-flight revocation, prompt-injection/extra-field rejection, escaping, immutable bindings, cumulative/concurrent budget reservations, low-usage non-refunds, BigInt limits, bounded retry, late timeout, sparse/oversized output, prepared-adapter default denial, fixed schema request, refusal/tool/error sanitization. Existing runner and app tests continue. Final exact counts/CI links are recorded in the draft PR after checks complete.

No new runtime dependency/framework/infrastructure, persistent production model usage, WordPress execution capability, automatic approval or public route is introduced. Draft writes remain gated by PR24's isolated-only controls. Production remains NO-GO pending all existing security, schema, infrastructure, credentials and real-integration approvals.
