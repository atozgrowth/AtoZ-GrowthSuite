import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiBase } from "../src/lib/apiBase.ts";

test("default API root stays on the current origin", () => {
  for (const value of [undefined, "", "  "]) assert.equal(resolveApiBase(value), "/api");
});
test("explicit environment API roots are normalized", () => {
  assert.equal(resolveApiBase(" https://staging.example.com/api/// "), "https://staging.example.com/api");
  assert.equal(resolveApiBase("http://127.0.0.1:3000/api"), "http://127.0.0.1:3000/api");
  assert.equal(resolveApiBase("/custom/api/"), "/custom/api");
});
test("invalid or credential-bearing API roots fail closed", () => {
  for (const value of ["//example.com/api", "javascript:alert(1)", "https://user:password@example.com/api", "https://example.com/api?key=x", "https://example.com/api#x", "relative/api", "/api?x", "/api\\evil"]) {
    assert.throws(() => resolveApiBase(value), undefined, value);
  }
});
