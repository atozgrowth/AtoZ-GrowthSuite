import assert from "node:assert/strict";
import test from "node:test";
import { isAdministrator, safeDestination, workspacePath } from "../src/workspace/policy.ts";
test("only trusted app metadata enables admin navigation", () => {
  assert.equal(isAdministrator(null), false);
  assert.equal(isAdministrator({ user_metadata: { role: "admin" } }), false);
  assert.equal(isAdministrator({ app_metadata: { role: "customer" } }), false);
  assert.equal(isAdministrator({ app_metadata: { role: "admin" } }), true);
});
test("login destinations cannot navigate to external or unsupported routes", () => {
  for (const path of ["https://evil.test", "//evil.test", "/\\evil.test", "/admin?redirect=https://evil.test", {}, null]) assert.equal(safeDestination(path), "/dashboard");
  assert.equal(safeDestination("/workspace/10000000-0000-4000-8000-000000000001/account"), "/workspace/10000000-0000-4000-8000-000000000001/account");
  assert.equal(safeDestination("/admin"), "/admin");
  assert.equal(workspacePath("user/id"), "/workspace/user%2Fid/dashboard");
});

test("return paths reject traversal and encoded separators instead of normalizing them into another route", () => {
  for (const path of ["/workspace/../account", "/workspace/./dashboard", "/workspace/%2f%2fevil/account", "/workspace/%5cevil/dashboard", "/workspace/owner/account"]) assert.equal(safeDestination(path), "/dashboard");
});
