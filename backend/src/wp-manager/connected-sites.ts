import { createClient } from "@supabase/supabase-js";
/** Per-request public-key client; the user's verified token retains RLS enforcement. */
export function createConnectedSitesReader(url: string, publicKey: string, fetcher?: typeof fetch) {
  return async (userId: string, accessToken: string) => {
    const client = createClient(url, publicKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` }, ...(fetcher ? { fetch: fetcher } : {}) },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return client.from("wordpress_site_connections").select("id, site_url")
      .eq("user_id", userId).eq("status", "connected").order("site_url", { ascending: true });
  };
}
