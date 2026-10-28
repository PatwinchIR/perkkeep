# Benefit terms maintenance

Nobody re-reads issuer pages by hand. A scheduled Claude task runs monthly, compares every recorded source against `data/benefits/research/`, and opens a pull request that proposes rule updates. The owner reviews and merges. After the merge, the app's terms-drift alerts (D49) offer "Review and save a new version" on each affected benefit, so no balance changes until the owner accepts the new terms in the app.

## The loop

1. Scheduled task (monthly, 1st of the month, morning Eastern): fetch each `source_url`, diff against the research files, scan Gmail for issuer change notices, update the research and rule files, run the test suite, open a pull request with the report as its body.
2. Owner: read the pull request (usually "no changes"), merge when the diff is right. Vercel deploys `main`.
3. App: shows a terms-drift alert for each benefit whose rule version changed; the owner saves the new version from the alert.

Cost: nothing beyond the owner's Claude subscription. Nothing runs against the production database.

## Creating the task

Creation was denied from the coding container (scheduled-task writes are blocked there), so the owner creates it once from a Claude session that allows it, with:

- Name: `PerkKeep benefit terms check`
- Schedule: `CRON_TZ=America/New_York 41 8 1 * *`
- Notifications: push on completion
- Prompt: the text below, verbatim

```
You are the monthly maintenance run for PerkKeep, the owner's personal credit-card benefits tracker (public repo github.com/PatwinchIR/perkkeep). Your only job: find changes in the benefit terms of the owner's cards and open a pull request that proposes the updates. Never merge, never push to main, never change code outside the files named below, never incur paid charges, and never put any account identifier, card digits or secret in the repository.

Steps:
1. Call add_repo for owner "PatwinchIR", repo "perkkeep", access "push", then clone it with `git clone --depth 1 https://github.com/PatwinchIR/perkkeep /home/claude/perkkeep` (generous timeout; one clone only). Read CLAUDE.md, data/benefits/README.md, docs/maintenance.md and docs/decisions.md entry D54.
2. Read every file in data/benefits/research/. For each product, collect the distinct source URLs from `card.sources` and from each benefit's `source_url`.
3. WebFetch each source URL and compare what the page states today against the research file: amounts, period types, enrollment requirements, qualifying merchants, effective and end dates, annual fee, and earn rates and caps. For rotating-category cards (Chase Freedom Flex, Discover it), also fetch the current quarter calendar and record the next quarter's categories if published. If a page is blocked or fails to render, record that in the report and do not guess; try one official alternate (issuer press release or terms PDF) at most. Use secondary sources (The Points Guy, Doctor of Credit, Frequent Miler, NerdWallet) only to detect that something changed, never as the recorded source; if only a secondary source shows a change, record it as an unverified alert in the report, not as a rule change.
4. Search the owner's Gmail (read only; use the Gmail connector's search tool, if available, with queries like "changes to your account terms", "benefit", "annual fee" from chase.com, americanexpress.com, discover.com, received in the last 35 days) for issuer change notices. Summarize any relevant notice in the report by issuer, card, what changes and the effective date, without quoting account numbers. If the Gmail tool is unavailable, say so in the report and continue.
5. For each confirmed change on an issuer domain: update the matching benefit in data/benefits/research/<product>.json (set `read_date` to today, add a `change_note` field describing old versus new and the date observed) and, when a trackable rule in data/benefits/<product>.json is affected, update that rule's fields, set its `version` and `checked_on` to today's date, and keep `patterns_verified`, `patterns_verified_on` and `observed_descriptor` exactly as they were. Never delete a rule; for a discontinued benefit set `effective_to` (exclusive, the day after the issuer's "through" date). When nothing changed for a product, set `read_date` to today in the research file only.
6. Run `npm ci`, `bash scripts/cloud-postgres.sh`, `npm test`, `npm run typecheck`, `npm run lint`, and `npx prettier --write "data/benefits/**/*.json"`. Fix any test that only hardcodes rule counts or names; do not change behavior.
7. Scan staged files for secrets and card digits. Commit on a branch named `claude/terms-check-<YYYY-MM>` and open a pull request against main with the REST API (`gh api repos/PatwinchIR/perkkeep/pulls ...`; GraphQL is unavailable). The PR body is the report: per product, "unchanged", "changed" (with old versus new, source URL and date), or "could not verify" (with the reason); any Gmail change notices found; and the test results. End the body with the Claude Code attribution lines. If nothing changed anywhere and no page failed, still open the PR, since it carries the refreshed read dates, and title it "Terms check <YYYY-MM>: no changes".
8. End with a two-sentence summary for the owner: how many products changed, and the PR link.
```

## What the task cannot do

- It cannot read the owner's logged-in issuer portals, so account-specific changes (enrollment status, anniversary dates, a product change on one account) still come from the owner or from a Claude in Chrome session with the owner present.
- It detects public terms changes within a month of the page changing. Issuers usually send notices earlier than they update public pages, which is why the Gmail scan is part of the run.
- If a run needs an approval it cannot get, the run stops and the push notification says so; the next monthly run picks up where it left off, since each run reads the current repository state.
