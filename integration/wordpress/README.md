# Actual isolated WordPress core

`npm ci --prefix backend --ignore-scripts && npm --prefix backend run build`, `npm ci --prefix integration/wordpress --ignore-scripts`, then `python3 integration/wordpress/run.py`.

Uses actual WordPress 7.1.4/PHP 8.3, MariaDB and PostgreSQL 17 on a newly created **internal** Docker network with no host ports. Only the fixed local Docker socket is accepted. HTTP proxies are cleared inside containers; WordPress external HTTP is blocked except the fixed internal backend callback origin. No existing .env, production credentials, external site, Supabase account, Auth user or VPS is used. Container filesystems/databases are disposable and cleaned on success or failure. Fixture image digests, actual core version and source revision are recorded in evidence.json only after all assertions succeed.

This is genuine core installation/activation, plugin HTTP, database and draft write/readback testing. The authentication prehandler, offline content provider and fixed internal transport mapping are **synthetic fixtures**, not live Supabase/JWT/email/model integration. `control.php` is fixture-only administrative setup/inspection and is never included in the plugin ZIP or production images. Its static key is synthetic, with no host port and no production secret role.

The fixture images have OS-package advisories (see the Phase 2 security report), are test-only, and must not be promoted to production. The internal network is a containment measure, not a claim that known vulnerabilities are fixed. No publishing, unrestricted code operation or production write is enabled. Workflow artifacts are expiring review evidence, not a release.

The first passing local run covered 15 scenarios; final evidence enumerates the exact final assertions. Never substitute PHP stub results for this core evidence. Persistent grant/action tests also run separately via scripts/wordpress/test_durable_database.py with real PostgreSQL concurrency.
