import { test, expect } from "@playwright/test";
import { mockServices, cachedSession, fixtureUser, root } from "./fixtures";

test("PKCE callback exchanges the code once and verifies the resulting identity", async ({ page }) => {
  const { authCalls } = await mockServices(page);
  await page.addInitScript(() => localStorage.setItem("sb-example-auth-token-code-verifier", JSON.stringify("synthetic-pkce-verifier")));
  await page.goto("/auth/callback?code=synthetic-one-time-code");
  await expect(page).toHaveURL(root + "/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome back, Jamie." })).toBeVisible();
  expect(authCalls.filter(path => path === "/auth/v1/token")).toHaveLength(1);
  expect(authCalls).toContain("/auth/v1/user");
});
test("confirmation cannot succeed from an invalid cached session", async ({ page }) => {
  const { apiCalls } = await mockServices(page, { expired: true }); await cachedSession(page, true);
  await page.goto("/auth/callback");
  await expect(page.getByRole("heading", { name: "Confirmation link expired or invalid" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Email verified" })).toHaveCount(0);
  expect(apiCalls).toEqual([]);
});
test("late verification cannot reopen a workspace after another tab signs out", async ({ page, context }) => {
  const { apiCalls } = await mockServices(page); await cachedSession(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/auth/v1/user", async route => { await pending; await route.fulfill({ json: fixtureUser() }); });
  const otherTab = await context.newPage(); await mockServices(otherTab);
  try {
    await page.goto("/dashboard");
    await expect(page.getByText("Restoring your session…")).toBeVisible();
    await otherTab.goto(root + "/account");
    await otherTab.getByRole("button", { name: "Sign out", exact: true }).last().click();
    await expect(page).toHaveURL(/\/login$/);
    const response = page.waitForResponse(response => response.url().includes("/auth/v1/user"));
    release(); await response;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
    expect(apiCalls).toEqual([]);
  } finally { release(); await otherTab.close(); }
});
test("malformed site records fail visibly without partial totals or unsafe site links", async ({ page }) => {
  await mockServices(page); await cachedSession(page);
  await page.route("**/api/wp-manager/sites", route => route.fulfill({ json: { sites: [{ id: "20000000-0000-4000-8000-000000000001", site_url: "javascript:alert(1)" }] } }));
  await page.goto(root + "/dashboard");
  await expect(page.getByRole("alert")).toContainText("totals are unavailable");
  await expect(page.locator(".metric-card strong").first()).toHaveText("—");
  await page.goto(root + "/wordpress");
  await expect(page.getByRole("alert")).toContainText("invalid inventory");
  await expect(page.getByRole("button", { name: "Inspect site", exact: true })).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
});
test("workspace navigation remains isolated on mobile when cached identity fields are forged", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockServices(page); await cachedSession(page, true);
  await page.goto("/workspace/10000000-0000-4000-8000-000000000002/wordpress");
  await expect(page.getByRole("heading", { name: "Workspace unavailable" })).toBeVisible();
  await page.getByRole("link", { name: "Return to your workspace" }).click();
  await expect(page).toHaveURL(root + "/dashboard");
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await expect(page.getByRole("link", { name: "Admin overview" })).toHaveCount(0);
});

test("callback scrubs credential parameters even when frontend auth is unconfigured", async ({ page }) => {
  await mockServices(page);
  await page.route("**/src/lib/supabase.ts*", route => route.fulfill({ contentType: "application/javascript", body: "export const isSupabaseConfigured = false; export const supabase = null;" }));
  await page.goto("/auth/callback#access_token=synthetic-unusable&refresh_token=synthetic-unusable");
  await expect(page.getByRole("heading", { name: "We couldn’t confirm your email" })).toBeVisible();
  await expect(page).toHaveURL("/auth/callback");
});
test("unsafe stored return locations cannot redirect a successful login off-origin", async ({ page }) => {
  const { signIn } = await import("./fixtures");
  await mockServices(page); await page.goto("/login");
  await page.evaluate(() => history.replaceState({ usr: { from: "//untrusted.example.test/path" }, key: "synthetic", idx: 0 }, "", "/login"));
  await page.reload(); await signIn(page);
  await expect(page).toHaveURL(root + "/dashboard");
});

test("empty cached access tokens cannot fall back to another inferred identity", async ({ page }) => {
  const { fixtureSession } = await import("./fixtures");
  const { apiCalls, authCalls } = await mockServices(page);
  const session = { ...fixtureSession(true), access_token: "" };
  await page.addInitScript(value => localStorage.setItem("sb-example-auth-token", JSON.stringify(value)), session);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
  expect(apiCalls).toEqual([]); expect(authCalls).not.toContain("/auth/v1/user");
});

test("WordPress client operations preserve missing-session 401s without sending requests", async ({ page }) => {
  const { apiCalls } = await mockServices(page); await page.goto("/login");
  const statuses = await page.evaluate(async () => {
    // Load the real development module, not a replacement client implementation.
    const api = await import("/src/wp-manager/api.ts");
    const id = "20000000-0000-4000-8000-000000000001";
    const calls = [() => api.getWordPressSites(""), () => api.initiateWordPressPairing("", "https://example.test"), () => api.getWordPressSiteInspection("", id), () => api.getWordPressInventory("", id, "posts"), () => api.getWordPressControlledActions("", id), () => api.getWordPressControlledAction("", id), () => api.approveWordPressControlledAction("", id), () => api.cancelWordPressControlledAction("", id)];
    return Promise.all(calls.map(async call => { try { await call(); return 200; } catch (error) { return error instanceof api.ApiError ? error.status : null; } }));
  });
  expect(statuses).toEqual(Array(8).fill(401)); expect(apiCalls).toEqual([]);
});
