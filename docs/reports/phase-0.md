# Phase 0 report: Neon port

Date: 2026-10-28. Branch: `claude/gallant-cray-jewnhr`, based on published commit `d6709e0`.

**Status:** the code is complete and verified against a local PostgreSQL 16 server that reproduces Neon's role model. The hosted half of the gate (deploying to the existing Vercel project and verifying HTTPS end to end) has **not** been done. This work ran in a cloud agent container that has no Neon credentials and no Vercel CLI login, and the Vercel connector there returned 404/403 for this project's details, environment variables and deployments. Section 5 gives the steps that finish it.

### Hosted attempt from a cloud container (2026-10-28, second session)

- **Local suite:** after `npm ci` and `bash scripts/cloud-postgres.sh`, 48/48 unit tests and 20/20 Chromium browser tests passed (4 WebKit-only tests skipped), and typecheck, lint, build and `check:client` passed.
- **Vercel:** a `VERCEL_TOKEN` environment variable works with the Vercel CLI (installed as `vercel@64.0.2`, with the team and project passed as `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`). `vercel env pull` wrote the production variables to the ignored `.local/neon.production.env`, and they were read by name only. Vercel production already holds `NEON_AUTH_BASE_URL` and `PERKKEEP_OWNER_EMAILS`. The owner list holds one address, and that address matches the owner's sign-in email. Production also holds `PERKKEEP_OWNER_PLUS_ALIASES`, which no PerkKeep code reads.
- **Neon:** the container cannot reach Neon's Postgres port. A direct TCP connection to the unpooled endpoint on port 5432 timed out. Through the egress proxy, `CONNECT` to port 5432 returned `200 Connection Established`, but the proxy never relayed Postgres's plaintext `SSLRequest` (no reply within 15 seconds). A TLS handshake sent through the same tunnel was reset after 2 seconds. My reasoning here is that the proxy re-terminates TLS on every tunnel, so it cannot carry the Postgres wire protocol; I have not confirmed that cause with the proxy's operators. The proxy was not bypassed.
- **Not done, because they depend on Neon:** `neon:provision`, the production deployment, and the end-to-end check with a synthetic account. The Neon Auth email-verification setting was not changed, because this container has no Neon Console or Neon API access.

## 1. Deployed URL and commit

- Deployed URL: none. Nothing was deployed from this session.
- Commit: the head of `claude/gallant-cray-jewnhr` (draft pull request linked in chat).

## 2. Tests run and results

All fixtures are **synthetic**. They use random test owners in a dedicated local `perkkeep_test` database and never touch real accounts.

| Check                                                                           | Result                                                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Baseline before the port: unit and database tests on the earlier implementation | 29/29 passed                                                                                                                                     |
| Unit and database tests on PostgreSQL 16 as `perkkeep_app` (`npm test`)         | 31/31 passed: the 29 ported cases plus 2 new ones (restricted-role attributes; transaction-local identity not leaking across pooled connections) |
| Browser tests, desktop Chromium and 375px Chromium (`npm run test:e2e`)         | 12/12 passed (6 UI flows per project)                                                                                                            |
| HTTP security tests against the running server (desktop Chromium project)       | 4/4 passed                                                                                                                                       |
| Browser tests, 375px WebKit                                                     | **Not run.** WebKit is not installed in the agent container. Run `npx playwright install webkit` and `npm run test:e2e` locally.                 |
| `npm run typecheck`, `npm run lint`, `npm run build`                            | Passed                                                                                                                                           |
| `npm run check:client` (connection strings and secret values in `.next/static`) | Passed                                                                                                                                           |
| Build guard with an owner-role URL and missing auth settings (`VERCEL=1`)       | Build refused, listing each problem                                                                                                              |
| Build guard with a restricted-role URL and complete settings (`VERCEL=1`)       | Build succeeded                                                                                                                                  |
| `neon:provision` against the local owner role                                   | Migrations applied; restricted role verified                                                                                                     |

## 3. Security boundaries verified, and how

- **Restricted database role.** `perkkeep_app` has no `BYPASSRLS`, is not a superuser, and owns no relations. The database test "runs as a role that cannot bypass row-level security" reads `pg_roles` and `pg_class` to prove this. On first use, the server pool runs the same query and refuses to serve if any condition fails (`src/server/db.ts`). `neon:provision` checks it again against Neon before saving the URL.
- **Row-level security.** Every ledger table has `ENABLE` and `FORCE ROW LEVEL SECURITY`, with owner policies on `app.current_owner()`. Tests show that another owner, and a connection without an identity, read 0 rows from all eight tables and views, and that their inserts, cross-owner evidence and ownership changes are rejected.
- **Transaction-local identity.** A test commits a transaction that set `app.owner_id`, then queries again on the same pooled connection. The identity is `NULL`, and 0 cards are visible.
- **Server-side session verification.** Ledger routes verify the session on the server (`src/server/identity.ts`, `src/server/access.ts`). HTTP tests confirm 401 with no session, 401 for a tampered cookie, 401 for an expired session, 403 for an unverified email, and 403 for an email not on the allowlist.
- **Email verification.** The server enforces it on every request (D7). The hosted Neon Auth verification email itself has not been tested.
- **Logout.** The sign-out test confirms that a second identity sees an empty ledger after the first signs out.
- **Session expiry.** Expired sessions are refused (HTTP test). Hosted revocation takes effect within the 60-second session cache (D6). That behavior has not yet been observed against hosted Neon Auth.
- **Allowed origins.** HTTP tests show that a write from a foreign origin, or with no origin, returns 403, and that the local test sign-in rejects foreign origins and wrong secrets.
- **Ownership.** An HTTP test shows that one owner's `updateCard` on another owner's card is rejected, leaves the card unchanged, and does not appear in the first owner's snapshot.
- **Provenance.** An HTTP test shows that evidence posted with `recorded_by: "import"` is stored as `user`.
- **No secrets in the browser.** `check:client` scans built assets for connection strings and the values of the server secrets present in the environment.
- **Service-worker cache.** Unchanged: navigations only, with an offline page and icons cached. The existing browser test still asserts this. API responses send `Cache-Control: no-store`.

## 4. What works with real data

Nothing yet. No real data was read or written in this session.

## 5. Owner inputs still missing

1. **Finish the hosted half of Phase 0** (on your Mac, inside the project folder):
   1. `git fetch origin && git checkout claude/gallant-cray-jewnhr && npm ci`
   2. Make sure `.local/neon.production.env` holds the Neon owner variables. If not: `vercel env pull .local/neon.production.env --environment production`
   3. `npm run neon:provision -- --vercel --owner-email <your sign-in email>`. This applies the migrations to Neon, sets a strong password on `perkkeep_app`, proves it cannot bypass row-level security, and stores `PERKKEEP_DATABASE_URL`, `PERKKEEP_OWNER_EMAILS`, `NEON_AUTH_COOKIE_SECRET`, `PERKKEEP_ENCRYPTION_KEY` and `CRON_SECRET` in Vercel production without printing them.
   4. In the Neon Console, under Auth: turn on email verification (`NEON_AUTH_BASE_URL` is already in Vercel production as of 2026-10-28), and, if the Auth settings list trusted or allowed domains, add the production domain there. (I have not seen the current Neon Auth settings screen, so the names there may differ.)
   5. Merge the pull request, or run `vercel deploy --prod`. Then sign up, verify your email, and confirm that the ledger opens.
2. **SimpleFIN setup token:** keep it on your Mac. Paste it into the owner-only settings page once Phase 1 is deployed (D14).

## 6. Decisions made without asking

D1 to D17 in [decisions.md](../decisions.md), each with one line of reasoning.

## 7. Known gaps and fallbacks

| Gap                                                                                                                                                                                           | Fallback                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Not deployed; hosted HTTPS, Neon Auth sign-up, verification email and revocation not observed                                                                                                 | Owner steps 1.1 to 1.5.                                                                                                                   |
| WebKit phone tests not run in the agent container                                                                                                                                             | Run them locally (section 2).                                                                                                             |
| Neon's `ALTER ROLE ... PASSWORD` and pooled-connection behavior verified only against documentation and local PostgreSQL                                                                      | `neon:provision` checks the role on Neon itself and stops before saving anything if the check fails.                                      |
| A second `neon:provision --vercel` run sets a new `perkkeep_app` password, but `vercel env add` does not overwrite an existing `PERKKEEP_DATABASE_URL`, so Vercel would keep the old password | Run it once. Before any re-run, remove `PERKKEEP_DATABASE_URL` from Vercel production (`vercel env rm PERKKEEP_DATABASE_URL production`). |
| Cloud containers cannot reach Neon's Postgres port through the egress proxy                                                                                                                   | Run `neon:provision` on the owner's Mac. Deployment and HTTPS verification can still run from a container.                                |
