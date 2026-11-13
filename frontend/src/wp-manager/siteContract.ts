import type { WordPressSite } from "../types/wordpress";
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export function isSiteId(value: unknown): value is string { return typeof value === "string" && uuid.test(value); }
/** Connected-only API: reject corrupt inventories rather than invent partial totals. */
export function parseConnectedSites(payload: unknown): WordPressSite[] {
  const records = Array.isArray(payload) ? payload : (payload as { sites?: unknown } | null)?.sites;
  if (!Array.isArray(records)) throw new Error("Invalid connected-site inventory.");
  const ids = new Set<string>();
  return records.map(record => {
    if (!record || typeof record !== "object" || !isSiteId(record.id) || ids.has(record.id.toLowerCase()) || typeof record.site_url !== "string") throw new Error("Invalid connected-site record.");
    const url = new URL(record.site_url);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (record.status !== undefined && record.status !== "connected")) throw new Error("Invalid connected-site record.");
    ids.add(record.id.toLowerCase());
    return { id: record.id, site_url: url.href, status: "connected" };
  });
}
