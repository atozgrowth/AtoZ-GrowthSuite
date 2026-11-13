import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createAuthenticate } from "../auth/authenticate.js";
import { registerWorkspaceRoutes } from "./routes.js";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
async function fixture() {
  const app = Fastify();
  const auth = createAuthenticate(async token => {
    if (token === "offline") throw new Error("synthetic service failure");
    if (!["customer", "admin", "forged-user-metadata"].includes(token)) return { data: { user: null }, error: new Error("expired") };
    return { data: { user: { id: owner, email: "fixture@example.test", app_metadata: token === "admin" ? { role: "admin" } : {}, user_metadata: { role: "admin", tenant_id: other } } }, error: null };
  });
  await registerWorkspaceRoutes(app, auth);
  return app;
}
test("all workspace/admin APIs reject missing, malformed and expired credentials", async () => {
  const app = await fixture();
  try {
    for (const url of [`/api/workspaces/${owner}`, "/api/admin/overview"]) {
      for (const authorization of [undefined, "Basic bad", "Bearer ", "Bearer invalid", "Bearer customer extra"]) {
        const response = await app.inject({ url, headers: authorization ? { authorization } : {} });
        assert.equal(response.statusCode, 401);
      }
    }
  } finally { await app.close(); }
});
test("workspace ownership ignores forged tenant headers and arbitrary workspace URLs", async () => {
  const app = await fixture();
  try {
    const own = await app.inject({ url: `/api/workspaces/${owner}`, headers: { authorization: "Bearer customer" } });
    assert.equal(own.statusCode, 200);
    assert.equal(own.json().workspace.id, owner);
    const foreign = await app.inject({ url: `/api/workspaces/${other}`, headers: { authorization: "Bearer admin", "x-tenant-id": other } });
    assert.equal(foreign.statusCode, 403);
  } finally { await app.close(); }
});
test("admin APIs require verified app metadata and never trust editable user metadata", async () => {
  const app = await fixture();
  try {
    for (const token of ["customer", "forged-user-metadata"]) {
      assert.equal((await app.inject({ url: "/api/admin/overview", headers: { authorization: `Bearer ${token}` } })).statusCode, 403);
    }
    const admin = await app.inject({ url: "/api/admin/overview", headers: { authorization: "Bearer admin" } });
    assert.equal(admin.statusCode, 200);
    assert.equal(admin.json().overview.status, "running");
    assert.equal(admin.json().overview.modules.find((x: { name: string }) => x.name === "Billing administration").available, false);
    const offline = await app.inject({ url: "/api/admin/overview", headers: { authorization: "Bearer offline" } });
    assert.equal(offline.statusCode, 503);
    assert.ok(!offline.body.includes("synthetic service failure"));
  } finally { await app.close(); }
});
