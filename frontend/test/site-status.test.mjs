import test from "node:test";
import assert from "node:assert/strict";
import { isConnectedSite } from "../src/wp-manager/siteStatus.ts";
test("connected-only endpoint records do not need a redundant status field", () => {
  assert.equal(isConnectedSite({ id: "fixture", site_url: "https://example.test" }), true);
  assert.equal(isConnectedSite({ status: "connected" }), true);
  for (const status of ["pending", "revoked", "unknown", null]) assert.equal(isConnectedSite({ status }), false);
});
