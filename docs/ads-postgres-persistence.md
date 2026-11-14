# Tenant Ads PostgreSQL persistence — review-only development

This PR stacks on PR23; PR23 depends on PR22. No existing PR was retargeted or merged. It adds an actual PostgreSQL implementation of the existing AdsRepository contract, not a live Google integration. No route, provider credentials, OAuth account, advertising request, spending, token refresh or production connection is activated.

## Persistence and authorization

`PostgresAdsRepository` receives an injected server-only pool; it never loads credentials or connects on its own. A future pool must use private server credentials and never browser roles. Existing adapter construction/actor validation still requires verified personal workspace ownership; a model, cached metadata or request header is not authorization. No production pool factory is provided.

A CLI-generated migration creates three private RLS-enabled tables: owner/revision/account-bound connections, hashed OAuth states with encrypted PKCE verifier, and encrypted token envelopes. PUBLIC/anon/authenticated receive no table privileges. The service role receives only SELECT/INSERT/UPDATE/DELETE and private schema USAGE, not TRUNCATE/TRIGGER/MAINTAIN/REFERENCES. No new public SECURITY DEFINER RPC is exposed. SQL is a review proposal, applied only in disposable fixtures here.

All sensitive values stored in state/token rows are AES-GCM envelopes supplied by the existing adapter. Schema constraints enforce exact envelope keys/format and reject plaintext/extra fields. Encryption keys are not stored by this repository. Existing AAD binds tenant, connection, purpose and token revision. Key management/rotation, KMS integration and provider-side revocation remain deployment prerequisites, not implemented production services.

State creation, consumption, token write/read and revoke/rotation use a connection-row transaction boundary. State consumption atomically checks digest, owner, connection, revision, redirect, unused state and **database** expiry; a caller's forged input clock cannot resurrect a state. Token saves serialize with revocation; whichever operation wins, revocation leaves no usable token row. Expected-revision rotation allows one concurrent winner, keeps ownership, invalidates old state and removes old encrypted tokens. Owner IDs and account lists must come from trusted Auth/provider verification; account rotation is not a public self-assertion endpoint.

Revocation here means local binding/token invalidation. No upstream OAuth revocation request is made. A read already in flight cannot be recalled; the adapter rechecks binding/revision before returning its report. Read reporting remains fixed-query, account-allowlisted, bounded and marked incomplete at 500 rows. It never accepts arbitrary GAQL or writes.

## Actual versus mocked tests

`python3 integration/ads-postgres/run.py` starts a fresh internal Docker network, PostgreSQL17 and a Node fixture with no host ports/proxy. It applies only the new persistence migration to a synthetic auth.users schema; separate combined validation checks ordering with the other repository migrations. The Node fixture uses real PostgreSQL transactions and concurrent clients and the actual adapter/repository. **Provider exchange/report responses are mocks**, not Google calls. No Supabase project or Auth record is accessed.

The proof covers private/RLS/browser denial, ownership, hashed/encrypted state, concurrent callback one-use, encrypted vault plus selected report fields, forbidden account, DB-clock expiry, owner/redirect mismatch, expected-revision rotation, stale state insertion, AAD isolation, schema plaintext rejection, revocation during exchange, foreign revoke/rotation, ten token-save/revoke races and disabled mode. Evidence lists exact check count/core version/source revision/dirty status and never includes keys, states, code, ciphertext, tokens or user content. CI upload/download verifies checksum and source revision.

Current public Supabase changelog/RLS markdown fetches returned HTTP403 from the managed environment. No current changelog review or live advisor result is claimed; schema/security behavior was verified against actual isolated PostgreSQL. Full GoTrue/PostgREST/provider integration is outside this proof.

## Compatibility, rollback and closed gates

The migration targets new private Ads tables and does not mutate existing WordPress/profiles/Auth triggers. It intentionally does not adopt unknown preexisting tables or silently overwrite schema. No automatic migration/cleanup deployment job is added. Review drift, grants, engine version, backups, lock window and source revision before any separately authorized live application. App rollback can disable the adapter while preserving encrypted rows and one-use evidence; do not automatically resurrect consumed states or deleted/revoked tokens. Database rollback/restore requires a separate approved plan.

Expired state retention and production provisioning/account verification are not automatic. Production remains NO-GO pending existing privilege/runtime/recovery/backup gates, key management, schema approval and designated provider verification. No paid API or production resource was touched.
