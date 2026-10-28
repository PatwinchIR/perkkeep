# Perkkeep verification — October 28, 2026

## Hosted Neon release (Claude Code cloud session)

### Deployed

- **Production:** https://perkkeep.vercel.app, deployed with the Vercel CLI from the reviewed working tree. The first production build applied all seven migrations to Neon: the platform prelude, five ledger migrations and the hardening check. The next build reported "Schema is up to date."
- The hardening check passed on Neon. No restricted role can log in, be a superuser or bypass RLS; `authenticated` cannot read identity mappings; and every public table enforces RLS. The Neon owner role used for the connection does have `BYPASSRLS`, which is why every request switches roles.

### Checked over HTTPS against production (real Neon Auth and database)

| Check                                                           | Result                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| Anonymous `GET /api/ledger`                                     | 401 `Sign in to continue.`                                      |
| Forged `__Secure-neon-auth.session_token` cookie                | 401; Neon Auth rejects it                                       |
| Cross-origin and origin-less `POST /api/ledger`                 | 403                                                             |
| Same-origin anonymous write                                     | 401                                                             |
| `POST /api/auth/admin/list-users`                               | 404, not forwarded                                              |
| Sign-up for an address outside the owner list                   | 403 `OWNER_ONLY`                                                |
| Verification-code request for a stranger, or OTP type `sign-in` | 403 / 404                                                       |
| Sign-up for an owner alias                                      | Account created unverified; no session issued; ledger stays 401 |
| Private responses                                               | `Cache-Control: private, no-store`; HSTS present                |
| `/sw.js`, `/offline.html`                                       | 200                                                             |

### Not yet verified on the deployment

- **Signed-in browser flows.** These are evidence entry and read-back, correction, rejection, notes, audit history, replay, changed-payload rejection, historical periods, cross-owner isolation, and sign-out revocation by replaying an old cookie. They are implemented in `tests/e2e/app.spec.ts` but have **not run**, because the two test owners could not finish email verification. Neon generated verification codes (rows appeared in `neon_auth.verification`), but no email arrived in the owner's inbox within about ten minutes, and the Gmail connector cannot see spam. Codes were not read from the database, because that would bypass email verification.
- Physical iPhone Home Screen installation.

### Automated checks in the cloud session

- **Ledger suite:** 27 tests against PostgreSQL 16, where the owner is a non-superuser with `BYPASSRLS`, like Neon's role. They cover the restricted role and identity assertions, anonymous and `anon` denial, evidence write/read-back with two replays, concurrent duplicate imports converging on one row, changed-payload rejection, cross-owner isolation for reads, writes and parents, rejection of browser-supplied owner fields, unknown operations, historical periods across month and year rollovers, supersession counted once, idempotent reconciliation with changed-input rejection, failed runs rolled back but logged, mid-request rollback, rule versioning, every cadence, leap anniversaries, partial windows, refunds versus explained reversals, units, forged period boundaries, and card initialization without invented digits.
- **Domain suite:** 7 tests.
- TypeScript, ESLint and the production build pass, and `check:client` found no database URL or configured secret in browser output.
- An earlier local Neon-mode production server returned 401/403/404 for the same anonymous, cross-origin and blocked-path cases.
- Before the Supabase removal, the existing 29 Supabase database and domain tests passed against a native local Supabase stack after the backend refactor. Browser tests were not run there, because the preinstalled Chromium build did not match Playwright's expected revision.

### Configuration changes made

- Vercel production environment: added `PERKKEEP_OWNER_EMAILS` (the owner's address) and `PERKKEEP_OWNER_PLUS_ALIASES=allow`.
- Neon Auth (`neon_auth.project_config`): trusted origin `https://perkkeep.vercel.app`, and required email verification with codes sent on sign-up and sign-in. See [deployment](deployment.md).
- Two synthetic test owners were created as plus-aliases of the owner's address. They are unverified and have no ledger rows.

### Dependency audit

`npm ci` on Vercel reported 7 low-severity findings, the same transitive findings as before (from the Neon Auth/Better Auth dependency tree). No moderate, high or critical findings were reported, and no forced fix was applied. Removing the Supabase packages did not change the count.

## Finances and scheduling

No ChatGPT Finances tool is available in this environment. No real transaction was imported, and no scheduled ChatGPT cycle ran. Classification: **not testable from the available environment**. See [reconciliation](reconciliation.md).

## Earlier local verification (Supabase, before this release)

29 database/domain tests and 18 browser tests passed locally on the earlier Supabase stack. That stack has since been removed from the project.
