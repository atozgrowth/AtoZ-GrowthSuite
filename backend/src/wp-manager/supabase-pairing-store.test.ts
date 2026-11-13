import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabasePairingStore } from "./supabase-pairing-store.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "30000000-0000-4000-8000-000000000001";
const SITE_ID = "20000000-0000-4000-8000-000000000001";
const SITE_URL = "https://example.com";
const DIGEST = "\\x" + "ab".repeat(32);

type Result = { data: unknown; error: unknown };

function builder(result: Result) {
  const chain: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "is",
    "in",
    "insert",
    "update",
    "delete",
  ]) {
    chain[method] = () => chain;
  }
  chain.single = async () => result;
  chain.maybeSingle = async () => result;
  chain.then = (
    resolve: (value: Result) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function clientWith(input: {
  fromResults?: Result[];
  rpcResults?: Result[];
}) {
  const fromResults = [...(input.fromResults ?? [])];
  const rpcResults = [...(input.rpcResults ?? [])];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const fromCalls: string[] = [];

  const client = {
    from(table: string) {
      fromCalls.push(table);
      return builder(fromResults.shift() ?? { data: null, error: null });
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return builder(rpcResults.shift() ?? { data: null, error: null });
    },
  } as unknown as SupabaseClient;

  return { client, rpcCalls, fromCalls };
}

const pendingConnection = {
  id: CONNECTION_ID,
  user_id: USER_ID,
  site_url: SITE_URL,
  site_id: null,
  status: "pending",
  connected_at: null,
  revoked_at: null,
};

test("initiate calls create RPC with the exact bytea digest and bounded expiry", async () => {
  const fake = clientWith({
    fromResults: [{ data: pendingConnection, error: null }],
    rpcResults: [
      {
        data: {
          out_connection_id: CONNECTION_ID,
          out_expires_at: "2026-09-19T09:10:00.000Z",
        },
        error: null,
      },
    ],
  });
  const store = new SupabasePairingStore(fake.client);

  const result = await store.initiate({
    userId: USER_ID,
    siteUrl: SITE_URL,
    challengeDigest: DIGEST,
    expiresAt: "2026-09-19T09:10:00.000Z",
    now: "2026-09-19T09:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(fake.rpcCalls, [
    {
      name: "wp_manager_create_pairing_challenge",
      args: {
        p_connection_id: CONNECTION_ID,
        p_user_id: USER_ID,
        p_challenge_digest: DIGEST,
        p_expires_at: "2026-09-19T09:10:00.000Z",
      },
    },
  ]);
  assert.deepEqual(fake.fromCalls, ["wordpress_site_connections"]);
});

test("initiate removes a newly created pending row when the RPC fails", async () => {
  const fake = clientWith({
    fromResults: [
      { data: null, error: null },
      { data: pendingConnection, error: null },
      { data: null, error: null },
    ],
    rpcResults: [{ data: null, error: { code: "sanitized-test-error" } }],
  });
  const store = new SupabasePairingStore(fake.client);

  const result = await store.initiate({
    userId: USER_ID,
    siteUrl: SITE_URL,
    challengeDigest: DIGEST,
    expiresAt: "2026-09-19T09:10:00.000Z",
    now: "2026-09-19T09:00:00.000Z",
  });

  assert.deepEqual(result, { ok: false, reason: "unavailable" });
  assert.deepEqual(fake.fromCalls, [
    "wordpress_site_connections",
    "wordpress_site_connections",
    "wordpress_site_connections",
  ]);
});

test("confirm calls the atomic RPC and maps a connected row", async () => {
  const fake = clientWith({
    rpcResults: [
      {
        data: {
          outcome: "connected",
          out_connection_id: CONNECTION_ID,
          out_user_id: USER_ID,
          out_site_url: SITE_URL,
          out_site_id: SITE_ID,
          out_status: "connected",
          out_connected_at: "2026-09-19T09:01:00.000Z",
          out_revoked_at: null,
        },
        error: null,
      },
    ],
  });
  const store = new SupabasePairingStore(fake.client);

  const result = await store.confirm({
    connectionId: CONNECTION_ID,
    siteId: SITE_ID,
    siteUrl: SITE_URL,
    challengeDigest: DIGEST,
    now: "2026-09-19T09:01:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(fake.rpcCalls, [
    {
      name: "wp_manager_confirm_pairing_challenge",
      args: {
        p_connection_id: CONNECTION_ID,
        p_site_id: SITE_ID,
        p_site_url: SITE_URL,
        p_challenge_digest: DIGEST,
      },
    },
  ]);
  assert.deepEqual(fake.fromCalls, []);
});

test("confirm maps safe RPC outcomes without exposing database errors", async () => {
  for (const [outcome, reason] of [
    ["invalid_or_expired", "invalid_or_expired"],
    ["invalid_state", "invalid_state"],
    ["site_conflict", "site_conflict"],
  ] as const) {
    const fake = clientWith({
      rpcResults: [{ data: { outcome }, error: null }],
    });
    const store = new SupabasePairingStore(fake.client);
    const result = await store.confirm({
      connectionId: CONNECTION_ID,
      siteId: SITE_ID,
      siteUrl: SITE_URL,
      challengeDigest: DIGEST,
      now: "2026-09-19T09:01:00.000Z",
    });
    assert.deepEqual(result, { ok: false, reason });
  }

  const failed = clientWith({
    rpcResults: [{ data: null, error: { message: "must not escape" } }],
  });
  const result = await new SupabasePairingStore(failed.client).confirm({
    connectionId: CONNECTION_ID,
    siteId: SITE_ID,
    siteUrl: SITE_URL,
    challengeDigest: DIGEST,
    now: "2026-09-19T09:01:00.000Z",
  });
  assert.deepEqual(result, { ok: false, reason: "unavailable" });
});
