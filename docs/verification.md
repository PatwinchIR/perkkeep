# Perkkeep implementation and verification report

Date: 2026-10-27 (America/New_York). Project: `perkkeep`.

## Milestones, in execution order

| Milestone               | Implemented and tested                                                                                                                                                                                                                                                                                                                           | Still blocked or limited                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Data-flow spike     | Created an isolated local Supabase native stack. Applied schema before frontend implementation. Real Supabase Auth → Data API → Postgres → read-back passed, with two identical replays producing no duplicate evidence.                                                                                                                         | No dedicated hosted project approved/provisioned. No direct Finances access in this Codex tool environment. ChatGPT connector writes and scheduled runs have not been tested. Local success does not prove the external path.         |
| 1 — Core database       | Three forward migrations; six owner-protected tables including audit events; security-invoker balance view; composite ownership foreign keys; seven-card initializer; typed client; calendar and anniversary periods; immutable rule snapshots; append-only evidence; corrections; reversals; transaction-safe reconciliation and deduplication. | User must verify actual card products, entitlements, effective dates, enrollment and account-specific reset rules. Five sourced catalog drafts are available but none is automatically enabled.                                       |
| 2 — Mobile PWA          | Auth, overview, card management, benefit setup/versioning, evidence confirmation/rejection/correction, enrollment action, notes, review queue, history, coverage records, failed/partial sync log, refresh, PWA icons/manifest and private offline fallback. Responsive phone and desktop browser tests pass against the actual local database.  | Vercel release, production Auth/email configuration and physical iPhone Home Screen verification require the hosted project/release. Offline financial browsing is intentionally unsupported; the offline page requests reconnection. |
| 3 — Optional automation | Transactional, owner-scoped reconciliation RPC and an explicit integration contract are ready.                                                                                                                                                                                                                                                   | No task or unattended synchronization is enabled. An interactive test and two scheduled Finances→Supabase cycles, including observed approval behavior, are required.                                                                 |

## Automated verification

- **20 database/API integration tests passed** against actual Supabase Auth, PostgREST and PostgreSQL 17.
- **7 domain tests passed**: date/timezone boundaries, exact integer cents, honest confidence/availability, enrollment/eligibility suppression and stale/future coverage.
- **15 browser tests passed**: five end-to-end stories each in Chromium at 1440×1000, Chromium at 375×812, and WebKit at 375×812. These exercise real authenticated writes and read-back, with no mocked financial API or fake production data.
- Accessibility checks on login, overview and card-identity dialog passed the automated WCAG 2 A/AA and WCAG 2.1 AA rules used by axe. This is a scoped automated check, not a claim of full manual accessibility certification.
- TypeScript check, ESLint and Next.js optimized production build passed.
- The same **15 browser tests also passed against the locally served optimized production build** on port 3011, including session isolation and accessibility checks.
- Supabase security advisor: **No issues found**. Performance advisor at warning level: **No issues found**.
- Production dependency audit: **0 vulnerabilities reported** at the time of the check.
- Browser bundle scan found no local Supabase secret/service-role credentials.
- All three migrations were listed as applied to the isolated local database. No hosted migrations were run.

The test data is explicitly synthetic and belongs to isolated test accounts. User accounts begin with an empty ledger, then add only the supplied seven-card list on request. Browser screenshots and diagnostic logs are in ignored `.local/` and `test-results/` directories; no credentials or traces are published.

## Critical cases exercised

- Unauthenticated reads denied; another authenticated owner cannot read any of the six tables or balance view, forge a parent relationship, reassign ownership, or append evidence to someone else's period.
- October→November and December→January preserve row IDs, prior evidence and rule snapshots. July 1 resets semiannual benefits. March anniversaries and leap-day clamping are tested. The issuer-local date flips at midnight, not at UTC midnight.
- Custom and one-time windows use explicit dates without inheriting the card's anniversary. Unknown anniversaries are rejected. Forged boundaries and allowance edits are rejected.
- A midyear term revision preserves the old annual period snapshot and creates a new rule version. A partial effective window has an unknown allowance.
- Concurrent duplicate imports converge on one evidence row. Reused evidence keys with changed payloads fail. Changed reconciliation inputs require a new run key.
- Purchases remain candidates; inference cannot confirm a redemption. Confirmed evidence can supersede a candidate without duplicating its value. Partial credits, late posting, negative reversals and unit-based benefits are tested.
- User-confirmed evidence cannot be silently superseded by imports. Corrections remain linked and auditable; evidence update/delete is not granted to the app.
- Failed reconciliation rolls back its evidence/coverage writes but preserves the failure record. Future coverage is rejected. Missing/partial/stale history never becomes a confident unused balance.
- Browser refresh reflects external database changes. Notes, rejections and corrections survive reload and appear in history. Signing out and signing in as another user produces an isolated empty ledger.
- The manifest is installable, responsive pages do not overflow at tested widths, and the service-worker cache includes only public icons and the offline reconnect page.

## Manual preview

The development server remains available at **http://127.0.0.1:3017**, and the correct Perkkeep login page was opened and verified in Chrome. The numeric address matters because `localhost:3000` on this machine resolves to another project over IPv6.

Create a local account from the login screen to start. No existing Supabase project was modified. No hosted project, paid resource, GitHub repository, deployment, recurring task or additional banking connection was created.

## Remaining operational caveats

The catalog is a small verified starting set, not a full survey of every card benefit. Actual entitlements and enrollment remain unverified until the user confirms them. The app creates the current period on load; unopened intervening periods can be added explicitly through the historical-date action. It has no scheduled period-generation job. The local database's durability depends on keeping its native stack data and the user's machine backups; a backup restore test has not been performed. Vercel and physical-device verification remain separate release gates.

## Follow-up: Ink Business cards

Added the user's Chase Ink Business Cash and Chase Ink Business Preferred to their existing local account as unverified cards. Their last-four digits are NULL, not invented. The existing unidentified Chase card record remains unchanged pending confirmation of whether it refers to either Ink card. No benefit rules were enabled.

The fourth forward migration allows unknown last-four digits and gives the two seeded Ink entries stable owner-scoped catalog keys. Re-initialization preserves edits and does not duplicate an already identified Ink product. Card details now support entering or correcting the last four digits, and unknown digits are labeled explicitly throughout the UI. Fresh initialization includes nine cards unless an existing card is already identified as one of the Ink products.

Follow-up checks: 29 database/domain tests passed; six affected browser flows passed across desktop Chromium, phone Chromium and phone WebKit. TypeScript, lint, production build and the Supabase security advisor passed. Earlier full-suite results above describe the initial build.
