import assert from "node:assert/strict";
import test from "node:test";
import { checkStaging } from "./check-staging.mjs";

const staging = {
  STAGING_SUPABASE_PROJECT_REF: "staging-ref",
  PRODUCTION_SUPABASE_PROJECT_REF: "production-ref",
  VITE_SUPABASE_URL: "https://staging-ref.supabase.co",
  VITE_SUPABASE_ANON_KEY: "fixture-public-key",
};
test("staging requires a verified, distinct project", () => {
  assert.doesNotThrow(() => checkStaging(staging));
  assert.throws(() => checkStaging({ ...staging, PRODUCTION_SUPABASE_PROJECT_REF: "staging-ref" }));
  assert.throws(() => checkStaging({ ...staging, PRODUCTION_SUPABASE_PROJECT_REF: "" }));
});
test("production, lookalike hosts and embedded credentials are rejected", () => {
  for (const url of ["https://production-ref.supabase.co", "https://staging-ref.supabase.co.evil.test", "http://staging-ref.supabase.co", "https://user:pass@staging-ref.supabase.co", "https://staging-ref.supabase.co?x=1"]) {
    assert.throws(() => checkStaging({ ...staging, VITE_SUPABASE_URL: url }));
  }
});

test("contradictory frontend/backend configuration cannot bypass the database boundary", () => {
  assert.throws(() => checkStaging({ ...staging, SUPABASE_URL: "https://production-ref.supabase.co" }));
  assert.throws(() => checkStaging({ ...staging, SUPABASE_URL: "" }));
  assert.doesNotThrow(() => checkStaging({ ...staging, SUPABASE_URL: staging.VITE_SUPABASE_URL }));
});
