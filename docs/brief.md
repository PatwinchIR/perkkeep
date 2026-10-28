# PerkKeep engineering brief (living copy)

This is the working copy of the owner's engineering brief (version 2026-10-28), kept in the repository so any session can recover the project's context. It restates the brief's rules and records what was decided and verified since. Private infrastructure identifiers and personal card details are deliberately left out of this public file.

Read with it: [status](status.md) (what is done and what is next), [decisions](decisions.md) (every decision made without asking, plus verified assumptions), [architecture](architecture.md), [deployment](deployment.md), and the phase reports in [reports/](reports/).

## 1. Mission

PerkKeep is a personal credit-card benefits tracker. The owner wants a finished product used daily without manual checks of issuer portals, and a hands-off build: routine decisions are made by the agent and recorded.

Priority order:

1. Trustworthy benefits tracking: which benefits exist, which are enrolled, how much is used, how much remains, when each expires, and how reliable that information is (the "six questions").
2. Transaction-assisted matching, so the owner stops checking issuer portals.
3. A "which card should I use" recommender, in the PWA and a browser extension.
4. Chat over all finances (spending, budgets, balances, holdings) through an MCP endpoint, as a possible replacement for Copilot Money.
5. Native iOS and public open-source release polish.

Items 1 and 2 are the goal. Items 3 to 5 wait behind the gates in section 9.

## 2. Autonomy rules

Proceed without asking when the decision is reversible or costs less than a day to redo, when the brief already decides it, when choosing between equally acceptable implementations (record the choice in `decisions.md`), or when fixing failing tests, builds or dependency conflicts.

Stop and ask only when:

- an action would incur any paid charge, or require the owner to pay (SimpleFIN, Plaid upgrade, Apple Developer Program, domain, Vercel or Neon upgrade);
- an action is irreversible and could reasonably go either way (deleting ledger data, force-pushing, rotating credentials, changing the public repository's history);
- real financial data would leave the owner's infrastructure for a destination not named in the brief;
- a required input exists only on the owner's side (section 10). Continue with synthetic fixtures meanwhile; never block.

When stopping, state the decision in one paragraph with a recommended default, then continue with unblocked work. Never ask for stylistic or architectural preferences, and never ask whether to proceed with a phase whose gate is met.

## 3. Architecture

```
SOURCES          SimpleFIN adapter · Plaid adapter (backup) · CSV import · manual entry
DATA LAYER       accounts · transactions (append-only) · balance snapshots · holdings (schema only)
KNOWLEDGE LAYER  card products · versioned benefit rules · earn rates · user valuation config
ENGINES          benefit matcher (deterministic rules + AI proposals) · card recommender (pure function)
INTERFACES       PWA · MCP endpoint (Claude / ChatGPT) · browser extension · iOS (later)
```

Each layer calls only the layer below it. The data layer stores all accounts, not only cards.

As built (see [architecture](architecture.md)): Next.js 16 App Router PWA → fixed server operations (`/api/ledger`, `/api/sources`, `/api/card-art/[id]`) → server-side Neon Auth session check, verified email and owner allowlist → one PostgreSQL transaction as the restricted role `perkkeep_app` with a transaction-local `app.owner_id` → forced row-level security on every table.

## 4. Decisions already made (do not re-open)

| Topic                      | Decision                                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hosting                    | Vercel Hobby (project `perkkeep`) and Neon Free, already attached.                                                                                                                                                             |
| Auth                       | Neon managed auth, server-side session verification, private owner access only.                                                                                                                                                |
| Database access            | Restricted role with RLS and transaction-local identity. The owner role has `BYPASSRLS`; never serve user queries under it.                                                                                                    |
| Primary transaction source | SimpleFIN Bridge, through a pluggable source adapter.                                                                                                                                                                          |
| Backup source              | Plaid Trial (free, 10 lifetime Production Items). Sandbox only until the owner decides.                                                                                                                                        |
| Excluded sources           | Era Context, ChatGPT Finances as a data source, any paid aggregator.                                                                                                                                                           |
| History backfill           | CSV import: Copilot Money's format once a sample exists, issuer formats meanwhile.                                                                                                                                             |
| AI matching                | Through PerkKeep's own MCP endpoint, called by Claude or ChatGPT. No server-side model API calls.                                                                                                                              |
| AI authority               | AI proposes matches with recorded provenance. Only issuer credit evidence or owner confirmation changes a balance.                                                                                                             |
| Point valuations           | Owner-configured, labeled as the owner's assumption everywhere. No built-in defaults.                                                                                                                                          |
| Recommender                | Pure function over benefit rules, earn rates, remaining credits and valuation config; ranked list with reasons.                                                                                                                |
| Local development          | The legacy local Supabase workflow was kept until the Neon path passed the same suite. It now passes, so Supabase is gone from runtime code and survives only as `legacy:supabase:*` scripts for reading the old local ledger. |
| Repository                 | Public `main` on `github.com/PatwinchIR/perkkeep`. Push only reviewed branches based on public `main`.                                                                                                                         |

## 5. Data sources

- **SimpleFIN:** the owner pastes the setup token into the owner-only Settings page. The server claims it once, stores the access URL encrypted (AES-256-GCM, key in `PERKKEEP_ENCRYPTION_KEY`), and never exposes it. Daily cron plus manual "Sync now" (30-minute cooldown). Per SimpleFIN's developer guide (read 2026-10-28): about 24 requests a day, at most 90 days per request, history depth varies by institution. Store date, posted date, integer cents, description, pending flag, account reference and an HMAC of the source id; never the raw payload. Coverage per account advances only on success; failures show the account as stale. Pending→posted, modified and removed transactions are appended as linked revisions; nothing is deleted or rewritten.
- **Plaid:** Sandbox only. Never create Production Items or submit a Production application; only the owner may.
- **CSV:** owner-only upload; the file's own date range is its coverage, the file hash is the idempotency key, row hashes deduplicate. Replays create nothing; the same file with different settings is rejected.
- **Account mapping:** the system proposes links from institution and last four digits; the owner confirms each one. Unconfirmed accounts sync but never affect balances. The unidentified Chase record stays unidentified until the owner confirms it; never assume it is either Ink card. Account identifiers live only in the private database, never in public source, fixtures or Git history.

## 6. Accounting rules

Separate card identity, benefit rules, benefit periods and redemption evidence. Support monthly, quarterly, semiannual, calendar-year, cardmember-year, one-time and custom periods with issuer timezones and confirmed anniversaries. Preserve old periods; version rules instead of rewriting them. Integer cents; units modeled separately. Track enrollment, eligibility, confidence and coverage; show unknown or stale information explicitly, and never display "no evidence of use" as "unused". Every balance change has an audit trail; corrections are appended and linked. Never count both a candidate and its confirmed replacement. Refunds do not restore a benefit without verified entitlement reversal. `record_evidence` and `apply_reconciliation` remain the reference behaviors (append-only, idempotent, transactional, reused keys with changed content rejected).

## 7. Benefits knowledge layer (Phase 2, not started)

Benefit rules and earn rates go in reviewable data files (for example `data/benefits/*.json`) with issuer, product, benefit name, period type, amount or units, enrollment requirement, eligibility notes, source URL, effective date and optional end date. No personal identifiers, no speculative valuations; unverified terms carry `verified: false` and the UI says so. Rule changes are versioned and each balance shows the rule version behind it. Cards in scope: American Express Gold, Chase Sapphire Reserve, Chase Freedom Flex, Chase Freedom Unlimited, Prime Visa, Discover it, Chase Ink Business Cash, Chase Ink Business Preferred. Owning a card does not establish entitlement to a benefit version.

## 8. MCP endpoint and AI matching (Phase 2, not started)

One authenticated MCP endpoint in the Next.js app; a no-auth endpoint is not acceptable. Verified 2026-10-28 from [Claude's connector docs](https://claude.com/docs/connectors/building/authentication): Claude needs OAuth with DCR or CIMD client registration, S256 PKCE, a `401` with an RFC 9728 `resource_metadata` pointer, and the callback `https://claude.ai/api/mcp/auth_callback`. Neon Auth can act as an OAuth 2.1 provider for MCP clients (see the installed `@neondatabase/auth` README). ChatGPT connector requirements are not yet checked. Tools at minimum: list cards and benefits with balances; list unmatched or low-confidence transactions; list rules; propose a match (candidate or confirmed, with reasoning and evidence references); confirm or reject as the owner; read a reconciliation result; summarize spending by category and period; read balances. Every write goes through `apply_reconciliation` with the client identity as provenance. Deterministic matchers handle clear cases; AI proposals land in a review queue. Test with a synthetic owner first and label it synthetic.

## 8a. Card art (done)

Official issuer images where a clean one exists, normalized to one 1.586:1 size, stored privately in Neon, served `private, no-store`; never committed. The public repo ships only neutral placeholder faces. The owner's profile name and last four are CSS overlays; bands in the card's color cover sample names. Owner-only per-card upload. The unidentified record keeps the placeholder. Details: decisions D27 to D30 and `data/card-faces.json`.

## 9. Phases and gates

| Phase | Deliverable                                                                                                                                                                              | Gate to the next phase                                                                                                          | State on 2026-10-28                                                      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 0     | Neon port with RLS under a restricted role, server sessions, email verification, logout, expiry, allowed origins, build guard, deployed and verified end to end with a synthetic account | All tests pass against Neon locally and on the hosted app; security boundaries listed in the report                             | Code done and verified on local PostgreSQL; **not deployed**             |
| 1     | SimpleFIN adapter, Plaid Sandbox adapter, CSV import, account mapping UI, coverage and staleness, daily cron                                                                             | Adapter tests pass on synthetic data; owner linked real accounts; one full sync shows statement credits for at least one issuer | Code done on synthetic data; gate needs deployment and the owner's token |
| 2     | Deterministic matchers per rule, review queue, expiration alerts, authenticated MCP endpoint, AI proposal flow verified with Claude                                                      | Owner says the PWA answers the six questions for every card without a portal check (the primary goal)                           | Not started                                                              |
| 3     | Recommender, valuation config UI, Chrome MV3 extension showing ranked cards for the current merchant                                                                                     | Owner uses the extension at checkout for two weeks                                                                              | Not started                                                              |
| 4     | Finance chat tools over all accounts                                                                                                                                                     | Owner decides whether Copilot Money is replaceable                                                                              | Not started                                                              |
| 5     | Open-source polish and, only with the owner's fee approval, native iOS                                                                                                                   | Owner decision                                                                                                                  | Not started                                                              |

Within a phase: finish, verify, document, commit and push before starting the next. Deliver usable increments early.

## 10. Inputs only the owner can provide

| Input                                                                        | Needed for         | State                                                                                                           |
| ---------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| SimpleFIN setup token                                                        | Phase 1 gate       | The owner has it on their Mac. It goes into the deployed Settings page, never into chat or a cloud environment. |
| Plaid Sandbox client id and secret                                           | Plaid adapter test | Missing                                                                                                         |
| Copilot Money CSV sample                                                     | Backfill format    | Missing                                                                                                         |
| Confirmation of each account-to-card link, including the unidentified record | Balances           | After the first sync                                                                                            |
| Owner connects Claude.ai (optionally ChatGPT) to the MCP endpoint            | Phase 2            | Later                                                                                                           |
| Point valuations                                                             | Phase 3            | Later                                                                                                           |

## 11. Constraints

- No paid charges, upgrades or purchases without explicit owner approval in chat.
- Do not modify Supabase projects `comment-section`, `comment-section-dev` or `hanabi`.
- Do not reset, destroy or overwrite existing local ledger data.
- Never expose database URLs, privileged keys, auth secrets, aggregator tokens or encryption keys in client code, logs, fixtures or documentation. Inspect `.local/neon.production.env` by variable name only.
- Never publish environment files, `.local/`, `.vercel/`, database exports, browser traces or private Git history. Never push `local/private-pre-publication`, old local history, or all branches and tags.
- Do not invent card identity, benefit eligibility, transaction coverage or successful integrations.
- Keep financial responses out of the service-worker cache; keep the offline page and public-assets-only caching.
- Do not migrate passwords or mark real users email-verified to bypass sign-in.
- Review audit findings deliberately; no forced major-version fixes (see D13).
- Follow `AGENTS.md`: consult the installed Next.js docs in `node_modules/next/dist/docs/` before editing Next.js code.

## 12. Assumptions to verify

Results are recorded in the "Section 14 assumptions" table in [decisions.md](decisions.md). Still open: ChatGPT connector requirements, whether write tools are allowed in Claude connectors, SimpleFIN's upstream aggregator, Chase and Amex reliability through SimpleFIN, and Apple Pay card selection on iOS.
