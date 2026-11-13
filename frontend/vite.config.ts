import { defineConfig, loadEnv } from "vite";
import { publicConfiguration } from "./src/lib/publicConfig";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  publicConfiguration(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3000",
          changeOrigin: true,
        },
      },
    },
  };
});
