import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import { isPublicWordPressAddress } from "./wordpress-site-client.js";
import type { WordPressDraftClient } from "./draft-workflow.js";
async function json(
  siteUrl: string,
  path: string,
  method: "GET" | "POST",
  grant: string,
  body?: unknown,
  extraHeaders: Record<string,string> = {},
): Promise<unknown> {
  const url = new URL(siteUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw Error("Invalid origin");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const candidates = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  const destination = candidates.find((a) =>
    isPublicWordPressAddress(a.address),
  );
  if (!destination) throw Error("Private destination");
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  if (encoded && Buffer.byteLength(encoded) > 110000)
    throw Error("Request size");
  return new Promise((resolve, reject) => {
    const req = request(
      {
        protocol: "https:",
        hostname: destination.address,
        port: 443,
        family: destination.family,
        path:
          url.pathname.replace(/\/+$/, "") + "/wp-json/atoz-growth/v1/" + path,
        method,
        servername: isIP(hostname) ? undefined : hostname,
        rejectUnauthorized: true,
        checkServerIdentity: (_h, c) => checkServerIdentity(hostname, c),
        headers: {
          Accept: "application/json",
          Host: url.host,
          "User-Agent": "AtoZ-Growth-WP-Manager/0.5",
          "X-AtoZ-Inspection-Grant": grant,
        ...extraHeaders,
          ...(encoded
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(encoded),
              }
            : {}),
        },
      },
      (res) => {
        if (
          res.statusCode !== 200 ||
          !String(res.headers["content-type"])
            .toLowerCase()
            .includes("application/json")
        ) {
          res.resume();
          reject(Error("WordPress request rejected"));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 256 * 1024) {
            req.destroy(Error("Response size"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(Error("Invalid response"));
          }
        });
      },
    );
    req.setTimeout(12000, () => req.destroy(Error("WordPress timeout")));
    req.on("error", () => reject(Error("WordPress unavailable")));
    if (encoded) req.write(encoded);
    req.end();
  });
}
export class SecureWordPressDraftClient implements WordPressDraftClient {
  execute(
    siteUrl: string,
    body: Parameters<WordPressDraftClient["execute"]>[1],
  ) {
    return json(siteUrl, "drafts/execute", "POST", body.grant, body);
  }
  receipt(siteUrl: string, action: { id: string; action_type: string; payload_digest: string }, grant: string) {
    return json(siteUrl, "drafts/receipts/" + action.id, "GET", grant, undefined, {
      "X-AtoZ-Action-Type": action.action_type,
      "X-AtoZ-Payload-Digest": action.payload_digest,
    });
  }
  read(siteUrl: string, postId: number, grant: string) {
    if (!Number.isSafeInteger(postId) || postId <= 0)
      throw Error("Invalid draft id");
    return json(siteUrl, "drafts/" + postId, "GET", grant);
  }
}
