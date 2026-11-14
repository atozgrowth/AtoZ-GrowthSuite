-- PROPOSAL ONLY. No live execution authorized by this repository change.
-- Existing trigger bodies are NEVER replaced. Adoption requires review attestation
-- against the exact definition in the same migration session (see readiness docs).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;
DO $baseline$
DECLARE trigger_function oid; expected record; actual_type text;
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NOT NULL THEN
    PERFORM pg_catalog.set_config('atoz.profiles_service_privileges_before',coalesce((SELECT pg_catalog.array_agg(capability ORDER BY capability) FROM (
      SELECT 'table:' || p AS capability
      FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','MAINTAIN','REFERENCES']) p
      WHERE pg_catalog.has_table_privilege('service_role','public.profiles',p)
      UNION ALL
      SELECT 'column:' || a.attnum::text || ':' || p AS capability
      FROM pg_catalog.pg_attribute a
      CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
      WHERE a.attrelid='public.profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped
        AND pg_catalog.has_column_privilege('service_role','public.profiles',a.attnum,p)
    ) AS effective_capabilities)::text,'{}'),true);
  ELSE
    PERFORM pg_catalog.set_config('atoz.profiles_service_privileges_before','fresh-table',true);
  END IF;
  IF pg_catalog.to_regclass('public.profiles') IS NULL THEN
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      full_name text,
      avatar_url text,
      created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
      updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
    );
    -- New-table defaults only; adoption must not alter existing service_role ACLs.
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO service_role;
  END IF;
  -- Fail on drift instead of coercing existing data/columns or replacing keys.
  FOR expected IN SELECT * FROM (VALUES ('id','uuid'),('full_name','text'),
    ('avatar_url','text'),('created_at','timestamp with time zone'),
    ('updated_at','timestamp with time zone')) AS c(name,type_name) LOOP
    SELECT pg_catalog.format_type(a.atttypid,a.atttypmod) INTO actual_type
    FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.profiles'::regclass
      AND a.attname=expected.name AND a.attnum>0 AND NOT a.attisdropped;
    IF actual_type IS DISTINCT FROM expected.type_name THEN
      RAISE EXCEPTION 'Profiles contract drift: required column type mismatch';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid='public.profiles'::regclass AND c.contype='p'
      AND c.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute
                          WHERE attrelid=c.conrelid AND attname='id')]::smallint[])
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid='public.profiles'::regclass AND c.confrelid='auth.users'::regclass
      AND c.contype='f' AND c.convalidated
      AND c.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.conrelid AND attname='id')]::smallint[]
      AND c.confkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.confrelid AND attname='id')]::smallint[]) THEN
    RAISE EXCEPTION 'Profiles contract drift: validated id primary/foreign key required';
  END IF;
  SELECT tgfoid INTO trigger_function FROM pg_catalog.pg_trigger
  WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created' AND NOT tgisinternal;
  IF trigger_function IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='auth.users'::regclass
      AND tgname='on_auth_user_created' AND tgtype=5 AND tgenabled='O') THEN
      RAISE EXCEPTION 'Profiles trigger drift: expected enabled AFTER INSERT ROW trigger';
    END IF;
    IF pg_catalog.current_setting('atoz.reviewed_profiles_trigger_md5',true)
       IS DISTINCT FROM pg_catalog.md5(pg_catalog.pg_get_functiondef(trigger_function)) THEN
      RAISE EXCEPTION 'Profiles adoption blocked: exact existing trigger definition needs owner security review';
    END IF;
    -- The review token is an operator acknowledgement, NOT a security boundary.
    -- Existing body, owner, path and behavior are deliberately preserved.
  ELSE
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
               WHERE tgrelid='auth.users'::regclass AND NOT tgisinternal)
       OR pg_catalog.to_regprocedure('private.atoz_provision_profile()') IS NOT NULL THEN
      RAISE EXCEPTION 'Profiles adoption blocked: review existing Auth triggers/function collision';
    END IF;
    CREATE SCHEMA IF NOT EXISTS private;
    EXECUTE $ddl$
      CREATE FUNCTION private.atoz_provision_profile() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
      BEGIN
        -- Metadata is display data only; it never provisions roles/permissions.
        INSERT INTO public.profiles(id,full_name,avatar_url)
        VALUES (NEW.id,
          CASE WHEN pg_catalog.jsonb_typeof(NEW.raw_user_meta_data->'full_name')='string'
               THEN NEW.raw_user_meta_data->>'full_name' END,
          CASE WHEN pg_catalog.jsonb_typeof(NEW.raw_user_meta_data->'avatar_url')='string'
               THEN NEW.raw_user_meta_data->>'avatar_url' END)
        ON CONFLICT (id) DO NOTHING; -- Never overwrite an existing profile.
        RETURN NEW;
      END;
      $function$
    $ddl$;
    REVOKE ALL ON FUNCTION private.atoz_provision_profile() FROM PUBLIC, anon, authenticated, service_role;
    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION private.atoz_provision_profile();
  END IF;
END;
$baseline$;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;
REVOKE TRUNCATE, TRIGGER, MAINTAIN, REFERENCES ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE DELETE ON TABLE public.profiles FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
-- Keep existing policies. Restrictive guards prevent an existing permissive
-- policy from broadening ownership. Replace only these repository-owned names.
DROP POLICY IF EXISTS atoz_profiles_owner_select ON public.profiles;
CREATE POLICY atoz_profiles_owner_select ON public.profiles FOR SELECT TO authenticated USING ((SELECT auth.uid())=id);
DROP POLICY IF EXISTS atoz_profiles_owner_insert ON public.profiles;
CREATE POLICY atoz_profiles_owner_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid())=id);
DROP POLICY IF EXISTS atoz_profiles_owner_update ON public.profiles;
CREATE POLICY atoz_profiles_owner_update ON public.profiles FOR UPDATE TO authenticated USING ((SELECT auth.uid())=id) WITH CHECK ((SELECT auth.uid())=id);
DROP POLICY IF EXISTS atoz_profiles_guard_select ON public.profiles;
CREATE POLICY atoz_profiles_guard_select ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT auth.uid())=id);
DROP POLICY IF EXISTS atoz_profiles_guard_insert ON public.profiles;
CREATE POLICY atoz_profiles_guard_insert ON public.profiles AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid())=id);
DROP POLICY IF EXISTS atoz_profiles_guard_update ON public.profiles;
CREATE POLICY atoz_profiles_guard_update ON public.profiles AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT auth.uid())=id) WITH CHECK ((SELECT auth.uid())=id);
DO $verify$
DECLARE browser text;
BEGIN
  FOREACH browser IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF pg_catalog.has_table_privilege(browser,'public.profiles','TRUNCATE,TRIGGER,MAINTAIN,REFERENCES,DELETE')
       OR pg_catalog.has_any_column_privilege(browser,'public.profiles','REFERENCES')
       OR pg_catalog.pg_has_role(browser, (SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.profiles'::regclass), 'MEMBER')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
                  WHERE pg_catalog.pg_has_role(browser,r.oid,'MEMBER')
                  AND (r.rolsuper OR r.rolbypassrls OR pg_catalog.has_any_column_privilege(r.oid,'public.profiles','REFERENCES') OR pg_catalog.has_table_privilege(r.oid,'public.profiles','TRUNCATE,TRIGGER,MAINTAIN,REFERENCES,DELETE'))) THEN
      RAISE EXCEPTION 'Profiles baseline blocked: browser effective/inherited/owner capability remains';
    END IF;
  END LOOP;
  IF pg_catalog.current_setting('atoz.profiles_service_privileges_before') <> 'fresh-table'
     AND pg_catalog.current_setting('atoz.profiles_service_privileges_before')
         IS DISTINCT FROM coalesce((SELECT pg_catalog.array_agg(capability ORDER BY capability) FROM (
      SELECT 'table:' || p AS capability
      FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','MAINTAIN','REFERENCES']) p
      WHERE pg_catalog.has_table_privilege('service_role','public.profiles',p)
      UNION ALL
      SELECT 'column:' || a.attnum::text || ':' || p AS capability
      FROM pg_catalog.pg_attribute a
      CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
      WHERE a.attrelid='public.profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped
        AND pg_catalog.has_column_privilege('service_role','public.profiles',a.attnum,p)
    ) AS effective_capabilities)::text,'{}') THEN
    RAISE EXCEPTION 'Profiles baseline blocked: PUBLIC revoke would change service_role effective privileges';
  END IF;
END;
$verify$;
COMMIT;
