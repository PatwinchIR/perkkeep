# Phase 2 report (in progress): review queue, alerts and progress

Date: 2026-10-28. Branch: `claude/serene-lovelace-hhlh6k`, based on `main` at `7c282d9`.

**Status:** the PWA half of Phase 2 is built and verified with synthetic data: a review queue and in-app alerts derived from the ledger, progress bars per benefit window, inline entry of partial use, and one-click confirmation of enrollment and eligibility. The matcher and rule files from the earlier Phase 2 session are unchanged. The Phase 2 gate (the owner reports that the PWA answers the six questions in brief section 1 for every card without a portal check) is **not yet claimed**: it needs the owner's own use, verified credit patterns on real statements, and the MCP endpoint, which is not built.

## 1. Deployed URL and commit

- Deployed URL: none from this branch. Production (https://perkkeep.vercel.app) still runs `main`.
- Commit: the head of `claude/serene-lovelace-hhlh6k`.

## 2. Tests run and results

All data is **synthetic**: random test owners in the local `perkkeep_test` database, synthetic cards, rules and evidence. No real account, transaction or benefit was read or written.

| Check                                                                                                 | Result                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline on `main` after `bash scripts/cloud-postgres.sh` (unit, database, matcher, source, card art) | 57/57 passed on PostgreSQL 16 as `perkkeep_app`, with migration 0004 applied                                                                                                                                                                                         |
| New alert and progress engine (`tests/alerts.test.ts`)                                                | 13/13 passed: progress fractions and time left, every attention kind, activity ordering, acknowledgement keys, grouping totals, term differences                                                                                                                     |
| New database cases for migration 0004 (`tests/database.test.ts`)                                      | 4/4 passed: append-only private acknowledgements with audit rows; settings bounds; re-verification rules; one-time capped allowance confirmation                                                                                                                     |
| Full `npm test`                                                                                       | 74/74 passed                                                                                                                                                                                                                                                         |
| Browser tests, desktop Chromium and 375px Chromium (`npm run test:e2e`)                               | 22 passed and 4 skipped (the HTTP security checks run on the desktop project only), including the reworked evidence flow (full form, inline "Mark used", candidate review under the row, rejection, note, history) and the WCAG audits of the overview and card page |
| `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:client`                          | Passed                                                                                                                                                                                                                                                               |
| WebKit phone tests                                                                                    | **Not run.** WebKit is not installed in the agent container.                                                                                                                                                                                                         |

One case was caught by the new database tests before it shipped: `confirm_period_allowance` called with neither an amount nor a unit count only appended the note. The function now refuses that call.

## 3. Security boundaries verified, and how

- **New tables under the same model.** `alert_acknowledgements` and `user_settings` have forced row-level security with owner policies on `app.current_owner()`. Tests show another owner and a connection without an identity read 0 rows, and that acknowledgements accept no `UPDATE` or `DELETE` (no grant). Each acknowledgement writes an audit row through the existing definer trigger.
- **Allowance confirmation is narrow.** The only new write path on `benefit_periods` is a column grant on the two allowance columns guarded by a trigger: it requires an existing `NULL` allowance, a partial rule window in the stored snapshot, exactly one of cents or units, a value no higher than the nominal allowance, and a changed note. Tests exercise each refusal, the one successful confirmation, a second refused confirmation, and another owner's refused call.
- **No new routes, no client SQL.** The five new operations (`markEligible`, `markReverified`, `confirmPeriodAllowance`, `acknowledgeAlert`, `updateSettings`) are named operations validated with zod inside the existing `/api/ledger` transaction. Evidence entered on the row goes through `recordEvidence`, which still forces `recorded_by = user` on the server.
- **Derived alerts hold nothing sensitive.** Alerts are computed in the browser from the snapshot the owner already receives; acknowledgements store only the alert key and the small context the alert carried (ids and counts, never descriptions or amounts from statements beyond what the ledger shows).
- **No secrets.** The client-secret scan of the production build passed.

## 4. What works with real data

Nothing new was run against real data in this session. The derived alerts will read the owner's existing ledger on the first load after deployment; nothing is written until the owner acts.

## 5. Owner inputs still missing

1. **Use it for a week.** Say whether the overview and card pages now answer, for every card: which benefits exist, which are enrolled, how much is used, how much remains, when each expires, and how reliable that is. That report is the Phase 2 gate.
2. **Verify the remaining credit patterns** (Gold dining, Dunkin', Resy; Sapphire Reserve The Edit, Exclusive Tables, StubHub) on real statements, then set `patterns_verified` in `data/benefits` (D36). Until then those benefits keep partial coverage and their remaining value shows as unconfirmed.
3. **Sapphire Reserve anniversary date**, still open from the Phase 1 status, so the travel credit's cardmember year is exact.

## 6. Decisions made without asking

D44 to D49 in [decisions.md](../decisions.md): derived alerts with append-only acknowledgements; compact rows grouped by reset timeframe; inline partial use with a default note; one-time capped allowance confirmation; terms drift against rule-file versions with a 180-day re-check default; lead days as the only stored preference, in-app only.

## 7. Known gaps and fallbacks

| Gap                                                                    | Fallback                                                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| No push notifications; alerts appear only when the app is opened       | The Review tab shows a count on every load, and the app refreshes on focus and every minute while open.          |
| MCP endpoint and AI proposals not built                                | The deterministic matcher and the review queue cover statement credits; anything else is entered on the row.     |
| Six products still have no researched rules                            | "Add benefit" with the issuer's page, as before.                                                                 |
| The 180-day re-check interval is a default, not an issuer-derived fact | "Terms unchanged today" clears it in one click; change the constant in `src/lib/alerts.ts` if it nags too often. |
| WebKit phone tests not run in the agent container                      | Run `npx playwright install webkit` and `npm run test:e2e` locally.                                              |
