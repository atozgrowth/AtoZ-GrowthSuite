/** API root including /api; defaults to this origin in every environment. */
export function resolveApiBase(value?: string): string {
  const base = value?.trim().replace(/\/+$/, "") || "/api";
  if (base.startsWith("/") && !base.startsWith("//") && !/[?#\\\s]/.test(base)) {
    return base;
  }
  const url = new URL(base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("VITE_API_BASE_URL must be an HTTP(S) URL or an absolute path without credentials, query, or fragment.");
  }
  return base;
}
