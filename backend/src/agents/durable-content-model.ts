import { randomUUID } from "node:crypto";
import { TransientContentError, type ContentModel } from "./content-provider.js";
import type { AiUsageLedger } from "./ai-usage-ledger.js";

export function createDurableContentModel(input: {
  model: ContentModel;
  ledger: AiUsageLedger;
  ownerId: string;
  connectionId: string;
  modelName: string;
  inputRateMicrosPerMillion: string;
  outputRateMicrosPerMillion: string;
}): ContentModel {
  return {
    async complete(request, signal) {
      const requestId = randomUUID();
      const reserved = await input.ledger.reserve({
        requestId,
        ownerId: input.ownerId,
        connectionId: input.connectionId,
        provider: "openai-responses",
        model: input.modelName,
        maxInputTokens: request.maxInputTokens,
        maxOutputTokens: request.maxOutputTokens,
        inputRateMicrosPerMillion: input.inputRateMicrosPerMillion,
        outputRateMicrosPerMillion: input.outputRateMicrosPerMillion,
      });
      if (!reserved) throw new Error("AI tenant quota or rate limit exceeded");
      try {
        const result = await input.model.complete(request, signal);
        const usage = result && typeof result === "object" && !Array.isArray(result)
          ? (result as Record<string, unknown>).usage : null;
        const inputTokens = usage && typeof usage === "object" ? (usage as Record<string, unknown>).inputTokens : null;
        const outputTokens = usage && typeof usage === "object" ? (usage as Record<string, unknown>).outputTokens : null;
        if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens) ||
            (inputTokens as number) < 0 || (inputTokens as number) > request.maxInputTokens ||
            (outputTokens as number) < 0 || (outputTokens as number) > request.maxOutputTokens) {
          throw new Error("Provider usage could not be verified");
        }
        const settled = await input.ledger.settle({
          ownerId: input.ownerId,
          requestId,
          outcome: "settled",
          inputTokens: inputTokens as number,
          outputTokens: outputTokens as number,
        });
        if (!settled) throw new Error("Provider usage settlement failed");
        return result;
      } catch (error) {
        if (error instanceof TransientContentError) {
          const released = await input.ledger.settle({ ownerId: input.ownerId, requestId, outcome: "no_charge" });
          if (released) throw error;
        }
        // Unknown outcomes retain the full reservation in the monthly budget.
        try { await input.ledger.settle({ ownerId: input.ownerId, requestId, outcome: "unknown" }); }
        catch { /* The existing reservation remains counted if settlement is unavailable. */ }
        throw error;
      }
    },
  };
}
