import test from "node:test";
import assert from "node:assert/strict";
import { publicConfiguration } from "../src/lib/publicConfig.ts";
const jwt = role => "eyJzeW50aGV0aWMiOnRydWV9." + Buffer.from(JSON.stringify({ role })).toString("base64url") + ".c3ludGhldGlj";
test("public config supports unconfigured UI, synthetic development and public keys", () => {
  assert.equal(publicConfiguration(), null);
  for (const key of ["test-anon-key", "sb_publishable_synthetic", jwt("anon")]) assert.equal(publicConfiguration("https://example.supabase.co", key).url, "https://example.supabase.co");
});
test("partial config, credential-bearing URLs and privileged keys fail before bundling", () => {
  for (const [url, key] of [["https://example.supabase.co", undefined], ["https://user:pass@example.test", "fixture"], ["javascript:bad", "fixture"], ["https://example.test", "sb_secret_synthetic"], ["https://example.test", jwt("service_role")], ["https://example.test", jwt("authenticated")]]) assert.throws(() => publicConfiguration(url, key));
});
