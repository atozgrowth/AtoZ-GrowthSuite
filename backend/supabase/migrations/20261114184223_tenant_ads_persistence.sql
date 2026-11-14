-- Review proposal only. Never applied to live Supabase by development workflows.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.ads_connections (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), active boolean NOT NULL DEFAULT true,
 customer_ids text[] NOT NULL DEFAULT '{}' CHECK(cardinality(customer_ids)<=100 AND array_position(customer_ids,NULL) IS NULL AND (cardinality(customer_ids)=0 OR array_to_string(customer_ids,',') ~ '^[0-9]{10}(,[0-9]{10})*$')),
 UNIQUE(id,user_id)
);
CREATE TABLE private.ads_oauth_states (
 digest bytea PRIMARY KEY CHECK(octet_length(digest)=32),
 user_id uuid NOT NULL, connection_id uuid NOT NULL,
 binding_revision integer NOT NULL CHECK(binding_revision>0),
 redirect_uri text NOT NULL CHECK(length(redirect_uri)<=2048 AND redirect_uri LIKE 'https://%'),
 verifier jsonb NOT NULL CHECK(jsonb_typeof(verifier)='object' AND verifier ?& ARRAY['version','nonce','ciphertext','tag'] AND verifier - ARRAY['version','nonce','ciphertext','tag'] = '{}'::jsonb AND jsonb_typeof(verifier->'version')='number' AND verifier->>'version'='1' AND verifier->>'nonce' ~ '^[A-Za-z0-9_-]{16}$' AND verifier->>'tag' ~ '^[A-Za-z0-9_-]{22}$' AND verifier->>'ciphertext' ~ '^[A-Za-z0-9_-]+$' AND length(verifier->>'ciphertext') BETWEEN 1 AND 22000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 consumed_at timestamptz, CHECK(expires_at>created_at),
 FOREIGN KEY(connection_id,user_id) REFERENCES private.ads_connections(id,user_id)
);
CREATE INDEX ads_oauth_state_expiry ON private.ads_oauth_states(expires_at);
CREATE TABLE private.ads_token_envelopes (
 connection_id uuid PRIMARY KEY, user_id uuid NOT NULL, binding_revision integer NOT NULL CHECK(binding_revision>0),
 envelope jsonb NOT NULL CHECK(jsonb_typeof(envelope)='object' AND envelope ?& ARRAY['version','nonce','ciphertext','tag'] AND envelope - ARRAY['version','nonce','ciphertext','tag'] = '{}'::jsonb AND jsonb_typeof(envelope->'version')='number' AND envelope->>'version'='1' AND envelope->>'nonce' ~ '^[A-Za-z0-9_-]{16}$' AND envelope->>'tag' ~ '^[A-Za-z0-9_-]{22}$' AND envelope->>'ciphertext' ~ '^[A-Za-z0-9_-]+$' AND length(envelope->>'ciphertext') BETWEEN 1 AND 22000),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(connection_id,user_id) REFERENCES private.ads_connections(id,user_id)
);
ALTER TABLE private.ads_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ads_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ads_token_envelopes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ads_connections,private.ads_oauth_states,private.ads_token_envelopes FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON private.ads_connections,private.ads_oauth_states,private.ads_token_envelopes TO service_role;
COMMIT;
