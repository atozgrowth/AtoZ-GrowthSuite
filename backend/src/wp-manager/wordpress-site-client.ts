import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import type { WordPressSiteClient } from "./site-inspection.js";
import type { InventoryResource, WordPressInventoryClient } from "./site-inventory.js";

const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;

function isPrivateIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) || a >= 224;
}
function isPrivateIpv6(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("2001:db8:")) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}
function isPublicAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !isPrivateIpv4(address) : family === 6 ? !isPrivateIpv6(address) : false;
}
async function resolvePublicAddress(hostname: string) {
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error("private address rejected");
    return { address: hostname, family: isIP(hostname) as 4 | 6 };
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  const selected = addresses.find((entry) => isPublicAddress(entry.address));
  if (!selected) throw new Error("no public address");
  return selected;
}
function siteReadUrl(siteUrl: string, resource: "inspection" | InventoryResource, page?: number, perPage?: number) {
  const url = new URL(siteUrl);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("invalid read origin");
  url.pathname = url.pathname.replace(/\/+$/, "") + `/wp-json/atoz-growth/v1/${resource}`;
  url.search = "";
  if (resource !== "inspection" && resource !== "plugins" && resource !== "themes") {
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
  }
  url.hash = "";
  return url;
}
async function requestJson(url: URL, grant: string): Promise<unknown> {
  const resolved = await resolvePublicAddress(url.hostname);
  return new Promise((resolve, reject) => {
    const req = request({
      protocol: "https:", hostname: resolved.address, family: resolved.family, port: 443,
      method: "GET", path: url.pathname + url.search, servername: url.hostname,
      rejectUnauthorized: true,
      checkServerIdentity: (_hostname, certificate) => checkServerIdentity(url.hostname, certificate),
      headers: { Accept: "application/json", Host: url.host, "User-Agent": "AtoZ-Growth-WP-Manager/0.2", "X-AtoZ-Inspection-Grant": grant },
    }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error("wordpress read rejected")); return; }
      const contentType = String(response.headers["content-type"] ?? "");
      if (!contentType.toLowerCase().includes("application/json")) { response.resume(); reject(new Error("wordpress read returned non-json")); return; }
      let size = 0; const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) { req.destroy(new Error("wordpress response too large")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new Error("wordpress read returned invalid json")); }
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("wordpress read timed out")));
    req.on("error", reject);
    req.end();
  });
}

export class SecureWordPressSiteClient implements WordPressSiteClient, WordPressInventoryClient {
  inspect(siteUrl: string, grant: string) {
    return requestJson(siteReadUrl(siteUrl, "inspection"), grant);
  }
  list(input: { siteUrl: string; grant: string; resource: InventoryResource; page?: number; perPage?: number }) {
    return requestJson(siteReadUrl(input.siteUrl, input.resource, input.page, input.perPage), input.grant);
  }
}
