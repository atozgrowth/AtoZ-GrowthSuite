import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createAuthenticate } from "../auth/authenticate.js";
import { createConnectedSitesReader } from "./connected-sites.js";
import { registerWpManagerRoutes } from "./routes.js";
const owner = "10000000-0000-4000-8000-000000000001", foreign = "10000000-0000-4000-8000-000000000002";
const site = "20000000-0000-4000-8000-000000000001";
const auth = createAuthenticate(async token => ({ data: { user: token === "synthetic-owner" ? { id: owner, app_metadata: {}, user_metadata: { role: "admin", user_id: foreign } } : null }, error: null }));
test("real Supabase query construction binds both verified owner and connected status", async () => {
  let called = 0;
  const reader = createConnectedSitesReader("https://example.supabase.co", "test-anon-key", async (input, init) => {
    called++;
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.pathname, "/rest/v1/wordpress_site_connections");
    assert.equal(url.searchParams.get("user_id"), "eq." + owner);
    assert.equal(url.searchParams.get("status"), "eq.connected");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-owner");
    return new Response(JSON.stringify([{ id: site, site_url: "https://store.example.test" }]), { status: 200, headers: { "content-type": "application/json" } });
  });
  const app = Fastify();
  await registerWpManagerRoutes(app, { authenticate: auth, listSites: reader, pairingService: null, inventoryService: null, inspectionService: null });
  try {
    const response = await app.inject({ url: `/api/wp-manager/sites?user_id=${foreign}`, headers: { authorization: "Bearer synthetic-owner", "x-tenant-id": foreign } });
    assert.equal(response.statusCode, 200); assert.equal(response.json().sites[0].id, site); assert.equal(called, 1);
  } finally { await app.close(); }
});
test("all account WordPress routes reject invalid credentials before invoking services", async () => {
  let calls = 0;
  const trap = new Proxy({}, { get: () => () => { calls++; throw new Error("Service must not run"); } });
  const app = Fastify();
  await registerWpManagerRoutes(app, { authenticate: auth, controlledWritesEnabled: true,
    pairingService: trap as never, inspectionService: trap as never, inventoryService: trap as never, controlledActionService: trap as never,
    listSites: (async () => { calls++; throw new Error("List must not run"); }) });
  const operations = [["GET", "/sites"], ["GET", `/sites/${site}/inspection`], ...["posts", "pages", "media", "plugins"].map(x => ["GET", `/sites/${site}/${x}`]), ["POST", "/pairing/initiate"], ["POST", `/connections/${site}/revoke`], ["POST", `/sites/${site}/actions/proposals`], ["GET", `/sites/${site}/actions`], ["GET", `/actions/${site}`], ["POST", `/actions/${site}/approve`], ["POST", `/actions/${site}/cancel`]];
  try {
    for (const [method, path] of operations) for (const authorization of [undefined, "Bearer expired-synthetic", "Basic invalid"]) {
      const response = await app.inject({ method: method as "GET" | "POST", url: "/api/wp-manager" + path, headers: authorization ? { authorization, "x-tenant-id": foreign } : {} });
      assert.equal(response.statusCode, 401, path);
    }
    assert.equal(calls, 0);
  } finally { await app.close(); }
});
test("inventory transport failure is sanitized rather than leaking SDK errors", async () => {
  const app = Fastify();
  await registerWpManagerRoutes(app, { authenticate: auth, listSites: async () => { throw new Error("synthetic private diagnostic"); }, pairingService: null, inventoryService: null, inspectionService: null });
  try { const response = await app.inject({ url: "/api/wp-manager/sites", headers: { authorization: "Bearer synthetic-owner" } }); assert.equal(response.statusCode, 503); assert.ok(!response.body.includes("private diagnostic")); }
  finally { await app.close(); }
});

test("foreign connection inventory is denied by the real service before any WordPress call", async () => {
  const { SiteInventoryService } = await import("./site-inventory.js");
  const { InspectionGrantStore } = await import("./site-inspection.js");
  let wordpressCalls = 0, ownerChecks = 0;
  const inventory = new SiteInventoryService({ async findOwnedConnected(input) {
    ownerChecks++; assert.equal(input.userId, owner); assert.equal(input.connectionId, foreign); return null;
  } }, { async list() { wordpressCalls++; throw new Error("Forbidden external call"); } }, new InspectionGrantStore());
  const app = Fastify();
  await registerWpManagerRoutes(app, { authenticate: auth, inventoryService: inventory, pairingService: null, inspectionService: null });
  try {
    const response = await app.inject({ url: `/api/wp-manager/sites/${foreign}/posts?user_id=${foreign}`, headers: { authorization: "Bearer synthetic-owner", "x-tenant-id": foreign } });
    assert.equal(response.statusCode, 404); assert.equal(ownerChecks, 1); assert.equal(wordpressCalls, 0);
  } finally { await app.close(); }
});
