import { test, expect, type Page } from "@playwright/test";
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; pageErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
});
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });
import { owner, other, root, fixtureSession, mockServices, cachedSession, signIn } from "./fixtures";

test("anonymous protected routes return to login without requesting workspace data", async ({ page }) => {
  const { apiCalls } = await mockServices(page);
  for (const path of ["/dashboard", root + "/wordpress", "/admin"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
  }
  expect(apiCalls).toEqual([]);
});
test("password login restores the intended workspace and navigation works", async ({ page }, testInfo) => {
  const { authCalls } = await mockServices(page);
  await page.goto(root + "/account"); await expect(page).toHaveURL(/\/login$/);
  await signIn(page); await expect(page).toHaveURL(root + "/account");
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome back, Jamie." })).toBeVisible();
  await expect(page.getByText("https://store.example.test/", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin overview" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("customer-dashboard.png"), fullPage: true });
  await page.getByRole("link", { name: "Billing Unavailable", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  await expect(page.getByText("No service is connected and no actions can be performed here.")).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(authCalls).toContain("/auth/v1/user");
});
test("signup requests email confirmation without opening protected screens", async ({ page }) => {
  const { apiCalls, authCalls } = await mockServices(page);
  await page.goto("/signup");
  await page.getByLabel("Email address").fill("new@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Synthetic-password-123");
  await page.getByLabel("Confirm password").fill("Synthetic-password-123");
  await page.getByRole("button", { name: "Create account", exact: true }).last().click();
  await expect(page.getByRole("status")).toContainText(/confirm|confirmation/i);
  expect(authCalls).toContain("/auth/v1/signup"); expect(apiCalls).toEqual([]);
});
test("expired cached sessions fail closed", async ({ page }) => {
  const { apiCalls } = await mockServices(page, { expired: true }); await cachedSession(page, true);
  await page.goto("/admin"); await expect(page).toHaveURL(/\/login$/); expect(apiCalls).toEqual([]);
});
test("editable user metadata and forged cached admin claims cannot unlock admin", async ({ page }) => {
  const { apiCalls } = await mockServices(page); await cachedSession(page, true);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Administrator access required" })).toBeVisible();
  expect(apiCalls).not.toContain("/api/admin/overview");
});
test("a foreign workspace is rejected even for a verified administrator", async ({ page }) => {
  const { apiCalls } = await mockServices(page, { admin: true }); await cachedSession(page, true);
  await page.goto(`/workspace/${other}/dashboard`);
  await expect(page.getByRole("heading", { name: "Workspace unavailable" })).toBeVisible(); expect(apiCalls).toEqual([]);
});
test("verified admins can load the admin dashboard and return to their workspace", async ({ page }, testInfo) => {
  await mockServices(page, { admin: true }); await cachedSession(page, true);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Platform overview" })).toBeVisible();
  await expect(page.getByText("Confirmed by the API")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("admin-dashboard.png"), fullPage: true });
  await page.getByRole("link", { name: "Open workspace" }).click();
  await expect(page).toHaveURL(root + "/dashboard");
});
test("server-side admin rejection never presents verified admin data", async ({ page }) => {
  await mockServices(page, { admin: true, adminDenied: true }); await cachedSession(page, true);
  await page.goto("/admin"); await expect(page.getByRole("alert")).toContainText("does not have access");
  await expect(page.getByText("Confirmed by the API")).toHaveCount(0);
});
test("inventory failure is honest and mobile navigation has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockServices(page, { sitesError: true }); await cachedSession(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("alert")).toContainText("totals are unavailable");
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("link", { name: "Account settings" }).click();
  await expect(page).toHaveURL(root + "/account");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
test("invalid email confirmation stays outside protected routes", async ({ page }) => {
  const { apiCalls } = await mockServices(page);
  await page.goto("/auth/callback?error=access_denied&error_code=otp_expired");
  await expect(page.getByRole("heading", { name: "Confirmation link expired or invalid" })).toBeVisible(); expect(apiCalls).toEqual([]);
});


test("failed password login never loads protected data", async ({ page }) => {
  const { apiCalls } = await mockServices(page, { loginFailed: true });
  await page.goto("/login"); await signIn(page);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/); expect(apiCalls).toEqual([]);
});
test("signup without email confirmation can enter the verified workspace", async ({ page }) => {
  await mockServices(page, { signupSession: true });
  await page.goto("/signup");
  await page.getByLabel("Email address").fill("new@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Synthetic-password-123");
  await page.getByLabel("Confirm password").fill("Synthetic-password-123");
  await page.getByRole("button", { name: "Create account", exact: true }).last().click();
  await expect(page).toHaveURL(root + "/dashboard");
});
test("successful confirmation validates the identity and opens the workspace", async ({ page }) => {
  await mockServices(page);
  const session = fixtureSession();
  await page.goto("/auth/callback#access_token=" + session.access_token + "&refresh_token=" + session.refresh_token);
  await expect(page).toHaveURL(root + "/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome back, Jamie." })).toBeVisible();
});
