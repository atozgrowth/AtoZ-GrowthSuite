# Tenant-bound Google Ads preparation — offline only

This stacked branch depends on PR #22 (`codex/agent-foundation`). It adds a tested contract and mock implementation seam, not an operational OAuth/MCP/API service. No route, provider transport, credential loader, production database migration, refresh scheduler or live advertising connection is installed. Default mode is disabled; only explicit `offline-test` mode runs the injected test contracts. No legacy Academy/staging identities or shared MCP admin credential are used.

## Concrete boundary

`TenantAdsAdapter` receives a server-verified actor, an authoritative connection repository, a provider interface, a private 32-byte envelope key and one trusted exact HTTPS redirect URI. The actor is not a body/header/model authorization claim: any future route must construct it from existing server Auth. Personal workspace must equal the verified user ID. Connection ownership, active status, monotonic revision and account bindings are resolved from server storage on every operation; callback/report parameters cannot supply their own bindings or permissions. Actor/configuration/resource binding snapshots prevent mutable caller/provider objects from changing authorization during awaits.

OAuth begin returns a random state and S256 PKCE challenge, stores only the SHA256 state digest, and encrypts the verifier. State records bind owner, connection, revision, exact trusted redirect and a five-minute expiry. Callback requires the same verified actor and atomically consumes the record **before** exchange. A state from before revocation cannot redeem after reconnection at a new revision. Provider exchange is not automatically retried; failure requires new state rather than replaying an uncertain authorization code. Callback error text never includes codes, provider messages or tokens.

Access/refresh token JSON is AES-256-GCM sealed with a random 96-bit nonce and authenticated data containing version, user, connection and purpose (`pkce` versus revision-bound `tokens:<revision>`). Tenant/connection/purpose swapping and tampering fail authentication. Caller-owned key bytes are copied. Real key management, rotation, old-key retention and ciphertext storage ACLs are prerequisites, not implemented infrastructure. Never put a vault key, OAuth client secret, developer token or sealed-content plaintext in a browser, Git artifact or log. GCM is an envelope primitive, not proof that a future storage implementation is correctly isolated.

Token persistence uses an atomic `saveTokensIfActive` owner/revision check. Token reads must atomically check active owner/revision too, and the envelope authenticates that revision so old ciphertext cannot be reused after reconnection. This prevents saving an exchange result after revocation. Reports revalidate binding revision/account authorization before returning results, preventing late disclosure after revocation. Expired credentials are denied; refresh is deliberately not implemented. The provider receives an abort signal and a bounded deadline; timers cannot preempt hostile synchronous JS, and cancellation of a real remote request must be implemented by its transport. Database calls also need independent server timeouts in a future adapter.

## Required durable repository implementation

`AdsRepository` has **no production implementation or in-memory fallback**. Test maps exercise the contract only; their concurrent callback test is not proof of a real SQL transaction. A future PostgreSQL implementation needs reviewed migrations/RLS/privileges and real concurrent integration tests:

- Owner-owned connection rows with active/revoked state, monotonically increasing revision and server-authorized account allowlist. No client-editable role/ownership columns.
- Private state rows keyed by digest; consume through one atomic conditional UPDATE/DELETE with owner, connection, revision, redirect and expiry predicates (or row lock in a transaction). Unique digests, bounded retention and server-only grants. Never SELECT-then-delete in separate transactions.
- Private encrypted token rows keyed by connection, owner and key version. Save through an atomic comparison against current active connection revision; only server credential access. No public token-select policy.
- Revoke invalidates outstanding state and token use through revision change; allowlist changes also bump revision. No cross-tenant cache or global fallback token.
- Redacted audit events may contain correlation ID, capability, outcome and timing/counts; never code/state/verifier/token/authorization header/provider payload. Durable audit, usage and history are not added by this seam.

No migration is added merely to suggest a storage layout. This branch cannot be enabled for production by setting an environment variable; there is no live service wiring.

## Read-only report

The sole report builds a fixed reviewed SELECT with selected campaign/metric fields, LAST_7_DAYS, campaign-ID order and LIMIT 500. No arbitrary GAQL, date expression, customer URL, login-customer header or mutation tool is accepted from the model/client. The authoritative account allowlist is checked before invoking the transport. `parseCampaignReport` from PR22 bounds/validates selected rows, drops unselected provider fields and preserves string int64 counters/micros beyond JS safe integer precision.

The result explicitly says `complete:false`, `maxRows:500` and `period:LAST_7_DAYS`; it is a bounded report, not complete account totals, billing or spend authority. Currency/timezone attribution and provider pagination are not implemented. Official Search response parsing, transport response-byte limits, API-version confirmation and accurate account currency/period reporting must precede a real dashboard.

## Migration away from recovered legacy runtime

1. Keep the recovered Google Ads repository as read-only provenance. Do not promote its shared admin initiation, hardcoded redirect/account mappings, project-per-tenant SQL or legacy environment identities.
2. Review a new Growth Suite OAuth client/consent configuration and exact redirect allowlist separately. Use current supported official Google Ads API version, developer-token access tier and applicable OAuth/App verification; the recovered v26 string is not evidence of approved/current support. No provider approval or OAuth flow occurred here.
3. Implement the durable repository above and a server-owned account authority resolver using supported official APIs. Account discovery alone is not proof of permission to modify an account. Do not populate allowlists from model output or editable metadata.
4. Add one transport that accepts the approved connection's encrypted credentials and fixed read query, validates response shape/size/pagination, enforces deadlines and performs zero automatic mutation/reconciliation. Google Ads OAuth scope may be write-capable; server-side read allowlists remain mandatory.
5. Run synthetic/isolated SQL and transport contract tests first. Real designated-account read tests need explicit owner authorization. Advertising writes, validate-only operations, spending, publishing and token/account operations are outside this batch.

## Test evidence and limits

Eleven new tests cover PKCE/state secrecy and replay, foreign actor/workspace, expiry, AEAD tenant/connection/purpose/tampering, fixed-query account authorization/int64 preservation, mid-exchange/report revocation, concurrent contract consumption, disabled/default behavior and redacted failures, reconnect state/token revision invalidation and provider deadline. All use synthetic data and an injected in-memory **test** repository/provider. No real Google, OAuth client, Ads account, Supabase or legacy infrastructure was contacted.

Parent PR22 also covers structured model tool plans and prompt-injection boundaries. This new adapter is not itself an LLM agent. End-to-end browser OAuth, real transactional storage, refresh/recovery, OS-image scanning and production readiness are not claimed by its unit tests. Production remains NO-GO.
