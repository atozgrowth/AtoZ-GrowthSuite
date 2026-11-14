# Phase 2 independent review and security-scan evidence

No pull request was merged and no production/provider/database/user-data operation was performed. Review used repository code, read-only GitHub PR/check metadata, disposable checkouts and local image scans. Existing four PRs remain OPEN Draft.

## Reviewed heads and outcomes

- PR19: `6bbc1958e8b151bfbc5b8d3af354d2a6570132c8`; nine final-head checks pass. Both PG17 proposals remove TRUNCATE/TRIGGER/MAINTAIN/REFERENCES; effective table and column/inherited/ownership postconditions and service-role preservation are fail-closed. Existing signup code and owner RLS preserved. Live grants remain a separately authorized remediation gate.
- PR20: now `58bf9e5332e3a74e356db11bc3f0fd36396d5641`; eight final-head checks pass. Fixed a confirmed keyboard-focus contrast gap on dark Auth branding surface. Teal indicator contrast against dark gradient endpoint was about2.08:1; light-cyan override gives about8.03:1. Local frontend11/build and browser41 passed. No full dark theme claimed.
- PR21: now `2924f3a504e42fc478cbb2b46f9c1b83873c41f9`; eleven final-head checks pass. Fixed IPv6-literal URL brackets being sent to DNS/TLS identity matching; public address validation/certificate matching now use raw IP while Host retains brackets and SNI stays DNS-only. TLS verification, original-host certificate identity, pinned public address, redirect rejection and SSRF classifier stay intact. Local backend49/build passed; tests include actual Node certificate SAN verification without network calls.
- PR22: `00bd58402078eb71e299e34ceae042462d45fa0f`; nine final-head checks pass. No new blocking issue found in detached/frozen plan authorization, copied tenant bindings or selected report parsing. Event-loop timeout/after-serialization result cap remain explicitly documented cooperative limits, not hostile-code isolation. No live route/provider is enabled.

The SQL is PostgreSQL17-specific (MAINTAIN). Profiles adoption remains an explicit operator private-review/drift gate, not unattended db-push or automatic attestation. Current supplied live evidence is not a guarantee of future deployed drift. Migration ordering: existing five WordPress migrations, hardening20261113215813, profiles baseline20261113215817, then separately reviewed later Phase2 migration(s). No production SQL was executed by this review.

## Cross-branch compatibility and safe sequence

All four current-head diffs applied without patch conflicts to a new detached `origin/main`32d3e51 checkout, in order19→20→21→22; `git diff --check` passed. The duplicate #19/#22 backend lockfile is byte-identical (SHA256 `7d50463a08a8bc13d04ddfdb43027b4ca11c8d2129c73726daf034ec77efbdb0`), so that same patch was applied once. This is patch compatibility, not a PR merge or fresh combined runtime proof. Parent must record combined execution at its final chosen heads.

Recommended owner-reviewed merge sequence:19 security first,21 WordPress baseline/transport next,22 shared agent/recovery foundation next;20 branding is independent and can be reviewed in parallel, but integrate it before the Phase2 UI. Then review the new Phase2 draft PR(s) with explicit21/19/20/22 dependencies as applicable. Re-run final combined tests after any retarget/rebase; no merge was authorized or performed.

## Official logos

No original PNG exists in accessible branches/history at either required path:

- `frontend/public/branding/logo-primary.png`
- `frontend/public/branding/logo-horizontal.png`

Only branding README is present. GitHub main was independently verified at32d3e51d82ede1d4adf7ff01f326d8ee5a3812ba; both exact PNG paths returned HTTP404 through the repository contents API. Earlier HTTPS CONNECT403 on the exact public R2 hostname remains recorded. No retry/bypass/proxy change or substitute logo was attempted during this review. Original bytes/dimensions/alpha/CRC/SHA cannot be verified without originals. Required next owner step is supplying originals or separately permitting the exact public hostname; no R2 permission change is proposed.

Updated screenshot artifact (new PR20 head): https://github.com/atozgrowth/AtoZ-GrowthSuite/actions/runs/43598752609/artifacts/14116055130 . Updated PR21 package artifact (same plugin0.4.1 source bytes, new exact-source manifest): https://github.com/atozgrowth/AtoZ-GrowthSuite/actions/runs/43598024810/artifacts/14115282313 . Hosted package upload/download/checksum/source verification passes. Actual WordPress core testing is not established by these older PR fixture results; parent must report its new isolated-core results separately.

## Broader secret-history scan

Checksum-verified Gitleaks8.30.1, `git --log-opts=--all --redact=100`, scanned52commits across all accessible local refs/history after the two fixes: zero findings. This does not include uncommitted work or unfetched remote-only refs and is not proof that secrets never existed. Safe summary: `/workspace/work/phase2-secret-history-redacted.json`. No matching secret was printed or published.

## Real OS-image vulnerability scan

Checksum-verified Trivy0.76.2. Default `mirror.gcr.io/v2/` DB request returned403; standard official `ghcr.io/aquasecurity/trivy-db:2` source succeeded without changing network policy. Current local actual test fixture images were scanned for OS packages only (not application/language dependencies). Redacted report: `/workspace/work/phase2-fixture-os-scan-redacted.json`. Raw Trivy JSON is private/local because image-config metadata may include Env; do not publish it.

| Fixture image / imageID | Critical | High | Medium | Low | Unknown |
| --- | ---: | ---: | ---: | ---: | ---: |
| wordpress:7.1.4-php8.3-apache / sha256:142ce2c6634b3e297e26bb842858283870ed435b4d3b93d09002880a565012d3 |5|154|549|956|106|
| mariadb:11.4 / sha256:3ead04fc44efca664e31dcba81eed32dd660597b27410a62113c6cf14dd6dc74 |0|0|34|7|0|
| postgres:17-alpine / sha256:6b75136145ddabf3d9a4b69660402082de7c56b734cfe50555b0674774dd742a |0|0|0|0|0|
| node:24-bookworm-slim / sha256:5ba3c1ded6eada2ea16582327a87c672fb3889fca362ee3ac0d78ed742b583c0 |1|34|95|85|5|

Counts are package vulnerability findings, not unique CVEs or proven exploitable application paths. WordPress has four package findings for Apache CVE-2026-119618 (2.4.69 installed,2.4.71 fixed) and libxml2 CVE-2026-6653 without a reported fix. Node's critical zlib1g CVE-2023-45853 is reported `will_not_fix`; distro/component exposure needs contextual review, not silent suppression. This does not scan final Phase2 app image builds. High/critical findings must be reported, not converted to a clean scan; test-only isolation does not make them production-approved. Parent should scan final app images separately and consider reviewed test-image refresh/hardening. No production image was changed or deployed.

Production remains NO-GO. Completed development changes are reviewable subject to final combined/new-WordPress workflow testing and explicit image-risk handling. No live privilege fix or deployment readiness is claimed.
