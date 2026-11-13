import { rm } from "node:fs/promises";
await rm(new URL("../preview-screenshots/", import.meta.url), { recursive: true, force: true });
