import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  PairingConnection,
  PairingStore,
  PairingStoreResult,
} from "./pairing.js";

const CONNECTION_FIELDS =
  "id,user_id,site_url,site_id,status,connected_at,revoked_at";

type CreateChallengeRpcRow = {
  out_connection_id: string;
  out_expires_at: string;
};

type ConfirmChallengeRpcRow = {
  outcome: "connected" | "invalid_or_expired" | "invalid_state" | "site_conflict";
  out_connection_id: string | null;
  out_user_id: string | null;
  out_site_url: string | null;
  out_site_id: string | null;
  out_status: "connected" | null;
  out_connected_at: string | null;
  out_revoked_at: string | null;
};

function unavailable<T>(): PairingStoreResult<T> {
  return { ok: false, reason: "unavailable" };
}

export function createPrivilegedPairingStore(): PairingStore | null {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return null;

  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return new SupabasePairingStore(client);
}

export class SupabasePairingStore implements PairingStore {
  constructor(private readonly client: SupabaseClient) {}

  private async removeNewPendingConnection(connectionId: string, userId: string) {
    await this.client
      .from("wordpress_site_connections")
      .delete()
      .eq("id", connectionId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .is("site_id", null);
  }

  async initiate(input: {
    userId: string;
    siteUrl: string;
    challengeDigest: string;
    expiresAt: string;
    now: string;
  }): Promise<PairingStoreResult<PairingConnection>> {
    const { data: existing, error: lookupError } = await this.client
      .from("wordpress_site_connections")
      .select(CONNECTION_FIELDS)
      .eq("user_id", input.userId)
      .eq("site_url", input.siteUrl)
      .maybeSingle();

    if (lookupError) return unavailable();

    let connection = existing as PairingConnection | null;
    if (connection?.status === "connected") {
      return { ok: false, reason: "already_connected" };
    }
    if (connection?.status === "revoked") {
      return { ok: false, reason: "invalid_state" };
    }

    let createdConnection = false;
    if (!connection) {
      const { data, error } = await this.client
        .from("wordpress_site_connections")
        .insert({
          user_id: input.userId,
          site_url: input.siteUrl,
          status: "pending",
          site_id: null,
          connected_at: null,
          revoked_at: null,
          created_at: input.now,
          updated_at: input.now,
        })
        .select(CONNECTION_FIELDS)
        .single();

      if (error || !data) return unavailable();
      connection = data as PairingConnection;
      createdConnection = true;
    }

    const { data: rpcData, error: rpcError } = await this.client
      .rpc("wp_manager_create_pairing_challenge", {
        p_connection_id: connection.id,
        p_user_id: input.userId,
        p_challenge_digest: input.challengeDigest,
        p_expires_at: input.expiresAt,
      })
      .maybeSingle();

    if (rpcError) {
      if (createdConnection) {
        await this.removeNewPendingConnection(connection.id, input.userId);
      }
      return unavailable();
    }

    const created = rpcData as CreateChallengeRpcRow | null;
    if (!created || created.out_connection_id !== connection.id) {
      if (createdConnection) {
        await this.removeNewPendingConnection(connection.id, input.userId);
      }
      return { ok: false, reason: "invalid_state" };
    }

    return { ok: true, value: connection };
  }

  async confirm(input: {
    connectionId: string;
    siteId: string;
    siteUrl: string;
    challengeDigest: string;
    now: string;
  }): Promise<PairingStoreResult<PairingConnection>> {
    const { data: rpcData, error } = await this.client
      .rpc("wp_manager_confirm_pairing_challenge", {
        p_connection_id: input.connectionId,
        p_site_id: input.siteId,
        p_site_url: input.siteUrl,
        p_challenge_digest: input.challengeDigest,
      })
      .maybeSingle();

    if (error) return unavailable();

    const result = rpcData as ConfirmChallengeRpcRow | null;
    if (!result) return { ok: false, reason: "invalid_or_expired" };

    if (result.outcome === "invalid_or_expired") {
      return { ok: false, reason: "invalid_or_expired" };
    }
    if (result.outcome === "invalid_state") {
      return { ok: false, reason: "invalid_state" };
    }
    if (result.outcome === "site_conflict") {
      return { ok: false, reason: "site_conflict" };
    }

    if (
      result.outcome !== "connected" ||
      !result.out_connection_id ||
      !result.out_user_id ||
      !result.out_site_url ||
      !result.out_site_id ||
      result.out_status !== "connected" ||
      !result.out_connected_at
    ) {
      return unavailable();
    }

    return {
      ok: true,
      value: {
        id: result.out_connection_id,
        user_id: result.out_user_id,
        site_url: result.out_site_url,
        site_id: result.out_site_id,
        status: result.out_status,
        connected_at: result.out_connected_at,
        revoked_at: result.out_revoked_at,
      },
    };
  }

  async revoke(input: {
    connectionId: string;
    userId: string;
    now: string;
  }): Promise<PairingStoreResult<PairingConnection>> {
    const { data: current, error: lookupError } = await this.client
      .from("wordpress_site_connections")
      .select(CONNECTION_FIELDS)
      .eq("id", input.connectionId)
      .eq("user_id", input.userId)
      .maybeSingle();

    if (lookupError) return unavailable();
    if (!current) return { ok: false, reason: "not_found" };
    if (current.status === "revoked") {
      return { ok: true, value: current as PairingConnection };
    }

    const { data, error } = await this.client
      .from("wordpress_site_connections")
      .update({
        status: "revoked",
        revoked_at: input.now,
        updated_at: input.now,
      })
      .eq("id", input.connectionId)
      .eq("user_id", input.userId)
      .in("status", ["pending", "connected"])
      .select(CONNECTION_FIELDS)
      .maybeSingle();

    if (error) return unavailable();
    if (!data) return { ok: false, reason: "invalid_state" };
    return { ok: true, value: data as PairingConnection };
  }
}
