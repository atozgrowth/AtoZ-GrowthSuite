-- OWNER AUTHORIZATION REQUIRED. Metadata only. Never invoke application RPCs here.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL search_path = pg_catalog;
SELECT n.nspname AS schema, c.relname AS relation, c.relrowsecurity AS rls,
       c.relforcerowsecurity AS force_rls
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE (n.nspname='public' AND c.relname IN ('profiles','wordpress_site_connections','wordpress_action_requests','wordpress_action_audit_events'))
   OR (n.nspname='private' AND c.relname IN ('wordpress_pairing_challenges','wordpress_action_payloads'));
SELECT table_schema,table_name,column_name,data_type,is_nullable
FROM information_schema.columns WHERE table_schema IN ('public','private')
AND table_name IN ('profiles','wordpress_site_connections','wordpress_action_requests','wordpress_action_audit_events','wordpress_pairing_challenges','wordpress_action_payloads')
ORDER BY table_schema,table_name,ordinal_position;
-- Booleans instead of policy expressions: review ownership expressions separately in a secure console.
SELECT schemaname,tablename,cmd,roles,qual IS NOT NULL AS has_using,with_check IS NOT NULL AS has_check
FROM pg_policies WHERE tablename IN ('profiles','wordpress_site_connections','wordpress_action_requests','wordpress_action_audit_events','wordpress_pairing_challenges','wordpress_action_payloads');
SELECT p.proname,p.proargnames[1:p.pronargs] AS arguments,p.prosecdef AS security_definer,
       'search_path=pg_catalog'=ANY(coalesce(p.proconfig,ARRAY[]::text[])) AS fixed_search_path,
       has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS user_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('wp_manager_create_pairing_challenge','wp_manager_confirm_pairing_challenge','wp_manager_create_action_request','wp_manager_get_action_payload','wp_manager_approve_action_request','wp_manager_cancel_action_request');
ROLLBACK;
