# Perkkeep

A private home for credit-card benefits. Built with Next.js App Router, TypeScript, Tailwind, PostgreSQL (Neon in production), Neon managed auth and Vercel.

**Local preview: http://127.0.0.1:3017**. Browser tests start their own Perkkeep server and refuse to reuse an occupied port.

Your ledger describes the last recorded reconciliation, not a live bank balance. All historical periods, rule snapshots and evidence corrections are retained.

## Project context

PerkKeep is the owner's personal credit-card benefits tracker. The goal is daily use with no manual checks of issuer portals: which benefits exist, which are enrolled, how much is used and remains, when each expires, and how reliable that information is. Transactions from SimpleFIN (Plaid as a backup, CSV for history) help match benefit use. A card recommender, a browser extension and finance chat over MCP come later, behind gates.

- [Engineering brief](docs/brief.md): mission, priorities, autonomy rules, architecture, phases and gates, constraints.
- [Status and next steps](docs/status.md): what is done, what is next, and how to work in a cloud container.
- [Decisions](docs/decisions.md): every decision made without asking, and the assumptions verified so far.
- [Architecture](docs/architecture.md), [deployment](docs/deployment.md), and the phase reports in [docs/reports](docs/reports/).

## How data is protected

- The browser never talks to the database. It calls a fixed set of server operations (`/api/ledger`). The server verifies the session, requires a verified email on the owner allowlist, and only then opens a transaction.
- Each transaction runs as the restricted `perkkeep_app` role, which has no `BYPASSRLS` and owns nothing. The owner's identity is a transaction-local setting, and row-level security policies on every table use it.
- The database owner role is used only for migrations. The app refuses to start on a connection that could bypass row-level security, and the Vercel build guard rejects unsafe configuration.

See [architecture](docs/architecture.md), [decisions](docs/decisions.md) and the [Phase 0 report](docs/reports/phase-0.md).

## Start locally

Use Node 24 LTS (see `.nvmrc`) and a local PostgreSQL 16 or newer server. In a Claude Code cloud container, run `bash scripts/cloud-postgres.sh` instead of the `local:postgres` line below.

```sh
git clone https://github.com/PatwinchIR/perkkeep.git
cd perkkeep
npm ci
PERKKEEP_LOCAL_ADMIN_URL=postgresql://postgres@127.0.0.1:5432/postgres npm run local:postgres
npm run dev
```

`local:postgres` reproduces Neon's role model on your local server: a non-superuser owner role with `BYPASSRLS` that runs migrations, and the restricted `perkkeep_app` role that serves the app. It creates `perkkeep_local` for development and `perkkeep_test` for synthetic test owners. It never drops or resets anything. Connection details go to ignored `.local/postgres.json` and `.env.local`. Local development uses a synthetic, password-less sign-in that works only against a local database and never on Vercel.

## Verify

```sh
npm test
npm run typecheck
npm run lint
npm run test:e2e
npm run build
npm run check:client
```

Database tests run as the restricted role against the local `perkkeep_test` database. Browser tests cover desktop Chromium, 375px Chromium and 375px WebKit, plus HTTP-level checks of the session, origin and ownership boundaries. All fixtures are synthetic.

## Hosted setup

See [deployment](docs/deployment.md). In short: `npm run neon:provision -- --vercel --owner-email you@example.com` on the owner's machine applies the migrations to Neon, provisions the restricted role, and stores the server-only Vercel variables without printing them.

## Structure

- `db/migrations/`: PostgreSQL schema, ownership policies, immutable snapshots, correction ledger, transactional reconciliation, audit triggers, append-only source transactions, private card art, append-only alert acknowledgements and alert settings.
- `data/card-faces.json`: public card face layout (placeholder colors, allowlisted issuer image URLs, cover bands and text positions).
- `src/server/`: database pool, session verification, owner access checks, the fixed ledger operations, source adapters (SimpleFIN, Plaid Sandbox, CSV) and card image normalization.
- `src/app/api/`: ledger, session and auth routes.
- `src/lib/`: shared types, date, status and coverage calculations, the rule-file catalog, the alert and progress engine (`alerts.ts`) and the browser API client.
- `src/components/`: app shell, dashboard, cards, review, history, settings and forms.
- `public/`: install icons and an offline reconnect page. No financial responses or authenticated pages are cached.
- `tests/`: unit, database and browser tests.
