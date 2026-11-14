# Existing Google Ads MCP recovery audit

## Recovered source and boundaries

Accessible repository: [atozgrowth/atoz-google-ads-mcp](https://github.com/atozgrowth/atoz-google-ads-mcp), inspected read-only at `e747af3392a18b0b6290feedf4674f8880b3909a`. Repository source was cloned into the development workspace, not copied wholesale into Growth Suite. No VPS, live Google account, OAuth flow, legacy Supabase project or advertising endpoint was accessed. No real credential or account data was used. Source contains historical project/account/site references; these were not treated as authorization to contact them and are not reproduced as integration targets.

README's early bootstrap description understates later source. Current code includes substantial v3 guards, reports, approval workflows and transport foundations. Conversely, capability tables and filenames are not proof of functioning deployed features.

| Area | Source evidence | Recovery status / integration implications |
| --- | --- | --- |
| MCP | Supabase functions include JSON-RPC initialization/tools and read-only reporting/approval-status adapters; OAuth resource metadata and Cloudflare routing sources exist | Recovered source, deployed behavior unverified. Inventory exposed tools against the reviewed runtime adapter; do not expose mutation helpers simply because modules exist |
| Google OAuth | OAuth start/callback Edge Functions implement state hashing, PKCE S256, bounded expiry, encrypted verifier/token storage with AES-GCM and conditional one-time state consumption | Partial reusable design, not production SaaS integration. Start uses a shared admin bearer; redirect and account mapping contain legacy hardcoded identities. Bind initiation/redemption/storage to verified Growth Suite principal, tenant and chosen connection; never deploy legacy values |
| Tenant/account selection | Authenticated actor boundary verifies session expiry and injected customer authorization; commercial installation model isolates projects/namespaces | Useful boundary tests. Growth Suite currently uses personal account workspaces, not one database project per customer. Reconcile models before reuse; never substitute an existing Academy/staging project |
| Reporting | Report builder uses selected reports/fields/period allowlists; executor uses GAQL Search, pagination cap and sanitized failures | Recoverable read-only foundation, tested with mocks only. Add server-authorized connection/account resolver, timeouts/response limits and request metering before runtime integration |
| Prerequisite reads | Server adapter disabled by default, fixed read-only GAQL, validates MCC/customer/resource relationships and handles expiry/errors | Tests pass. Even successful basic reads intentionally end in UNVERIFIED_AUTHORITY rather than inventing account permissions or write eligibility |
| Approval/mutations | Many proposal, digest, lease, reservation, pinned-draft and reconciliation modules and migrations exist | Recovered design/source, not proof of safe commercial execution. Do not enable spending, publishing or validate-only operations in this batch |
| API version | Current server read/report executor target Google Ads v26 | Exact official version support/sunset, developer-token access and field compatibility were not verified against live Google or current release documentation. Validate before connecting; do not blindly downgrade or promote an old example |
| Packaging/runtime | Private dependency-free Node test package; Supabase/Deno functions and Cloudflare sources, rather than a ready Fastify application adapter | Preserve useful pure modules by reviewed extraction; no deployment of those independent entry points or wholesale migrations |

## Actual offline test evidence

Ran selected tests only, with global `fetch` replaced by a rejecting function before imports:

```sh
node --import /tmp/atoz-research-no-network.mjs --test \
  test/google-ads-v3-server-read-adapter.test.mjs \
  test/google-ads-v3-report-builder.test.mjs \
  test/google-ads-v3-authenticated-actor-boundary.test.mjs
```

The temporary preload contains only `globalThis.fetch = async () => { throw new Error('Live network is disabled in recovery audit'); };`. Positive transport tests inject their own synthetic fetch functions. **23 tests passed, 0 failed/skipped.** This covers disabled-by-default transport, malformed/cross-customer resources, missing/failed OAuth credentials, redacted/rate-limit failures, report query restrictions and authenticated actor boundaries. No package install or live network call is required for this subset.

The complete repository has 86 test files; full-suite/SQL/Deno/Cloudflare execution was not performed by this recovery audit. The repository was not modified. Passing this subset does not establish OAuth deployment, API access, policy compliance or real account authorization.

## Safe integration next steps

1. Keep read-only reporting disabled until a reviewed server connection registry binds verified principal/workspace to selected Google customer and manager identities. Never accept customer IDs or provider tokens as proof of authorization.
2. Extract only reviewed pure query/result contracts behind a Fastify server adapter; pin source revision, preserve licensing/provenance and add Growth Suite tests. No ad credentials in frontend, model messages, tool parameters, logs or artifacts.
3. Replace hardcoded redirect/account/project assumptions with reviewed configuration, one-time tenant/principal-bound OAuth state, PKCE and encrypted per-connection token references. State issuance/callbacks must re-check trusted session ownership; shared admin tokens do not constitute per-customer OAuth authorization.
4. Verify official Google Cloud OAuth consent/access requirements, Google Ads developer-token tier, allowed accounts and currently supported API version/GAQL fields without spending or campaign changes. `adwords` scope is not inherently read-only: enforce a read-only endpoint/tool allowlist server-side.
5. Add bounded timeouts, maximum pages/rows/bytes and tenant rate limits. Redact identifiers and provider error payloads. Do not forward free-form GAQL or model-selected URLs.
6. Only then request a separate owner-approved read-only test using a designated account. Live reporting, real OAuth/token storage, campaign actions, budgets and legacy Supabase operations remain unauthorized in this batch.
