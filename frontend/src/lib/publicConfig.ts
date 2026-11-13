/** Credential-type checks only: JWT contents here are NEVER authorization proof. */
// This module is shared by the browser bundle and Vite's ES-only config project.
const web = globalThis as unknown as {
  URL: new (input: string) => { protocol: string; hostname: string; username: string; password: string; search: string; hash: string; pathname: string; origin: string };
  atob: (value: string) => string;
};
export function publicConfiguration(rawUrl?: string, rawKey?: string) {
  const url = rawUrl?.trim(), key = rawKey?.trim();
  if (!url && !key) return null;
  if (!url || !key) throw new Error("Both public Supabase configuration values are required.");
  let parsed;
  try { parsed = new web.URL(url); }
  catch { throw new Error("Invalid public Supabase URL."); }
  if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") throw new Error("Invalid public Supabase URL.");
  if (key.startsWith("sb_secret_")) throw new Error("A privileged key cannot be used as a frontend public key.");
  if (key.split(".").length === 3) {
    let role: unknown;
    try { role = JSON.parse(web.atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role; }
    catch { throw new Error("Invalid public key format."); }
    if (role !== "anon") throw new Error("Only an anonymous/public key may be included in a frontend build.");
  }
  return { url: parsed.origin, key };
}
