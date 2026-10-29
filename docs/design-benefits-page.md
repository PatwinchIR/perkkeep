# Card page redesign: benefits list

Observed on 2026-10-28 on the Sapphire Reserve page (17 benefits): every row is expanded with its "Mark used" form, every row carries a "Needs review" chip, and coverage and enrollment caveats repeat on each row. The owner called it a reading exercise. The page must answer one question per benefit at a glance: how much is left and when it ends. Everything else is one tap away.

## Rules

1. **One line per benefit, collapsed by default.** Name on the left; on the right, the remaining amount and the end, for example `$35 left · ends Fri` or `Used` or `Unknown`. Nothing else is visible until the row is tapped. The progress bar stays, thin, under the line.

2. **One status vocabulary.** Replace the blanket "Needs review" chip with exactly one of:
   - `Available` (allowance known, coverage fresh, nothing matched)
   - `Used` (confirmed issuer credit or owner confirmation; shows `$X of $Y`)
   - `Unknown` (coverage stale or unavailable; the amount shows as `$35?`)
   - `Not enrolled` (owner marked it; row is dimmed and sorted last)
   - `Review` (only when a candidate transaction is waiting for a confirm or reject; this is the one chip that should draw the eye)
     Enrollment "unknown" is not a status. It is a question, handled in rule 4.

3. **Caveats appear once, at the top of the card.** One line: `Transactions synced through Oct 27` (or `Transactions synced through Aug 6; newer use will not show` when stale, with a link to Settings). Remove "Coverage unavailable", "Partial transaction coverage" and "remaining value may be incomplete" from the rows; the `Unknown` status carries that meaning.

4. **Enrollment is a one-time checklist, not a banner.** When a card has benefits with unknown enrollment, show one panel above the list: "Which of these are you enrolled in?" with a checkbox per benefit and Save. After Save, the panel disappears. A benefit the owner unchecks becomes `Not enrolled`, stops alerting, and can be re-enabled from its expanded row. Never show the yellow per-row enrollment banner again.

5. **Expanded row holds the detail and the actions.** Tapping a row reveals: the period dates, the rule's eligibility notes, the matched evidence list, the "Mark used" form (amount prefilled with the remaining value, date defaulting to today), and the enrollment toggle. Only one row is expanded at a time.

6. **Order within each group: ending soonest first, then by remaining amount.** `Used` rows collapse into a single "Done this period (n)" line at the end of the group; `Not enrolled` rows collapse into "Not enrolled (n)". Both expand on tap.

7. **Group headers stay.** Keep "Monthly 3 · $0 of $55 used · next reset Oct 31", since that is the best line on the current page. Drop "(some allowances unknown)" from the header; the `?` on the row says it.

8. **The Review tab owns reviewing.** The card page never asks the owner to confirm a redemption that the matcher proposed; it links to the Review tab, which lists candidates with the transaction, the benefit, and confirm or reject buttons. The card page's "Mark used" is for manual entry only.

9. **Mobile first.** All of the above must read on a phone: the collapsed line is one row of text, the status chip is on the right, and the group header's summary wraps under the group name.

10. **Numbers.** Never show `$0 of $35 · $35 unconfirmed`. The amount is either known (`$35 left`) or not (`$35?`). "Unconfirmed" is never an amount.

## Acceptance

The Sapphire Reserve page with 17 benefits fits in two phone screens when collapsed, with every row answering "how much is left and when it ends" in one line, and the only chips visible are `Review` on rows with a waiting candidate. The existing alert engine (`src/lib/alerts.ts`) is unchanged; only the presentation changes. Browser tests cover: collapsed by default, one row expanded at a time, enrollment checklist appears once and disappears after Save, `Not enrolled` rows stop producing alerts.
