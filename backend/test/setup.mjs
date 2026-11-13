import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Unit workers must not load ambient credentials through dotenv/config either.
const directory = mkdtempSync(join(tmpdir(), "atoz-unit-config-"));
const file = join(directory, ".env");
writeFileSync(file, "", { mode: 0o600 });
process.env.DOTENV_CONFIG_PATH = file;
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
