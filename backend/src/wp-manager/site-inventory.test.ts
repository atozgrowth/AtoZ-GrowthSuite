import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { InspectionGrantStore, type InspectionConnection, type InspectionConnectionStore } from "./site-inspection.js";
import { SiteInventoryService, type InventoryResource, type WordPressInventoryClient } from "./site-inventory.js";

const connection: InspectionConnection = {
  id: "11111111-1111-4111-8111-111111111111", user_id: "22222222-2222-4222-8222-222222222222",
  site_url: "https://example.com", site_id: "33333333-3333-4333-8333-333333333333", status: "connected",
};
const contentItem = {
  id: 1, title: "Hello", status: "publish", author_display_name: "Editor",
  published_at: "2026-09-19T12:00:00Z", modified_at: "2026-09-19T12:01:00Z",
  slug: "hello", public_url: "https://example.com/hello/",
};
function response(resource: InventoryResource, overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    identity: { site_id: connection.site_id, site_url: connection.site_url }, mode: "read-only", resource,
    items: resource === "plugins" ? [{ name: "Example", version: "1.0", active: true }] : [contentItem],
  };
  if (resource !== "plugins") base.pagination = { page: 1, per_page: 20, total_items: 1, total_pages: 1 };
  return { ...base, ...overrides };
}
function serviceWith(payload: unknown, owned = true) {
  let service: SiteInventoryService;
  const connections: InspectionConnectionStore = { async findOwnedConnected(input) { return owned && input.userId === connection.user_id ? connection : null; } };
  const client: WordPressInventoryClient = { async list(input) {
    assert.equal(serviceAuthorize(input.grant, input.resource, input.page, input.perPage), true);
    return payload;
  } };
  const grants = new InspectionGrantStore();
  const serviceAuthorize = (grant: string, scope: InventoryResource, page?: number, perPage?: number) => grants.consume({ grant, siteId: connection.site_id, siteUrl: connection.site_url, scope, page, perPage });
  service = new SiteInventoryService(connections, client, grants);
  return service;
}

test("inventory enforces ownership and connected pairing", async () => {
  const service = serviceWith(response("posts"), false);
  assert.deepEqual(await service.list({ userId: connection.user_id, accessToken: "token", connectionId: connection.id, resource: "posts" }), { ok: false, reason: "not_found" });
});

test("inventory validates pagination bounds and binds them to the grant", async () => {
  const service = serviceWith(response("posts"));
  assert.deepEqual(await service.list({ userId: connection.user_id, accessToken: "token", connectionId: connection.id, resource: "posts", page: "0" }), { ok: false, reason: "invalid_input" });
  assert.deepEqual(await service.list({ userId: connection.user_id, accessToken: "token", connectionId: connection.id, resource: "posts", perPage: "51" }), { ok: false, reason: "invalid_input" });
  assert.equal((await service.list({ userId: connection.user_id, accessToken: "token", connectionId: connection.id, resource: "posts", page: "1", perPage: "20" })).ok, true);
});

test("inventory rejects unknown fields and identity mismatches", async () => {
  const unknown = serviceWith(response("posts", { extra: true }));
  assert.deepEqual(await unknown.list({ userId: connection.user_id, accessToken: "token", connectionId: connection.id, resource: "posts" }), { ok: false, reason: "unavailable" });
  const mismatch = serviceWith(response("posts", { identity: { site_id: "44444444-4444-4444-8444-444444444444", site_url: connection.site_url } }));
  assert.deepEqual(await mismatch.list({ userId: connection.user_id, accessToken: "token", connectionId: connection.id, resource: "posts" }), { ok: false, reason: "unavailable" });
});

test("inventory rejects unsafe URLs, malformed schemas, and oversized item lists", async () => {
  const unsafe = serviceWith(response("posts", { items: [{ ...contentItem, public_url: "javascript:alert(1)" }] }));
  assert.equal((await unsafe.list({ userId: connection.user_id, accessToken: "token", connectionId: connection.id, resource: "posts" })).ok, false);
  const malformed = serviceWith(response("media", { items: [{ title: "missing required fields" }] }));
  assert.equal((await malformed.list({ userId: connection.user_id, accessToken: "token", connectionId: connection.id, resource: "media" })).ok, false);
  const oversized = serviceWith(response("posts", { items: Array.from({ length: 51 }, (_, id) => ({ ...contentItem, id: id + 1 })) }));
  assert.equal((await oversized.list({ userId: connection.user_id, accessToken: "token", connectionId: connection.id, resource: "posts" })).ok, false);
});

test("inventory routes reject unauthenticated requests and expose no mutation methods", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  const { registerWpManagerRoutes } = await import("./routes.js");
  const app = Fastify();
  await registerWpManagerRoutes(app, {
    pairingService: null, inspectionService: null, inventoryService: null,
    authenticate: async (_request, reply) => { await reply.code(401).send({ success: false }); },
  });
  const getResponse = await app.inject({ method: "GET", url: `/api/wp-manager/sites/${connection.id}/posts` });
  assert.equal(getResponse.statusCode, 401);
  for (const resource of ["posts", "pages", "media", "plugins", "themes"]) {
    assert.equal((await app.inject({ method: "GET", url: `/api/wp-manager/sites/${connection.id}/${resource}` })).statusCode, 401);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const result = await app.inject({ method, url: `/api/wp-manager/sites/${connection.id}/${resource}` });
      assert.equal(result.statusCode, 404);
    }
  }
  await app.close();
});


test("grants cannot be reused for a different resource or page", () => {
  const grants = new InspectionGrantStore(() => 1_000, 30_000, () => "A".repeat(43));
  const grant = grants.issue(connection, { scope: "posts", page: 2, perPage: 20 });
  assert.equal(grants.consume({ grant, siteId: connection.site_id, siteUrl: connection.site_url, scope: "pages", page: 2, perPage: 20 }), false);
  const second = grants.issue(connection, { scope: "posts", page: 2, perPage: 20 });
  assert.equal(grants.consume({ grant: second, siteId: connection.site_id, siteUrl: connection.site_url, scope: "posts", page: 1, perPage: 20 }), false);
});

const themeItem = { name: "Synthetic Theme", version: "1.0", active: true, parent: null, update_available: null };
function themeResponse(items: unknown[] = [themeItem]) {
  return { identity: { site_id: connection.site_id, site_url: connection.site_url }, mode: "read-only", resource: "themes", items };
}
test("theme inventory uses a site/owner/scope-bound read grant without pagination", async () => {
  const value = await serviceWith(themeResponse()).list({ userId: connection.user_id, accessToken: "synthetic-token", connectionId: connection.id, resource: "themes" });
  assert.equal(value.ok, true);
  if (value.ok) assert.deepEqual(value.value.items, [themeItem]);
  assert.deepEqual(await serviceWith(themeResponse(), false).list({ userId: connection.user_id, accessToken: "synthetic-token", connectionId: connection.id, resource: "themes" }), { ok: false, reason: "not_found" });
});
test("theme inventory rejects malformed cached update states and hidden fields", async () => {
  for (const item of [{ ...themeItem, update_available: "yes" }, { ...themeItem, active: "yes" }, { ...themeItem, path: "/private/theme" }]) {
    assert.equal((await serviceWith(themeResponse([item])).list({ userId: connection.user_id, accessToken: "synthetic-token", connectionId: connection.id, resource: "themes" })).ok, false);
  }
});
test("theme grants reject scope substitution, expire, and cannot be replayed", () => {
  let now = 1000;
  const grants = new InspectionGrantStore(() => now, 30_000, () => "A".repeat(43));
  const grant = grants.issue(connection, { scope: "themes" });
  assert.equal(grants.consume({ grant, siteId: connection.site_id, siteUrl: connection.site_url, scope: "themes" }), true);
  assert.equal(grants.consume({ grant, siteId: connection.site_id, siteUrl: connection.site_url, scope: "themes" }), false);
  const substituted = grants.issue(connection, { scope: "themes" });
  assert.equal(grants.consume({ grant: substituted, siteId: connection.site_id, siteUrl: connection.site_url, scope: "plugins" }), false);
  const expired = grants.issue(connection, { scope: "themes" }); now += 30_000;
  assert.equal(grants.consume({ grant: expired, siteId: connection.site_id, siteUrl: connection.site_url, scope: "themes" }), false);
});
