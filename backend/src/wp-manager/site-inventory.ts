import { normalizeSiteUrl } from "./pairing.js";
import {
  InspectionGrantStore,
  type InspectionConnection,
  type InspectionConnectionStore,
  type ReadGrantScope,
} from "./site-inspection.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAGE = 1_000_000;
export const DEFAULT_PER_PAGE = 20;
export const MAX_PER_PAGE = 50;
export type InventoryResource = Exclude<ReadGrantScope, "inspection">;

export type Pagination = { page: number; per_page: number; total_items: number; total_pages: number };
export type ContentInventoryItem = {
  id: number; title: string; status: string; author_display_name: string | null;
  published_at: string | null; modified_at: string | null; slug: string; public_url: string | null;
};
export type MediaInventoryItem = {
  id: number; title: string; media_type: string; mime_type: string;
  width: number | null; height: number | null; uploaded_at: string | null; public_url: string;
};
export type PluginInventoryItem = { name: string; version: string; active: boolean };
export type ThemeInventoryItem = { name: string; version: string; active: boolean; parent: string | null; update_available: boolean | null };
export type InventoryItem = ContentInventoryItem | MediaInventoryItem | PluginInventoryItem | ThemeInventoryItem;
export type InventoryResponse = {
  identity: { site_id: string; site_url: string };
  mode: "read-only";
  resource: InventoryResource;
  pagination?: Pagination;
  items: InventoryItem[];
};
export type InventoryResult =
  | { ok: true; value: InventoryResponse }
  | { ok: false; reason: "not_found" | "invalid_input" | "unavailable" };

export interface WordPressInventoryClient {
  list(input: { siteUrl: string; grant: string; resource: InventoryResource; page?: number; perPage?: number }): Promise<unknown>;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid object");
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) {
    throw new Error("unexpected response field");
  }
}
function stringValue(value: unknown, max: number) {
  if (typeof value !== "string" || value.length > max) throw new Error("invalid string");
  return value;
}
function nullableString(value: unknown, max: number) {
  return value === null ? null : stringValue(value, max);
}
function integerValue(value: unknown, min = 0, max = 1_000_000_000) {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error("invalid integer");
  return value as number;
}
function nullableDimension(value: unknown) {
  return value === null ? null : integerValue(value, 0, 100_000);
}
function dateValue(value: unknown) {
  if (value === null) return null;
  const result = stringValue(value, 64);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error("invalid date");
  return result;
}
function safePublicUrl(value: unknown, nullable: boolean) {
  if (value === null && nullable) return null;
  const raw = stringValue(value, 2_048);
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsafe public url");
  return url.toString();
}
function contentStatus(value: unknown) {
  const status = stringValue(value, 32);
  if (!["publish", "private", "draft", "pending", "future"].includes(status)) throw new Error("invalid content status");
  return status;
}
function requireUuid(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new Error("invalid uuid");
  return value.toLowerCase();
}
function paginationInput(value: unknown, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error("invalid pagination");
  return integerValue(Number(value), 1, maximum);
}

export function sanitizeInventory(value: unknown, connection: InspectionConnection, resource: InventoryResource): InventoryResponse {
  const root = objectValue(value);
  const paginated = resource !== "plugins" && resource !== "themes";
  exactKeys(root, paginated ? ["identity", "mode", "resource", "pagination", "items"] : ["identity", "mode", "resource", "items"]);
  const identity = objectValue(root.identity);
  exactKeys(identity, ["site_id", "site_url"]);
  if (
    requireUuid(identity.site_id) !== connection.site_id.toLowerCase() ||
    normalizeSiteUrl(identity.site_url) !== connection.site_url ||
    root.mode !== "read-only" || root.resource !== resource || !Array.isArray(root.items)
  ) throw new Error("inventory identity mismatch");
  if (root.items.length > (["plugins", "themes"].includes(resource) ? 500 : MAX_PER_PAGE)) throw new Error("too many items");

  let pagination: Pagination | undefined;
  if (paginated) {
    const p = objectValue(root.pagination);
    exactKeys(p, ["page", "per_page", "total_items", "total_pages"]);
    pagination = {
      page: integerValue(p.page, 1, MAX_PAGE),
      per_page: integerValue(p.per_page, 1, MAX_PER_PAGE),
      total_items: integerValue(p.total_items),
      total_pages: integerValue(p.total_pages),
    };
    if (root.items.length > pagination.per_page) throw new Error("pagination overflow");
    if ((pagination.total_pages === 0 && pagination.page !== 1) || (pagination.total_pages > 0 && pagination.page > pagination.total_pages)) {
      throw new Error("page out of range");
    }
  }

  const items = root.items.map((raw) => {
    const item = objectValue(raw);
    if (resource === "posts" || resource === "pages") {
      exactKeys(item, ["id", "title", "status", "author_display_name", "published_at", "modified_at", "slug", "public_url"]);
      return {
        id: integerValue(item.id, 1), title: stringValue(item.title, 500), status: contentStatus(item.status),
        author_display_name: nullableString(item.author_display_name, 300), published_at: dateValue(item.published_at),
        modified_at: dateValue(item.modified_at), slug: stringValue(item.slug, 300), public_url: safePublicUrl(item.public_url, true),
      } satisfies ContentInventoryItem;
    }
    if (resource === "media") {
      exactKeys(item, ["id", "title", "media_type", "mime_type", "width", "height", "uploaded_at", "public_url"]);
      return {
        id: integerValue(item.id, 1), title: stringValue(item.title, 500), media_type: stringValue(item.media_type, 64),
        mime_type: stringValue(item.mime_type, 128), width: nullableDimension(item.width), height: nullableDimension(item.height),
        uploaded_at: dateValue(item.uploaded_at), public_url: safePublicUrl(item.public_url, false) as string,
      } satisfies MediaInventoryItem;
    }
    if (resource === "themes") {
      exactKeys(item, ["name", "version", "active", "parent", "update_available"]);
      if (typeof item.active !== "boolean" || (item.update_available !== null && typeof item.update_available !== "boolean")) throw new Error("invalid theme state");
      return { name: stringValue(item.name, 300), version: stringValue(item.version, 64), active: item.active,
        parent: nullableString(item.parent, 300), update_available: item.update_available } satisfies ThemeInventoryItem;
    }
    exactKeys(item, ["name", "version", "active"]);
    if (typeof item.active !== "boolean") throw new Error("invalid active state");
    return { name: stringValue(item.name, 300), version: stringValue(item.version, 64), active: item.active } satisfies PluginInventoryItem;
  });
  return { identity: { site_id: connection.site_id.toLowerCase(), site_url: connection.site_url }, mode: "read-only", resource, ...(pagination ? { pagination } : {}), items };
}

export class SiteInventoryService {
  constructor(
    private readonly connections: InspectionConnectionStore,
    private readonly siteClient: WordPressInventoryClient,
    private readonly grants: InspectionGrantStore,
  ) {}

  async list(input: { userId: string; accessToken: string; connectionId: unknown; resource: InventoryResource; page?: unknown; perPage?: unknown }): Promise<InventoryResult> {
    let connectionId: string, page: number | undefined, perPage: number | undefined;
    try {
      connectionId = requireUuid(input.connectionId);
      if (input.resource !== "plugins" && input.resource !== "themes") {
        page = paginationInput(input.page, 1, MAX_PAGE);
        perPage = paginationInput(input.perPage, DEFAULT_PER_PAGE, MAX_PER_PAGE);
      }
    } catch { return { ok: false, reason: "invalid_input" }; }
    let connection: InspectionConnection | null;
    try { connection = await this.connections.findOwnedConnected({ userId: input.userId, accessToken: input.accessToken, connectionId }); }
    catch { return { ok: false, reason: "unavailable" }; }
    if (!connection) return { ok: false, reason: "not_found" };
    const normalized = { ...connection, site_url: normalizeSiteUrl(connection.site_url), site_id: connection.site_id.toLowerCase() };
    const grant = this.grants.issue(normalized, { scope: input.resource, ...(page ? { page } : {}), ...(perPage ? { perPage } : {}) });
    try {
      const response = await this.siteClient.list({ siteUrl: normalized.site_url, grant, resource: input.resource, page, perPage });
      const value = sanitizeInventory(response, normalized, input.resource);
      if (value.pagination && (value.pagination.page !== page || value.pagination.per_page !== perPage)) throw new Error("pagination mismatch");
      return { ok: true, value };
    } catch { return { ok: false, reason: "unavailable" }; }
    finally { this.grants.revoke(grant); }
  }
}
