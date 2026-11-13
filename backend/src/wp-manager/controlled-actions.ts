import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SupabaseInspectionConnectionStore,
  type InspectionConnection,
  type InspectionConnectionStore,
} from "./site-inspection.js";
import { normalizeSiteUrl } from "./pairing.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const PROPOSAL_TTL_MS = 15 * 60 * 1_000;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 100_000;

export const CONTROLLED_WRITES_ENV = "WP_MANAGER_CONTROLLED_WRITES_ENABLED";
export const CREATE_POST_DRAFT_ACTION = "create_post_draft" as const;

export type ControlledActionType = typeof CREATE_POST_DRAFT_ACTION;
export type ControlledActionStatus =
  | "proposed"
  | "approved"
  | "executing"
  | "succeeded"
  | "failed"
  | "expired"
  | "cancelled";

export type CreatePostDraftPayload = {
  title: string;
  content: string;
};

export type ControlledActionRecord = {
  id: string;
  user_id: string;
  connection_id: string;
  site_id: string;
  site_url: string;
  action_type: ControlledActionType;
  status: ControlledActionStatus;
  payload_digest: string;
  actor_source: "user" | "approved_ai";
  created_at: string;
  expires_at: string;
  approved_at: string | null;
  executing_at: string | null;
  execution_consumed_at: string | null;
  completed_at: string | null;
  result_post_id: number | null;
  failure_code: string | null;
};

export type ControlledActionDetail = ControlledActionRecord & {
  payload: CreatePostDraftPayload;
};

export type ControlledActionAuditEvent = {
  actionId: string;
  ownerId: string;
  connectionId: string;
  actionType: ControlledActionType;
  eventType: "proposed" | "approved" | "cancelled" | "expired";
  actorSource: "user" | "approved_ai";
  occurredAt: string;
};

export type ActionTransitionResult =
  | { ok: true; value: ControlledActionRecord; changed: boolean }
  | {
      ok: false;
      reason: "not_found" | "expired" | "invalid_state" | "unavailable";
    };

export interface ControlledActionStore {
  create(input: {
    ownerId: string;
    connection: InspectionConnection;
    actionType: ControlledActionType;
    payload: CreatePostDraftPayload;
    payloadDigest: string;
    actorSource: "user" | "approved_ai";
    createdAt: string;
    expiresAt: string;
  }): Promise<ControlledActionRecord | null>;
  list(input: {
    ownerId: string;
    accessToken: string;
    connectionId?: string;
  }): Promise<ControlledActionRecord[]>;
  get(input: {
    ownerId: string;
    accessToken: string;
    actionId: string;
  }): Promise<ControlledActionDetail | null>;
  approve(input: {
    ownerId: string;
    actionId: string;
    payloadDigest: string;
    now: string;
  }): Promise<ActionTransitionResult>;
  cancel(input: {
    ownerId: string;
    actionId: string;
    now: string;
  }): Promise<ActionTransitionResult>;
}

export type ControlledActionResult<T> =
  | { ok: true; value: T; changed?: boolean }
  | {
      ok: false;
      reason:
        | "invalid_input"
        | "not_found"
        | "expired"
        | "invalid_state"
        | "tampered"
        | "unavailable";
    };

export function controlledWritesEnabled(
  value = process.env[CONTROLLED_WRITES_ENV],
) {
  return value === "true";
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error("unexpected field");
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid object");
  }
  return value as Record<string, unknown>;
}

function requireUuid(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("invalid uuid");
  }
  return value.toLowerCase();
}

function validatePayload(value: unknown): CreatePostDraftPayload {
  const payload = objectValue(value);
  exactKeys(payload, ["title", "content"]);

  if (typeof payload.title !== "string") throw new Error("invalid title");
  const title = payload.title.trim();
  if (!title || title.length > MAX_TITLE_LENGTH) {
    throw new Error("invalid title");
  }

  if (
    typeof payload.content !== "string" ||
    !payload.content.trim() ||
    payload.content.length > MAX_CONTENT_LENGTH
  ) {
    throw new Error("invalid content");
  }

  return { title, content: payload.content };
}

export function parseCreatePostDraftProposal(value: unknown) {
  const input = objectValue(value);
  exactKeys(input, ["action_type", "payload"]);
  if (input.action_type !== CREATE_POST_DRAFT_ACTION) {
    throw new Error("unsupported action type");
  }
  return {
    actionType: CREATE_POST_DRAFT_ACTION,
    payload: validatePayload(input.payload),
  };
}

export function canonicalizeCreatePostDraftPayload(
  payload: CreatePostDraftPayload,
) {
  return JSON.stringify({ title: payload.title, content: payload.content });
}

export function digestCreatePostDraftPayload(payload: CreatePostDraftPayload) {
  return createHash("sha256")
    .update(canonicalizeCreatePostDraftPayload(payload), "utf8")
    .digest("hex");
}

function normalizeDigest(value: unknown) {
  if (typeof value !== "string") throw new Error("invalid digest");
  const digest = value.startsWith("\\x") ? value.slice(2) : value;
  if (!DIGEST_PATTERN.test(digest)) throw new Error("invalid digest");
  return digest.toLowerCase();
}

function safeRecord(value: unknown): ControlledActionRecord {
  const row = objectValue(value);
  const nullableDate = (input: unknown) =>
    input === null ? null : typeof input === "string" ? input : (() => { throw new Error("invalid date"); })();
  const nullableInteger = (input: unknown) =>
    input === null
      ? null
      : Number.isSafeInteger(input) && (input as number) > 0
        ? (input as number)
        : (() => { throw new Error("invalid integer"); })();
  if (
    row.action_type !== CREATE_POST_DRAFT_ACTION ||
    !["proposed", "approved", "executing", "succeeded", "failed", "expired", "cancelled"].includes(String(row.status)) ||
    !["user", "approved_ai"].includes(String(row.actor_source))
  ) {
    throw new Error("invalid action record");
  }
  return {
    id: requireUuid(row.id),
    user_id: requireUuid(row.user_id),
    connection_id: requireUuid(row.connection_id),
    site_id: requireUuid(row.site_id),
    site_url: normalizeSiteUrl(row.site_url),
    action_type: CREATE_POST_DRAFT_ACTION,
    status: row.status as ControlledActionStatus,
    payload_digest: normalizeDigest(row.payload_digest),
    actor_source: row.actor_source as "user" | "approved_ai",
    created_at: String(row.created_at),
    expires_at: String(row.expires_at),
    approved_at: nullableDate(row.approved_at),
    executing_at: nullableDate(row.executing_at),
    execution_consumed_at: nullableDate(row.execution_consumed_at),
    completed_at: nullableDate(row.completed_at),
    result_post_id: nullableInteger(row.result_post_id),
    failure_code: row.failure_code === null ? null : String(row.failure_code),
  };
}

export class ControlledActionService {
  constructor(
    private readonly connections: InspectionConnectionStore,
    private readonly store: ControlledActionStore,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = PROPOSAL_TTL_MS,
  ) {}

  async propose(input: {
    ownerId: string;
    accessToken: string;
    connectionId: unknown;
    body: unknown;
  }): Promise<ControlledActionResult<ControlledActionRecord>> {
    let connectionId: string;
    let proposal: ReturnType<typeof parseCreatePostDraftProposal>;
    try {
      connectionId = requireUuid(input.connectionId);
      proposal = parseCreatePostDraftProposal(input.body);
    } catch {
      return { ok: false, reason: "invalid_input" };
    }

    let connection: InspectionConnection | null;
    try {
      connection = await this.connections.findOwnedConnected({
        userId: input.ownerId,
        accessToken: input.accessToken,
        connectionId,
      });
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    if (!connection) return { ok: false, reason: "not_found" };

    const createdAt = this.now();
    const payloadDigest = digestCreatePostDraftPayload(proposal.payload);
    try {
      const value = await this.store.create({
        ownerId: input.ownerId,
        connection,
        actionType: proposal.actionType,
        payload: proposal.payload,
        payloadDigest,
        actorSource: "user",
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + this.ttlMs).toISOString(),
      });
      return value
        ? { ok: true, value }
        : { ok: false, reason: "invalid_state" };
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }

  async list(input: {
    ownerId: string;
    accessToken: string;
    connectionId?: unknown;
  }): Promise<ControlledActionResult<ControlledActionRecord[]>> {
    let connectionId: string | undefined;
    try {
      connectionId = input.connectionId === undefined
        ? undefined
        : requireUuid(input.connectionId);
      const value = await this.store.list({
        ownerId: input.ownerId,
        accessToken: input.accessToken,
        connectionId,
      });
      return { ok: true, value };
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }

  async get(input: {
    ownerId: string;
    accessToken: string;
    actionId: unknown;
  }): Promise<ControlledActionResult<ControlledActionDetail>> {
    let actionId: string;
    try {
      actionId = requireUuid(input.actionId);
    } catch {
      return { ok: false, reason: "not_found" };
    }
    try {
      const value = await this.store.get({ ...input, actionId });
      if (!value) return { ok: false, reason: "not_found" };
      if (digestCreatePostDraftPayload(value.payload) !== value.payload_digest) {
        return { ok: false, reason: "tampered" };
      }
      return { ok: true, value };
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }

  async approve(input: {
    ownerId: string;
    accessToken: string;
    actionId: unknown;
  }): Promise<ControlledActionResult<ControlledActionRecord>> {
    const detail = await this.get(input);
    if (!detail.ok) return detail;
    let connection: InspectionConnection | null;
    try {
      connection = await this.connections.findOwnedConnected({
        userId: input.ownerId,
        accessToken: input.accessToken,
        connectionId: detail.value.connection_id,
      });
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    if (
      !connection ||
      connection.site_id.toLowerCase() !== detail.value.site_id ||
      normalizeSiteUrl(connection.site_url) !== detail.value.site_url
    ) {
      return { ok: false, reason: "invalid_state" };
    }
    const now = this.now();
    if (detail.value.status === "approved") {
      if (Date.parse(detail.value.expires_at) <= now.getTime()) {
        return this.store.approve({
          ownerId: input.ownerId,
          actionId: detail.value.id,
          payloadDigest: detail.value.payload_digest,
          now: now.toISOString(),
        });
      }
      return { ok: true, value: detail.value, changed: false };
    }
    if (detail.value.status !== "proposed") {
      return { ok: false, reason: "invalid_state" };
    }
    try {
      return await this.store.approve({
        ownerId: input.ownerId,
        actionId: detail.value.id,
        payloadDigest: detail.value.payload_digest,
        now: now.toISOString(),
      });
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }

  async cancel(input: {
    ownerId: string;
    accessToken: string;
    actionId: unknown;
  }): Promise<ControlledActionResult<ControlledActionRecord>> {
    const detail = await this.get(input);
    if (!detail.ok) return detail;
    if (detail.value.status === "cancelled") {
      return { ok: true, value: detail.value, changed: false };
    }
    if (!(["proposed", "approved"] as ControlledActionStatus[]).includes(detail.value.status)) {
      return { ok: false, reason: "invalid_state" };
    }
    try {
      return await this.store.cancel({
        ownerId: input.ownerId,
        actionId: detail.value.id,
        now: this.now().toISOString(),
      });
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }
}

const ACTION_FIELDS =
  "id,user_id,connection_id,site_id,site_url,action_type,status,payload_digest,actor_source,created_at,expires_at,approved_at,executing_at,execution_consumed_at,completed_at,result_post_id,failure_code";

type RpcTransitionRow = {
  outcome: "approved" | "cancelled" | "expired" | "not_found" | "invalid_state";
  changed: boolean;
  action_record: unknown;
};

export class SupabaseControlledActionStore implements ControlledActionStore {
  constructor(
    private readonly supabaseUrl: string,
    private readonly anonKey: string,
    private readonly privilegedClient: SupabaseClient,
    private readonly createSupabaseClient: typeof createClient = createClient,
  ) {}

  private ownerClient(accessToken: string) {
    return this.createSupabaseClient(this.supabaseUrl, this.anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async create(input: Parameters<ControlledActionStore["create"]>[0]) {
    const { data, error } = await this.privilegedClient
      .rpc("wp_manager_create_action_request", {
        p_user_id: input.ownerId,
        p_connection_id: input.connection.id,
        p_action_type: input.actionType,
        p_payload_digest: `\\x${input.payloadDigest}`,
        p_payload: input.payload,
        p_actor_source: input.actorSource,
        p_created_at: input.createdAt,
        p_expires_at: input.expiresAt,
      })
      .maybeSingle();
    if (error) throw new Error("action creation failed");
    return data ? safeRecord(data) : null;
  }

  async list(input: Parameters<ControlledActionStore["list"]>[0]) {
    let query = this.ownerClient(input.accessToken)
      .from("wordpress_action_requests")
      .select(ACTION_FIELDS)
      .eq("user_id", input.ownerId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (input.connectionId) query = query.eq("connection_id", input.connectionId);
    const { data, error } = await query;
    if (error) throw new Error("action list failed");
    return (data ?? []).map(safeRecord);
  }

  async get(input: Parameters<ControlledActionStore["get"]>[0]) {
    const ownerClient = this.ownerClient(input.accessToken);
    const { data: record, error: recordError } = await ownerClient
      .from("wordpress_action_requests")
      .select(ACTION_FIELDS)
      .eq("id", input.actionId)
      .eq("user_id", input.ownerId)
      .maybeSingle();
    if (recordError) throw new Error("action lookup failed");
    if (!record) return null;

    const { data: payloadRow, error: payloadError } = await this.privilegedClient
      .rpc("wp_manager_get_action_payload", {
        p_action_id: input.actionId,
        p_user_id: input.ownerId,
      })
      .maybeSingle();
    if (payloadError || !payloadRow) throw new Error("action payload lookup failed");
    const payloadRecord = objectValue(payloadRow);
    const safe = safeRecord(record);
    if (normalizeDigest(payloadRecord.payload_digest) !== safe.payload_digest) {
      throw new Error("protected payload digest mismatch");
    }
    return {
      ...safe,
      payload: validatePayload(payloadRecord.payload),
    };
  }

  private async transition(
    name: "wp_manager_approve_action_request" | "wp_manager_cancel_action_request",
    args: Record<string, unknown>,
  ): Promise<ActionTransitionResult> {
    const { data, error } = await this.privilegedClient.rpc(name, args).maybeSingle();
    if (error || !data) return { ok: false, reason: "unavailable" };
    const row = data as RpcTransitionRow;
    if (row.outcome === "not_found") return { ok: false, reason: "not_found" };
    if (row.outcome === "expired") return { ok: false, reason: "expired" };
    if (row.outcome === "invalid_state") return { ok: false, reason: "invalid_state" };
    return { ok: true, value: safeRecord(row.action_record), changed: row.changed };
  }

  approve(input: Parameters<ControlledActionStore["approve"]>[0]) {
    return this.transition("wp_manager_approve_action_request", {
      p_action_id: input.actionId,
      p_user_id: input.ownerId,
      p_payload_digest: `\\x${input.payloadDigest}`,
      p_now: input.now,
    });
  }

  cancel(input: Parameters<ControlledActionStore["cancel"]>[0]) {
    return this.transition("wp_manager_cancel_action_request", {
      p_action_id: input.actionId,
      p_user_id: input.ownerId,
      p_now: input.now,
    });
  }
}

export function createControlledActionService() {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceRoleKey) return null;
  const connections = new SupabaseInspectionConnectionStore(url, anonKey);
  const privileged = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return new ControlledActionService(
    connections,
    new SupabaseControlledActionStore(url, anonKey, privileged),
  );
}
