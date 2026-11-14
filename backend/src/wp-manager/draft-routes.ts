import type { FastifyInstance, FastifyReply } from "fastify";
import {
  authenticate,
  type AuthenticatedRequest,
} from "../auth/authenticate.js";
import { DraftWorkflowService, type DraftResult } from "./draft-workflow.js";
export async function registerDraftWorkflowRoutes(
  app: FastifyInstance,
  dependencies: {
    service: DraftWorkflowService | null;
    authenticate?: typeof authenticate;
  },
) {
  const service = dependencies.service,
    auth = dependencies.authenticate ?? authenticate;
  const failure = (
    reply: FastifyReply,
    r: Exclude<DraftResult<unknown>, { ok: true }>,
  ) =>
    reply
      .code(
        r.reason === "not_found"
          ? 404
          : r.reason === "invalid_input"
            ? 400
            : r.reason === "invalid_state"
              ? 409
              : 503,
      )
      .send({
        success: false,
        message:
          r.reason === "uncertain"
            ? "Execution outcome is uncertain. Do not retry; review activity."
            : "The isolated draft operation could not be completed.",
        code: r.reason,
      });
  app.get("/api/wp-manager/drafts/status", { preHandler: auth }, async () => ({
    success: true,
    enabled: service?.enabled === true,
    provider: "offline",
    mode: "isolated-test-only",
  }));
  app.post("/api/wp-manager/drafts/authorize", async (req, reply) => {
    if (!service)
      return reply.code(503).send({ success: false, authorized: false });
    const r = await service.authorize(req.body);
    return r ?? reply.code(403).send({ success: false, authorized: false });
  });
  app.get(
    "/api/wp-manager/sites/:connectionId/drafts",
    { preHandler: auth },
    async (req: AuthenticatedRequest, reply) => {
      if (!service) return reply.code(503).send({ success: false });
      const r = await service.list({
        ownerId: req.user!.id,
        accessToken: req.accessToken!,
        connectionId: (req.params as { connectionId: string }).connectionId,
      });
      return r.ok ? { success: true, actions: r.value } : failure(reply, r);
    },
  );
  app.post(
    "/api/wp-manager/sites/:connectionId/drafts/proposals",
    { preHandler: auth },
    async (req: AuthenticatedRequest, reply) => {
      if (!service) return reply.code(503).send({ success: false });
      const r = await service.propose({
        ownerId: req.user!.id,
        accessToken: req.accessToken!,
        connectionId: (req.params as { connectionId: string }).connectionId,
        body: req.body,
      });
      return r.ok
        ? reply.code(201).send({ success: true, action: r.value })
        : failure(reply, r);
    },
  );
  app.get(
    "/api/wp-manager/sites/:connectionId/drafts/:postId",
    { preHandler: auth },
    async (req: AuthenticatedRequest, reply) => {
      if (!service) return reply.code(503).send({ success: false });
      const p = req.params as { connectionId: string; postId: string };
      const r = await service.inspect({
        ownerId: req.user!.id,
        accessToken: req.accessToken!,
        connectionId: p.connectionId,
        postId: p.postId,
      });
      return r.ok ? { success: true, draft: r.value } : failure(reply, r);
    },
  );
  app.get(
    "/api/wp-manager/drafts/:actionId",
    { preHandler: auth },
    async (req: AuthenticatedRequest, reply) => {
      if (!service) return reply.code(503).send({ success: false });
      const r = await service.get({
        ownerId: req.user!.id,
        actionId: (req.params as { actionId: string }).actionId,
      });
      return r.ok ? { success: true, action: r.value } : failure(reply, r);
    },
  );
  for (const operation of ["approve", "execute", "reconcile"] as const)
    app.post(
      "/api/wp-manager/drafts/:actionId/" + operation,
      { preHandler: auth },
      async (req: AuthenticatedRequest, reply) => {
        if (!service) return reply.code(503).send({ success: false });
        const r = await service[operation]({
          ownerId: req.user!.id,
          accessToken: req.accessToken!,
          actionId: (req.params as { actionId: string }).actionId,
          body: req.body,
        });
        return r.ok ? { success: true, action: r.value } : failure(reply, r);
      },
    );
}
