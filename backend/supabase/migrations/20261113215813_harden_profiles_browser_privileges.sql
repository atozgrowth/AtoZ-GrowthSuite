-- PROPOSAL ONLY: requires separate owner authorization before any live execution.
-- Independent of provisioning-body review. Atomic; inherited/owner access fails closed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;
DO $hardening$
DECLARE browser text; service_before text[];
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NULL THEN
    RETURN; -- Fresh installations are secured by the following baseline migration.
  END IF;
  service_before := (SELECT pg_catalog.array_agg(capability ORDER BY capability) FROM (
      SELECT 'table:' || p AS capability
      FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','MAINTAIN','REFERENCES']) p
      WHERE pg_catalog.has_table_privilege('service_role','public.profiles',p)
      UNION ALL
      SELECT 'column:' || a.attnum::text || ':' || p AS capability
      FROM pg_catalog.pg_attribute a
      CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
      WHERE a.attrelid='public.profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped
        AND pg_catalog.has_column_privilege('service_role','public.profiles',a.attnum,p)
    ) AS effective_capabilities);
  REVOKE TRUNCATE, TRIGGER, MAINTAIN, REFERENCES ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
  FOREACH browser IN ARRAY ARRAY['anon','authenticated'] LOOP
    -- Effective ACL includes PUBLIC and inherited grants. Membership check also
    -- rejects NOINHERIT roles reachable via SET ROLE and table ownership paths.
    IF pg_catalog.has_table_privilege(browser, 'public.profiles', 'TRUNCATE,TRIGGER,MAINTAIN,REFERENCES')
       OR pg_catalog.has_any_column_privilege(browser,'public.profiles','REFERENCES')
       OR pg_catalog.pg_has_role(browser, (SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.profiles'::regclass), 'MEMBER')
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_roles r
         WHERE pg_catalog.pg_has_role(browser, r.oid, 'MEMBER')
           AND (r.rolsuper OR r.rolbypassrls OR pg_catalog.has_any_column_privilege(r.oid,'public.profiles','REFERENCES') OR
                pg_catalog.has_table_privilege(r.oid, 'public.profiles', 'TRUNCATE,TRIGGER,MAINTAIN,REFERENCES'))
       ) THEN
      RAISE EXCEPTION 'Profiles browser privilege hardening blocked: review role grants/membership/ownership privately';
    END IF;
  END LOOP;
  IF service_before IS DISTINCT FROM (SELECT pg_catalog.array_agg(capability ORDER BY capability) FROM (
      SELECT 'table:' || p AS capability
      FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','MAINTAIN','REFERENCES']) p
      WHERE pg_catalog.has_table_privilege('service_role','public.profiles',p)
      UNION ALL
      SELECT 'column:' || a.attnum::text || ':' || p AS capability
      FROM pg_catalog.pg_attribute a
      CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
      WHERE a.attrelid='public.profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped
        AND pg_catalog.has_column_privilege('service_role','public.profiles',a.attnum,p)
    ) AS effective_capabilities) THEN
    RAISE EXCEPTION 'Profiles hardening blocked: PUBLIC revoke would change service_role effective privileges';
  END IF;
END;
$hardening$;
COMMIT;
