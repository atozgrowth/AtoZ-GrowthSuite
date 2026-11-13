import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { registerWpManagerRoutes } from "./wp-manager/routes.js";
import { authenticate, type AuthenticatedRequest } from "./auth/authenticate.js";

dotenv.config();

const app = Fastify({
  logger: true,
});

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

function getAuthenticatedSupabase(accessToken: string) {
  return createClient(supabaseUrl!, supabaseAnonKey!, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function start() {
  await app.register(cors, {
    origin: true,
  });

  await app.register(helmet);

  await registerWpManagerRoutes(app);

  app.get("/health", async () => {
    return {
      success: true,
      service: "AtoZ Growth Suite Backend",
      status: "running",
      timestamp: new Date().toISOString(),
    };
  });

  app.get(
    "/api/me",
    { preHandler: authenticate },
    async (request: AuthenticatedRequest) => {
      return {
        success: true,
        user: request.user,
      };
    }
  );

  app.get(
    "/api/profile",
    { preHandler: authenticate },
    async (request: AuthenticatedRequest, reply) => {
      const userId = request.user!.id;
      const userClient = getAuthenticatedSupabase(request.accessToken!);

      const { data, error } = await userClient
        .from("profiles")
        .select("id, full_name, avatar_url, created_at, updated_at")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        return reply.code(500).send({
          success: false,
          message: "Failed to fetch profile.",
          error: error.message,
        });
      }

      return {
        success: true,
        profile: data,
      };
    }
  );

  app.patch(
    "/api/profile",
    { preHandler: authenticate },
    async (request: AuthenticatedRequest, reply) => {
      const userId = request.user!.id;
      const userClient = getAuthenticatedSupabase(request.accessToken!);

      const body = (request.body || {}) as {
        full_name?: string;
        avatar_url?: string;
      };

      const updates: {
        full_name?: string;
        avatar_url?: string;
        updated_at?: string;
      } = {
        updated_at: new Date().toISOString(),
      };

      if (typeof body.full_name === "string") {
        updates.full_name = body.full_name.trim();
      }

      if (typeof body.avatar_url === "string") {
        updates.avatar_url = body.avatar_url.trim();
      }

      const { data, error } = await userClient
        .from("profiles")
        .update(updates)
        .eq("id", userId)
        .select("id, full_name, avatar_url, created_at, updated_at")
        .maybeSingle();

      if (error) {
        return reply.code(500).send({
          success: false,
          message: "Failed to update profile.",
          error: error.message,
        });
      }

      return {
        success: true,
        message: "Profile updated successfully.",
        profile: data,
      };
    }
  );

  app.get("/api/supabase-test", async () => {
    return {
      success: true,
      message:
        "Supabase configuration is loaded. Profile queries require authentication.",
    };
  });

  try {
    await app.listen({
      port: PORT,
      host: HOST,
    });

    console.log(`Backend running on http://${HOST}:${PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
