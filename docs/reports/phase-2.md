# Phase 2 report (in progress): review queue, alerts and progress

Date: 2026-10-28. Branch: `claude/serene-lovelace-hhlh6k` (draft pull request PatwinchIR/perkkeep#4), based on `main` at `7c282d9` and merged with `main` at `6470d62` (card add, remove and restore).

**Status:** the PWA half of Phase 2 is built and verified with synthetic data: a review queue and in-app alerts derived from the ledger, progress bars per benefit window, inline entry of partial use, and one-click confirmation of enrollment and eligibility. The matcher and rule files from the earlier Phase 2 session are unchanged. The Phase 2 gate (the owner reports that the PWA answers the six questions in brief section 1 for every card without a portal check) is **not yet claimed**: it needs the owner's own use, verified credit patterns on real statements, and the MCP endpoint, which is not built.

## 1. Deployed URL and commit

- Deployed URL: none from this branch. Production (https://perkkeep.vercel.app) still runs `main`.
- Commit: the head of `claude/serene-lovelace-hhlh6k`.

## 2. Tests run and results

All data is **synthetic**: random test owners in the local `perkkeep_test` database, synthetic cards, rules and evidence. No real account, transaction or benefit was read or written.

| Check                                                                                                 | Result                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline on `main` after `bash scripts/cloud-postgres.sh` (unit, database, matcher, source, card art) | 57/57 passed on PostgreSQL 16 as `perkkeep_app`, with migration 0005 applied                                                                                                                                                                                         |
| New alert and progress engine (`tests/alerts.test.ts`)                                                | 13/13 passed: progress fractions and time left, every attention kind, activity ordering, acknowledgement keys, grouping totals, term differences                                                                                                                     |
| New database cases for migration 0005 (`tests/database.test.ts`)                                      | 4/4 passed: append-only private acknowledgements with audit rows; settings bounds; re-verification rules; one-time capped allowance confirmation                                                                                                                     |
| Full `npm test`                                                                                       | 77/77 passed, including main's 3 card-lifecycle cases                                                                                                                                                                                                                |
| Browser tests, desktop Chromium and 375px Chromium (`npm run test:e2e`)                               | 24 passed and 4 skipped (the HTTP security checks run on the desktop project only), including the reworked evidence flow (full form, inline "Mark used", candidate review under the row, rejection, note, history) and the WCAG audits of the overview and card page |
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

1. ~~Apply migration 0005 to Neon.~~ Done by the owner on 2026-10-28 at 22:03 UTC with `npm run neon:migrate`; verified over port 443 (migration recorded, tables and functions present). The deployed code ran without it until then (D52): alerts, progress rows and use entry work, and the top bar names the pending migration until dismissing alerts, alert settings, re-verification and allowance confirmation can be enabled. On your Mac, inside the project folder on `main`: `npm ci && npm run neon:migrate` (D51, over port 443; it reads `.local/neon.production.env` or `.local/neon.https.env`). It applies only the migrations Neon has not seen (0005 here) and changes nothing else. Do not use `neon:provision` for this: it rotates the `perkkeep_app` password on every run, and Vercel keeps the old one. The cloud container's sandbox refused to run the migration.
2. **Use it for a week.** Say whether the overview and card pages now answer, for every card: which benefits exist, which are enrolled, how much is used, how much remains, when each expires, and how reliable that is. That report is the Phase 2 gate.
3. **Verify the remaining credit patterns** (Gold dining, Dunkin', Resy; Sapphire Reserve The Edit, Exclusive Tables, StubHub) on real statements, then set `patterns_verified` in `data/benefits` (D36). Until then those benefits keep partial coverage and their remaining value shows as unconfirmed.
4. **Sapphire Reserve anniversary date**, still open from the Phase 1 status, so the travel credit's cardmember year is exact.

## 6. Decisions made without asking

D45 to D50 in [decisions.md](../decisions.md): derived alerts with append-only acknowledgements; compact rows grouped by reset timeframe; inline partial use with a default note; one-time capped allowance confirmation; terms drift against rule-file versions with a 180-day re-check default; lead days as the only stored preference, in-app only.

## 7. Known gaps and fallbacks

| Gap                                                                    | Fallback                                                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| No push notifications; alerts appear only when the app is opened       | The Review tab shows a count on every load, and the app refreshes on focus and every minute while open.          |
| MCP endpoint and AI proposals not built                                | The deterministic matcher and the review queue cover statement credits; anything else is entered on the row.     |
| All eight products are researched (D54); some rules still need dates   | Custom-window rules carry an assumed start where no transaction shows one (D55); correct it on the card page.    |
| The 180-day re-check interval is a default, not an issuer-derived fact | "Terms unchanged today" clears it in one click; change the constant in `src/lib/alerts.ts` if it nags too often. |
| WebKit phone tests not run in the agent container                      | Run `npx playwright install webkit` and `npm run test:e2e` locally.                                              |

## Copilot Money backfill (2026-10-28)

- The owner exported every account from Copilot Money. The file is real financial data and stays outside the repository; only the layout (D53) and this summary are recorded.
- Layout: `date,name,amount,status,category,parent category,excluded,tags,type,account,account mask,note,recurring`; spending positive, credits negative; `type` marks transfers between the owner's accounts; `status` marks pending rows. Copilot rewrites merchant names in title case and drops most Chase statement credits: of the twelve `TRAVEL CREDIT $300/YEAR` lines the SimpleFIN sync holds for September 2026, the export has one.
- Import: nine exported card accounts matched cards by their last four digits (the four Chase accounts share one export name and differ only by digits). Each landed in its own CSV account linked to the card, with rows from 2026-07-31 on left to the SimpleFIN account. Bank accounts, a closed card and accounts without digits were skipped and listed.
- Anniversaries: the Sapphire Reserve renewal fee posted 2026-09-01 and the new year's travel credits began 2026-08-28 and reached exactly $300 by 2026-09-12, so the anchor is 2026-08-28 (the open date may fall between 2026-08-08 and 2026-08-28; the card page can correct it). The Gold renewal fee posted on 3 July in 2023, 2024 and 2026, so its anchor is 2026-07-03.
- Result: 13 confirmed credits. Sapphire Reserve annual travel credit, 2026-08-28 to 2027-08-28: $300 of $300 used, coverage complete. Exclusive Tables dining credit, first half of 2026: $150 of $150 used, coverage complete. The `dining credit` and `stubhub` patterns are verified from the export's wording. Nothing else in 2026 matched: the export holds no Gold dining, Dunkin' or Resy credit, and Lyft, DoorDash and Uber Cash are in-app credits that statements cannot show.

## Researched benefits added in production (2026-10-28, third session)

- PatwinchIR/perkkeep#7 (benefits research for all eight products) was merged into `main` through the REST API after main was merged into it. Both branches had added a decision D53; main's (Copilot Money import) is referenced from code, so the research decision became D54. 80/80 tests, typecheck and lint passed on the merged tree on a local PostgreSQL 16. Vercel deployed `main` to production and the deployment is Ready.
- Production check over port 443: all five migrations are recorded, and `perkkeep_app` has no BYPASSRLS.
- `npm run neon:reconcile -- --add-researched` plus ten `--op createBenefit` inputs ran in one transaction as `perkkeep_app` with the owner's identity, after an identical dry run.

| Card                    | Added | Total now | How                                                                            |
| ----------------------- | ----- | --------- | ------------------------------------------------------------------------------ |
| Sapphire Reserve        | 10    | 17        | 1 by `addResearchedBenefits`, 9 custom windows (D55)                           |
| Freedom Flex            | 2     | 2         | `addResearchedBenefits`                                                        |
| Gold                    | 1     | 5         | `addResearchedBenefits`                                                        |
| Freedom Unlimited       | 1     | 1         | `addResearchedBenefits`                                                        |
| Ink Business Cash       | 1     | 1         | `addResearchedBenefits`                                                        |
| Ink Business Preferred  | 1     | 1         | `createBenefit`, because the confirmed card has no catalog key                 |
| Discover it, Prime Visa | 0     | 0         | Discover's Q4 categories are unverified; Prime Visa has no trackable allowance |

- Dates from transactions: the Sapphire Reserve $75,000 tier (The Shops at Chase credit, Southwest $500 credit, Southwest A-List, World of Hyatt Explorist, IHG Diamond Elite) starts 2026-10-23, when recorded 2026 purchases passed $75,000. The Shops at Chase credit of $250 on 2026-10-26 confirms it and is now matched as fully used. If spend is missing from the history (August 2026 shows little), the true start is earlier; the end dates do not change.
- Assumed dates (2026-10-28, need the owner's confirmation): Global Entry, TSA PreCheck or NEXUS credit (window to 2030-10-28); Apple TV and Apple Music (to 2027-10-28); DashPass (to 2030-01-01); IHG Platinum Elite (to 2028-01-01).
- Not added: Gold's Hotel Collection credit and the six-month DashPass on both Freedom cards (custom windows outside Sapphire Reserve). Ink Business Preferred's welcome offer waited for the owner to match the approval terms; it was added later the same day (next section).
- The monthly terms-check task from [maintenance](../maintenance.md) was created as a desktop app task on the owner's Mac. Its prompt assumes a cloud session (`add_repo`, `/home/claude`), so the first run on 2026-11-01 should be watched.

## Owner confirmations applied (2026-10-28, fourth session)

- The owner identified the unidentified Chase business account as Ink Business Cash. Its SimpleFIN account and Copilot export were already linked to the Ink Business Cash card, so no mapping changed.
- The owner confirmed that the Ink Business Preferred approval terms match the recorded welcome offer. `createBenefit` added it to the confirmed Ink Business Preferred card: 100,000 points after $8,000 of purchases, a one-time window from 2026-10-27 (the card's anchor date, the account opening) to 2027-01-27. `ensurePeriod` opened the period. Ink Business Preferred now has 2 benefits.
- `archiveCard` archived the "Identify this card" placeholder and the unconfirmed duplicate Ink Business Preferred starter card. Both were empty, and `restoreCard` reverses it.
- Everything ran through `npm run neon:reconcile -- --op ...` as `perkkeep_app` with the owner's identity, after a dry run.
