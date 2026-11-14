import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeSiteUrl } from "./pairing.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GRANT_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DEFAULT_GRANT_TTL_MS = 30_000;

export type InspectionConnection = {
  id: string;
  user_id: string;
  site_url: string;
  site_id: string;
  status: "connected";
};

export type SiteInspection = {
  identity: {
    site_id: string;
    site_url: string;
  };
  mode: "read-only";
  inspected_at: string;
  site: {
    title: string;
    description: string;
    url: string;
    wordpress_version: string;
    php_version: string;
    language: string;
    timezone: string;
    multisite: boolean;
    https: boolean;
  };
  theme: {
    name: string;
    version: string;
    stylesheet: string;
    parent: string | null;
  };
  plugins: {
    total: number;
    active: number;
    inactive: number;
    network_active: number;
  };
  content: {
    posts: number;
    pages: number;
    media: number;
  };
};

export type InspectionResult =
  | { ok: true; value: SiteInspection }
  | { ok: false; reason: "not_found" | "unavailable" };

export interface InspectionConnectionStore {
  findOwnedConnected(input: {
    userId: string;
    accessToken: string;
    connectionId: string;
  }): Promise<InspectionConnection | null>;
}

export interface WordPressSiteClient {
  inspect(siteUrl: string, grant: string): Promise<unknown>;
}

type GrantRecord = {
  connectionId: string;
  siteId: string;
  siteUrl: string;
  scope: ReadGrantScope;
  page: number | null;
  perPage: number | null;
  expiresAt: number;
};

export type ReadGrantScope = "inspection" | "posts" | "pages" | "media" | "plugins" | "themes";
export type ReadGrantAuthorization = { scope: ReadGrantScope; page?: number; perPage?: number };

function digestGrant(grant: string) {
  return createHash("sha256").update(grant, "utf8").digest("hex");
}

function requireUuid(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("invalid uuid");
  }
  return value.toLowerCase();
}

function requireString(value: unknown, maximum: number) {
  if (typeof value !== "string" || value.length > maximum) {
    throw new Error("invalid string");
  }
  return value;
}

function requireCount(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000_000) {
    throw new Error("invalid count");
  }
  return value as number;
}

function requireBoolean(value: unknown) {
  if (typeof value !== "boolean") throw new Error("invalid boolean");
  return value;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid object");
  }
  return value as Record<string, unknown>;
}

function sanitizeInspection(
  value: unknown,
  connection: InspectionConnection,
): SiteInspection {
  const root = objectValue(value);
  const identity = objectValue(root.identity);
  const site = objectValue(root.site);
  const theme = objectValue(root.theme);
  const plugins = objectValue(root.plugins);
  const content = objectValue(root.content);

  const siteId = requireUuid(identity.site_id);
  const siteUrl = normalizeSiteUrl(identity.site_url);
  const reportedSiteUrl = normalizeSiteUrl(site.url);

  if (
    siteId !== connection.site_id.toLowerCase() ||
    siteUrl !== connection.site_url ||
    reportedSiteUrl !== connection.site_url ||
    root.mode !== "read-only"
  ) {
    throw new Error("site identity mismatch");
  }

  const parent = theme.parent;
  if (parent !== null && typeof parent !== "string") {
    throw new Error("invalid theme parent");
  }

  return {
    identity: { site_id: siteId, site_url: siteUrl },
    mode: "read-only",
    inspected_at: requireString(root.inspected_at, 64),
    site: {
      title: requireString(site.title, 300),
      description: requireString(site.description, 1_000),
      url: reportedSiteUrl,
      wordpress_version: requireString(site.wordpress_version, 64),
      php_version: requireString(site.php_version, 64),
      language: requireString(site.language, 64),
      timezone: requireString(site.timezone, 128),
      multisite: requireBoolean(site.multisite),
      https: requireBoolean(site.https),
    },
    theme: {
      name: requireString(theme.name, 300),
      version: requireString(theme.version, 64),
      stylesheet: requireString(theme.stylesheet, 300),
      parent: parent === null ? null : requireString(parent, 300),
    },
    plugins: {
      total: requireCount(plugins.total),
      active: requireCount(plugins.active),
      inactive: requireCount(plugins.inactive),
      network_active: requireCount(plugins.network_active),
    },
    content: {
      posts: requireCount(content.posts),
      pages: requireCount(content.pages),
      media: requireCount(content.media),
    },
  };
}

export interface InspectionGrantRepository {
 issue(connection: InspectionConnection, authorization?: ReadGrantAuthorization): string | Promise<string>;
 consume(input: { grant: string; siteId: string; siteUrl: string; scope?: ReadGrantScope; page?: number; perPage?: number }): boolean | Promise<boolean>;
 revoke(grant: string): void | Promise<void>;
}
/** Explicit fixture store; production route factories use durable RPC storage. */
export class InspectionGrantStore implements InspectionGrantRepository {
  private readonly grants = new Map<string, GrantRecord>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = DEFAULT_GRANT_TTL_MS,
    private readonly generateGrant: () => string = () => randomBytes(32).toString("base64url"),
  ) {}

  issue(
    connection: InspectionConnection,
    authorization: ReadGrantAuthorization = { scope: "inspection" },
  ) {
    this.removeExpired();
    const grant = this.generateGrant();
    this.grants.set(digestGrant(grant), {
      connectionId: connection.id,
      siteId: connection.site_id.toLowerCase(),
      siteUrl: connection.site_url,
      scope: authorization.scope,
      page: authorization.page ?? null,
      perPage: authorization.perPage ?? null,
      expiresAt: this.now() + this.ttlMs,
    });
    return grant;
  }

  consume(input: {
    grant: string;
    siteId: string;
    siteUrl: string;
    scope?: ReadGrantScope;
    page?: number;
    perPage?: number;
  }) {
    if (!GRANT_PATTERN.test(input.grant)) return false;

    const key = digestGrant(input.grant);
    const record = this.grants.get(key);
    if (!record) return false;

    this.grants.delete(key);

    try {
      return (
        record.expiresAt > this.now() &&
        record.siteId === requireUuid(input.siteId) &&
        record.siteUrl === normalizeSiteUrl(input.siteUrl) &&
        record.scope === (input.scope ?? "inspection") &&
        record.page === (input.page ?? null) &&
        record.perPage === (input.perPage ?? null)
      );
    } catch {
      return false;
    }
  }

  revoke(grant: string) {
    if (GRANT_PATTERN.test(grant)) this.grants.delete(digestGrant(grant));
  }

  private removeExpired() {
    const now = this.now();
    for (const [key, record] of this.grants) {
      if (record.expiresAt <= now) this.grants.delete(key);
    }
  }
}

export class SupabaseInspectionConnectionStore implements InspectionConnectionStore {
  constructor(
    private readonly supabaseUrl: string,
    private readonly supabaseAnonKey: string,
    private readonly createSupabaseClient: typeof createClient = createClient,
  ) {}

  async findOwnedConnected(input: {
    userId: string;
    accessToken: string;
    connectionId: string;
  }): Promise<InspectionConnection | null> {
    const client: SupabaseClient = this.createSupabaseClient(
      this.supabaseUrl,
      this.supabaseAnonKey,
      {
        global: {
          headers: { Authorization: `Bearer ${input.accessToken}` },
        },
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );

    const { data, error } = await client
      .from("wordpress_site_connections")
      .select("id,user_id,site_url,site_id,status")
      .eq("id", input.connectionId)
      .eq("user_id", input.userId)
      .eq("status", "connected")
      .maybeSingle();

    if (error) throw new Error("connection lookup failed");
    if (!data || !data.site_id) return null;

    return data as InspectionConnection;
  }
}

export class SiteInspectionService {
  constructor(
    private readonly connections: InspectionConnectionStore,
    private readonly siteClient: WordPressSiteClient,
    private readonly grants: InspectionGrantRepository = new InspectionGrantStore(),
  ) {}

  async inspect(input: {
    userId: string;
    accessToken: string;
    connectionId: unknown;
  }): Promise<InspectionResult> {
    let connectionId: string;
    try {
      connectionId = requireUuid(input.connectionId);
    } catch {
      return { ok: false, reason: "not_found" };
    }

    let connection: InspectionConnection | null;
    try {
      connection = await this.connections.findOwnedConnected({
        userId: input.userId,
        accessToken: input.accessToken,
        connectionId,
      });
    } catch {
      return { ok: false, reason: "unavailable" };
    }

    if (!connection) return { ok: false, reason: "not_found" };

    const normalizedConnection: InspectionConnection = {
      ...connection,
      site_url: normalizeSiteUrl(connection.site_url),
      site_id: connection.site_id.toLowerCase(),
    };
    let grant: string;
    try { grant = await this.grants.issue(normalizedConnection); } catch { return { ok: false, reason: "unavailable" }; }

    try {
      const response = await this.siteClient.inspect(normalizedConnection.site_url, grant);
      return {
        ok: true,
        value: sanitizeInspection(response, normalizedConnection),
      };
    } catch {
      return { ok: false, reason: "unavailable" };
    } finally {
      try { await this.grants.revoke(grant); } catch { /* short durable expiry remains */ }
    }
  }

  async authorize(body: unknown) {
    try {
      const input = objectValue(body);
      return await this.grants.consume({
        grant: requireString(input.grant, 128),
        siteId: requireUuid(input.site_id),
        siteUrl: normalizeSiteUrl(input.site_url),
        scope: input.scope === undefined
          ? "inspection"
          : requireReadGrantScope(input.scope),
        page: input.page === undefined ? undefined : requirePositiveInteger(input.page),
        perPage: input.per_page === undefined
          ? undefined
          : requirePositiveInteger(input.per_page),
      });
    } catch {
      return false;
    }
  }
}

function requireReadGrantScope(value: unknown): ReadGrantScope {
  if (
    value !== "inspection" && value !== "posts" && value !== "pages" &&
    value !== "media" && value !== "plugins" && value !== "themes"
  ) throw new Error("invalid grant scope");
  return value;
}

function requirePositiveInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error("invalid positive integer");
  }
  return value as number;
}
