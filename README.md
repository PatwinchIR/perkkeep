# Perkkeep

A private home for credit-card benefits: which benefits you have, whether you are eligible and enrolled, how much you have used this period, what remains, when it resets, and how reliable that information is.

Built with Next.js App Router, TypeScript and Tailwind, with Neon PostgreSQL and Neon Auth, deployed on Vercel.

**Production: https://perkkeep.vercel.app**

No Plaid integration, bank connection or direct ChatGPT Finances access is included. The ledger describes the last recorded reconciliation, not a live bank balance. All historical periods, rule snapshots and evidence corrections are retained.

## How it fits together

Browser (PWA) → same-origin `/api` routes on Vercel → Neon Auth session check → Neon PostgreSQL with row-level security.

- The browser holds no database credential. It calls `/api/ledger`, `/api/session` and a filtered `/api/auth/*` proxy.
- The server asks Neon Auth to validate the session on every request, requires a verified email on the owner list, and maps the account to an internal UUID.
- Each request runs in its own transaction as the restricted `authenticated` role (no `BYPASSRLS`) with a transaction-local owner ID. The ledger's ownership policies, triggers and functions enforce isolation, append-only evidence, audit history and idempotency.

See [architecture](docs/architecture.md), [deployment](docs/deployment.md), [reconciliation](docs/reconciliation.md) and [verification](docs/verification-2026-10-28.md).

## First visit

1. Open the production URL and choose **First visit? Create the owner account**. Only addresses listed in `PERKKEEP_OWNER_EMAILS` can sign up. Verify your email, then sign in.
2. Choose **Set up my cards**. This adds Amex Gold, Chase Sapphire Reserve, Freedom Flex, Freedom Unlimited, Prime Visa, Discover it, Ink Business Cash, Ink Business Preferred, and one unidentified Chase record. Identities start unverified, with no last-four digits and no assumed benefits.
3. Open a card and confirm its product, status, issuer timezone and optional anniversary with the issuer.
4. Add a benefit from a sourced catalog draft or your verified issuer terms. Confirm effective dates, eligibility and enrollment. A partial effective window has an unknown allowance instead of an invented prorated amount.
5. Record candidate purchases or confirmed redemptions. Purchases cannot be marked issuer-confirmed. Refunds or reversals reduce usage only when an entitlement reversal is explicitly verified.
6. In Settings, record the periods and coverage of a manual reconciliation, or exchange a structured reconciliation with a transaction reviewer. Only eligible monetary benefits with recent complete coverage enter **Known available**.

## Configuration

Server-only variables (see `.env.example`). The Neon–Vercel integration supplies the database and Auth URLs for production.

| Variable                                | Purpose                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Neon connection (pooled for requests, direct for migrations)                   |
| `NEON_AUTH_BASE_URL`                    | Neon Auth endpoint                                                             |
| `NEON_AUTH_COOKIE_SECRET`               | Optional; otherwise derived from `DATABASE_URL`                                |
| `PERKKEEP_OWNER_EMAILS`                 | Comma-separated owner addresses; required for production builds                |
| `PERKKEEP_OWNER_PLUS_ALIASES`           | `allow` to accept `name+tag@` aliases of listed owners as separate test owners |

Neon Auth must list each app origin as a trusted domain (Neon Console → Auth → Configuration), or sign-up and sign-in fail with `INVALID_ORIGIN`.

## Run locally against the remote database

Use Node 24 LTS (see `.nvmrc`).

```sh
npm ci
vercel link --project perkkeep --scope dee-dongs-projects
vercel env pull --environment=production .env.local
npm run dev
```

Open `http://127.0.0.1:3017`. This uses the **production** Neon database and Auth, so records you create are real. Add `http://127.0.0.1:3017` to Neon Auth's trusted domains. Auth cookies use the `__Secure-` prefix; Chromium accepts them on `127.0.0.1`, but Safari requires HTTPS.

Apply migrations with `npm run db:migrate`. Migrations are forward-only and checksummed; an edited, already-applied file is refused. Production Vercel builds apply pending migrations automatically before compiling.

## Verify

```sh
npm run typecheck
npm run lint
npm test                      # domain tests; ledger tests need PERKKEEP_TEST_DATABASE_URL
PERKKEEP_TEST_DATABASE_URL=postgres://owner:pw@127.0.0.1:5432/perkkeep_test npm run test:db
npm run build
npm run check:client
PLAYWRIGHT_BASE_URL=https://perkkeep.vercel.app npm run test:e2e
```

- The ledger suite runs against a disposable **local** PostgreSQL database and refuses any other host. Use a non-superuser owner role with `BYPASSRLS` so it mirrors Neon's default role and proves that the role switch enforces RLS.
- The browser suite runs against the deployment. Signed-in tests need two verified test owners in `PERKKEEP_E2E_OWNER_EMAIL`/`_PASSWORD` and `PERKKEEP_E2E_OTHER_EMAIL`/`_PASSWORD`. All records they write are labeled synthetic, and their test rules are paused afterwards.

## Structure

- `db/migrations/`: ledger tables, ownership policies, immutable snapshots, correction ledger, transactional reconciliation and audit triggers.
- `db/neon/`: Neon platform prelude (roles, `auth.uid()`, identity mapping) and a post-migration hardening check.
- `scripts/`: migration runner, Vercel build entry point and browser-bundle credential check.
- `src/lib/server/`: session verification, owner-scoped transactions and allow-listed ledger operations.
- `src/lib/`: browser API client, operation schemas, date/status/coverage rules and catalog.
- `src/app/api/`: ledger, session and filtered Neon Auth routes.
- `src/components/`, `src/app/`: the mobile-first app.
- `public/`: install icons and an offline reconnect page. No financial responses or authenticated pages are cached.
- `tests/`: domain tests, PostgreSQL ledger tests and hosted browser tests.

Credentials, database exports, environment files and browser traces are excluded from this public repository.

Finances reconciliation and scheduled tasks remain unproven. See [reconciliation](docs/reconciliation.md). No scheduled task, unattended sync, banking connection or background financial worker has been created.
