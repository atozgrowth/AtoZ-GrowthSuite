# A2Z GrowthSuite

React/Vite frontend, Fastify API, Supabase Auth/Postgres, and a WordPress manager plugin.

Use Node 24. From each of `backend` and `frontend`, run `npm ci`, `npm test`, and `npm run build`. Backend tests use isolated fixture configuration and injected stores, not a live database. Test deployment boundaries with `node --test scripts/*.test.mjs` from the repository root.

For development, supply a **development-only** Supabase project through secure environment settings. From `backend`, run `npm run dev`; from `frontend`, run `npm run dev`. Vite proxies `/api` to port 3000. The frontend can render its configuration notice without Supabase credentials; backend startup requires them.

See [environment and automation setup](docs/automation.md) for secure configuration, recurring checks, pull requests, staging releases, rollback, and production approval requirements.
