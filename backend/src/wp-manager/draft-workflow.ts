import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { normalizeSiteUrl } from "./pairing.js";
import {
  SupabaseInspectionConnectionStore,
  type InspectionConnection,
  type InspectionConnectionStore,
} from "./site-inspection.js";
import {
  DurableOperationGrantStore,
  type RpcClient,
} from "./durable-grants.js";
import { SecureWordPressDraftClient } from "./draft-site-client.js";
import { createAgentDraftProvider } from "./content-draft-provider.js";
import { loadContentProviderConfig } from "../agents/content-provider-config.js";
import { SupabaseAiUsageLedger } from "../agents/ai-usage-ledger.js";
export type DraftPayload = {
  title: string;
  content: string;
  post_id?: number;
  post_type?: "post" | "page";
  expected_modified_gmt?: string;
  expected_content_digest?: string;
  category_ids?: number[];
  tag_ids?: number[];
  featured_media_id?: number;
  revision_id?: number;
  expected_revision_digest?: string;
};
export type DraftAction = {
  id: string;
  user_id: string;
  connection_id: string;
  site_id: string;
  site_url: string;
  action_type: "create_post_draft" | "create_page_draft" | "edit_draft" | "publish_draft" | "restore_revision";
  status:
    | "proposed"
    | "approved"
    | "executing"
    | "succeeded"
    | "failed"
    | "uncertain"
    | "cancelled"
    | "expired";
  payload: DraftPayload;
  payload_digest: string;
  created_at: string;
  expires_at: string;
  approved_at: string | null;
  completed_at: string | null;
  result_post_id: number | null;
  failure_code: string | null;
};
export type DraftDocument = {
  id: number;
  type: "post" | "page";
  status: "draft" | "publish";
  title: string;
  content: string;
  modified_gmt: string;
  content_digest: string;
  category_ids?: number[];
  tag_ids?: number[];
  featured_media_id?: number | null;
};
export interface DraftProvider {
  generate(input: {
    instruction: string;
    postType: "post" | "page";
  }, context?: { ownerId: string; accessToken: string; connectionId: string; siteId: string; siteUrl: string }): Promise<{ title: string; content: string }>;
}
export interface WordPressDraftClient {
  execute(
    siteUrl: string,
    body: {
      grant: string;
      action_id: string;
      action_type: DraftAction["action_type"];
      payload_digest: string;
      payload: DraftPayload;
    },
  ): Promise<unknown>;
  read(siteUrl: string, postId: number, grant: string): Promise<unknown>;
  receipt?(siteUrl: string, action: Pick<DraftAction, "id" | "action_type" | "payload_digest">, grant: string): Promise<unknown>;
  readPublished?(siteUrl: string, postId: number, action: Pick<DraftAction, "id" | "payload_digest">, grant: string): Promise<unknown>;
  revisions?(siteUrl: string, postId: number, grant: string): Promise<unknown>;
  revision?(siteUrl: string, postId: number, revisionId: number, grant: string): Promise<unknown>;
}
export type DraftRevision = { id: number; parent_id: number; modified_gmt: string; title: string; content: string; content_digest: string };
export interface DraftWorkflowStore {
  create(input: {
    ownerId: string;
    connectionId: string;
    actionType: DraftAction["action_type"];
    payload: DraftPayload;
    payloadDigest: string;
  }): Promise<DraftAction | null>;
  get(ownerId: string, actionId: string): Promise<DraftAction | null>;
  list(ownerId: string, connectionId: string): Promise<DraftAction[]>;
  transition(input: {
    ownerId: string;
    actionId: string;
    payloadDigest: string;
    transition: string;
    postId?: number;
    failureCode?: string;
  }): Promise<DraftAction | null>;
}
const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  hash = /^[0-9a-f]{64}$/;
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Invalid object");
  return v as Record<string, unknown>;
}
function keys(
  v: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
) {
  const k = Object.keys(v);
  if (
    required.some((x) => !k.includes(x)) ||
    k.some((x) => !required.includes(x) && !optional.includes(x))
  )
    throw Error("Invalid fields");
}
function id(v: unknown) {
  if (typeof v !== "string" || !uuid.test(v)) throw Error("Invalid id");
  return v.toLowerCase();
}
function postId(v: unknown) {
  if (!Number.isSafeInteger(v) || (v as number) <= 0)
    throw Error("Invalid post");
  return v as number;
}
function digest(v: unknown) {
  if (typeof v !== "string" || !hash.test(v)) throw Error("Invalid digest");
  return v;
}
function text(v: unknown, max: number) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw Error("Invalid text");
  return v;
}
function safePayload(v: unknown, restoring = false): DraftPayload {
  const p = object(v);
  keys(
    p,
    ["title", "content"],
    [
      "post_id",
      "post_type",
      "expected_modified_gmt",
      "expected_content_digest",
      "category_ids", "tag_ids", "featured_media_id",
      "revision_id", "expected_revision_digest",
    ],
  );
  const title = restoring && typeof p.title === "string" && p.title.length <= 200 ? p.title : text(p.title, 200),
    content = text(p.content, 100000);
  // Deliberately limited offline-provider grammar, not a general HTML sanitizer.
  if (
    title !== title.trim() ||
    /[<>\u0000-\u001f]/.test(title) ||
    (!restoring && !/^<p>(?:[^<>]|<\/p>\n<p>)*<\/p>$/.test(content))
  )
    throw Error("Unsafe content");
  const result: DraftPayload = { title, content };
  for (const field of ["category_ids", "tag_ids"] as const) {
    if (p[field] !== undefined) {
      if (!Array.isArray(p[field]) || p[field].length > 100 || p[field].some((n) => !Number.isSafeInteger(n) || n <= 0) || new Set(p[field]).size !== p[field].length) throw Error("Invalid taxonomy selection");
      result[field] = [...p[field] as number[]].sort((a, b) => a - b);
    }
  }
  if (p.featured_media_id !== undefined) result.featured_media_id = postId(p.featured_media_id);
  if (p.revision_id !== undefined) result.revision_id = postId(p.revision_id);
  if (p.expected_revision_digest !== undefined) result.expected_revision_digest = digest(p.expected_revision_digest);
  if (p.post_id !== undefined) {
    result.post_id = postId(p.post_id);
    if (p.post_type !== "post" && p.post_type !== "page") throw Error();
    result.post_type = p.post_type;
    result.expected_modified_gmt = text(p.expected_modified_gmt, 64);
    result.expected_content_digest = digest(p.expected_content_digest);
  } else if (
    ["post_type", "expected_modified_gmt", "expected_content_digest"].some(
      (k) => p[k] !== undefined,
    )
  )
    throw Error();
  if ((result.revision_id === undefined) !== (result.expected_revision_digest === undefined) || (result.revision_id !== undefined && result.post_id === undefined)) throw Error("Invalid revision binding");
  return result;
}
export function canonicalDraftPayload(p: DraftPayload) {
  return JSON.stringify({
    title: p.title,
    content: p.content,
    ...(p.post_id === undefined
      ? {}
      : {
          post_id: p.post_id,
          post_type: p.post_type,
          expected_modified_gmt: p.expected_modified_gmt,
          expected_content_digest: p.expected_content_digest,
        }),
    ...(p.category_ids === undefined ? {} : { category_ids: p.category_ids }),
    ...(p.tag_ids === undefined ? {} : { tag_ids: p.tag_ids }),
    ...(p.featured_media_id === undefined ? {} : { featured_media_id: p.featured_media_id }),
    ...(p.revision_id === undefined ? {} : { revision_id: p.revision_id, expected_revision_digest: p.expected_revision_digest }),
  });
}
export function draftPayloadDigest(p: DraftPayload) {
  return createHash("sha256").update(canonicalDraftPayload(p)).digest("hex");
}
export function draftContentDigest(p: { title: string; content: string }) {
  return createHash("sha256")
    .update(JSON.stringify({ title: p.title, content: p.content }))
    .digest("hex");
}
export class OfflineDraftProvider implements DraftProvider {
  async generate(i: { instruction: string; postType: "post" | "page" }) {
    const escape = (v: string) =>
      v
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    return {
      title:
        i.instruction
          .split("\n")[0]
          .replace(/[<>\u0000-\u001f]/g, "")
          .trim()
          .slice(0, 200) || "Draft",
      content: i.instruction
        .split(/\n\s*\n/)
        .map((p) => "<p>" + escape(p.trim()) + "</p>")
        .join("\n"),
    };
  }
}
function action(v: unknown): DraftAction {
  const a = object(v),
    payload = safePayload(a.payload, a.action_type === "restore_revision"),
    raw = String(a.payload_digest),
    payload_digest = digest(raw.startsWith("\\x") ? raw.slice(2) : raw);
  if (
    !["create_post_draft", "create_page_draft", "edit_draft", "publish_draft", "restore_revision"].includes(
      String(a.action_type),
    ) ||
    ![
      "proposed",
      "approved",
      "executing",
      "succeeded",
      "failed",
      "uncertain",
      "cancelled",
      "expired",
    ].includes(String(a.status)) ||
    draftPayloadDigest(payload) !== payload_digest
  )
    throw Error("Action integrity");
  return {
    ...a,
    id: id(a.id),
    user_id: id(a.user_id),
    connection_id: id(a.connection_id),
    site_id: id(a.site_id),
    site_url: normalizeSiteUrl(a.site_url),
    payload,
    payload_digest,
  } as DraftAction;
}
export class SupabaseDraftWorkflowStore implements DraftWorkflowStore {
  constructor(private readonly client: RpcClient) {}
  private async call(name: string, args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) throw Error("Draft storage unavailable");
    return data;
  }
  async create(i: Parameters<DraftWorkflowStore["create"]>[0]) {
    const row = await this.call("wp_manager_create_draft_workflow", {
      p_user_id: i.ownerId,
      p_connection_id: i.connectionId,
      p_action_type: i.actionType,
      p_payload: i.payload,
      p_payload_digest: "\\x" + i.payloadDigest,
    });
    return row ? action(row) : null;
  }
  async get(ownerId: string, actionId: string) {
    const row = await this.call("wp_manager_get_draft_workflow", {
      p_user_id: ownerId,
      p_action_id: actionId,
    });
    return row ? action(row) : null;
  }
  async list(ownerId: string, connectionId: string) {
    const rows = await this.call("wp_manager_list_draft_workflows", {
      p_user_id: ownerId,
      p_connection_id: connectionId,
    });
    if (!Array.isArray(rows)) throw Error("Invalid history");
    return rows.map(action);
  }
  async transition(i: Parameters<DraftWorkflowStore["transition"]>[0]) {
    const row = await this.call("wp_manager_transition_draft_workflow", {
      p_user_id: i.ownerId,
      p_action_id: i.actionId,
      p_payload_digest: "\\x" + i.payloadDigest,
      p_transition: i.transition,
      p_result_post_id: i.postId ?? null,
      p_failure_code: i.failureCode ?? null,
    });
    return row ? action(row) : null;
  }
}
export type DraftResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason:
        | "invalid_input"
        | "not_found"
        | "invalid_state"
        | "unavailable"
        | "uncertain";
    };
export function draftTestModeEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.NODE_ENV === "test" &&
    env.WP_MANAGER_DRAFT_TEST_MODE === "isolated" &&
    env.WP_MANAGER_CONTROLLED_WRITES_ENABLED === "true"
  );
}
export function draftPublishTestModeEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (draftTestModeEnabled(env) && env.WP_MANAGER_TEST_PUBLISH_ENABLED === "true") ||
    ((env.APP_STAGE === "development" || env.APP_STAGE === "staging") &&
      env.WP_MANAGER_DRAFT_WORKFLOW_ENABLED === "true" &&
      env.WP_MANAGER_CONTROLLED_WRITES_ENABLED === "true" &&
      env.WP_MANAGER_NONPRODUCTION_PUBLISH_ENABLED === "true");
}
export function draftWorkflowRuntimeEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (draftTestModeEnabled(env)) return true;
  return (env.APP_STAGE === "development" || env.APP_STAGE === "staging") &&
    env.WP_MANAGER_DRAFT_WORKFLOW_ENABLED === "true" &&
    env.WP_MANAGER_CONTROLLED_WRITES_ENABLED === "true";
}
export class DraftWorkflowService {
  constructor(
    private readonly connections: InspectionConnectionStore,
    private readonly store: DraftWorkflowStore,
    private readonly grants: DurableOperationGrantStore,
    private readonly client: WordPressDraftClient,
    private readonly provider: DraftProvider = new OfflineDraftProvider(),
    public readonly enabled = false,
    public readonly publishEnabled = false,
    public readonly providerName = "offline-mock",
    public readonly mode = "isolated-test-only",
  ) {}
  private async connection(
    ownerId: string,
    accessToken: string,
    connectionId: unknown,
  ) {
    return this.connections.findOwnedConnected({
      userId: id(ownerId),
      accessToken,
      connectionId: id(connectionId),
    });
  }
  private checked(a: DraftAction | null, ownerId: string) {
    return !a ||
      a.user_id !== ownerId ||
      draftPayloadDigest(a.payload) !== a.payload_digest
      ? null
      : a;
  }
  async propose(i: {
    ownerId: string;
    accessToken: string;
    connectionId: unknown;
    body: unknown;
  }): Promise<DraftResult<DraftAction>> {
    if (!this.enabled) return { ok: false, reason: "unavailable" };
    let c: InspectionConnection | null,
      b: Record<string, unknown>,
      instruction: string;
    try {
      b = object(i.body);
      keys(
        b,
        ["instruction", "post_type"],
        ["post_id", "expected_modified_gmt", "expected_content_digest", "category_ids", "tag_ids", "featured_media_id"],
      );
      instruction = text(b.instruction, 8000);
      if (b.post_type !== "post" && b.post_type !== "page") throw Error();
      if (b.post_id !== undefined) {
        postId(b.post_id);
        text(b.expected_modified_gmt, 64);
        digest(b.expected_content_digest);
      } else if (
        b.expected_modified_gmt !== undefined ||
        b.expected_content_digest !== undefined
      )
        throw Error();
      c = await this.connection(i.ownerId, i.accessToken, i.connectionId);
    } catch {
      return { ok: false, reason: "invalid_input" };
    }
    if (!c) return { ok: false, reason: "not_found" };
    try {
      const generated = await this.provider.generate({
        instruction,
        postType: b.post_type as "post" | "page",
      }, {
        ownerId: i.ownerId, accessToken: i.accessToken, connectionId: c.id, siteId: c.site_id, siteUrl: c.site_url,
      });
      const payload = safePayload({
        ...generated,
        ...(b.category_ids === undefined ? {} : { category_ids: b.category_ids }),
        ...(b.tag_ids === undefined ? {} : { tag_ids: b.tag_ids }),
        ...(b.featured_media_id === undefined ? {} : { featured_media_id: b.featured_media_id }),
        ...(b.post_id === undefined
          ? {}
          : {
              post_id: b.post_id,
              post_type: b.post_type,
              expected_modified_gmt: b.expected_modified_gmt,
              expected_content_digest: b.expected_content_digest,
            }),
      });
      const value = await this.store.create({
        ownerId: i.ownerId,
        connectionId: c.id,
        actionType:
          b.post_id !== undefined
            ? "edit_draft"
            : b.post_type === "page"
              ? "create_page_draft"
              : "create_post_draft",
        payload,
        payloadDigest: draftPayloadDigest(payload),
      });
      return value
        ? { ok: true, value }
        : { ok: false, reason: "invalid_state" };
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }
  async proposePublish(i: {
    ownerId: string; accessToken: string; connectionId: unknown; body: unknown;
  }): Promise<DraftResult<DraftAction>> {
    if (!this.enabled || !this.publishEnabled) return { ok: false, reason: "unavailable" };
    let b: Record<string, unknown>, c: InspectionConnection | null;
    try {
      b = object(i.body); keys(b, ["post_id", "expected_modified_gmt", "expected_content_digest"]);
      postId(b.post_id); text(b.expected_modified_gmt, 64); digest(b.expected_content_digest);
      c = await this.connection(i.ownerId, i.accessToken, i.connectionId);
    } catch { return { ok: false, reason: "invalid_input" }; }
    if (!c) return { ok: false, reason: "not_found" };
    const inspected = await this.inspect({ ownerId: i.ownerId, accessToken: i.accessToken, connectionId: c.id, postId: b.post_id });
    if (!inspected.ok) return inspected;
    if (inspected.value.modified_gmt !== b.expected_modified_gmt || inspected.value.content_digest !== b.expected_content_digest)
      return { ok: false, reason: "invalid_state" };
    try {
      const payload = safePayload({ title: inspected.value.title, content: inspected.value.content, ...(inspected.value.type === "post" && inspected.value.category_ids !== undefined ? { category_ids: inspected.value.category_ids } : {}), ...(inspected.value.type === "post" && inspected.value.tag_ids !== undefined ? { tag_ids: inspected.value.tag_ids } : {}), ...(inspected.value.featured_media_id == null ? {} : { featured_media_id: inspected.value.featured_media_id }), post_id: inspected.value.id,
        post_type: inspected.value.type, expected_modified_gmt: inspected.value.modified_gmt, expected_content_digest: inspected.value.content_digest });
      const value = await this.store.create({ ownerId: i.ownerId, connectionId: c.id, actionType: "publish_draft", payload, payloadDigest: draftPayloadDigest(payload) });
      return value ? { ok: true, value } : { ok: false, reason: "invalid_state" };
    } catch { return { ok: false, reason: "unavailable" }; }
  }
  async listRevisions(i: { ownerId: string; accessToken: string; connectionId: unknown; postId: unknown }): Promise<DraftResult<DraftRevision[]>> {
    if (!this.client.revisions) return { ok: false, reason: "unavailable" };
    let grant: string | undefined;
    try {
      const c = await this.connection(i.ownerId, i.accessToken, i.connectionId); if (!c) return { ok: false, reason: "not_found" };
      const target = postId(typeof i.postId === "string" ? Number(i.postId) : i.postId);
      grant = await this.grants.issueOperation(c, { scope: "draft_read", postId: target });
      const raw = object(await this.client.revisions(c.site_url, target, grant));
      if (raw.success !== true || !Array.isArray(raw.revisions) || raw.revisions.length > 100) throw Error("Revision response");
      const revisions = raw.revisions.map((v) => { const r = object(v); if (typeof r.title !== "string" || r.title.length > 200) throw Error("Revision title"); const revision = { id: postId(r.id), parent_id: postId(r.parent_id), modified_gmt: text(r.modified_gmt, 64), title: r.title, content: text(r.content, 100000), content_digest: digest(r.content_digest) }; if (revision.parent_id !== target || draftContentDigest(revision) !== revision.content_digest) throw Error("Revision integrity"); return revision; });
      return { ok: true, value: revisions };
    } catch { return { ok: false, reason: "unavailable" }; }
    finally { if (grant) try { await this.grants.revoke(grant); } catch {} }
  }
  async proposeRestore(i: { ownerId: string; accessToken: string; connectionId: unknown; body: unknown }): Promise<DraftResult<DraftAction>> {
    if (!this.enabled || !this.client.revision) return { ok: false, reason: "unavailable" };
    let c: InspectionConnection | null, b: Record<string, unknown>;
    try { b = object(i.body); keys(b, ["post_id", "revision_id", "expected_modified_gmt", "expected_content_digest", "expected_revision_digest"]); postId(b.post_id); postId(b.revision_id); text(b.expected_modified_gmt, 64); digest(b.expected_content_digest); digest(b.expected_revision_digest); c = await this.connection(i.ownerId, i.accessToken, i.connectionId); }
    catch { return { ok: false, reason: "invalid_input" }; }
    if (!c) return { ok: false, reason: "not_found" };
    const current = await this.inspect({ ownerId: i.ownerId, accessToken: i.accessToken, connectionId: c.id, postId: b.post_id });
    if (!current.ok) return current;
    if (current.value.modified_gmt !== b.expected_modified_gmt || current.value.content_digest !== b.expected_content_digest) return { ok: false, reason: "invalid_state" };
    let grant: string | undefined;
    try {
      grant = await this.grants.issueOperation(c, { scope: "draft_read", postId: postId(b.post_id) });
      const raw = object(await this.client.revision(c.site_url, postId(b.post_id), postId(b.revision_id), grant));
      if (raw.success !== true) throw Error("Revision unavailable");
      const r = object(raw.revision); if (typeof r.title !== "string" || r.title.length > 200) throw Error("Revision title"); const revision: DraftRevision = { id: postId(r.id), parent_id: postId(r.parent_id), modified_gmt: text(r.modified_gmt, 64), title: r.title, content: text(r.content, 100000), content_digest: digest(r.content_digest) };
      if (revision.id !== b.revision_id || revision.parent_id !== current.value.id || revision.content_digest !== b.expected_revision_digest || draftContentDigest(revision) !== revision.content_digest) return { ok: false, reason: "invalid_state" };
      const payload = safePayload({ title: revision.title, content: revision.content, post_id: current.value.id, post_type: current.value.type, expected_modified_gmt: current.value.modified_gmt, expected_content_digest: current.value.content_digest, revision_id: revision.id, expected_revision_digest: revision.content_digest }, true);
      const value = await this.store.create({ ownerId: i.ownerId, connectionId: c.id, actionType: "restore_revision", payload, payloadDigest: draftPayloadDigest(payload) });
      return value ? { ok: true, value } : { ok: false, reason: "invalid_state" };
    } catch { return { ok: false, reason: "unavailable" }; }
    finally { if (grant) try { await this.grants.revoke(grant); } catch {} }
  }
  async list(i: {
    ownerId: string;
    accessToken: string;
    connectionId: unknown;
  }): Promise<DraftResult<DraftAction[]>> {
    try {
      if (!(await this.connection(i.ownerId, i.accessToken, i.connectionId)))
        return { ok: false, reason: "not_found" };
      return {
        ok: true,
        value: await this.store.list(i.ownerId, id(i.connectionId)),
      };
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }
  async get(i: {
    ownerId: string;
    actionId: unknown;
  }): Promise<DraftResult<DraftAction>> {
    try {
      const a = this.checked(
        await this.store.get(id(i.ownerId), id(i.actionId)),
        i.ownerId,
      );
      return a ? { ok: true, value: a } : { ok: false, reason: "not_found" };
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }
  async approve(i: {
    ownerId: string;
    accessToken: string;
    actionId: unknown;
    body: unknown;
  }): Promise<DraftResult<DraftAction>> {
    if (!this.enabled) return { ok: false, reason: "unavailable" };
    try {
      const b = object(i.body);
      keys(b, ["payload_digest"]);
      const d = digest(b.payload_digest),
        detail = await this.get(i);
      if (!detail.ok) return detail;
      if (d !== detail.value.payload_digest)
        return { ok: false, reason: "invalid_state" };
      if (
        !(await this.connection(
          i.ownerId,
          i.accessToken,
          detail.value.connection_id,
        ))
      )
        return { ok: false, reason: "not_found" };
      const value = await this.store.transition({
        ownerId: i.ownerId,
        actionId: detail.value.id,
        payloadDigest: d,
        transition: "approved",
      });
      return value
        ? { ok: true, value }
        : { ok: false, reason: "invalid_state" };
    } catch {
      return { ok: false, reason: "invalid_input" };
    }
  }
  async cancel(i: {
    ownerId: string;
    accessToken: string;
    actionId: unknown;
    body: unknown;
  }): Promise<DraftResult<DraftAction>> {
    if (!this.enabled) return { ok: false, reason: "unavailable" };
    try {
      const b = object(i.body);
      keys(b, ["payload_digest"]);
      const d = digest(b.payload_digest), detail = await this.get(i);
      if (!detail.ok) return detail;
      if (d !== detail.value.payload_digest || !["proposed", "approved"].includes(detail.value.status))
        return { ok: false, reason: "invalid_state" };
      if (!(await this.connection(i.ownerId, i.accessToken, detail.value.connection_id)))
        return { ok: false, reason: "not_found" };
      const value = await this.store.transition({
        ownerId: i.ownerId,
        actionId: detail.value.id,
        payloadDigest: d,
        transition: "cancelled",
      });
      return value ? { ok: true, value } : { ok: false, reason: "invalid_state" };
    } catch {
      return { ok: false, reason: "invalid_input" };
    }
  }
  private document(raw: unknown, c: InspectionConnection, expectedStatus: "draft" | "publish" = "draft"): DraftDocument {
    const e = object(raw),
      identity = object(e.identity),
      d = object(e.draft);
    if (
      e.success !== true ||
      id(identity.site_id) !== c.site_id.toLowerCase() ||
      normalizeSiteUrl(identity.site_url) !== normalizeSiteUrl(c.site_url) ||
      d.status !== expectedStatus ||
      (d.type !== "post" && d.type !== "page")
    )
      throw Error("Draft identity");
    const result = {
      id: postId(d.id),
      type: d.type,
      status: expectedStatus,
      title: typeof d.title === "string" && d.title.length <= 200 ? d.title : text(d.title, 200),
      content: text(d.content, 100000),
      modified_gmt: text(d.modified_gmt, 64),
      content_digest: digest(d.content_digest),
    } as DraftDocument;
    for (const [field, out] of [["category_ids", "category_ids"], ["tag_ids", "tag_ids"]] as const) {
      if (d[field] !== undefined) {
        if (!Array.isArray(d[field]) || d[field].length > 100 || d[field].some((n) => !Number.isSafeInteger(n) || n <= 0)) throw Error("Draft taxonomy");
        result[out] = [...d[field] as number[]].sort((a, b) => a - b);
      }
    }
    if (d.featured_media_id !== undefined) {
      if (d.featured_media_id !== null && (!Number.isSafeInteger(d.featured_media_id) || Number(d.featured_media_id) <= 0)) throw Error("Draft media");
      result.featured_media_id = d.featured_media_id as number | null;
    }
    if (draftContentDigest(result) !== result.content_digest)
      throw Error("Draft digest");
    return result;
  }
  async inspect(i: {
    ownerId: string;
    accessToken: string;
    connectionId: unknown;
    postId: unknown;
  }): Promise<DraftResult<DraftDocument>> {
    let grant: string | undefined;
    try {
      const c = await this.connection(i.ownerId, i.accessToken, i.connectionId);
      if (!c) return { ok: false, reason: "not_found" };
      const target = postId(
        typeof i.postId === "string" ? Number(i.postId) : i.postId,
      );
      grant = await this.grants.issueOperation(c, {
        scope: "draft_read",
        postId: target,
      });
      const value = this.document(
        await this.client.read(c.site_url, target, grant),
        c,
      );
      if (value.id !== target) throw Error();
      return { ok: true, value };
    } catch {
      return { ok: false, reason: "unavailable" };
    } finally {
      if (grant)
        try {
          await this.grants.revoke(grant);
        } catch {}
    }
  }
  async execute(i: {
    ownerId: string;
    accessToken: string;
    actionId: unknown;
    body: unknown;
  }): Promise<DraftResult<DraftAction>> {
    if (!this.enabled) return { ok: false, reason: "unavailable" };
    let a: DraftAction, c: InspectionConnection, grant: string | undefined;
    try {
      const b = object(i.body);
      keys(b, ["payload_digest"]);
      const d = digest(b.payload_digest),
        detail = await this.get(i);
      if (!detail.ok) return detail;
      if (d !== detail.value.payload_digest)
        return { ok: false, reason: "invalid_state" };
      const conn = await this.connection(
        i.ownerId,
        i.accessToken,
        detail.value.connection_id,
      );
      if (!conn) return { ok: false, reason: "not_found" };
      c = conn;
      if (detail.value.action_type === "publish_draft" && !this.publishEnabled) return { ok: false, reason: "unavailable" };
      if (detail.value.status === "succeeded") return detail;
      const claimed = await this.store.transition({
        ownerId: i.ownerId,
        actionId: detail.value.id,
        payloadDigest: d,
        transition: "executing",
      });
      if (!claimed) return { ok: false, reason: "invalid_state" };
      a = claimed;
    } catch {
      return { ok: false, reason: "invalid_input" };
    }
    try {
      grant = await this.grants.issueOperation(c, {
        scope: "draft_execute",
        actionId: a.id,
        payloadDigest: a.payload_digest,
      });
      const raw = await this.client.execute(c.site_url, {
        grant,
        action_id: a.id,
        action_type: a.action_type,
        payload_digest: a.payload_digest,
        payload: a.payload,
      });
      const expectedStatus = a.action_type === "publish_draft" ? "publish" : "draft";
      const executed = this.document(raw, c, expectedStatus),
        expectedType = a.action_type === "create_page_draft"
          ? "page"
          : a.action_type === "edit_draft" || a.action_type === "publish_draft" || a.action_type === "restore_revision"
            ? a.payload.post_type
            : "post";
      if (
        executed.type !== expectedType ||
        executed.title !== a.payload.title ||
        executed.content !== a.payload.content ||
        (a.payload.category_ids !== undefined && JSON.stringify(executed.category_ids) !== JSON.stringify(a.payload.category_ids)) ||
        (a.payload.tag_ids !== undefined && JSON.stringify(executed.tag_ids) !== JSON.stringify(a.payload.tag_ids)) ||
        (a.payload.featured_media_id !== undefined && executed.featured_media_id !== a.payload.featured_media_id) ||
        (a.payload.post_id !== undefined && executed.id !== a.payload.post_id)
      ) {
        throw Error("Verification");
      }
      let verified: DraftDocument;
      if (a.action_type === "publish_draft") {
        if (!this.client.readPublished) throw Error("Published readback unavailable");
        const readGrant = await this.grants.issueOperation(c, { scope: "published_read", postId: executed.id, actionId: a.id, payloadDigest: a.payload_digest });
        try { verified = this.document(await this.client.readPublished(c.site_url, executed.id, a, readGrant), c, "publish"); }
        finally { await this.grants.revoke(readGrant); }
      } else {
        const read = await this.inspect({ ownerId: i.ownerId, accessToken: i.accessToken, connectionId: c.id, postId: executed.id });
        if (!read.ok) throw Error("Verification");
        verified = read.value;
      }
      if (
        verified.status !== expectedStatus || verified.title !== a.payload.title ||
        verified.content !== a.payload.content || verified.type !== expectedType ||
        (a.payload.category_ids !== undefined && JSON.stringify(verified.category_ids) !== JSON.stringify(a.payload.category_ids)) ||
        (a.payload.tag_ids !== undefined && JSON.stringify(verified.tag_ids) !== JSON.stringify(a.payload.tag_ids)) ||
        (a.payload.featured_media_id !== undefined && verified.featured_media_id !== a.payload.featured_media_id)
      ) {
        throw Error("Verification");
      }
      const value = await this.store.transition({
        ownerId: i.ownerId,
        actionId: a.id,
        payloadDigest: a.payload_digest,
        transition: "succeeded",
        postId: executed.id,
      });
      return value ? { ok: true, value } : { ok: false, reason: "uncertain" };
    } catch {
      try {
        await this.store.transition({
          ownerId: i.ownerId,
          actionId: a.id,
          payloadDigest: a.payload_digest,
          transition: "uncertain",
          failureCode: "execution_uncertain",
        });
      } catch {}
      return { ok: false, reason: "uncertain" };
    } finally {
      if (grant)
        try {
          await this.grants.revoke(grant);
        } catch {}
    }
  }
  /** Read-only reconciliation: never repeats an uncertain WordPress mutation. */
  async reconcile(i: { ownerId: string; accessToken: string; actionId: unknown; body: unknown }): Promise<DraftResult<DraftAction>> {
    if (!this.enabled || !this.client.receipt) return { ok: false, reason: "unavailable" };
    let grant: string | undefined;
    try {
      const b = object(i.body); keys(b, ["payload_digest"]); const d = digest(b.payload_digest);
      const detail = await this.get(i); if (!detail.ok) return detail;
      const a = detail.value;
      if (a.payload_digest !== d) return { ok: false, reason: "invalid_state" };
      const c = await this.connection(i.ownerId, i.accessToken, a.connection_id);
      if (!c) return { ok: false, reason: "not_found" };
      if (a.status === "succeeded") return detail;
      if (a.status !== "uncertain" && a.status !== "executing") return { ok: false, reason: "invalid_state" };
      grant = await this.grants.issueOperation(c, { scope: "draft_receipt", actionId: a.id, payloadDigest: d });
      const raw = await this.client.receipt(c.site_url, a, grant);
      const receipt = object(raw);
      if (receipt.action_id !== a.id || receipt.action_type !== a.action_type || receipt.payload_digest !== d) throw Error("Receipt binding");
      const expectedStatus = a.action_type === "publish_draft" ? "publish" : "draft";
      const draft = this.document(raw, c, expectedStatus);
      const expectedType = a.action_type === "create_page_draft" ? "page" : a.action_type === "edit_draft" || a.action_type === "publish_draft" || a.action_type === "restore_revision" ? a.payload.post_type : "post";
      if (draft.type !== expectedType || draft.title !== a.payload.title || draft.content !== a.payload.content || (a.payload.post_id !== undefined && draft.id !== a.payload.post_id) || (a.payload.category_ids !== undefined && JSON.stringify(draft.category_ids) !== JSON.stringify(a.payload.category_ids)) || (a.payload.tag_ids !== undefined && JSON.stringify(draft.tag_ids) !== JSON.stringify(a.payload.tag_ids)) || (a.payload.featured_media_id !== undefined && draft.featured_media_id !== a.payload.featured_media_id)) throw Error("Receipt content");
      let verified: DraftDocument;
      if (a.action_type === "publish_draft") {
        if (!this.client.readPublished) throw Error("Published readback unavailable");
        const readGrant = await this.grants.issueOperation(c, { scope: "published_read", postId: draft.id, actionId: a.id, payloadDigest: a.payload_digest });
        try { verified = this.document(await this.client.readPublished(c.site_url, draft.id, a, readGrant), c, "publish"); }
        finally { await this.grants.revoke(readGrant); }
      } else {
        const read = await this.inspect({ ownerId: i.ownerId, accessToken: i.accessToken, connectionId: c.id, postId: draft.id });
        if (!read.ok) throw Error("Readback mismatch");
        verified = read.value;
      }
      if (verified.status !== expectedStatus || verified.type !== expectedType || verified.title !== a.payload.title || verified.content !== a.payload.content || (a.payload.category_ids !== undefined && JSON.stringify(verified.category_ids) !== JSON.stringify(a.payload.category_ids)) || (a.payload.tag_ids !== undefined && JSON.stringify(verified.tag_ids) !== JSON.stringify(a.payload.tag_ids)) || (a.payload.featured_media_id !== undefined && verified.featured_media_id !== a.payload.featured_media_id)) throw Error("Readback mismatch");
      const value = await this.store.transition({ ownerId: i.ownerId, actionId: a.id, payloadDigest: d, transition: "succeeded", postId: draft.id });
      return value ? { ok: true, value } : { ok: false, reason: "uncertain" };
    } catch { return { ok: false, reason: "uncertain" }; }
    finally { if (grant) try { await this.grants.revoke(grant); } catch {} }
  }
  async authorize(body: unknown) {
    try {
      const b = object(body);
      if (b.scope === "draft_read") {
        keys(b, ["grant", "scope", "site_id", "site_url", "post_id"]);
        const target = postId(b.post_id),
          authorized = await this.grants.consumeOperation({
            grant: text(b.grant, 128),
            scope: "draft_read",
            siteId: id(b.site_id),
            siteUrl: normalizeSiteUrl(b.site_url),
            postId: target,
          });
        return authorized
          ? { success: true, authorized: true, post_id: target }
          : null;
      }
      if (b.scope === "published_read") {
        keys(b, ["grant", "scope", "site_id", "site_url", "post_id", "action_id", "action_type", "payload_digest"]);
        if (b.action_type !== "publish_draft") return null;
        const post = postId(b.post_id), actionId = id(b.action_id), d = digest(b.payload_digest);
        const authorized = await this.grants.consumeOperation({ grant: text(b.grant, 128), scope: "published_read", siteId: id(b.site_id), siteUrl: normalizeSiteUrl(b.site_url), postId: post, actionId, payloadDigest: d, actionType: "publish_draft" });
        return authorized ? { success: true, authorized: true, post_id: post, action_id: actionId, action_type: "publish_draft", payload_digest: d } : null;
      }
      if (b.scope !== undefined && b.scope !== "draft_receipt") return null;
      keys(b, [
        "grant",
        "action_id",
        "action_type",
        "payload_digest",
        "site_id",
        "site_url",
      ], b.scope === "draft_receipt" ? ["scope"] : []);
      const actionId = id(b.action_id),
        d = digest(b.payload_digest),
        actionType = String(b.action_type);
      if (
        !["create_post_draft", "create_page_draft", "edit_draft", "publish_draft", "restore_revision"].includes(
          actionType,
        )
      )
        return null;
      const authorized = await this.grants.consumeOperation({
        grant: text(b.grant, 128),
        scope: b.scope === "draft_receipt" ? "draft_receipt" : "draft_execute",
        siteId: id(b.site_id),
        siteUrl: normalizeSiteUrl(b.site_url),
        actionId,
        payloadDigest: d,
        actionType,
      });
      return authorized
        ? {
            success: true,
            authorized: true,
            action_id: actionId,
            action_type: actionType,
            payload_digest: d,
          }
        : null;
    } catch {
      return null;
    }
  }
}
export function createDraftWorkflowService(env: NodeJS.ProcessEnv = process.env) {
  if (!draftWorkflowRuntimeEnabled(env)) return null;
  const url = env.SUPABASE_URL?.trim(),
    anon = env.SUPABASE_ANON_KEY?.trim(),
    key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anon || !key) return null;
  const rpc = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as RpcClient;
  const connections = new SupabaseInspectionConnectionStore(url, anon);
  let providerConfig;
  try { providerConfig = loadContentProviderConfig(env); }
  catch { return null; }
  const provider = createAgentDraftProvider(
    connections,
    providerConfig ?? undefined,
    providerConfig ? new SupabaseAiUsageLedger(rpc) : undefined,
  );
  return new DraftWorkflowService(
    connections,
    new SupabaseDraftWorkflowStore(rpc),
    new DurableOperationGrantStore(rpc),
    new SecureWordPressDraftClient(),
    provider,
    true,
    draftPublishTestModeEnabled(env),
    providerConfig?.provider ?? "offline-mock",
    draftTestModeEnabled(env) ? "isolated-test-only" : "nonproduction",
  );
}
