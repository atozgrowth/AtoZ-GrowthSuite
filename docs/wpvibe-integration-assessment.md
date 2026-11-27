# WPVibe integration decision

## Source and isolated installation

Official source: [awesomemotive/wpvibe-ai-mcp](https://github.com/awesomemotive/wpvibe-ai-mcp), pinned at commit `5187f684e8e1812a7a4ecaa48585ee17be8a66d5` (2026-11-22). The plugin header declares `GPL-2.0-or-later`; the repository ships the GPL v2 license text. It declares WordPress 6.0 and PHP 7.4 minimums, and includes the `svg-sanitize` 1.0.0 library under GPL-2.0-or-later. Its WordPress Abilities API routes are available on WordPress 6.9 and later.

Installation/activation was exercised on disposable WordPress 7.1.4/PHP 8.3 with MariaDB 11.4 and WP-CLI 2.12.0. Docker network was internal-only, containers had no published host ports, external HTTP was blocked, and only synthetic credentials/content were used. WPVibe 1.24.3 activated and registered 63 REST routes. Unauthenticated requests with valid-shaped inputs to site-info, file-list, content-edit, CLI-run and abilities all returned HTTP 401. This does not validate any authenticated WPVibe operation or its hosted gateway.

Image digests and test result are captured in [wpvibe-install-evidence.json](wpvibe-install-evidence.json). The WPVibe hosted MCP gateway was not contacted. Upstream documentation says the plugin depends on that service for its intended AI-client experience; that service handles the connected Application Password and relays requests.

## Existing A2Z code and strategy

The A2Z plugin/backend in the existing WordPress draft workflow already supplies site pairing and permanent identity, tenant-owned connections, expiring one-use inspection grants, site inspection, posts/pages/media/plugin/theme inventories, draft creation and editing, exact human approval, idempotency receipts, audit history and independent readback. PR #22 provides the offline tenant-bound agent runner; PR #25 provides a bounded, proposal-only model-provider interface. They remain separate open drafts and were included in this development branch only for an isolated mock-provider integration test.

**Selected: Option A, keep A2Z as the single plugin and preserve its authorization path.** Importing WPVibe's full REST/admin surface would add file operations, code-snippet editing, CLI-style operations and theme write/publish operations whose permission and approval model is different from A2Z's tenant-bound grant and exact approval flow. Option B would require replacing the current pairing flow with WordPress Application Password issuance, encrypted per-tenant storage and a new operation/approval bridge. That is a larger security change and would make WPVibe's hosted-service model tempting as a shortcut.

This batch adds a read-only WordPress Abilities inventory to the existing site inspection. It returns only abilities explicitly exposed through WordPress REST or public MCP metadata, with bounded display metadata; it never returns executable callbacks or schemas and never executes an ability. The feature remains behind the existing owner-bound, single-use inspection grant. No WPVibe PHP source was copied into the distributable plugin, so upstream source notices and license obligations do not attach to this plugin package.

The latest actual WordPress 7.1.4 integration completed 20/20 scenarios across seven local migration files. It included public/private ability filtering, actual plugin activation, synthetic pairing and tenant checks, assistant preview/approval, draft readback, duplicate-write protection, receipt reconciliation and a separately approved publish of an unchanged existing draft followed by independent readback. The existing agent/provider boundary was exercised through a deterministic offline mock; no model service was contacted or paid request made. Publishing was enabled only inside the disposable local fixture through separate backend/plugin test flags; production writes remained disabled. All migrations and WordPress records existed only in disposable containers. A first test exposed an undefined variable in the publish capability check; it was corrected and the rerun passed.

The plugin display name is now **A to Z WordPress AI Manager**. Its internal slug and repository identifiers remain unchanged. No logo was added or substituted.

## Feature status

- Working in existing A2Z flow: pairing, inspection, inventory, offline mock assistant proposals, exact approval, isolated draft create/edit and separately gated isolated publish of an unchanged draft, readback, receipt reconciliation and audit history.
- Added here: public WordPress Abilities discovery. Execution is visibly unavailable.
- AI provider: the provider boundary is wired through the existing authorized content adapter to a deterministic offline mock. The default application remains offline; no production model transport, key vault, durable per-tenant spend limits or paid request is enabled.
- Still unavailable: scheduling, media mutation, plugin/theme/core maintenance, arbitrary PHP/shell/SQL operations, theme drafting, page-builder editing and automatic execution of WordPress abilities. Isolated test publishing is not production-ready functionality.

## Remaining integration gates

Before considering real customer use, independently review the merged drafts and run a live, owner-approved integration against the intended existing project/site. Confirm HTTPS origin validation, supported WordPress/PHP versions, Auth/RLS and migration state, a verified backup/restore, data retention, rate/spend limits for any model provider, and operational rollback. No live Supabase, customer site, VPS, gateway, DNS or model-provider request was made here.

Estimated remaining effort: about 3–5 engineering days for reviewed read-only capability presentation and a non-production model adapter with durable limits; 2–4 additional weeks for each consequential maintenance/page-builder/publishing module, because each needs separate authorization, recovery and real-core coverage. This is planning based on the current scope, not a delivery commitment.
