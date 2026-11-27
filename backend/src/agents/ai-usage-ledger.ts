import type { RpcClient } from "../wp-manager/durable-grants.js";

export type AiUsageOutcome = "settled" | "unknown" | "no_charge";
export type AiUsageReservation = Readonly<{
  requestId: string;
  ownerId: string;
  connectionId: string;
  provider: "openai-responses";
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  inputRateMicrosPerMillion: string;
  outputRateMicrosPerMillion: string;
}>;
export interface AiUsageLedger {
  reserve(input: AiUsageReservation): Promise<boolean>;
  settle(input: { ownerId: string; requestId: string; outcome: AiUsageOutcome; inputTokens?: number; outputTokens?: number }): Promise<boolean>;
}

/** RPC-only access; prompts, model responses, keys and customer content are never recorded. */
export class SupabaseAiUsageLedger implements AiUsageLedger {
  constructor(private readonly rpc: RpcClient) {}
  async reserve(input: AiUsageReservation) {
    const { data, error } = await this.rpc.rpc("wp_manager_reserve_ai_usage", {
      p_user_id: input.ownerId,
      p_connection_id: input.connectionId,
      p_request_id: input.requestId,
      p_provider: input.provider,
      p_model: input.model,
      p_input_tokens: input.maxInputTokens,
      p_output_tokens: input.maxOutputTokens,
      p_input_rate: input.inputRateMicrosPerMillion,
      p_output_rate: input.outputRateMicrosPerMillion,
    });
    if (error) throw new Error("AI usage budget unavailable");
    return data === true;
  }
  async settle(input: { ownerId: string; requestId: string; outcome: AiUsageOutcome; inputTokens?: number; outputTokens?: number }) {
    const { data, error } = await this.rpc.rpc("wp_manager_settle_ai_usage", {
      p_user_id: input.ownerId,
      p_request_id: input.requestId,
      p_outcome: input.outcome,
      p_input_tokens: input.inputTokens ?? null,
      p_output_tokens: input.outputTokens ?? null,
    });
    if (error) throw new Error("AI usage settlement unavailable");
    return data === true;
  }
}
