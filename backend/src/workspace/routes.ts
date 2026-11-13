import type { FastifyInstance } from "fastify";
import { authenticate, type AuthenticatedRequest } from "../auth/authenticate.js";

export async function registerWorkspaceRoutes(app: FastifyInstance, auth = authenticate) {
  app.get("/api/workspaces/:workspaceId", { preHandler: auth }, async (request: AuthenticatedRequest, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    // Existing tables are owned by user_id. Never treat a URL/header as membership.
    if (workspaceId !== request.user!.id) return reply.code(403).send({ success: false, message: "This workspace is not available to your account." });
    return { success: true, workspace: { id: request.user!.id, name: "Personal workspace", scope: "account", sharedMembershipsAvailable: false } };
  });
  app.get("/api/admin/overview", { preHandler: auth }, async (request: AuthenticatedRequest, reply) => {
    if (request.user!.app_metadata?.role !== "admin") return reply.code(403).send({ success: false, message: "Administrator access is required." });
    return {
      success: true,
      overview: {
        service: "A2Z GrowthSuite API", status: "running", checkedAt: new Date().toISOString(),
        administrator: { id: request.user!.id, email: request.user!.email },
        modules: [
          { name: "Personal workspaces", available: true, detail: "Account-scoped access is enforced by the API." },
          { name: "WordPress Manager", available: true, detail: "Connections remain scoped to the signed-in account." },
          { name: "Organization management", available: false, detail: "Shared memberships and provisioning are not implemented." },
          { name: "Billing administration", available: false, detail: "No subscription or payment service is connected." },
          { name: "Platform analytics", available: false, detail: "Cross-account reporting is not implemented." },
        ],
      },
    };
  });
}
