import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicConfiguration } from "./publicConfig";
const config = publicConfiguration(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
export const isSupabaseConfigured = config !== null;
export const supabase: SupabaseClient | null = config
  ? createClient(config.url, config.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    })
  : null;
