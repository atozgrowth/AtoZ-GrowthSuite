import { createHash, randomBytes } from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export type PairingConnection = {
  id: string;
  user_id: string;
  site_url: string;
  site_id: string | null;
  status: "pending" | "connected" | "revoked";
  connected_at: string | null;
  revoked_at: string | null;
};

export type PairingStoreResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason:
        | "already_connected"
        | "invalid_or_expired"
        | "invalid_state"
        | "not_found"
        | "site_conflict"
        | "unavailable";
    };

export interface PairingStore {
  initiate(input: {
    userId: string;
    siteUrl: string;
    challengeDigest: string;
    expiresAt: string;
    now: string;
  }): Promise<PairingStoreResult<PairingConnection>>;
  confirm(input: {
    connectionId: string;
    siteId: string;
    siteUrl: string;
    challengeDigest: string;
    now: string;
  }): Promise<PairingStoreResult<PairingConnection>>;
  revoke(input: {
    connectionId: string;
    userId: string;
    now: string;
  }): Promise<PairingStoreResult<PairingConnection>>;
}

export class PairingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairingInputError";
  }
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PairingInputError("A JSON request body is required.");
  }
  return value as Record<string, unknown>;
}

export function normalizeSiteUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) {
    throw new PairingInputError("A valid site_url is required.");
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new PairingInputError("A valid site_url is required.");
  }

  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new PairingInputError(
      "site_url must be an HTTPS origin without credentials, query parameters, or fragments."
    );
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new PairingInputError(field + " must be a valid UUID.");
  }
  return value.toLowerCase();
}

function requireChallenge(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 32 ||
    value.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new PairingInputError("The pairing challenge is invalid.");
  }
  return value;
}

export function digestChallenge(challenge: string): string {
  return "\\x" + createHash("sha256").update(challenge, "utf8").digest("hex");
}

export class PairingService {
  constructor(
    private readonly store: PairingStore,
    private readonly now: () => Date = () => new Date(),
    private readonly generateChallenge: () => string = () =>
      randomBytes(32).toString("base64url")
  ) {}

  async initiate(userId: string, body: unknown) {
    const input = requireObject(body);
    const siteUrl = normalizeSiteUrl(input.site_url);
    const challenge = this.generateChallenge();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);

    const result = await this.store.initiate({
      userId,
      siteUrl,
      challengeDigest: digestChallenge(challenge),
      expiresAt: expiresAt.toISOString(),
      now: now.toISOString(),
    });

    if (!result.ok) return result;
    return {
      ok: true as const,
      value: {
        connection_id: result.value.id,
        site_url: result.value.site_url,
        challenge,
        expires_at: expiresAt.toISOString(),
      },
    };
  }

  async confirm(body: unknown) {
    const input = requireObject(body);
    const connectionId = requireUuid(input.connection_id, "connection_id");
    const siteId = requireUuid(input.site_id, "site_id");
    const siteUrl = normalizeSiteUrl(input.site_url);
    const challenge = requireChallenge(input.challenge);

    return this.store.confirm({
      connectionId,
      siteId,
      siteUrl,
      challengeDigest: digestChallenge(challenge),
      now: this.now().toISOString(),
    });
  }

  async revoke(userId: string, connectionId: unknown) {
    return this.store.revoke({
      connectionId: requireUuid(connectionId, "connection_id"),
      userId,
      now: this.now().toISOString(),
    });
  }
}
