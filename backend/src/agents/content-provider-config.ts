import type { ContentLimits } from "./content-provider.js";

export type ContentProviderConfig = Readonly<{
  provider: "offline-mock" | "openai-responses";
  model: string;
  apiKey: string;
  allowedModels: readonly string[];
  limits: ContentLimits;
}>;

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === "") return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error("AI provider configuration is invalid");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error("AI provider configuration is invalid");
  return parsed;
}
function micros(value: string | undefined): string {
  if (!value || !/^(?:0|[1-9][0-9]{0,17})$/.test(value)) throw new Error("AI provider pricing configuration is invalid");
  return value;
}

/** Real transport is deliberately available only in explicit development/staging stages. */
export function loadContentProviderConfig(env: NodeJS.ProcessEnv = process.env): ContentProviderConfig | null {
  const stage = env.APP_STAGE;
  if (stage !== "development" && stage !== "staging") return null;
  const provider = env.WP_MANAGER_AI_PROVIDER ?? "offline-mock";
  if (provider === "offline-mock") return null;
  if (provider !== "openai-responses") throw new Error("AI provider selection is invalid");
  const apiKey = env.OPENAI_API_KEY;
  const model = env.WP_MANAGER_AI_MODEL;
  const allowedModels = (env.WP_MANAGER_AI_ALLOWED_MODELS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  if (!apiKey || apiKey.length < 20 || apiKey.length > 512 || /\s/.test(apiKey) ||
      !model || !/^[A-Za-z0-9._-]{1,80}$/.test(model) || !allowedModels.includes(model) ||
      allowedModels.length > 10 || allowedModels.some(value => !/^[A-Za-z0-9._-]{1,80}$/.test(value))) {
    throw new Error("AI provider configuration is incomplete or unreviewed");
  }
  const maxInputTokens = integer(env.WP_MANAGER_AI_MAX_INPUT_TOKENS, 8_000, 256, 16_384);
  const maxOutputTokens = integer(env.WP_MANAGER_AI_MAX_OUTPUT_TOKENS, 2_000, 128, 4_096);
  const maxTotalTokens = integer(env.WP_MANAGER_AI_MAX_TOTAL_TOKENS, 10_000, maxInputTokens + maxOutputTokens, 24_576);
  const maxAttempts = integer(env.WP_MANAGER_AI_MAX_ATTEMPTS, 1, 1, 2);
  const timeoutMs = integer(env.WP_MANAGER_AI_TIMEOUT_MS, 15_000, 1_000, 30_000);
  const maxCostMicros = micros(env.WP_MANAGER_AI_MAX_COST_MICROS);
  const inputMicrosPerMillionTokens = micros(env.WP_MANAGER_AI_INPUT_RATE_MICROS_PER_MILLION);
  const outputMicrosPerMillionTokens = micros(env.WP_MANAGER_AI_OUTPUT_RATE_MICROS_PER_MILLION);
  const reservedPerAttempt = (BigInt(maxInputTokens) * BigInt(inputMicrosPerMillionTokens) + BigInt(maxOutputTokens) * BigInt(outputMicrosPerMillionTokens) + 999_999n) / 1_000_000n;
  if (reservedPerAttempt === 0n || reservedPerAttempt * BigInt(maxAttempts) > BigInt(maxCostMicros)) {
    throw new Error("AI provider cost ceiling is below its configured worst-case reservation");
  }
  return Object.freeze({
    provider: "openai-responses",
    model,
    apiKey,
    allowedModels: Object.freeze([...new Set(allowedModels)]),
    limits: Object.freeze({
      maxInputTokens,
      maxOutputTokens,
      maxTotalTokens,
      maxAttempts,
      timeoutMs,
      maxCostMicros,
      inputMicrosPerMillionTokens,
      outputMicrosPerMillionTokens,
    }),
  });
}
