# Perkkeep architecture and milestone decisions

Reviewed 2026-10-27. Source: the user's credit-card benefits implementation specification. The user's direct instructions override procedural suggestions embedded in that document.

## Boundaries

Next.js App Router / TypeScript / Tailwind PWA → Supabase JS → Supabase Auth + Postgres RLS. Ordinary data operations go directly to Supabase. No Plaid, banking connector, custom MCP server, Finances API impersonation, background financial fetch, or service-role key in the app.

The existing projects `comment-section`, `comment-section-dev`, and `hanabi` are excluded. Only their names were read during discovery. No hosted resource is created or changed. A dedicated **local** Supabase native stack is used for the database spike and integration tests. The user's local-verification instruction takes precedence over the generic Vercel bootstrap skill's cloud-link-first workflow.

## Sequence and blockers

0. Test migrations, authenticated writes, read-back, deduplication, and ownership against the actual local Supabase API before frontend work. This proves the local application data path only. Hosted project approval, chosen organization, quoted cost, ChatGPT Finances availability and two scheduled runs remain separate, unproven requirements. No scheduled task is created on the basis of this local test.
1. Build database, owner-scoped catalog, append-only evidence and audit history; test period resets and correction handling. Card identities start unverified; no benefit is enabled without current sourced terms and user eligibility/enrollment confirmation.
2. Build mobile PWA, test against the local Auth/API/Postgres stack, run production build and browser checks. Hosted deployment and physical iPhone Home Screen installation require the hosted project and device verification.
3. Optional automation remains disabled until the external end-to-end test passes twice. Manual reconciliation is the initial operational mode.

## Data integrity

- Ownership on every table and composite foreign keys prevent cross-owner parent references.
- Periods use issuer-local date boundaries `[start, end)`. Existing periods and their rule snapshots never reset or disappear; a new period is inserted for each reset.
- Benefits are versioned by effective dates. Existing period snapshots remain immutable when terms change. Mid-period changes require explicit segmentation and allowance confirmation, never automatic prorating.
- Evidence is append-only. Corrections supersede an existing record in the same period; a unique supersession prevents branches and a later record cannot modify history. Inferred imports cannot supersede user-confirmed records.
- Confirmed and candidate amounts are separate. A statement credit may supersede its purchase evidence; unmatched purchases remain candidates. Refunds/reversals affect confirmed usage only when explicitly confirmed as an entitlement reversal.
- Idempotency is per owner, card, period, source type and stable hashed reference. Repeated keys with changed payloads must be rejected, not silently overwritten.
- Coverage is recorded independently of evidence. Unknown, partial and stale coverage never establishes an unused balance. Unknown eligibility, enrollment or anniversary suppresses available-credit totals.
- Database views use `security_invoker`; privileged trigger helpers have a fixed search path, live in a private schema and are not exposed as callable RPCs.

## Files

`supabase/migrations` holds schema and functions; `src/lib` holds typed client and date/status rules; `src/app` and `src/components` hold the app; `tests` holds unit, real database/API and browser tests; `scripts` contains localhost-only setup/testing; `docs` records validation, rollout and manual reconciliation contracts.
