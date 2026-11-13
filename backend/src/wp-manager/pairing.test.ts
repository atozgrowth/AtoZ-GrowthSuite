import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";
import Fastify, { type FastifyReply } from "fastify";
import type { AuthenticatedRequest } from "../auth/authenticate.js";
import {
  PairingService,
  type PairingConnection,
  type PairingStore,
  type PairingStoreResult,
} from "./pairing.js";
import { registerWpManagerRoutes } from "./routes.js";

const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "10000000-0000-4000-8000-000000000002";
const SITE_A = "20000000-0000-4000-8000-000000000001";
const CONNECTION_A = "30000000-0000-4000-8000-000000000001";
const CHALLENGE = "A".repeat(43);

type ChallengeRow = {
  connectionId: string;
  digest: string;
  expiresAt: string;
  consumedAt: string | null;
};

class MemoryPairingStore implements PairingStore {
  connections = new Map<string, PairingConnection>();
  challenges: ChallengeRow[] = [];
  nextConnectionId = CONNECTION_A;

  async initiate(input: {
    userId: string;
    siteUrl: string;
    challengeDigest: string;
    expiresAt: string;
    now: string;
  }): Promise<PairingStoreResult<PairingConnection>> {
    let connection = [...this.connections.values()].find(
      (item) => item.user_id === input.userId && item.site_url === input.siteUrl
    );

    if (connection?.status === "connected") {
      return { ok: false, reason: "already_connected" };
    }
    if (connection?.status === "revoked") {
      return { ok: false, reason: "invalid_state" };
    }

    if (!connection) {
      connection = {
        id: this.nextConnectionId,
        user_id: input.userId,
        site_url: input.siteUrl,
        site_id: null,
        status: "pending",
        connected_at: null,
        revoked_at: null,
      };
      this.connections.set(connection.id, connection);
    }

    for (const challenge of this.challenges) {
      if (challenge.connectionId === connection.id && !challenge.consumedAt) {
        challenge.consumedAt = input.now;
      }
    }
    this.challenges.push({
      connectionId: connection.id,
      digest: input.challengeDigest,
      expiresAt: input.expiresAt,
      consumedAt: null,
    });
    return { ok: true, value: connection };
  }

  async confirm(input: {
    connectionId: string;
    siteId: string;
    siteUrl: string;
    challengeDigest: string;
    now: string;
  }): Promise<PairingStoreResult<PairingConnection>> {
    const challenge = this.challenges.find(
      (item) =>
        item.connectionId === input.connectionId &&
        item.digest === input.challengeDigest &&
        !item.consumedAt &&
        item.expiresAt > input.now
    );
    if (!challenge) return { ok: false, reason: "invalid_or_expired" };

    // Mirrors the production conditional UPDATE: consumption happens exactly once.
    challenge.consumedAt = input.now;

    const connection = this.connections.get(input.connectionId);
    if (
      !connection ||
      connection.status !== "pending" ||
      connection.site_url !== input.siteUrl
    ) {
      return { ok: false, reason: "invalid_state" };
    }

    const conflict = [...this.connections.values()].some(
      (item) => item.id !== connection.id && item.site_id === input.siteId
    );
    if (conflict) return { ok: false, reason: "site_conflict" };

    connection.site_id = input.siteId;
    connection.status = "connected";
    connection.connected_at = input.now;
    connection.revoked_at = null;
    return { ok: true, value: connection };
  }

  async revoke(input: {
    connectionId: string;
    userId: string;
    now: string;
  }): Promise<PairingStoreResult<PairingConnection>> {
    const connection = this.connections.get(input.connectionId);
    if (!connection || connection.user_id !== input.userId) {
      return { ok: false, reason: "not_found" };
    }
    if (connection.status !== "revoked") {
      connection.status = "revoked";
      connection.revoked_at = input.now;
    }
    return { ok: true, value: connection };
  }
}

function serviceAt(store: PairingStore, iso: string) {
  return new PairingService(store, () => new Date(iso), () => CHALLENGE);
}

test("unauthenticated initiation is rejected", async () => {
  const app = Fastify({ logger: false });
  const store = new MemoryPairingStore();
  await registerWpManagerRoutes(app, {
    pairingService: serviceAt(store, "2026-09-19T09:00:00.000Z"),
    authenticate: async (request: AuthenticatedRequest, reply: FastifyReply) => {
      if (!request.headers.authorization) {
        return reply.code(401).send({ success: false });
      }
      request.user = { id: USER_A };
      request.accessToken = "test-only-token";
    },
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/wp-manager/pairing/initiate",
    payload: { site_url: "https://example.com" },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(store.connections.size, 0);
  await app.close();
});

test("invalid and expired challenges are rejected", async () => {
  const store = new MemoryPairingStore();
  const initiated = await serviceAt(store, "2026-09-19T09:00:00.000Z").initiate(
    USER_A,
    { site_url: "https://example.com" }
  );
  assert.equal(initiated.ok, true);

  const invalid = await serviceAt(store, "2026-09-19T09:01:00.000Z").confirm({
    connection_id: CONNECTION_A,
    site_id: SITE_A,
    site_url: "https://example.com",
    challenge: "B".repeat(43),
  });
  assert.deepEqual(invalid, { ok: false, reason: "invalid_or_expired" });

  const expired = await serviceAt(store, "2026-09-19T09:11:00.000Z").confirm({
    connection_id: CONNECTION_A,
    site_id: SITE_A,
    site_url: "https://example.com",
    challenge: CHALLENGE,
  });
  assert.deepEqual(expired, { ok: false, reason: "invalid_or_expired" });
});

test("a valid challenge connects once and preserves lifecycle transitions", async () => {
  const store = new MemoryPairingStore();
  await serviceAt(store, "2026-09-19T09:00:00.000Z").initiate(USER_A, {
    site_url: "https://example.com",
  });

  const connected = await serviceAt(store, "2026-09-19T09:01:00.000Z").confirm({
    connection_id: CONNECTION_A,
    site_id: SITE_A,
    site_url: "https://example.com",
    challenge: CHALLENGE,
  });
  assert.equal(connected.ok, true);
  if (!connected.ok) return;
  assert.equal(connected.value.status, "connected");
  assert.equal(connected.value.connected_at, "2026-09-19T09:01:00.000Z");

  const replay = await serviceAt(store, "2026-09-19T09:02:00.000Z").confirm({
    connection_id: CONNECTION_A,
    site_id: SITE_A,
    site_url: "https://example.com",
    challenge: CHALLENGE,
  });
  assert.deepEqual(replay, { ok: false, reason: "invalid_or_expired" });
});

test("revocation enforces ownership and preserves site identity", async () => {
  const store = new MemoryPairingStore();
  await serviceAt(store, "2026-09-19T09:00:00.000Z").initiate(USER_A, {
    site_url: "https://example.com",
  });
  await serviceAt(store, "2026-09-19T09:01:00.000Z").confirm({
    connection_id: CONNECTION_A,
    site_id: SITE_A,
    site_url: "https://example.com",
    challenge: CHALLENGE,
  });

  const denied = await serviceAt(store, "2026-09-19T09:02:00.000Z").revoke(
    USER_B,
    CONNECTION_A
  );
  assert.deepEqual(denied, { ok: false, reason: "not_found" });

  const revoked = await serviceAt(store, "2026-09-19T09:03:00.000Z").revoke(
    USER_A,
    CONNECTION_A
  );
  assert.equal(revoked.ok, true);
  if (!revoked.ok) return;
  assert.equal(revoked.value.status, "revoked");
  assert.equal(revoked.value.site_id, SITE_A);
  assert.equal(revoked.value.connected_at, "2026-09-19T09:01:00.000Z");
  assert.equal(revoked.value.revoked_at, "2026-09-19T09:03:00.000Z");
});

test("global site identity conflicts are rejected", async () => {
  const store = new MemoryPairingStore();
  store.connections.set("30000000-0000-4000-8000-000000000009", {
    id: "30000000-0000-4000-8000-000000000009",
    user_id: USER_B,
    site_url: "https://other.example.com",
    site_id: SITE_A,
    status: "connected",
    connected_at: "2026-09-19T08:00:00.000Z",
    revoked_at: null,
  });

  await serviceAt(store, "2026-09-19T09:00:00.000Z").initiate(USER_A, {
    site_url: "https://example.com",
  });
  const result = await serviceAt(store, "2026-09-19T09:01:00.000Z").confirm({
    connection_id: CONNECTION_A,
    site_id: SITE_A,
    site_url: "https://example.com",
    challenge: CHALLENGE,
  });

  assert.deepEqual(result, { ok: false, reason: "site_conflict" });
});
