import test from "node:test";
import assert from "node:assert/strict";
import { parseConnectedSites } from "../src/wp-manager/siteContract.ts";
const record = { id: "20000000-0000-4000-8000-000000000001", site_url: "https://store.example.test" };
test("inventory accepts actual connected-only envelopes and empty results", () => {
  assert.deepEqual(parseConnectedSites({ sites: [record] }), [{ ...record, site_url: record.site_url + "/", status: "connected" }]);
  assert.deepEqual(parseConnectedSites([]), []);
});
test("bad IDs, duplicate records, unsafe URLs and non-connected rows reject the entire inventory", () => {
  for (const bad of [{ ...record, id: 1 }, { ...record, id: "missing-uuid" }, { ...record, site_url: "javascript:alert(1)" }, { ...record, site_url: "https://secret@example.test" }, { ...record, site_url: "http://example.test" }, { ...record, site_url: "https://example.test?token=synthetic" }, { ...record, status: "pending" }]) {
    assert.throws(() => parseConnectedSites({ sites: [record, bad] }));
  }
  assert.throws(() => parseConnectedSites({ sites: [record, record] }));
  for (const value of [null, {}, { sites: null }]) assert.throws(() => parseConnectedSites(value));
});
