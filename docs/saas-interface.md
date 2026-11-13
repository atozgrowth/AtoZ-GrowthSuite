# SaaS interface and authorization contract

The existing app supplied login/signup, a confirmation callback, account details and WordPress connection/inspection/controlled-action screens. This change adds customer and administrator overviews, account-scoped navigation, explicit unavailable-module pages, server authorization endpoints and browser tests. It uses React/React Router, the existing CSS shell, Supabase Auth and Fastify; no database migration is needed or included.

## Routes

- `/login`, `/signup`: email/password authentication. Signup follows the project's configured email-confirmation policy; confirmed sessions are validated before protected navigation.
- `/auth/callback`: existing PKCE/legacy confirmation handling, followed by the workspace overview. Invalid/expired links remain outside protected screens.
- `/dashboard`, `/wordpress`, `/account`, `/`: compatibility redirects to the signed-in user's workspace.
- `/workspace/:workspaceId/dashboard`: customer overview, refresh, real account site inventory, loading/error/empty states and getting-started links. No sample business KPIs or fabricated totals.
- `/workspace/:workspaceId/wordpress`: existing WordPress Manager functionality.
- `/workspace/:workspaceId/account`: authenticated account identity and sign-out.
- `/workspace/:workspaceId/modules/:moduleId`: Analytics, Campaigns, Team and Billing availability pages. All are explicitly unavailable and have no action controls or connected services.
- `/admin`: API-verified service/capability overview for administrators. User/organization/billing provisioning and platform-wide business analytics remain unavailable; no fabricated cross-account data is displayed.

Anonymous visits redirect to login while retaining a validated internal return path. Foreign workspace IDs produce an access-restricted screen before any workspace request. Customers cannot access the admin dashboard.

## Identity and tenancy

The existing data model uses `user_id` ownership, not organizations or membership tables. A **personal workspace** therefore uses the authenticated user's ID. There is no arbitrary tenant selector, local-storage-selected organization or inferred membership. The new `/api/workspaces/:workspaceId` endpoint validates the access token with Supabase Auth and requires an exact ownership match, even for administrators. Existing WordPress APIs retain their authenticated owner/RLS boundaries. Shared organization provisioning and switching require a future reviewed membership/RLS design.

Administrator eligibility is exactly `app_metadata.role === "admin"` on the user returned by Supabase Auth. Editable `user_metadata` and client-cached admin claims are ignored. The frontend verifies restored sessions with `getUser(access_token)` before rendering protected content; the backend independently verifies every request and applies the role check to `/api/admin/overview`. No UI guard substitutes for API authorization. No signup field can grant admin privileges. Role assignment must occur through a separately authorized trusted administrative process; this change assigns no roles.

## Integration requirements

Configure frontend public `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` and backend `SUPABASE_URL` / `SUPABASE_ANON_KEY` for the same existing Growth Suite project. Never expose service-role keys in Vite. The existing WordPress pairing/actions additionally need the backend-only privileged key and their existing tables/RPCs/RLS; this PR does not provision them. Keep controlled-write switches disabled until separately reviewed.

The same-origin `/api` route is the default, with existing Caddy/Vite proxy configuration. Set `VITE_API_BASE_URL` explicitly for an approved split-origin deployment. Supabase email/password enablement, email delivery, confirmation policy and allowed `/auth/callback` redirect must be configured securely in the relevant project. Live signup, real email delivery and authenticated database/RLS behavior require separately authorized integration testing; all development tests here use synthetic identities and intercept remote requests.

## Checks

`npm test` in backend verifies token rejection, Auth-service failures, workspace ownership and server-owned admin roles alongside existing tests. Frontend `npm test` covers role/navigation policy. `npm run test:e2e` in frontend uses a fixture-only Vite server and mocked Auth/API responses to test login, signup, callback, expired sessions, forged claims, foreign workspaces, admin denial, module navigation, sign-out and mobile layout. External non-fixture requests are blocked. The dedicated Frontend navigation workflow uses read-only permissions and no GitHub environment or production secrets.


## PR #17 visual review evidence

The Frontend navigation workflow generates a separate `dashboard-previews-RUN_ID-ATTEMPT` artifact (30-day retention). Download it and open `index.html`; README.md provides the same seven-screen index. Full-page originals cover Login, Signup, Customer Dashboard, Admin Dashboard, WordPress Manager, Account Settings and the Mobile Customer Dashboard. manifest.json records tested revision, PR head, routes, fixture personas and PNG dimensions; SHA256SUMS covers all screenshots and index files. The separate browser report retains failure traces for seven days.

Preview tests run the app locally with intercepted synthetic Auth/API responses. Site fixtures match the connected-only endpoint's actual id/site_url response shape, including the legacy omission of status. Responsive checks cover 360/768/1440px, keyboard focus containment/Escape/return focus in the mobile drawer, busy-state semantics, public-form headings and existing WordPress connection controls. Auth, admin-role and foreign-workspace rejection tests remain mandatory. These previews do not certify live email delivery, database readiness or real WordPress connectivity.
