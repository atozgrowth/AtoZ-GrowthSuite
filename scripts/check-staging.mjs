export function checkStaging(env) {
  const staging = env.STAGING_SUPABASE_PROJECT_REF;
  const production = env.PRODUCTION_SUPABASE_PROJECT_REF;
  if (!staging || !production || staging === production) {
    throw new Error("Distinct, verified staging and production Supabase project refs are required.");
  }
  const urls = [env.VITE_SUPABASE_URL, env.SUPABASE_URL].filter(value => value !== undefined);
  if (!urls.length) throw new Error("A staging Supabase URL is required.");
  for (const value of urls) {
    const url = new URL(value);
    if (url.origin !== `https://${staging}.supabase.co` || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      throw new Error("Every Supabase URL must match the verified staging project.");
    }
  }
  if (!(env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY)) {
    throw new Error("A staging public Supabase key is required.");
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  checkStaging(process.env);
  console.log("Staging database boundary verified.");
}
