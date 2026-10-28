# Architecture

Updated 2026-10-28. PerkKeep runs on Next.js 16 (App Router, TypeScript, Tailwind) on Vercel, with Neon PostgreSQL and Neon Auth. There is no other database or auth provider.

## Request path

Browser (PWA) → fixed server operations (`/api/ledger`, `/api/sources`, `/api/card-art/[id]`) → server-side Neon Auth session check, verified email and owner allowlist (`src/server/access.ts`) → one PostgreSQL transaction as the restricted role `perkkeep_app` with a transaction-local `app.owner_id` (`withOwner` in `src/server/db.ts`) → forced row-level security on every table.

- The browser holds no database credentials and never sends SQL, table names or column lists.
- `perkkeep_app` has no `BYPASSRLS`, is not a superuser and owns nothing; the pool refuses to serve if any of that is false.
- The Neon owner role is used only by `scripts/db-migrate.mjs` and `scripts/neon-provision.mjs`.
- PerkKeep's tables live in their own database (`perkkeep`) in the Neon project; Neon Auth keeps its own tables in `neondb`.

## Layers (brief section 3)

| Layer                                                                                         | Where                                                                               |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Sources: SimpleFIN, Plaid Sandbox, CSV                                                        | `src/server/sources/`                                                               |
| Data: accounts, append-only transactions, balance snapshots, coverage, holdings (schema only) | `db/migrations/0002_sources.sql`                                                    |
| Ledger: cards, versioned benefit rules, periods, append-only evidence, audit                  | `db/migrations/0001_ledger.sql`                                                     |
| Card art (private images)                                                                     | `db/migrations/0003_card_art.sql`, `src/server/card-art.ts`, `data/card-faces.json` |
| Knowledge layer, matchers, recommender, MCP                                                   | Phase 2 and later                                                                   |

## Data integrity

- Ownership is on every table; composite foreign keys prevent cross-owner parent references.
- Periods use issuer-local `[start, end)` dates. Periods and their rule snapshots are never reset; each reset inserts a new period.
- Benefit rules are versioned by effective dates; existing snapshots stay immutable. Mid-period changes suppress the allowance instead of prorating it.
- Evidence and transactions are append-only. Corrections supersede an earlier row in a single linear chain; imports cannot supersede the owner's own evidence.
- Confirmed and candidate amounts are separate. Refunds and reversals affect confirmed use only when the entitlement reversal is confirmed.
- Idempotency keys reused with changed content are rejected, not overwritten.
- Coverage is recorded separately from evidence and advances only on a successful sync. Unknown, partial and stale coverage never produces an "unused" balance.

## Files

`db/migrations` (schema, policies, functions) · `src/server` (database, auth, operations, sources, card art) · `src/app` and `src/components` (PWA) · `src/lib` (shared types and date, status and coverage rules) · `tests` (unit, database and browser tests) · `scripts` (local PostgreSQL, migrations, Neon provisioning and inspection, secret scan) · `docs` (brief, status, decisions, reports, deployment).
