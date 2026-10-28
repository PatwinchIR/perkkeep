# Benefit rules (knowledge layer)

One file per card product. These are reviewable data, not entitlements: owning a card does not prove you hold any rule's version, and nothing here is enabled automatically. You confirm each benefit on the card's page before PerkKeep tracks it.

Each rule records:

- `id`: stable rule identifier. `version`: the date the terms were read; a change in terms is a new version, never an edit.
- `name`, `period` (`monthly`, `quarterly`, `semiannual`, `calendar_year`, `cardmember_year`, `one_time`, `custom`), and `amount_cents` or `units` with `unit_label`.
- `enrollment_required`, `eligibility_notes`, `source_url`, `checked_on`.
- `effective_from` and `effective_to`: the issuer's dates, or `null` where the issuer does not publish them. `effective_to` is exclusive (the day after an issuer's "through" date), matching the ledger's `[start, end)` periods. `checked_on` is never used as an effective date.
- `verified`: `true` only when the amount, period and enrollment were read on the issuer's own page on `checked_on`.
- `manual`: `true` when use cannot appear as a card statement credit (for example, Uber Cash spent in the Uber app).
- `matching`: deterministic hints for the transaction matcher.
  - `credit_patterns` match the issuer's statement credit description.
  - `purchase_patterns` match qualifying purchases.
  - While `patterns_verified` is `false`, matches are only candidates for your review. Set it to `true` once a real statement has shown the pattern is right, and matched credits then count as confirmed issuer credits. Record the date in `patterns_verified_on` and the statement wording in `observed_descriptor` (no amounts or account details).

Products with an empty `rules` list and `researched: false` have not been researched yet. That does not mean they have no benefits. A researched product with an empty `rules` list (Prime Visa) has no trackable allowance; its earn rates and protections are in `research/`.

## `research/`

One file per product with the full research behind the rules: earn rates with caps, protections with coverage limits, fees, status perks, product version notes and every source with its read date. This is the input for the Phase 3 recommender and for terms maintenance. Each benefit there carries `verified` and `verification_note`; `verified: true` means the fact was read on the issuer's own domain on the stated date. Nothing in `research/` is loaded by the app.

## Maintenance

A scheduled task re-reads every `source_url` monthly, compares the terms against `research/`, and opens a pull request that bumps `version` and `checked_on` on changed rules. The owner reviews and merges; the app's terms-drift alerts then offer "Review and save a new version" on each affected benefit. No rule changes without that review.
