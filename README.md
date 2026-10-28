# Perkkeep

A private home for credit-card benefits. Built with Next.js App Router, TypeScript, Tailwind, Supabase Auth/Postgres, and Vercel deployment configuration.

**Local preview: http://127.0.0.1:3017**. Browser tests start their own Perkkeep server and refuse to reuse an occupied port.

No Plaid integration or direct ChatGPT Finances access is included. Your ledger describes the last recorded reconciliation, not a live bank balance. All historical periods, rule snapshots and evidence corrections are retained.

## First visit

1. Open the local preview and choose **First visit? Create a local account**. Local Auth stores the account in the dedicated local Supabase database; no real email is sent by the local mail service.
2. Choose **Set up my cards**. This includes Amex Gold, Chase Sapphire Reserve, Freedom Flex, Freedom Unlimited, Prime Visa, Discover it, Ink Business Cash, and Ink Business Preferred, plus an unidentified Chase record. Identities remain unverified and no benefits are assumed. All cards start without last-four digits; enter your own in card details.
3. Open a card and confirm its product, status, issuer timezone and optional anniversary with the issuer.
4. Add a benefit from a sourced catalog draft or your verified issuer terms. Confirm effective dates, eligibility and enrollment. A partial effective window has an unknown allowance instead of an invented prorated amount.
5. Record candidate purchases or confirmed redemptions. Purchases cannot be marked issuer-confirmed. Review a candidate to append its confirmation or rejection. Refunds/reversals reduce usage only when entitlement reversal is explicitly verified.
6. In Settings, record the periods and coverage of a manual reconciliation. Only eligible, monetary benefits with recent complete coverage enter **Known available**. Candidate purchases never reduce that figure.

## Start locally

Use Node 24 LTS (see `.nvmrc`). The installed Supabase CLI is pinned in this project. A native local runtime is supported on Apple-silicon macOS 14+ and supported Linux platforms; Docker is an alternative. No cloud linking or provisioning is required.

```sh
git clone https://github.com/PatwinchIR/perkkeep.git
cd perkkeep
npm ci
npm run local:start
npm run db:migrate
npm run local:env
npm run dev
```

Open `http://127.0.0.1:3017`. If you need another port, update the local Auth redirect allowlist, Playwright base URL and dev/start scripts together. Local Supabase assigns its own API/database ports. `local:env` captures the actual ports and saves only the **publishable** key and API URL into `.env.local`. Test-only privileged credentials stay in ignored `.local/supabase.json` with owner-only permissions. No privileged key is needed by the app.

Stop the local database with `npm run local:stop`; stop the app with Ctrl-C in its terminal. Stopping preserves data. **Do not use database reset or destroy commands on a workspace containing records you want to keep.** Apply forward migrations with `db:migrate` instead.

## Verify

The database tests use the **real local Supabase Auth, Data API and PostgreSQL**, not a mocked database. They run before frontend verification. Synthetic fixtures are explicitly labeled, belong to separate randomly created test accounts and are never seeded into a user's account. Tests refuse a non-local Supabase URL.

```sh
npm run test:db
npm test
npm run typecheck
npm run lint
npm run db:advisors
npx playwright install chromium webkit
npm run test:e2e
npm run build
npm run check:client
```

Browser tests exercise 375px Chromium, 375px WebKit and desktop Chromium with actual Auth and database writes. They include accessibility audits and verify that the service-worker cache contains only public icons and the offline page. Native iPhone installation still needs a physical-device check at the eventual HTTPS deployment.

See [verification](docs/verification.md) for observed outcomes and [architecture](docs/architecture.md) for design decisions.

## Structure

- `supabase/migrations/`: versioned tables, ownership policies, immutable snapshots, correction ledger, transactional reconciliation and audit triggers.
- `src/lib/`: generated database types, date/status/coverage calculations, catalog and direct Supabase client.
- `src/components/`: authenticated app shell, dashboard, cards, review, history, settings and forms.
- `src/app/`: App Router pages, metadata and PWA manifest.
- `public/`: install icons and an offline reconnect page. No financial responses or authenticated pages are cached.
- `tests/`: unit tests, local API/database integration tests, browser flows and accessibility checks.
- `docs/`: milestone report, sourced catalog, reconciliation contract and deployment runbook.

## Hosted release is in progress

The local app currently uses Supabase. A dedicated Vercel Hobby project and Neon Free database have been provisioned for the hosted version. The Neon application connection, hosted authentication and deployment are not yet complete. The included Neon dependencies are preparation for that work, not a working hosted integration.

Existing unrelated projects were not modified. No paid upgrade was enabled. The current build still requires a dedicated Supabase HTTPS URL and publishable key when running on Vercel; this guard must be replaced as part of the Neon migration.

See [deployment](docs/deployment.md) and [verification](docs/verification-2026-10-28.md). Local accounts and records do not automatically migrate to the hosted project. Credentials, local database contents, financial records and browser traces are excluded from this public source repository.

Finances reconciliation and scheduled tasks remain unproven. See [reconciliation](docs/reconciliation.md). No scheduled task, unattended sync, banking connection or background financial worker has been created.
