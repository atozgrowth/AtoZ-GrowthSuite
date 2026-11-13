import type { FastifyInstance, FastifyReply } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { authenticate, type AuthenticatedRequest } from "../auth/authenticate.js";
import { PairingInputError, PairingService, type PairingStoreResult } from "./pairing.js";
import {
  InspectionGrantStore,
  SiteInspectionService,
  SupabaseInspectionConnectionStore,
} from "./site-inspection.js";
import { SiteInventoryService, type InventoryResource } from "./site-inventory.js";
import { createPrivilegedPairingStore } from "./supabase-pairing-store.js";
import { SecureWordPressSiteClient } from "./wordpress-site-client.js";
import {
  ControlledActionService,
  controlledWritesEnabled,
  createControlledActionService,
} from "./controlled-actions.js";

type RouteDependencies = {
  pairingService?: PairingService | null;
  inspectionService?: SiteInspectionService | null;
  inventoryService?: SiteInventoryService | null;
  controlledActionService?: ControlledActionService | null;
  controlledWritesEnabled?: boolean;
  authenticate?: typeof authenticate;
};

function createReadServices() {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return { inspectionService: null, inventoryService: null };
  const connections = new SupabaseInspectionConnectionStore(url, anonKey);
  const client = new SecureWordPressSiteClient();
  const grants = new InspectionGrantStore();
  return {
    inspectionService: new SiteInspectionService(connections, client, grants),
    inventoryService: new SiteInventoryService(connections, client, grants),
  };
}

function pairingFailure(
  reply: FastifyReply,
  result: Exclude<PairingStoreResult<unknown>, { ok: true }>
) {
  switch (result.reason) {
    case "already_connected":
      return reply.code(409).send({
        success: false,
        message: "This site is already connected.",
      });
    case "invalid_or_expired":
      return reply.code(400).send({
        success: false,
        message: "The pairing request is invalid or has expired.",
      });
    case "site_conflict":
      return reply.code(409).send({
        success: false,
        message: "This WordPress site is already assigned to an account.",
      });
    case "not_found":
      return reply.code(404).send({
        success: false,
        message: "The connection was not found.",
      });
    case "invalid_state":
      return reply.code(409).send({
        success: false,
        message: "The connection is not in a valid state for this operation.",
      });
    default:
      return reply.code(503).send({
        success: false,
        message: "The pairing service is temporarily unavailable.",
      });
  }
}

function invalidInput(reply: FastifyReply, error: unknown) {
  if (error instanceof PairingInputError) {
    return reply.code(400).send({ success: false, message: error.message });
  }
  return reply.code(500).send({
    success: false,
    message: "The pairing request could not be processed.",
  });
}

function actionFailure(
  reply: FastifyReply,
  reason: "invalid_input" | "not_found" | "expired" | "invalid_state" | "tampered" | "unavailable",
) {
  switch (reason) {
    case "invalid_input": return reply.code(400).send({ success: false, message: "The controlled action request is invalid." });
    case "not_found": return reply.code(404).send({ success: false, message: "The controlled action was not found." });
    case "expired": return reply.code(409).send({ success: false, message: "The controlled action has expired." });
    case "invalid_state": return reply.code(409).send({ success: false, message: "The controlled action is not in a valid state for this operation." });
    case "tampered": return reply.code(409).send({ success: false, message: "The controlled action payload failed integrity validation." });
    default: return reply.code(503).send({ success: false, message: "The controlled action service is temporarily unavailable." });
  }
}

function hasEmptyBody(body: unknown) {
  return body === undefined || (
    !!body && typeof body === "object" && !Array.isArray(body) &&
    Object.keys(body as Record<string, unknown>).length === 0
  );
}

export async function registerWpManagerRoutes(
  app: FastifyInstance,
  dependencies: RouteDependencies = {}
) {
  const authHandler = dependencies.authenticate ?? authenticate;
  const pairingService =
    dependencies.pairingService === undefined
      ? (() => {
          const store = createPrivilegedPairingStore();
          return store ? new PairingService(store) : null;
        })()
      : dependencies.pairingService;
  const readServices = createReadServices();
  const inspectionService = dependencies.inspectionService === undefined
    ? readServices.inspectionService
    : dependencies.inspectionService;
  const inventoryService = dependencies.inventoryService === undefined
    ? readServices.inventoryService
    : dependencies.inventoryService;
  const writesEnabled = dependencies.controlledWritesEnabled
    ?? controlledWritesEnabled();
  const controlledActionService = dependencies.controlledActionService === undefined
    ? (writesEnabled ? createControlledActionService() : null)
    : dependencies.controlledActionService;

  app.get("/api/wp-manager/status", async () => {
    return {
      success: true,
      service: "A to Z Growth WP Manager",
      version: "0.1.0",
      status: "running",
      mode: "read-only",
      timestamp: new Date().toISOString(),
    };
  });

  app.get(
    "/api/wp-manager/me",
    { preHandler: authHandler },
    async (request: AuthenticatedRequest) => {
      return {
        success: true,
        authenticated: true,
        user: {
          id: request.user?.id,
          email: request.user?.email,
        },
      };
    }
  );

  app.get(
    "/api/wp-manager/sites",
    { preHandler: authHandler },
    async (request: AuthenticatedRequest, reply) => {
      const userClient = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_ANON_KEY!,
        {
          global: {
            headers: {
              Authorization: "Bearer " + request.accessToken!,
            },
          },
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        }
      );

      const { data, error } = await userClient
        .from("wordpress_site_connections")
        .select("id, site_url")
        .eq("user_id", request.user!.id)
        .eq("status", "connected")
        .order("site_url", { ascending: true });

      if (error) {
        return reply.code(500).send({
          success: false,
          message: "Failed to fetch WordPress sites.",
        });
      }

      return {
        success: true,
        sites: data ?? [],
      };
    }
  );

  app.get(
    "/api/wp-manager/sites/:connectionId/inspection",
    { preHandler: authHandler },
    async (request: AuthenticatedRequest, reply) => {
      if (!inspectionService) {
        return reply.code(503).send({
          success: false,
          message: "The site inspection service is temporarily unavailable.",
        });
      }

      const params = request.params as { connectionId?: string };
      const result = await inspectionService.inspect({
        userId: request.user!.id,
        accessToken: request.accessToken!,
        connectionId: params.connectionId,
      });

      if (!result.ok && result.reason === "not_found") {
        return reply.code(404).send({
          success: false,
          message: "The connected site was not found.",
        });
      }
      if (!result.ok) {
        return reply.code(502).send({
          success: false,
          message: "The connected WordPress site could not be inspected.",
        });
      }

      return {
        success: true,
        inspection: result.value,
      };
    },
  );

  for (const resource of ["posts", "pages", "media", "plugins"] as InventoryResource[]) {
    app.get(
      `/api/wp-manager/sites/:connectionId/${resource}`,
      { preHandler: authHandler },
      async (request: AuthenticatedRequest, reply) => {
        if (!inventoryService) return reply.code(503).send({ success: false, message: "The site inventory service is temporarily unavailable." });
        const params = request.params as { connectionId?: string };
        const query = request.query as { page?: string; per_page?: string };
        const result = await inventoryService.list({
          userId: request.user!.id, accessToken: request.accessToken!, connectionId: params.connectionId,
          resource, page: query.page, perPage: query.per_page,
        });
        if (!result.ok && result.reason === "invalid_input") return reply.code(400).send({ success: false, message: "The inventory request is invalid." });
        if (!result.ok && result.reason === "not_found") return reply.code(404).send({ success: false, message: "The connected site was not found." });
        if (!result.ok) return reply.code(502).send({ success: false, message: "The connected WordPress inventory could not be read." });
        return { success: true, inventory: result.value };
      },
    );
  }

  if (writesEnabled) {
    app.post(
      "/api/wp-manager/sites/:connectionId/actions/proposals",
      { preHandler: authHandler },
      async (request: AuthenticatedRequest, reply) => {
        if (!controlledActionService) return actionFailure(reply, "unavailable");
        const params = request.params as { connectionId?: string };
        const result = await controlledActionService.propose({
          ownerId: request.user!.id, accessToken: request.accessToken!,
          connectionId: params.connectionId, body: request.body,
        });
        if (!result.ok) return actionFailure(reply, result.reason);
        return reply.code(201).send({ success: true, action: result.value });
      },
    );

    app.get(
      "/api/wp-manager/sites/:connectionId/actions",
      { preHandler: authHandler },
      async (request: AuthenticatedRequest, reply) => {
        if (!controlledActionService) return actionFailure(reply, "unavailable");
        const params = request.params as { connectionId?: string };
        const result = await controlledActionService.list({
          ownerId: request.user!.id, accessToken: request.accessToken!,
          connectionId: params.connectionId,
        });
        if (!result.ok) return actionFailure(reply, result.reason);
        return { success: true, actions: result.value };
      },
    );

    app.get(
      "/api/wp-manager/actions/:actionId",
      { preHandler: authHandler },
      async (request: AuthenticatedRequest, reply) => {
        if (!controlledActionService) return actionFailure(reply, "unavailable");
        const params = request.params as { actionId?: string };
        const result = await controlledActionService.get({
          ownerId: request.user!.id, accessToken: request.accessToken!, actionId: params.actionId,
        });
        if (!result.ok) return actionFailure(reply, result.reason);
        return { success: true, action: result.value };
      },
    );

    app.post(
      "/api/wp-manager/actions/:actionId/approve",
      { preHandler: authHandler },
      async (request: AuthenticatedRequest, reply) => {
        if (!controlledActionService) return actionFailure(reply, "unavailable");
        if (!hasEmptyBody(request.body)) return actionFailure(reply, "invalid_input");
        const params = request.params as { actionId?: string };
        const result = await controlledActionService.approve({
          ownerId: request.user!.id, accessToken: request.accessToken!, actionId: params.actionId,
        });
        if (!result.ok) return actionFailure(reply, result.reason);
        return { success: true, action: result.value, changed: result.changed ?? true };
      },
    );

    app.post(
      "/api/wp-manager/actions/:actionId/cancel",
      { preHandler: authHandler },
      async (request: AuthenticatedRequest, reply) => {
        if (!controlledActionService) return actionFailure(reply, "unavailable");
        if (!hasEmptyBody(request.body)) return actionFailure(reply, "invalid_input");
        const params = request.params as { actionId?: string };
        const result = await controlledActionService.cancel({
          ownerId: request.user!.id, accessToken: request.accessToken!, actionId: params.actionId,
        });
        if (!result.ok) return actionFailure(reply, result.reason);
        return { success: true, action: result.value, changed: result.changed ?? true };
      },
    );
  }

  app.post("/api/wp-manager/inspection/authorize", async (request, reply) => {
    if (!inspectionService) {
      return reply.code(503).send({
        success: false,
        authorized: false,
        message: "The site inspection service is temporarily unavailable.",
      });
    }

    if (!inspectionService.authorize(request.body)) {
      return reply.code(403).send({
        success: false,
        authorized: false,
        message: "The inspection grant is invalid or expired.",
      });
    }

    return { success: true, authorized: true };
  });

  app.post(
    "/api/wp-manager/pairing/initiate",
    { preHandler: authHandler },
    async (request: AuthenticatedRequest, reply) => {
      if (!pairingService) {
        return pairingFailure(reply, { ok: false, reason: "unavailable" });
      }

      try {
        const result = await pairingService.initiate(request.user!.id, request.body);
        if (!result.ok) return pairingFailure(reply, result);
        return reply.code(201).send({ success: true, pairing: result.value });
      } catch (error) {
        return invalidInput(reply, error);
      }
    }
  );

  app.post("/api/wp-manager/pairing/confirm", async (request, reply) => {
    if (!pairingService) {
      return pairingFailure(reply, { ok: false, reason: "unavailable" });
    }

    try {
      const result = await pairingService.confirm(request.body);
      if (!result.ok) return pairingFailure(reply, result);
      return {
        success: true,
        connection: {
          id: result.value.id,
          site_url: result.value.site_url,
          status: result.value.status,
          connected_at: result.value.connected_at,
        },
      };
    } catch (error) {
      return invalidInput(reply, error);
    }
  });

  app.post(
    "/api/wp-manager/connections/:connectionId/revoke",
    { preHandler: authHandler },
    async (request: AuthenticatedRequest, reply) => {
      if (!pairingService) {
        return pairingFailure(reply, { ok: false, reason: "unavailable" });
      }

      try {
        const params = request.params as { connectionId?: string };
        const result = await pairingService.revoke(
          request.user!.id,
          params.connectionId
        );
        if (!result.ok) return pairingFailure(reply, result);
        return {
          success: true,
          connection: {
            id: result.value.id,
            site_url: result.value.site_url,
            status: result.value.status,
            revoked_at: result.value.revoked_at,
          },
        };
      } catch (error) {
        return invalidInput(reply, error);
      }
    }
  );
}
