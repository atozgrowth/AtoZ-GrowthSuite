// Unit tests use injected stores/clients. Never inherit live Supabase credentials.
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
