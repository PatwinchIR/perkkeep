# Perkkeep architecture

Updated 2026-10-28. The hosted Neon backend replaces the earlier local Supabase stack, which was removed at the owner's request. Ledger rules are unchanged: the same SQL migrations now run on Neon.

## Boundaries

```
Browser PWA ──fetch (same origin, cookies)──▶ Next.js on Vercel
                                               ├─ /api/auth/*  → filtered proxy → Neon Auth
                                               ├─ /api/session → session state only
                                               └─ /api/ledger  → session check → owner transaction → Neon PostgreSQL
```

- The browser has no database URL, Auth secret or owner identifier. `check:client` fails the build check if a database URL or a configured secret appears in browser output.
- No Plaid, banking connector, MCP server, Finances API impersonation, background financial fetch or scheduled job exists.

## Authentication and private owner access

- Neon Auth (managed Better Auth) stores users in the `neon_auth` schema. The SDK's Next.js handler proxies auth calls and sets `__Secure-neon-auth.*` HttpOnly, `SameSite=Lax` cookies.
- The proxy forwards only sign-in, sign-up, sign-out, session, email-verification code, password reset and session revocation endpoints. Admin, organization, social, magic-link and token endpoints return 404.
- Sign-up and verification-code requests are refused unless the email is in `PERKKEEP_OWNER_EMAILS`. `PERKKEEP_OWNER_PLUS_ALIASES=allow` also accepts `name+tag@domain` for a listed `name@domain`. Each alias is a separate owner, which is how isolated test owners are created.
- On every ledger request the server asks Neon Auth to validate the session token (`disableCookieCache`), so sign-out and revocation take effect immediately. The account must have a verified email and an allowed address.
- Neon Auth project configuration (trusted origins, required email verification) lives in `neon_auth.project_config`. See [deployment](deployment.md) for the values in use and how they were set.

## Database access and row-level security

- The server connects with the Neon-provided owner role, which has `BYPASSRLS`. It never serves queries under that privilege. `withOwner()` opens a transaction, maps the Neon Auth user to an internal UUID in `auth.users`, runs `SET LOCAL ROLE authenticated`, sets the transaction-local `perkkeep.user_id`, and asserts that `current_user` is `authenticated`, that the role has no `BYPASSRLS`, and that `auth.uid()` matches before any ledger query.
- `auth.uid()` reads only that transaction-local setting. Without it, every policy denies access. `authenticated` cannot read `auth.users`; `anon` has no privileges, and the server role cannot assume it.
- The request body never carries an owner ID. Only allow-listed operations (`src/lib/ledger-ops.ts`) are accepted, each with a strict schema; unknown fields are rejected. SQL is parameterized. Cross-origin writes are rejected.
- The migration `db/neon/9000_neon_hardening.sql` fails if a restricted role can log in or bypass RLS, if `authenticated` can read identity mappings, or if any public table lacks RLS.

## Data integrity (unchanged ledger rules)

- Ownership on every table, plus composite foreign keys, prevents cross-owner parent references.
- Periods use issuer-local `[start, end)` boundaries. Earlier periods and their rule snapshots are never reset or deleted; each reset inserts a new period.
- Benefits are versioned by effective dates. Mid-period changes require explicit segmentation and never prorate automatically.
- Evidence is append-only. A correction supersedes exactly one earlier record in the same period, and imports cannot supersede user-confirmed records.
- Confirmed and candidate amounts are separate. A credit that supersedes its candidate is counted once. Refunds affect confirmed usage only through an explicitly explained entitlement reversal.
- Idempotency applies per owner, card, period, source type and hashed reference. A repeated key with a changed payload is rejected. Reconciliation runs are keyed by request UUID plus an input digest.
- Coverage is recorded separately from evidence. Unknown, partial or stale coverage never produces a confident unused balance.

## Migrations

`scripts/neon-migrate.mjs` applies `db/neon/0000_*`, then `db/migrations/*`, then `db/neon/9000_*`. Each file and its tracking row commit in one transaction under an advisory lock. Applied files are checksummed, and a changed file is refused. Production Vercel builds run the migrations before `next build`.

## Files

`db/` holds schema and platform SQL, `src/lib/server/` holds the server boundary, `src/lib/` holds shared rules and the browser client, `src/app/api/` holds route handlers, `tests/` holds domain, PostgreSQL and hosted browser tests, and `docs/` holds operations and verification records.
