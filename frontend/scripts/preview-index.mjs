import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const directory = new URL("../preview-screenshots/", import.meta.url);
const workspace = "/workspace/10000000-0000-4000-8000-000000000001";
const entries = [
  ["01-login.png", "Login", "/login", "Public", 1440],
  ["02-signup.png", "Signup", "/signup", "Public", 1440],
  ["03-customer-dashboard.png", "Customer Dashboard", workspace + "/dashboard", "Synthetic customer", 1440],
  ["04-admin-dashboard.png", "Admin Dashboard", "/admin", "Synthetic administrator", 1440],
  ["05-wordpress-manager.png", "WordPress Manager", workspace + "/wordpress", "Synthetic customer", 1440],
  ["06-account-settings.png", "Account Settings", workspace + "/account", "Synthetic customer", 1440],
  ["07-mobile-customer-dashboard.png", "Mobile Customer Dashboard", workspace + "/dashboard", "Synthetic customer", 390],
];
const checksum = data => createHash("sha256").update(data).digest("hex");
const screenshots = [];
for (const [file, title, route, persona, width] of entries) {
  const data = await readFile(new URL(file, directory));
  if (data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || data.readUInt32BE(16) !== width) throw new Error(`Invalid screenshot: ${file}`);
  screenshots.push({ file, title, route, persona, width, height: data.readUInt32BE(20), fullPage: true, sha256: checksum(data) });
}
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const head = process.env.PREVIEW_HEAD_SHA || revision;
if (!/^[a-f0-9]{40}$/.test(revision) || !/^[a-f0-9]{40}$/.test(head)) throw new Error("Invalid source revision");
const pr = /^\d+$/.test(process.env.PREVIEW_PR_NUMBER || "") ? Number(process.env.PREVIEW_PR_NUMBER) : null;
const label = pr ? `PR #${pr}` : "Local or main preview";
const manifest = { pr, prHeadSha: head, testedRevision: revision, syntheticOnly: true, productionAccess: false, retentionDays: 30, screenshots };
await writeFile(new URL("manifest.json", directory), JSON.stringify(manifest, null, 2) + "\n");
const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>A2Z GrowthSuite · ${escape(label)} screen review</title><style>body{font:15px/1.6 system-ui,sans-serif;color:#20283e;background:#f6f7fb;margin:0;padding:32px;max-width:1400px;margin:auto}h1{letter-spacing:-.04em}header{margin-bottom:30px}code{overflow-wrap:anywhere}article{background:white;border:1px solid #e1e5ee;border-radius:12px;padding:24px;margin-bottom:24px}img{display:block;max-width:100%;max-height:650px;object-fit:contain;object-position:top;margin:20px auto;border:1px solid #e1e5ee}a{color:#5140b0}small{color:#68748c}</style><header><h1>A2Z GrowthSuite · screen review</h1><p>${escape(label)} · Full-page screenshots from the local app using intercepted synthetic Auth/API responses. No production connection or live email flow is shown.</p><p>PR head: <code>${head}</code><br>Tested checkout: <code>${revision}</code></p><p>Click an image for the original PNG. Verify files with <code>sha256sum -c SHA256SUMS</code>. Retention: 30 days.</p><nav aria-label="Screenshot index">${screenshots.map(s => `<a href="#${s.file}">${escape(s.title)}</a>`).join(" · ")}</nav></header>${screenshots.map(s => `<article id="${s.file}"><h2>${escape(s.title)}</h2><p><code>${escape(s.route)}</code><br><small>${escape(s.persona)} · ${s.width} × ${s.height} · full page</small></p><a href="${s.file}"><img src="${s.file}" alt="${escape(s.title)} full-page preview" loading="lazy"></a></article>`).join("")}</html>`;
await writeFile(new URL("index.html", directory), html);
await writeFile(new URL("README.md", directory), "# A2Z GrowthSuite " + label + " screenshot index\n\nOpen index.html after extracting this artifact. All identities, site inventory and Auth/API responses are synthetic. External non-fixture requests are blocked. No production service is accessed. Screenshots demonstrate the implemented UI, not live Supabase/email integration.\n\nPR head: `" + head + "`\n\n| File | Screen | Viewport width |\n| --- | --- | --- |\n" + screenshots.map(s => `| [${s.file}](${s.file}) | ${s.title} | ${s.width}px |`).join("\n") + "\n\nVerify: `sha256sum -c SHA256SUMS`. The manifest records tested revision, routes, persona and PNG dimensions. Artifact retention is 30 days.\n");
const files = [...screenshots.map(s => s.file), "manifest.json", "index.html", "README.md"];
const hashes = await Promise.all(files.map(async file => `${checksum(await readFile(new URL(file, directory)))}  ${file}`));
await writeFile(new URL("SHA256SUMS", directory), hashes.join("\n") + "\n");
console.log(`Indexed ${screenshots.length} full-page previews with SHA-256 checksums.`);
