import test from "node:test";
import assert from "node:assert/strict";
import { loadContentProviderConfig } from "./content-provider-config.js";

const valid: NodeJS.ProcessEnv = {
  APP_STAGE: "staging",
  WP_MANAGER_AI_PROVIDER: "openai-responses",
  OPENAI_API_KEY: "synthetic-server-only-provider-key",
  WP_MANAGER_AI_MODEL: "reviewed-model",
  WP_MANAGER_AI_ALLOWED_MODELS: "reviewed-model",
  WP_MANAGER_AI_MAX_COST_MICROS: "1000000",
  WP_MANAGER_AI_INPUT_RATE_MICROS_PER_MILLION: "1000000",
  WP_MANAGER_AI_OUTPUT_RATE_MICROS_PER_MILLION: "2000000",
};

test("real provider is disabled by default and in production even with credentials", () => {
  assert.equal(loadContentProviderConfig({ ...valid, WP_MANAGER_AI_PROVIDER: undefined }), null);
  assert.equal(loadContentProviderConfig({ ...valid, APP_STAGE: "production" }), null);
  assert.equal(loadContentProviderConfig({ ...valid, APP_STAGE: "test" }), null);
});
test("staging provider config is model allowlisted and bounded", () => {
  const config = loadContentProviderConfig(valid);
  assert.equal(config?.provider, "openai-responses");
  assert.equal(config?.model, "reviewed-model");
  assert.equal(config?.limits.maxAttempts, 1);
  for (const change of [
    { WP_MANAGER_AI_MODEL: "unreviewed" },
    { WP_MANAGER_AI_MAX_OUTPUT_TOKENS: "99999" },
    { WP_MANAGER_AI_MAX_ATTEMPTS: "3" },
    { WP_MANAGER_AI_TIMEOUT_MS: "999999" },
    { OPENAI_API_KEY: "bad key with spaces" },
    { WP_MANAGER_AI_MAX_COST_MICROS: "1" },
  ]) assert.throws(() => loadContentProviderConfig({ ...valid, ...change }));
});
test("malformed provider selection fails closed", () => {
  assert.throws(() => loadContentProviderConfig({ ...valid, WP_MANAGER_AI_PROVIDER: "custom-url" }));
});
