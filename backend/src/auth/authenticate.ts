import { FastifyReply, FastifyRequest } from "fastify";
import { createClient } from "@supabase/supabase-js";

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

export type AuthenticatedRequest = FastifyRequest & {
  user?: {
    id: string;
    email?: string;
  };
  accessToken?: string;
};

export async function authenticate(
  request: AuthenticatedRequest,
  reply: FastifyReply
) {
  const authorization = request.headers.authorization;

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return reply.code(401).send({
      success: false,
      message: "Authorization token is required.",
    });
  }

  const accessToken = authorization.replace("Bearer ", "").trim();

  if (!accessToken) {
    return reply.code(401).send({
      success: false,
      message: "Invalid authorization token.",
    });
  }

  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user) {
    return reply.code(401).send({
      success: false,
      message: "Invalid or expired access token.",
    });
  }

  request.user = {
    id: data.user.id,
    email: data.user.email,
  };

  request.accessToken = accessToken;
}
