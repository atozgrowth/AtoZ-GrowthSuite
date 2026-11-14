import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { mockServices, cachedSession, root } from "./fixtures";

const screens = [
  { file: "01-login", path: "/login", heading: "Sign in to your account", public: true },
  { file: "02-signup", path: "/signup", heading: "Create your account", public: true },
  { file: "03-customer-dashboard", path: root + "/dashboard", heading: "Welcome back, Jamie." },
  { file: "04-admin-dashboard", path: "/admin", heading: "Platform overview", admin: true },
  { file: "05-wordpress-manager", path: root + "/wordpress", heading: "WordPress Manager" },
  { file: "06-account-settings", path: root + "/account", heading: "Account" },
  { file: "07-mobile-customer-dashboard", path: root + "/dashboard", heading: "Welcome back, Jamie.", mobile: true },
];
for (const screen of screens) {
  test(`preview ${screen.file}`, async ({ page }) => {
    await page.setViewportSize(screen.mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await mockServices(page, { admin: screen.admin });
    if (!screen.public) await cachedSession(page, screen.admin);
    await page.goto(screen.path);
    await expect(page.getByRole("heading", { name: screen.heading, exact: true })).toBeVisible();
    if (screen.public) await expect(page.locator('button[type="submit"]')).toBeEnabled();
    if (screen.path.endsWith("/dashboard")) {
      await expect(page.getByText("https://store.example.test/", { exact: true })).toBeVisible();
      await expect(page.locator(".metric-card").filter({ hasText: "Connected sites" }).locator("strong")).toHaveText("2");
      await expect(page.getByText("Verified", { exact: true })).toBeVisible();
    }
    if (screen.admin) await expect(page.getByText("Confirmed by the API")).toBeVisible();
    if (screen.path.endsWith("/wordpress")) await expect(page.getByText("store.example.test", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await mkdir("preview-screenshots", { recursive: true });
    await page.screenshot({ path: `preview-screenshots/${screen.file}.png`, fullPage: true, animations: "disabled" });
  });
}

test("mobile navigation traps focus, closes with Escape, and restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockServices(page); await cachedSession(page); await page.goto("/dashboard");
  const opener = page.getByRole("button", { name: "Open navigation", exact: true });
  await expect(opener).toBeVisible(); await opener.click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(drawer).toBeVisible();
  const links = drawer.locator('a[href], button:not(:disabled)');
  await links.last().focus(); await page.keyboard.press("Tab"); await expect(links.first()).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(links.last()).toBeFocused();
  expect(await page.locator(".app-main").evaluate(element => element.hasAttribute("inert"))).toBe(true);
  await page.keyboard.press("Escape"); await expect(drawer).toHaveCount(0); await expect(opener).toBeFocused();
  await opener.click(); await page.getByRole("button", { name: "Close navigation", exact: true }).click(); await expect(opener).toBeFocused();
});

test("responsive existing screens and WordPress connection controls", async ({ page }) => {
  await mockServices(page); await cachedSession(page);
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of [root + "/dashboard", root + "/wordpress", root + "/account", root + "/modules/billing"]) {
      await page.goto(route); await expect(page.locator("main h1")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await page.goto(root + "/wordpress"); await page.getByRole("button", { name: "Connect a site", exact: true }).click();
  await expect(page.getByLabel("WordPress site URL")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate pairing code" })).toBeEnabled();
});


test("public forms retain an accessible main heading on mobile and tablet", async ({ page }) => {
  await mockServices(page);
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/login", "/signup"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole("button", { name: route === "/login" ? "Sign in" : "Create account", exact: true }).first()).toHaveAttribute("aria-pressed", "true");
    }
  }
});
test("customer loading state exposes busy status and never fabricates zero totals", async ({ page }) => {
  await mockServices(page); await cachedSession(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wp-manager/sites", async route => { await pending; await route.fulfill({ json: { sites: [] } }); });
  try {
    await page.goto(root + "/dashboard");
    const metrics = page.getByRole("region", { name: "Workspace status" });
    await expect(metrics).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
    await expect(metrics.locator("strong").first()).toHaveText("—");
    release();
    await expect(metrics).toHaveAttribute("aria-busy", "false");
    await expect(page.getByText("Your first connection starts here")).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  } finally { release(); }
});

test("administrator overview fits mobile, tablet and desktop", async ({ page }) => {
  await mockServices(page, { admin: true }); await cachedSession(page, true);
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto("/admin");
    await expect(page.getByText("Confirmed by the API")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("skip navigation targets main content and reviewed small-text contrast passes", async ({ page }) => {
  await mockServices(page); await cachedSession(page); await page.goto(root + "/wordpress");
  await expect(page.getByText("store.example.test", { exact: true })).toBeVisible();
  const skip = page.getByRole("link", { name: "Skip to content" }); await skip.focus(); await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  const ratios = await page.evaluate(() => {
    function luminance(color: string) {
      const values = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
    }
    function ratio(a: string, b: string) { const values = [luminance(a), luminance(b)].sort((x, y) => x - y); return (values[1] + .05) / (values[0] + .05); }
    const nav = getComputedStyle(document.querySelector(".nav-label")!);
    const sidebar = getComputedStyle(document.querySelector(".sidebar")!);
    const badge = getComputedStyle(document.querySelector(".status-pill.success")!);
    const muted = getComputedStyle(document.querySelector(".topbar-context")!);
    return [ratio(nav.color, sidebar.backgroundColor), ratio(badge.color, badge.backgroundColor), ratio(muted.color, getComputedStyle(document.documentElement).backgroundColor)];
  });
  for (const contrast of ratios) expect(contrast).toBeGreaterThanOrEqual(4.5);
});

test("customer refresh recovers from a service error with the connected-only API shape", async ({ page }) => {
  await mockServices(page, { sitesError: true }); await cachedSession(page); await page.goto(root + "/dashboard");
  await expect(page.getByRole("alert")).toContainText("totals are unavailable");
  await page.route("**/api/wp-manager/sites", route => route.fulfill({ json: { sites: [{ id: "20000000-0000-4000-8000-000000000003", site_url: "https://recovered.example.test" }] } }));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("https://recovered.example.test/", { exact: true })).toBeVisible();
  await expect(page.locator(".metric-card").filter({ hasText: "Connected sites" }).locator("strong")).toHaveText("1");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("auth mode changes and browser history clear password fields", async ({ page }) => {
  await mockServices(page); await page.goto("/login");
  await page.getByLabel("Password", { exact: true }).fill("Synthetic-password-123");
  await page.getByRole("button", { name: "Create account", exact: true }).first().click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await page.getByLabel("Password", { exact: true }).fill("Another-synthetic-password");
  await page.goBack(); await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
});

test("canonical text identity remains readable at mobile widths without replacement logos", async ({ page }) => {
  await mockServices(page);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login');
    await expect(page).toHaveTitle('Sign in · A to Z Growth Suite');
    const brand = page.getByRole('link', { name: 'A to Z Growth Suite dashboard' }).filter({ visible: true });
    await expect(brand).toHaveCount(1);
    await expect(brand).toHaveText('A to Z Growth Suite');
    await expect(page.locator('.brand-mark')).toHaveCount(0);
    await expect(page.locator('.brand img')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("primary action gradient endpoints retain accessible white text contrast", async ({ page }) => {
  await mockServices(page); await page.goto('/login');
  const result = await page.locator('.button.primary').evaluate(element => {
    const style = getComputedStyle(element);
    const root = getComputedStyle(document.documentElement);
    function luminance(hex: string) {
      const values = hex.trim().slice(1).match(/../g)!.map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
      return values[0]*.2126+values[1]*.7152+values[2]*.0722;
    }
    return { color: style.color, gradient: style.backgroundImage, ratios: ['--brand-pink-ink','--brand-teal-ink'].map(token=>1.05/(luminance(root.getPropertyValue(token))+.05)) };
  });
  expect(result.color).toBe('rgb(255, 255, 255)');
  expect(result.gradient).toContain('linear-gradient');
  for (const ratio of result.ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test("dark preference stays intentionally readable in light mode and motion preference is respected", async ({ page }) => {
  await page.emulateMedia({ colorScheme:'dark', reducedMotion:'reduce' });
  await mockServices(page); await page.goto('/signup');
  await expect(page.getByRole('heading', { level:1 })).toBeVisible();
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme)).toBe('light');
  const duration = await page.locator('.button.primary').evaluate(element=>getComputedStyle(element).transitionDuration);
  expect(parseFloat(duration)).toBeLessThanOrEqual(.001);
});
