import test from "node:test";
import assert from "node:assert/strict";
import { createDurableContentModel } from "./durable-content-model.js";
import { TransientContentError } from "./content-provider.js";
import type { AiUsageLedger, AiUsageReservation, AiUsageOutcome } from "./ai-usage-ledger.js";

function fixture(complete: () => Promise<unknown> = async () => ({ content: { title: "ok", paragraphs: ["safe"] }, usage: { inputTokens: 1, outputTokens: 2 } })) {
  const calls: Array<{ reserve: AiUsageReservation } | { settle: AiUsageOutcome }> = [];
  let allowed = true;
  const ledger: AiUsageLedger = {
    async reserve(value) { calls.push({ reserve: value }); return allowed; },
    async settle(value) { calls.push({ settle: value.outcome }); return true; },
  };
  const model = createDurableContentModel({
    model: { complete }, ledger, ownerId: "owner", connectionId: "connection", modelName: "model",
    inputRateMicrosPerMillion: "100", outputRateMicrosPerMillion: "200",
  });
  return { model, calls, deny() { allowed = false; } };
}
const request = { instruction: "synthetic", postType: "post" as const, maxInputTokens: 100, maxOutputTokens: 50 };

test("durable model reserves against the verified tenant and settles actual token usage", async () => {
  const f = fixture();
  await f.model.complete(request, new AbortController().signal);
  assert.deepEqual(f.calls[0], { reserve: { requestId: (f.calls[0] as { reserve: AiUsageReservation }).reserve.requestId, ownerId: "owner", connectionId: "connection", provider: "openai-responses", model: "model", maxInputTokens: 100, maxOutputTokens: 50, inputRateMicrosPerMillion: "100", outputRateMicrosPerMillion: "200" } });
  assert.deepEqual(f.calls[1], { settle: "settled" });
});
test("quota denial happens before the provider call", async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return {}; }); f.deny();
  await assert.rejects(f.model.complete(request, new AbortController().signal));
  assert.equal(calls, 0);
});
test("unknown provider outcome retains reservation while only known 429 releases it", async () => {
  const unknown = fixture(async () => { throw new Error("network lost after dispatch"); });
  await assert.rejects(unknown.model.complete(request, new AbortController().signal));
  assert.deepEqual(unknown.calls.slice(1), [{ settle: "unknown" }]);
  const limited = fixture(async () => { throw new TransientContentError("rate limited"); });
  await assert.rejects(limited.model.complete(request, new AbortController().signal));
  assert.deepEqual(limited.calls.slice(1), [{ settle: "no_charge" }]);
});
test("reported usage outside the reservation is marked unknown", async () => {
  const f = fixture(async () => ({ content: {}, usage: { inputTokens: 101, outputTokens: 1 } }));
  await assert.rejects(f.model.complete(request, new AbortController().signal));
  assert.deepEqual(f.calls.slice(1), [{ settle: "unknown" }]);
});
