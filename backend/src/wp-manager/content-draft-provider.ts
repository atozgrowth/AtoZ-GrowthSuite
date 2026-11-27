import { createAuthorizedContentProvider, type ContentLimits } from "../agents/content-provider.js";
import { createPreparedResponsesModel, createOpenAIResponsesTransport } from "../agents/prepared-responses-model.js";
import { createDurableContentModel } from "../agents/durable-content-model.js";
import type { ContentProviderConfig } from "../agents/content-provider-config.js";
import type { AiUsageLedger } from "../agents/ai-usage-ledger.js";
import type { InspectionConnectionStore } from "./site-inspection.js";
import type { DraftProvider } from "./draft-workflow.js";

const limits: ContentLimits = Object.freeze({
  maxInputTokens: 16_384,
  maxOutputTokens: 8_192,
  maxTotalTokens: 24_576,
  maxAttempts: 1,
  timeoutMs: 5_000,
  maxCostMicros: "0",
  inputMicrosPerMillionTokens: "0",
  outputMicrosPerMillionTokens: "0",
});

/** Deterministic, offline-only adapter. It cannot send network requests or incur provider spend. */
export function createAgentDraftProvider(
  connections: InspectionConnectionStore,
  configured?: ContentProviderConfig,
  ledger?: AiUsageLedger,
): DraftProvider {
  if (configured?.provider === "openai-responses" && !ledger) throw new Error("Durable AI usage ledger is required");
  return {
    async generate(input, context) {
      if (!context) throw Error("Content proposal binding is required");
      const current = await connections.findOwnedConnected({
        userId: context.ownerId,
        accessToken: context.accessToken,
        connectionId: context.connectionId,
      });
      if (!current || current.site_id !== context.siteId || current.site_url !== context.siteUrl) {
        throw Error("The selected connected site is no longer authorized");
      }

      const model: import("../agents/content-provider.js").ContentModel = configured
        ? createDurableContentModel({
            model: createPreparedResponsesModel({
              enabled: true,
              model: configured.model,
              allowedModels: configured.allowedModels,
              transport: createOpenAIResponsesTransport(configured.apiKey),
            }),
            ledger: ledger!,
            ownerId: context.ownerId,
            connectionId: context.connectionId,
            modelName: configured.model,
            inputRateMicrosPerMillion: configured.limits.inputMicrosPerMillionTokens,
            outputRateMicrosPerMillion: configured.limits.outputMicrosPerMillionTokens,
          })
        : {
            async complete(request, signal) {
              if (signal.aborted) throw Error("Proposal timed out");
              const firstLine = request.instruction.trim().split(/\r?\n/, 1)[0] ?? "";
              const title = firstLine
                .replace(/^(?:please\s+)?(?:create|write|draft|make)\s+(?:a|an|the)\s+/i, "")
                .replace(/[.?!]+$/, "")
                .trim()
                .slice(0, 190) || "New WordPress content";
              const paragraph = `Offline mock proposal for ${request.postType}: ${request.instruction.trim()}`;
              return {
                content: { title: title.charAt(0).toUpperCase() + title.slice(1), paragraphs: [paragraph] },
                usage: { inputTokens: 0, outputTokens: 0 },
              };
            },
          };

      const agent = createAuthorizedContentProvider({
        principal: {
          userId: context.ownerId,
          workspaceId: context.ownerId,
          siteIds: [context.siteId],
          adsCustomerIds: [],
        },
        binding: {
          ownerId: context.ownerId,
          workspaceId: context.ownerId,
          connectionId: context.connectionId,
          siteId: context.siteId,
          revision: 1,
        },
        limits: configured?.limits ?? limits,
        model,
        authorize: async (binding, signal) => {
          if (signal.aborted) return false;
          const refreshed = await connections.findOwnedConnected({
            userId: binding.ownerId,
            accessToken: context.accessToken,
            connectionId: binding.connectionId,
          });
          return Boolean(refreshed && refreshed.status === "connected" &&
            refreshed.id === binding.connectionId && refreshed.site_id === binding.siteId &&
            refreshed.site_url === context.siteUrl && binding.revision === 1 && !signal.aborted);
        },
        audit: () => undefined,
      });
      return agent.generate(input);
    },
  };
}
