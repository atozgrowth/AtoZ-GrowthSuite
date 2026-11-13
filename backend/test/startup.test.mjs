import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("startup loads .env before authentication imports and rejects anonymous API requests", { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "atoz-startup-"));
  const env = { ...process.env };
  for (const name of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "PORT", "HOST"]) delete env[name];
  await writeFile(join(dir, ".env"), "SUPABASE_URL=https://example.supabase.co\nSUPABASE_ANON_KEY=test-anon-key\nPORT=0\nHOST=127.0.0.1\n");
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), fileURLToPath(new URL("../src/index.ts", import.meta.url))], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const base = await new Promise((resolve, reject) => {
      let output = "";
      child.on("error", reject);
      child.on("exit", code => reject(new Error(`Backend exited before readiness: ${code}`)));
      child.stdout.on("data", data => {
        output += data.toString();
        const address = output.match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/);
        if (address) resolve(address[1]);
      });
    });
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.success, true);
    assert.equal(body.status, "running");
    const me = await fetch(`${base}/api/me`);
    assert.equal(me.status, 401);
    assert.equal((await me.json()).message, "Authorization token is required.");
  } finally {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    await rm(dir, { recursive: true, force: true });
  }
});

test("startup rejects missing public configuration even when a privileged key is supplied", { timeout: 15000 }, async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), "atoz-config-"));
  try {
    for (const missing of ["SUPABASE_URL", "SUPABASE_ANON_KEY"]) {
      const env = { ...process.env, SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "test-anon-key", SUPABASE_SERVICE_ROLE_KEY: "synthetic-backend-only" };
      delete env[missing];
      await assert.rejects(run(process.execPath, ["--import", import.meta.resolve("tsx"), fileURLToPath(new URL("../src/index.ts", import.meta.url))], { cwd: dir, env, timeout: 5000 }), error => Boolean(error.stderr?.includes("Missing SUPABASE_URL or SUPABASE_ANON_KEY")));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
