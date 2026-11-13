import assert from "node:assert/strict";
import test from "node:test";
import {
  InspectionGrantStore,
  SiteInspectionService,
  type InspectionConnection,
  type InspectionConnectionStore,
  type SiteInspection,
  type WordPressSiteClient,
} from "./site-inspection.js";

const connection: InspectionConnection = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  site_url: "https://example.com",
  site_id: "33333333-3333-4333-8333-333333333333",
  status: "connected",
};

const inspection: SiteInspection = {
  identity: {
    site_id: connection.site_id,
    site_url: connection.site_url,
  },
  mode: "read-only",
  inspected_at: "2026-09-19T12:00:00Z",
  site: {
    title: "Example",
    description: "Example site",
    url: connection.site_url,
    wordpress_version: "6.8",
    php_version: "8.3",
    language: "en_US",
    timezone: "UTC",
    multisite: false,
    https: true,
  },
  theme: {
    name: "Example Theme",
    version: "1.0.0",
    stylesheet: "example-theme",
    parent: null,
  },
  plugins: {
    total: 4,
    active: 3,
    inactive: 1,
    network_active: 0,
  },
  content: {
    posts: 10,
    pages: 5,
    media: 20,
  },
};

test("inspection requires an owned connected site and atomically consumes its grant", async () => {
  const connections: InspectionConnectionStore = {
    async findOwnedConnected(input) {
      return input.userId === connection.user_id ? connection : null;
    },
  };

  let service: SiteInspectionService;
  let replayAccepted = true;
  const siteClient: WordPressSiteClient = {
    async inspect(siteUrl, grant) {
      assert.equal(siteUrl, connection.site_url);
      assert.equal(
        service.authorize({
          grant,
          site_id: connection.site_id,
          site_url: connection.site_url,
        }),
        true,
      );
      replayAccepted = service.authorize({
        grant,
        site_id: connection.site_id,
        site_url: connection.site_url,
      });
      return inspection;
    },
  };

  service = new SiteInspectionService(connections, siteClient);
  const result = await service.inspect({
    userId: connection.user_id,
    accessToken: "test-access-token",
    connectionId: connection.id,
  });

  assert.equal(result.ok, true);
  assert.equal(replayAccepted, false);
  if (result.ok) assert.deepEqual(result.value, inspection);

  const unauthorized = await service.inspect({
    userId: "44444444-4444-4444-8444-444444444444",
    accessToken: "other-test-access-token",
    connectionId: connection.id,
  });
  assert.deepEqual(unauthorized, { ok: false, reason: "not_found" });
});

test("inspection rejects a mismatched plugin identity", async () => {
  const connections: InspectionConnectionStore = {
    async findOwnedConnected() {
      return connection;
    },
  };

  let service: SiteInspectionService;
  const siteClient: WordPressSiteClient = {
    async inspect(_siteUrl, grant) {
      assert.equal(
        service.authorize({
          grant,
          site_id: connection.site_id,
          site_url: connection.site_url,
        }),
        true,
      );
      return {
        ...inspection,
        identity: {
          ...inspection.identity,
          site_id: "55555555-5555-4555-8555-555555555555",
        },
      };
    },
  };

  service = new SiteInspectionService(connections, siteClient);
  const result = await service.inspect({
    userId: connection.user_id,
    accessToken: "test-access-token",
    connectionId: connection.id,
  });

  assert.deepEqual(result, { ok: false, reason: "unavailable" });
});

test("inspection grants expire and remain single-use", () => {
  let now = 1_000;
  const grantValue = "A".repeat(43);
  const grants = new InspectionGrantStore(() => now, 30_000, () => grantValue);
  const issued = grants.issue(connection);

  now = 31_000;
  assert.equal(
    grants.consume({
      grant: issued,
      siteId: connection.site_id,
      siteUrl: connection.site_url,
    }),
    false,
  );
  assert.equal(
    grants.consume({
      grant: issued,
      siteId: connection.site_id,
      siteUrl: connection.site_url,
    }),
    false,
  );
});
