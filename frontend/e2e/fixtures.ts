import type { Page } from "@playwright/test";
export const owner = "10000000-0000-4000-8000-000000000001";
export const other = "10000000-0000-4000-8000-000000000002";
export const root = `/workspace/${owner}`;
export function fixtureUser(admin = false) {
  return { id: owner, email: admin ? "admin@example.test" : "customer@example.test", last_sign_in_at: "2026-01-01T12:00:00Z", aud: "authenticated", role: "authenticated", created_at: "2026-01-01T00:00:00Z", app_metadata: admin ? { role: "admin" } : {}, user_metadata: { full_name: "Jamie Taylor", role: "admin", tenant_id: other }, identities: [{ id: "fixture" }] };
}
export function fixtureSession(admin = false) {
  const payload = { sub: owner, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) };
  const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify(payload)).toString("base64url"), "c3ludGhldGlj"].join(".");
  return { access_token: token, token_type: "bearer", refresh_token: "synthetic-refresh", expires_in: 3600, expires_at: payload.exp, user: fixtureUser(admin) };
}
export async function mockServices(page: Page, options: { admin?: boolean; expired?: boolean; sitesError?: boolean; adminDenied?: boolean; loginFailed?: boolean; signupSession?: boolean } = {}) {
  const admin = options.admin ?? false;
  const apiCalls: string[] = [];
  const authCalls: string[] = [];
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "example.supabase.co") {
      authCalls.push(url.pathname);
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
      if (url.pathname.endsWith("/user")) return route.fulfill({ status: options.expired ? 401 : 200, headers: cors, json: options.expired ? { message: "Invalid JWT", code: "bad_jwt" } : fixtureUser(admin) });
      if (url.pathname.endsWith("/token")) return route.fulfill({ status: options.loginFailed ? 400 : 200, headers: cors, json: options.loginFailed ? { message: "Invalid login credentials", code: "invalid_credentials" } : fixtureSession(admin) });
      if (url.pathname.endsWith("/signup")) return route.fulfill({ status: 200, headers: cors, json: options.signupSession ? fixtureSession(false) : { user: fixtureUser(false), session: null } });
      if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204, headers: cors });
      return route.fulfill({ status: 400, headers: cors, json: { message: "Synthetic endpoint unavailable" } });
    }
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    apiCalls.push(url.pathname);
    if (!route.request().headers().authorization) return route.fulfill({ status: 401, json: { success: false } });
    if (url.pathname.startsWith("/api/workspaces/")) return route.fulfill({ status: url.pathname.endsWith(owner) ? 200 : 403, json: { workspace: { id: owner, name: "Personal workspace", scope: "account" } } });
    if (url.pathname === "/api/wp-manager/sites") return route.fulfill({ status: options.sitesError ? 503 : 200, json: { sites: [{ id: "20000000-0000-4000-8000-000000000001", site_url: "https://store.example.test" }, { id: "20000000-0000-4000-8000-000000000002", site_url: "https://journal.example.test" }] } });
    if (url.pathname === "/api/admin/overview") return route.fulfill({ status: admin && !options.adminDenied ? 200 : 403, json: { overview: { service: "Synthetic API", status: "running", checkedAt: "2026-01-01T12:00:00Z", administrator: { id: owner }, modules: [{ name: "Personal workspaces", available: true, detail: "Account-scoped access." }, { name: "Billing administration", available: false, detail: "Not implemented." }] } } });
    return route.fulfill({ status: 404, json: { message: "Synthetic API endpoint unavailable" } });
  });
  return { apiCalls, authCalls };
}
export async function cachedSession(page: Page, admin = false) {
  const session = fixtureSession(admin);
  await page.addInitScript(value => { localStorage.setItem("sb-example-auth-token", JSON.stringify(value)); }, session);
}
export async function signIn(page: Page) {
  await page.getByLabel("Email address").fill("customer@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Synthetic-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
}

