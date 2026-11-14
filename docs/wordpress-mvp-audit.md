# WordPress Manager recovery and read-only MVP increment

## Recovery evidence

The complete existing plugin **0.4.0** is present in this repository, not confined to an inaccessible VPS: entry point `wp-manager-plugin/atoz-growth-wp-manager/atoz-growth-wp-manager.php`, three include classes (REST API, pairing, site identity), originating in accessible source snapshot commit `c05d600`. Main baseline for this increment is PR #18 merge `32d3e51d82ede1d4adf7ff01f326d8ee5a3812ba`. Existing source is preserved in Git; this branch increments the package to **0.4.1** for theme inventory and strict authorization-response validation. No inaccessible source was reconstructed. No VPS, live WordPress site or live database was accessed.

Accessible Git history contains the original source snapshot; no previous plugin release ZIP was found among inspected repository artifacts. This branch adds reproducible packaging instead of claiming an existing ZIP was recovered. No third-party plugin code or dependency is imported. Existing business source ownership/licensing remains with its owner; public WordPress.org distribution/licensing review is not performed here.

## Capability matrix

“Implemented” means source and offline synthetic tests, **not** verified deployment or real WordPress integration. Partial features remain unavailable for production activation.

| Capability | State | Evidence / limit |
| --- | --- | --- |
| Installable plugin and activation identity | Implemented; live activation unverified | Entry point/activation hook creates persistent UUID; deterministic ZIP now checked in CI. No real WordPress installation performed |
| Local WordPress admin capability and CSRF boundary | Implemented; runtime unverified | manage_options and WP nonce on pairing form; standalone denial test and source audit |
| Secure website pairing | Implemented; live unverified | One-time HTTPS challenge, exact connection/site match, no redirect; pending/error handling; backend owner/lifecycle tests |
| Multiple-site owner inventory | Implemented | Existing authenticated backend owner predicates, connected status and RLS; fixture tests |
| Read-only site inspection | Implemented | Version/PHP/language/HTTPS/theme/count metadata; bounded HTTPS client, exact site identity, expiring single-use grants |
| Posts/pages inventory | Implemented | Paginated safe metadata, no content bodies; exact scope/page grants; backend contract tests |
| Media inventory | Implemented read-only | Metadata and public HTTPS URLs; no uploads/deletes/transforms |
| Plugin inventory | Implemented read-only | Names/version/active state; no plugin updates/activation |
| Theme inventory and cached update indication | **Implemented in 0.4.1** | New owner-authenticated `/api/wp-manager/sites/:id/themes`, plugin GET `/wp-json/atoz-growth/v1/themes`; no filesystem paths/remote update calls; unknown/stale data is NULL |
| Connection revocation | Partial | Backend revoke lifecycle and no silent reassignment; automatic plugin-side status synchronization and reconnect/reset UI are not complete |
| Request authentication / replay protection | Implemented for reads | Opaque backend-issued 30-second grants, site/scope/page binding, consume-once validation; not HMAC signed requests and not a durable distributed grant store |
| AI post draft proposal/approval | Partial, disabled by default | Existing backend canonical payload/owner/expiry/audit foundation; no plugin execution route, no completed user-facing write flow |
| Draft creation/editing/preview/revisions/rollback | Missing end-to-end | No publishing, scheduling, arbitrary PHP/shell/SQL or WordPress write route added |
| Categories/tags, content body inspection | Missing | No category taxonomy management or content-editing API added |
| Core/plugin/theme update execution | Missing | Cached theme update indication is observational only; no refresh/install/update/restart |
| Backup/cache management | Missing | No backup adapter or purge capability; no “backup verified” claim |
| Malware/security scanning | Missing | No antivirus, malware detection/removal or guaranteed security claim |
| Gutenberg/Elementor page generation | Future architecture only | No custom editor or visual builder dependency added |
| Production WordPress/PHP compatibility | Unverified | PHP 7.4/8.3 standalone syntax/contracts are CI fixtures, not real WP core/multisite/database integration |

## New API and security behavior

Authenticated GET `/api/wp-manager/sites/:connectionId/themes` uses the existing verified bearer/owner lookup and connected site identity. It issues a theme-only single-use grant, fetches from the HTTPS WordPress plugin, consumes validation at the backend callback and revokes any remaining grant. Other site owners cannot trigger a WordPress call. All POST/PUT/PATCH/DELETE theme routes remain absent. Old 0.4.0 plugins do not support themes; they return a controlled unavailable result rather than simulated success. Existing posts/pages/media/plugins contracts remain unchanged.

Theme items contain only `name`, `version`, `active`, `parent`, `update_available`. Update availability is a recent cached observation from WordPress's `update_themes` transient, not a live update/security scan. Missing/malformed/version-mismatched or older-than-24-hour cache returns NULL. No scheduled checks are triggered. False means only that a matching recent cache did not report an update; it is not a guarantee of the latest upstream release. Strings are external untrusted display input; consumers must render as text. The frontend theme screen is not implemented by this backend/plugin increment.

Grant callback JSON must contain literal booleans `success: true` and `authorized: true`; truthy strings such as `"false"` are rejected for both inspection and inventory. Existing TLS verification, redirect prohibition and generic errors remain. No secrets/grants/challenges are printed in test evidence.

## Packaging, download and installation plan

Run `python3 scripts/wordpress/package_plugin.py --output <disposable-output>` to create `atoz-growth-wp-manager-0.4.1.zip`, `SHA256SUMS` and `manifest.json` (exact Git source revision, archive digest, per-file digests and explicit live-test=false). ZIP timestamps/permissions/order are normalized; PHP source bytes remain unchanged by packaging. The top-level slug is WordPress-installable. Packaging excludes test fixtures, Git files, dependencies, environments and unrelated source. Verification rejects digest/content tampering. Two independently generated ZIPs must have identical SHA256.

The read-only **WordPress plugin package** workflow uploads this directory as a downloadable GitHub Actions artifact for 30 days. Download, extract the outer Actions archive, then run `sha256sum -c SHA256SUMS` in its directory before considering the installable ZIP. An expiring workflow artifact is review evidence, not a permanent published product release. Do not publish a GitHub release or deploy from this workflow.

Future owner-approved installation only: back up a designated non-production WordPress instance, verify package/checksums/source, upload the inner plugin ZIP via Plugins → Add New → Upload, activate with an authorized administrator, confirm permanent Site ID and read-only status, then pair using a separately approved backend. Existing production API endpoints remain fixed in the recovered connector; this task does not authorize using them for a test account or pairing a live site. A reviewed non-production callback configuration strategy is required before real integration tests. Record version/identity/state without secrets. Never reset a revoked connection or silently reassign ownership. Plugin deactivation must not erase identity/connection evidence; restoration/rollback requires the owner's approved saved package and state plan.

## Testing and next gates

Backend tests cover theme ownership, exact schema, malformed update states/hidden fields, resource substitution, expiry and replay. Standalone PHP fixtures cover read-only route registration, manage_options denial, disconnected/malformed/unknown grants before outbound HTTP, strict callback booleans, HTTP/transport failure, theme cache unknown/version mismatch/staleness and positive/negative cached observations. They mock WordPress functions and perform no HTTP or SQL; they do not prove WordPress core integration. Package tests cover reproducibility and corrupted archive rejection. PHP syntax is checked on 7.4 and 8.3 in isolated Docker CI.

Development review can proceed after CI; production remains **NO-GO**. Remaining gates include PR #19 security approval, existing Supabase migration/privilege remediation under separate authorization, durable/multi-instance grant handling, real WordPress install/activation/pairing tests on a designated non-production site, validated endpoint configuration, recovery/backups and full controlled write execution/verification/rollback before any write feature is offered. This branch deliberately does not enable production writes.
