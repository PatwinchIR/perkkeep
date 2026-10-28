# PerkKeep: notes for coding agents

Read before working: `docs/brief.md` (goals, rules, phases), `docs/status.md` (current state and next steps), `docs/decisions.md` (every decision so far, with reasons). Also follow `AGENTS.md`: consult `node_modules/next/dist/docs/` before changing Next.js code, because Next.js 16 differs from older versions (for example, `middleware` is now `proxy`).

## Rules that are easy to break

- The owner role bypasses RLS. The app connects only as `perkkeep_app` through `PERKKEEP_DATABASE_URL`, and every request runs inside `withOwner()` (`src/server/db.ts`). Never add a code path that queries without it, and never accept SQL, table names or column lists from the browser: add a named operation in `src/server/ledger.ts` or `src/server/sources/operations.ts`.
- Migrations are append-only files in `db/migrations/`. Never edit an applied file; the runner rejects a changed checksum.
- Transactions, evidence, imports and balance snapshots are append-only. Corrections are new linked rows.
- Real financial data, account identifiers, card digits, connection strings and secrets never go into source, fixtures, docs, logs or Git history. Test data is synthetic and labeled as such.
- No paid charges, Plaid Production Items, credential rotation or force-pushes without the owner's explicit approval.
- Keep financial responses out of the service-worker cache.

## Commands

`npm test` · `npm run test:e2e` · `npm run typecheck` · `npm run lint` · `npm run build` · `npm run check:client` · `npm run local:postgres` (owner's machine) · `bash scripts/cloud-postgres.sh` (cloud container) · `npm run neon:provision`
