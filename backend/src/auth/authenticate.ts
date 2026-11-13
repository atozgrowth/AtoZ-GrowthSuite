import type { FastifyRequest, FastifyReply } from "fastify";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env");
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

export interface VerifiedUser {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
}
export type AuthenticatedRequest = FastifyRequest & { user?: VerifiedUser; accessToken?: string };
type Lookup = (token: string) => Promise<{ data: { user: VerifiedUser | null }; error: unknown }>;

/** Only the Auth server response supplies identity and authorization metadata. */
export function createAuthenticate(lookup: Lookup) {
  return async (request: AuthenticatedRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return reply.code(401).send({ success: false, message: "Authorization token is required." });
    try {
      const { data, error } = await lookup(token);
      if (error || !data.user) return reply.code(401).send({ success: false, message: "Invalid or expired access token." });
      request.user = { id: data.user.id, email: data.user.email, app_metadata: data.user.app_metadata };
      request.accessToken = token;
    } catch {
      return reply.code(503).send({ success: false, message: "Authentication is temporarily unavailable." });
    }
  };
}
export const authenticate = createAuthenticate(token => supabase.auth.getUser(token));
