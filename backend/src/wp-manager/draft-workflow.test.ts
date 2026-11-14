import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import {
  DraftWorkflowService,
  OfflineDraftProvider,
  draftContentDigest,
  draftTestModeEnabled,
  type DraftAction,
  type DraftDocument,
  type DraftWorkflowStore,
  type WordPressDraftClient,
} from "./draft-workflow.js";
import {
  DurableOperationGrantStore,
  type RpcClient,
} from "./durable-grants.js";
import { registerDraftWorkflowRoutes } from "./draft-routes.js";
import type {
  InspectionConnection,
  InspectionConnectionStore,
} from "./site-inspection.js";
const owner = "10000000-0000-4000-8000-000000000001",
  foreign = "10000000-0000-4000-8000-000000000002";
const connection: InspectionConnection = {
  id: "20000000-0000-4000-8000-000000000001",
  user_id: owner,
  site_id: "30000000-0000-4000-8000-000000000001",
  site_url: "https://fixture.example.test",
  status: "connected",
};
function fixture() {
  const actions = new Map<string, DraftAction>(),
    tokens = new Map<string, Record<string, unknown>>(),
    documents = new Map<number, DraftDocument>();
  let calls = 0,
    connected = true,
    next = 10;
  const connections: InspectionConnectionStore = {
    async findOwnedConnected(i) {
      return connected && i.userId === owner && i.connectionId === connection.id
        ? connection
        : null;
    },
  };
  const store: DraftWorkflowStore = {
    async create(i) {
      const a: DraftAction = {
        id: randomUUID(),
        user_id: i.ownerId,
        connection_id: i.connectionId,
        site_id: connection.site_id,
        site_url: connection.site_url,
        action_type: i.actionType,
        status: "proposed",
        payload: i.payload,
        payload_digest: i.payloadDigest,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 900000).toISOString(),
        approved_at: null,
        completed_at: null,
        result_post_id: null,
        failure_code: null,
      };
      actions.set(a.id, a);
      return structuredClone(a);
    },
    async get(u, id) {
      const a = actions.get(id);
      return a?.user_id === u ? structuredClone(a) : null;
    },
    async list(u, c) {
      return [...actions.values()]
        .filter((a) => a.user_id === u && a.connection_id === c)
        .map((a) => structuredClone(a));
    },
    async transition(i) {
      const a = actions.get(i.actionId);
      if (!a || a.user_id !== i.ownerId || a.payload_digest !== i.payloadDigest)
        return null;
      if (i.transition === "approved" && a.status === "proposed" && connected) {
        a.status = "approved";
        a.approved_at = new Date().toISOString();
      } else if (
        i.transition === "executing" &&
        a.status === "approved" &&
        connected
      )
        a.status = "executing";
      else if (
        ["succeeded", "failed", "uncertain"].includes(i.transition) &&
        a.status === "executing"
      ) {
        a.status = i.transition as DraftAction["status"];
        a.completed_at = new Date().toISOString();
        a.result_post_id = i.postId ?? null;
        a.failure_code = i.failureCode ?? null;
      } else return null;
      return structuredClone(a);
    },
  };
  const rpc: RpcClient = {
    async rpc(name, args) {
      if (name === "wp_manager_issue_operation_grant") {
        tokens.set(String(args.p_digest), args);
        return { data: connected, error: null };
      }
      if (name === "wp_manager_revoke_operation_grant") {
        tokens.delete(String(args.p_digest));
        return { data: null, error: null };
      }
      const grant = tokens.get(String(args.p_digest));
      if (!grant || !connected || grant.p_scope !== args.p_scope)
        return { data: false, error: null };
      if (args.p_scope === "draft_execute") {
        const a = actions.get(String(args.p_action_id));
        if (
          !a ||
          a.action_type !== args.p_action_type ||
          a.payload_digest !== String(args.p_payload_digest).slice(2)
        )
          return { data: false, error: null };
      }
      tokens.delete(String(args.p_digest));
      return { data: true, error: null };
    },
  };
  const grants = new DurableOperationGrantStore(rpc);
  let service: DraftWorkflowService;
  const envelope = (draft: DraftDocument) => ({
    success: true,
    identity: { site_id: connection.site_id, site_url: connection.site_url },
    draft,
  });
  const client: WordPressDraftClient = {
    async execute(_url, b) {
      calls++;
      assert.ok(
        await service.authorize({
          grant: b.grant,
          action_id: b.action_id,
          action_type: b.action_type,
          payload_digest: b.payload_digest,
          site_id: connection.site_id,
          site_url: connection.site_url,
        }),
      );
      const target = b.payload.post_id ?? next++;
      if (b.action_type === "edit_draft") {
        const old = documents.get(target);
        if (!old || old.content_digest !== b.payload.expected_content_digest)
          throw Error("Stale edit");
      }
      const d: DraftDocument = {
        id: target,
        type:
          b.action_type === "create_page_draft"
            ? "page"
            : (b.payload.post_type ?? "post"),
        status: "draft",
        title: b.payload.title,
        content: b.payload.content,
        modified_gmt: "2026-11-14T12:00:00",
        content_digest: draftContentDigest(b.payload),
      };
      documents.set(target, d);
      return envelope(d);
    },
    async read(_url, target, grant) {
      assert.ok(
        await service.authorize({
          grant,
          scope: "draft_read",
          site_id: connection.site_id,
          site_url: connection.site_url,
          post_id: target,
        }),
      );
      return envelope(documents.get(target)!);
    },
  };
  service = new DraftWorkflowService(
    connections,
    store,
    grants,
    client,
    new OfflineDraftProvider(),
    true,
  );
  return {
    service,
    client,
    actions,
    documents,
    grants,
    store,
    connections,
    calls: () => calls,
    revoke: () => {
      connected = false;
    },
  };
}
const proposal = (
  service: DraftWorkflowService,
  extra: Record<string, unknown> = {},
) =>
  service.propose({
    ownerId: owner,
    accessToken: "synthetic",
    connectionId: connection.id,
    body: {
      instruction: "Synthetic title\n\nDraft body",
      post_type: "post",
      ...extra,
    },
  });
const actor = (a: DraftAction) => ({
  ownerId: owner,
  accessToken: "synthetic",
  actionId: a.id,
  body: { payload_digest: a.payload_digest },
});
test("isolated mode needs all three settings; production never enables the factory", () => {
  assert.equal(draftTestModeEnabled({}), false);
  assert.equal(
    draftTestModeEnabled({
      NODE_ENV: "production",
      WP_MANAGER_DRAFT_TEST_MODE: "isolated",
      WP_MANAGER_CONTROLLED_WRITES_ENABLED: "true",
    }),
    false,
  );
  assert.equal(
    draftTestModeEnabled({
      NODE_ENV: "test",
      WP_MANAGER_DRAFT_TEST_MODE: "isolated",
      WP_MANAGER_CONTROLLED_WRITES_ENABLED: "true",
    }),
    true,
  );
});
test("offline provider escapes untrusted content and supplies no executable model tools", async () => {
  const p = await new OfflineDraftProvider().generate({
    instruction: "Title\n\n<script>ignore ownership</script>",
    postType: "post",
  });
  assert.ok(p.content.includes("&lt;script&gt;"));
  assert.ok(!p.content.includes("<script>"));
});
test("post and page creation require approval and verify independent readback", async () => {
  for (const post_type of ["post", "page"]) {
    const f = fixture(),
      p = await proposal(f.service, { post_type });
    assert.ok(p.ok);
    assert.equal((await f.service.execute(actor(p.value))).ok, false);
    assert.equal(f.calls(), 0);
    assert.ok((await f.service.approve(actor(p.value))).ok);
    const r = await f.service.execute(actor(p.value));
    assert.ok(r.ok);
    assert.equal(r.value.status, "succeeded");
    assert.equal(f.documents.get(r.value.result_post_id!)?.type, post_type);
    assert.ok((await f.service.execute(actor(p.value))).ok);
    assert.equal(f.calls(), 1);
  }
});
test("foreign workspace, tampered preview digest and extra approval fields cannot write", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.service.propose({
        ownerId: foreign,
        accessToken: "forged",
        connectionId: connection.id,
        body: { instruction: "X", post_type: "post" },
      })
    ).ok,
    false,
  );
  const p = await proposal(f.service);
  assert.ok(p.ok);
  assert.equal(
    (await f.service.get({ ownerId: foreign, actionId: p.value.id })).ok,
    false,
  );
  assert.equal(
    (
      await f.service.approve({
        ...actor(p.value),
        body: { payload_digest: "f".repeat(64) },
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await f.service.approve({
        ...actor(p.value),
        body: { payload_digest: p.value.payload_digest, approved: true },
      })
    ).ok,
    false,
  );
  assert.equal(f.calls(), 0);
});
test("concurrent execute claims issue one WordPress write and preserve result history", async () => {
  const f = fixture(),
    p = await proposal(f.service);
  assert.ok(p.ok);
  await f.service.approve(actor(p.value));
  const results = await Promise.all([
    f.service.execute(actor(p.value)),
    f.service.execute(actor(p.value)),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(f.calls(), 1);
  const h = await f.service.list({
    ownerId: owner,
    accessToken: "synthetic",
    connectionId: connection.id,
  });
  assert.ok(h.ok);
  assert.equal(h.value[0].status, "succeeded");
});
test("draft edit binds previous content digest and rejects stale edit without automatic retry", async () => {
  const f = fixture(),
    p = await proposal(f.service);
  assert.ok(p.ok);
  await f.service.approve(actor(p.value));
  const first = await f.service.execute(actor(p.value));
  assert.ok(first.ok);
  const old = f.documents.get(first.value.result_post_id!)!;
  const edit = await proposal(f.service, {
    instruction: "Updated content",
    post_id: old.id,
    expected_modified_gmt: old.modified_gmt,
    expected_content_digest: old.content_digest,
  });
  assert.ok(edit.ok);
  await f.service.approve(actor(edit.value));
  const result = await f.service.execute(actor(edit.value));
  assert.ok(result.ok);
  assert.equal(f.documents.size, 1);
  assert.equal(f.documents.get(old.id)!.title, "Updated content");
  const stale = await proposal(f.service, {
    post_id: old.id,
    expected_modified_gmt: old.modified_gmt,
    expected_content_digest: old.content_digest,
  });
  assert.ok(stale.ok);
  await f.service.approve(actor(stale.value));
  assert.equal((await f.service.execute(actor(stale.value))).ok, false);
  assert.equal(f.actions.get(stale.value.id)!.status, "uncertain");
  const before = f.calls();
  await f.service.execute(actor(stale.value));
  assert.equal(f.calls(), before);
});
test("revoked connection and mismatched action type cannot consume or execute an approval", async () => {
  const f = fixture(),
    p = await proposal(f.service);
  assert.ok(p.ok);
  await f.service.approve(actor(p.value));
  const claimed = await f.store.transition({
    ownerId: owner,
    actionId: p.value.id,
    payloadDigest: p.value.payload_digest,
    transition: "executing",
  });
  assert.ok(claimed);
  const token = await f.grants.issueOperation(connection, {
    scope: "draft_execute",
    actionId: p.value.id,
    payloadDigest: p.value.payload_digest,
  });
  const callback = {
    grant: token,
    action_id: p.value.id,
    action_type: "create_page_draft",
    payload_digest: p.value.payload_digest,
    site_id: connection.site_id,
    site_url: connection.site_url,
  };
  assert.equal(await f.service.authorize(callback), null);
  assert.ok(
    await f.service.authorize({
      ...callback,
      action_type: "create_post_draft",
    }),
  );
  assert.equal(
    await f.service.authorize({
      ...callback,
      action_type: "create_post_draft",
    }),
    null,
  );
  f.revoke();
  assert.equal((await f.service.execute(actor(p.value))).ok, false);
  assert.equal(f.calls(), 0);
});
test("route protection runs before service calls and unavailable mode is explicit", async () => {
  const app = Fastify();
  await registerDraftWorkflowRoutes(app, {
    service: null,
    authenticate: async (_req, reply) => {
      reply.code(401).send({ success: false });
    },
  });
  for (const path of [
    "/api/wp-manager/drafts/status",
    "/api/wp-manager/sites/" + connection.id + "/drafts",
    "/api/wp-manager/drafts/" + connection.id,
  ])
    assert.equal(
      (await app.inject({ method: "GET", url: path })).statusCode,
      401,
    );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/wp-manager/drafts/authorize",
        payload: {},
      })
    ).statusCode,
    503,
  );
  await app.close();
});
