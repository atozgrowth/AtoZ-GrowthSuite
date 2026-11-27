# Open-source dependency evaluation

Research snapshot: 14 November 2026. GitHub repository metadata, default-branch license texts, latest-release endpoints and public repository security advisory lists were inspected without executing upstream installation scripts. This is a screening decision, not legal certification, a complete vulnerability assessment or a performance benchmark. Repository latest-release tags can refer to a CLI, extension or Svelte package rather than the package we would actually adopt. No dependency below was installed by this research.

## Decision

Keep this batch's offline agent proof of concept independent of a runtime framework. Preserve typed provider/tool interfaces so a justified SDK can be pinned later. The current requirement is safe authorization, bounded execution and verifiable proposals, not a hosted graph/editor stack. Do not install competing agent frameworks. No framework removes the need for server-authoritative tenant authorization, exact-payload approval and durable single-use execution records.

| Repository | License findings | Maintenance snapshot / published repository advisories | Integration/resource assessment and decision |
| --- | --- | --- | --- |
| [Mastra](https://github.com/mastra-ai/mastra) | Root license: Apache-2.0 outside excluded `ee/` directories; enterprise areas have separate terms; third-party licenses also apply | Active; latest endpoint `@mastra/core@1.83.0`, 13 Nov; 2 public advisories | Broad TS agents/workflows/storage package family could save workflow implementation time. More operational surface than the current mock-tool need. Defer; inspect exact package exports/dependencies and exclude enterprise code before commercial use |
| [LangGraph.js](https://github.com/langchain-ai/langgraphjs) | MIT | Active; latest endpoint is CLI `1.7.2`, 12 Nov; 8 public advisories | Strong graph/checkpoint/interrupt abstraction when long-running workflows exist. Persistence, serialization and checkpoint tenancy require additional design. Defer until a real durable workflow warrants graph complexity; pin the graph package, not the reported CLI tag |
| [OpenAI Agents JS](https://github.com/openai/openai-agents-js) | MIT | Active; latest endpoint is extensions `0.22.0`, 12 Nov; 0 advisories returned | Tool-call/handoff/tracing abstractions could reduce future orchestration work. Keep models behind a provider adapter; default tracing must not export tenant content or tokens. Best narrow candidate for a later provider-backed POC, not needed to prove offline authorization |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | Root text describes Apache-2.0 transition with un-relicensed contributions retaining MIT, and documentation CC-BY-4.0; preserve applicable notices | Active; latest endpoint `v2.4.0`, 23 Oct; 10 public advisories | Prefer official SDK when adding an actual MCP transport rather than maintaining custom wire parsing. No transport is enabled by this batch. Pin audited package version, enforce protocol/origin/auth/session handling and tenant-bound tool context |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | MIT; copied components still need their upstream/primitive notices | Active; latest endpoint `shadcn@4.23.0`, 27 Oct; 0 advisories returned | Source-level component adoption can save accessible dialog/form work; registry generation and its transitive packages must be reviewed. Existing React/CSS screens work, so no wholesale theme/library rebuild |
| [xyflow](https://github.com/xyflow/xyflow) | MIT root; paid examples/services may have separate terms | Active; latest endpoint is Svelte `1.7.1`, 2 Nov; 0 advisories returned | Useful only for a future visual workflow editor; React package choice differs from latest-release tag. Adds browser/render/interaction complexity with no present MVP value. Defer |
| [BullMQ](https://github.com/taskforcesh/bullmq) | MIT core; paid/pro offerings separate | Active; latest endpoint `vnet1.3.1`, 12 Nov; 0 advisories returned | Durable Redis-backed queue could handle future bounded jobs, but requires Redis memory/backup/HA and worker idempotency. Do not add Redis to a 2-vCPU target merely for a mock POC. Revisit after measured job volume and retry requirements |
| [Gutenberg](https://github.com/WordPress/gutenberg) | Project remains GPL-2.0-or-later; post-15-Apr-2021 contribution licensing includes GPL/MPL dual terms. Do not assume the whole tree is permissively licensed | Active; latest endpoint `v24.4.1`, 13 Nov; 0 advisories returned | Prefer the existing site's native block editor and supported serialized blocks rather than bundling the editor into the proprietary SaaS. Individual npm packages require their own exact license audit. Advanced design remains deferred; do not assume Elementor compatibility |
| [n8n](https://github.com/n8n-io/n8n) | Sustainable Use License limits own internal business/non-commercial use; `.ee` code requires enterprise terms; non-master branches are not licensed by the root notice | Active; latest endpoint `2.47.7`, 13 Nov; first advisory page returned 100 entries (not a total) | Cannot assume a paid embedded/hosted customer automation platform is permitted. No adoption/install. Commercial agreement/appropriate licensing and isolated credentials/execution review required first |

Advisory counts are repository API results, not a count of vulnerabilities in any selected package. Zero returned does not establish safety. Historical advisories include high-severity MCP SDK request/session/transport issues and LangGraph/Mastra issues; inspect the exact selected package, patched ranges and release notes immediately before installation. Upstream metadata can contain inconsistent patched-version text; do not convert it directly into an installation policy. Run lockfile-aware audit, source/license review and tenant regression tests after a justified exact-version installation.

## Source provenance

Default-branch commits inspected:

- Mastra `7277766d6c967c475675d58ff2d0e5c6d7be7c84`.
- LangGraph.js `fa426b293b6ecccbf62b4f262475777b4bf86673`.
- OpenAI Agents JS `8aeac0eb255dbdff9adcdc65a0eae638cbcea74f`.
- MCP SDK `919bb8ea88b6e10e72c2f8b6218fad4cfdc40b2c`.
- shadcn/ui `e62c9435fff729a175f38983dee73b2cb4f6a069`.
- xyflow `1bc405cd113618c17fd181b931a9fe573bec9fee`.
- BullMQ `c9c13438716597e1d2e4d5eeb276a9ce88d12750`.
- Gutenberg `3f15c50f18d768c7dc7d5c9e149deffd621b71ab`.
- n8n `251c44bc5e072afcc3daab3c3d1baf525afd8d41`.

License links: repository root LICENSE/README at those revisions. Dynamic GitHub API observations are point-in-time, not a reproducible dependency lock; nothing was incorporated from those repositories.

Additional relevant candidates screened by repository metadata: [WP-CLI](https://github.com/wp-cli/wp-cli), MIT, for separately authorized operator maintenance (never AI shell execution); [axe-core](https://github.com/dequelabs/axe-core), MPL-2.0, for a later dedicated automated accessibility scan; [Playwright](https://github.com/microsoft/playwright), Apache-2.0, already used for browser regression. No new installation was justified here.

## Resource and adoption gates

The 2-vCPU/8-GB VPS target supports a shared process/service approach more plausibly than one process per named agent. No CPU/RSS/load benchmark was performed, so no capacity promise is made. Cap task concurrency, payload/result size, tool call count and execution time; redact logs; meter calls; use off-process model APIs only after approval. Persistent jobs/checkpoints must carry server-owned tenant, principal and connection identity and require authorization again at execution. A queue or framework's retry feature must never replay an uncertain write automatically.

Adoption requires a concrete capability lacking in the current architecture, measured development savings, exact package/license/transitive review, pinned lockfile, clean relevant security checks, synthetic compatibility tests, resource measurement and reviewed operational dependencies. No new production infrastructure is authorized.
