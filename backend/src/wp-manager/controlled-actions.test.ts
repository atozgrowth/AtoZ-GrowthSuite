import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Fastify, { type FastifyReply } from "fastify";
import type { AuthenticatedRequest } from "../auth/authenticate.js";
import {
  ControlledActionService,
  canonicalizeCreatePostDraftPayload,
  controlledWritesEnabled,
  digestCreatePostDraftPayload,
  type ActionTransitionResult,
  type ControlledActionAuditEvent,
  type ControlledActionDetail,
  type ControlledActionRecord,
  type ControlledActionStore,
} from "./controlled-actions.js";
import { registerWpManagerRoutes } from "./routes.js";
import type {
  InspectionConnection,
  InspectionConnectionStore,
} from "./site-inspection.js";

const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "10000000-0000-4000-8000-000000000002";
const CONNECTION_ID = "30000000-0000-4000-8000-000000000001";
const SITE_ID = "20000000-0000-4000-8000-000000000001";
const ACTION_ID = "40000000-0000-4000-8000-000000000001";
const NOW = "2026-09-20T18:00:00.000Z";

const connection: InspectionConnection = {
  id: CONNECTION_ID,
  user_id: USER_A,
  site_url: "https://example.com",
  site_id: SITE_ID,
  status: "connected",
};

class MemoryActionStore implements ControlledActionStore {
  records = new Map<string, ControlledActionDetail>();
  audits: ControlledActionAuditEvent[] = [];
  nextId = ACTION_ID;

  async create(input: Parameters<ControlledActionStore["create"]>[0]) {
    const record: ControlledActionDetail = {
      id: this.nextId,
      user_id: input.ownerId,
      connection_id: input.connection.id,
      site_id: input.connection.site_id,
      site_url: input.connection.site_url,
      action_type: input.actionType,
      status: "proposed",
      payload_digest: input.payloadDigest,
      actor_source: input.actorSource,
      created_at: input.createdAt,
      expires_at: input.expiresAt,
      approved_at: null,
      executing_at: null,
      execution_consumed_at: null,
      completed_at: null,
      result_post_id: null,
      failure_code: null,
      payload: input.payload,
    };
    this.records.set(record.id, record);
    this.audits.push({
      actionId: record.id,
      ownerId: record.user_id,
      connectionId: record.connection_id,
      actionType: record.action_type,
      eventType: "proposed",
      actorSource: record.actor_source,
      occurredAt: record.created_at,
    });
    return record;
  }

  async list(input: Parameters<ControlledActionStore["list"]>[0]) {
    return [...this.records.values()]
      .filter((item) => item.user_id === input.ownerId)
      .filter((item) => !input.connectionId || item.connection_id === input.connectionId)
      .map(({ payload: _payload, ...record }) => record);
  }

  async get(input: Parameters<ControlledActionStore["get"]>[0]) {
    const record = this.records.get(input.actionId);
    return record?.user_id === input.ownerId ? structuredClone(record) : null;
  }

  async approve(input: Parameters<ControlledActionStore["approve"]>[0]): Promise<ActionTransitionResult> {
    const record = this.records.get(input.actionId);
    if (!record || record.user_id !== input.ownerId) return { ok: false, reason: "not_found" };
    if (record.payload_digest !== input.payloadDigest) return { ok: false, reason: "invalid_state" };
    if (Date.parse(record.expires_at) <= Date.parse(input.now)) {
      if (record.status === "proposed" || record.status === "approved") {
        record.status = "expired";
        record.completed_at = input.now;
        this.audits.push({ actionId: record.id, ownerId: record.user_id, connectionId: record.connection_id, actionType: record.action_type, eventType: "expired", actorSource: "user", occurredAt: input.now });
      }
      return { ok: false, reason: "expired" };
    }
    if (record.status === "approved") return { ok: true, value: record, changed: false };
    if (record.status !== "proposed") return { ok: false, reason: "invalid_state" };
    record.status = "approved";
    record.approved_at = input.now;
    this.audits.push({
      actionId: record.id,
      ownerId: record.user_id,
      connectionId: record.connection_id,
      actionType: record.action_type,
      eventType: "approved",
      actorSource: "user",
      occurredAt: input.now,
    });
    return { ok: true, value: record, changed: true };
  }

  async cancel(input: Parameters<ControlledActionStore["cancel"]>[0]): Promise<ActionTransitionResult> {
    const record = this.records.get(input.actionId);
    if (!record || record.user_id !== input.ownerId) return { ok: false, reason: "not_found" };
    if (Date.parse(record.expires_at) <= Date.parse(input.now)) {
      if (record.status === "proposed" || record.status === "approved") {
        record.status = "expired";
        record.completed_at = input.now;
        this.audits.push({ actionId: record.id, ownerId: record.user_id, connectionId: record.connection_id, actionType: record.action_type, eventType: "expired", actorSource: "user", occurredAt: input.now });
      }
      return { ok: false, reason: "expired" };
    }
    if (record.status === "cancelled") return { ok: true, value: record, changed: false };
    if (record.status !== "proposed" && record.status !== "approved") {
      return { ok: false, reason: "invalid_state" };
    }
    record.status = "cancelled";
    record.completed_at = input.now;
    this.audits.push({
      actionId: record.id,
      ownerId: record.user_id,
      connectionId: record.connection_id,
      actionType: record.action_type,
      eventType: "cancelled",
      actorSource: "user",
      occurredAt: input.now,
    });
    return { ok: true, value: record, changed: true };
  }
}

function service(input: { owned?: boolean; now?: string } = {}) {
  const connections: InspectionConnectionStore = {
    async findOwnedConnected(query) {
      return input.owned !== false && query.userId === USER_A ? connection : null;
    },
  };
  const store = new MemoryActionStore();
  const value = new ControlledActionService(
    connections,
    store,
    () => new Date(input.now ?? NOW),
  );
  return { value, store };
}

const validBody = {
  action_type: "create_post_draft",
  payload: { title: "Draft title", content: "Draft body" },
};

async function propose(value: ControlledActionService) {
  return value.propose({
    ownerId: USER_A,
    accessToken: "test-token",
    connectionId: CONNECTION_ID,
    body: validBody,
  });
}

test("controlled writes are disabled by default and require an exact true flag", () => {
  assert.equal(controlledWritesEnabled(undefined), false);
  assert.equal(controlledWritesEnabled("false"), false);
  assert.equal(controlledWritesEnabled("TRUE"), false);
  assert.equal(controlledWritesEnabled("true"), true);
});

test("canonical payload digests are deterministic and field-order independent", () => {
  const one = { title: "Title", content: "Body" };
  const two = { content: "Body", title: "Title" };
  assert.equal(canonicalizeCreatePostDraftPayload(one), '{"title":"Title","content":"Body"}');
  assert.equal(digestCreatePostDraftPayload(one), digestCreatePostDraftPayload(two));
});

test("proposal accepts only create_post_draft with exact bounded title/content fields", async () => {
  const { value, store } = service();
  assert.equal((await propose(value)).ok, true);
  assert.equal(store.records.size, 1);

  for (const body of [
    { ...validBody, action_type: "publish_post" },
    { ...validBody, extra: true },
    { ...validBody, payload: { ...validBody.payload, status: "publish" } },
    { ...validBody, payload: { title: "", content: "Body" } },
    { ...validBody, payload: { title: "T".repeat(201), content: "Body" } },
    { ...validBody, payload: { title: "Title", content: "" } },
    { ...validBody, payload: { title: "Title", content: "C".repeat(100_001) } },
  ]) {
    const result = await value.propose({
      ownerId: USER_A,
      accessToken: "test-token",
      connectionId: CONNECTION_ID,
      body,
    });
    assert.deepEqual(result, { ok: false, reason: "invalid_input" });
  }
});

test("proposal denies cross-account and invalid or unpaired connections", async () => {
  const denied = service({ owned: false });
  assert.deepEqual(await propose(denied.value), { ok: false, reason: "not_found" });

  const owned = service();
  const result = await owned.value.propose({
    ownerId: USER_B,
    accessToken: "other-token",
    connectionId: CONNECTION_ID,
    body: validBody,
  });
  assert.deepEqual(result, { ok: false, reason: "not_found" });
});

test("proposal creates only safe audit metadata and stores payload separately", async () => {
  const { value, store } = service();
  const result = await propose(value);
  assert.equal(result.ok, true);
  assert.equal(store.audits.length, 1);
  assert.equal(JSON.stringify(store.audits).includes("Draft body"), false);
  assert.equal(store.audits[0].eventType, "proposed");
});

test("approval revalidates connected ownership and bound site identity", async () => {
  let connected = true;
  const connections: InspectionConnectionStore = {
    async findOwnedConnected() { return connected ? connection : null; },
  };
  const store = new MemoryActionStore();
  const value = new ControlledActionService(connections, store, () => new Date(NOW));
  await propose(value);
  connected = false;
  assert.deepEqual(
    await value.approve({ ownerId: USER_A, accessToken: "test-token", actionId: ACTION_ID }),
    { ok: false, reason: "invalid_state" },
  );
});

test("payload tampering is detected before approval", async () => {
  const { value, store } = service();
  await propose(value);
  store.records.get(ACTION_ID)!.payload.content = "tampered";
  assert.deepEqual(
    await value.approve({ ownerId: USER_A, accessToken: "test-token", actionId: ACTION_ID }),
    { ok: false, reason: "tampered" },
  );
});

test("approval enforces expiry, legal transitions, and safe duplicate idempotency", async () => {
  const current = service();
  await propose(current.value);
  const approved = await current.value.approve({
    ownerId: USER_A, accessToken: "test-token", actionId: ACTION_ID,
  });
  assert.equal(approved.ok, true);
  if (approved.ok) assert.equal(approved.changed, true);
  const duplicate = await current.value.approve({
    ownerId: USER_A, accessToken: "test-token", actionId: ACTION_ID,
  });
  assert.equal(duplicate.ok, true);
  if (duplicate.ok) assert.equal(duplicate.changed, false);
  assert.equal(current.store.audits.filter((event) => event.eventType === "approved").length, 1);

  const expired = service({ now: "2026-09-20T18:00:00.000Z" });
  await propose(expired.value);
  const lateService = new ControlledActionService(
    { async findOwnedConnected() { return connection; } },
    expired.store,
    () => new Date("2026-09-20T18:16:00.000Z"),
  );
  assert.deepEqual(
    await lateService.approve({ ownerId: USER_A, accessToken: "test-token", actionId: ACTION_ID }),
    { ok: false, reason: "expired" },
  );
});

test("cancelled proposals cannot be approved and terminal states reject cancellation", async () => {
  const { value, store } = service();
  await propose(value);
  assert.equal((await value.cancel({ ownerId: USER_A, accessToken: "test-token", actionId: ACTION_ID })).ok, true);
  assert.deepEqual(
    await value.approve({ ownerId: USER_A, accessToken: "test-token", actionId: ACTION_ID }),
    { ok: false, reason: "invalid_state" },
  );
  store.records.get(ACTION_ID)!.status = "failed";
  assert.deepEqual(
    await value.cancel({ ownerId: USER_A, accessToken: "test-token", actionId: ACTION_ID }),
    { ok: false, reason: "invalid_state" },
  );
});

test("routes do not exist while the feature is disabled", async () => {
  const app = Fastify({ logger: false });
  await registerWpManagerRoutes(app, {
    pairingService: null,
    inspectionService: null,
    inventoryService: null,
    controlledActionService: service().value,
    controlledWritesEnabled: false,
  });
  const response = await app.inject({
    method: "POST",
    url: `/api/wp-manager/sites/${CONNECTION_ID}/actions/proposals`,
    payload: validBody,
  });
  assert.equal(response.statusCode, 404);
  await app.close();
});

test("enabled proposal routes require authentication", async () => {
  const app = Fastify({ logger: false });
  await registerWpManagerRoutes(app, {
    pairingService: null,
    inspectionService: null,
    inventoryService: null,
    controlledActionService: service().value,
    controlledWritesEnabled: true,
    authenticate: async (_request, reply: FastifyReply) => {
      await reply.code(401).send({ success: false });
    },
  });
  const response = await app.inject({
    method: "POST",
    url: `/api/wp-manager/sites/${CONNECTION_ID}/actions/proposals`,
    payload: validBody,
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("enabled routes support proposal, retrieval, approval, and cancellation without WordPress execution", async () => {
  const app = Fastify({ logger: false });
  const action = service();
  await registerWpManagerRoutes(app, {
    pairingService: null,
    inspectionService: null,
    inventoryService: null,
    controlledActionService: action.value,
    controlledWritesEnabled: true,
    authenticate: async (request: AuthenticatedRequest) => {
      request.user = { id: USER_A };
      request.accessToken = "test-token";
    },
  });
  const created = await app.inject({
    method: "POST",
    url: `/api/wp-manager/sites/${CONNECTION_ID}/actions/proposals`,
    payload: validBody,
  });
  assert.equal(created.statusCode, 201);
  const retrieved = await app.inject({ method: "GET", url: `/api/wp-manager/actions/${ACTION_ID}` });
  assert.equal(retrieved.statusCode, 200);
  const approved = await app.inject({ method: "POST", url: `/api/wp-manager/actions/${ACTION_ID}/approve` });
  assert.equal(approved.statusCode, 200);
  const cancelled = await app.inject({ method: "POST", url: `/api/wp-manager/actions/${ACTION_ID}/cancel` });
  assert.equal(cancelled.statusCode, 200);
  assert.equal(action.store.records.get(ACTION_ID)!.executing_at, null);
  assert.equal(action.store.records.get(ACTION_ID)!.result_post_id, null);
  await app.close();
});

test("migration blocks client mutation and keeps protected payloads server-only", async () => {
  const migration = await readFile(
    new URL("../../supabase/migrations/20260920180312_create_wordpress_controlled_action_foundation.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /grant select on table public\.wordpress_action_requests to authenticated/i);
  assert.doesNotMatch(migration, /grant[^;]*insert[^;]*wordpress_action_requests[^;]*authenticated/i);
  assert.match(migration, /revoke all privileges on table private\.wordpress_action_payloads[\s\S]*authenticated/i);
  assert.match(migration, /before update or delete on public\.wordpress_action_audit_events/i);
});

test("the v0.4.0 plugin remains read-only and has no controlled write route", async () => {
  const plugin = await readFile(
    new URL("../../../wp-manager-plugin/atoz-growth-wp-manager/includes/class-atoz-rest-api.php", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(plugin, /WP_REST_Server::CREATABLE/);
  assert.doesNotMatch(plugin, /wp_insert_post\s*\(/);
  assert.doesNotMatch(plugin, /create-post-draft|create_post_draft/);
});
