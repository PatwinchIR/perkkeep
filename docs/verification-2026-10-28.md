# Perkkeep follow-up verification

Date: October 28, 2026 (America/New_York).

## Local verification before public-source preparation

- 29 database/domain tests passed against actual local Supabase Auth, REST and PostgreSQL.
- 18 browser tests passed against both development and optimized production previews: desktop Chromium, 375px Chromium and 375px WebKit.
- TypeScript, ESLint, production build and browser credential checks passed.
- Local Supabase security advisor returned no issues.
- Tests cover authentication, owner isolation, evidence write/read-back, immutable corrections, audit history, manual coverage, card initialization, accessibility and public-only service-worker caching.
- Database cases cover duplicate replay, concurrent imports, changed-payload rejection, transactional rollback and historical-period preservation. All fixtures are synthetic and separate from real accounts.

Perkkeep now uses port 3017. Browser tests refuse to reuse an occupied server, preventing an unrelated app from being mistaken for the test target.

## Public-source preparation

Personal card endings have been removed from source and public history. Starter cards have unknown digits and stable catalog keys. A forward migration changes initialization without editing existing private ledger records. Environment files, credentials, database contents and diagnostic traces are excluded. The original development history is retained only locally.

After the public-source changes, all 29 database/domain tests and all 18 browser tests passed again. Type checking, lint, production build, client credential checks and the local security advisor passed. The 64-file publication snapshot was checked against known local credentials, token patterns, private paths and personal card identifiers, with no matches.

The production dependency audit reports seven low-severity findings in transitive dependencies introduced for the pending Neon Auth integration; no moderate, high or critical findings were reported. No automatic major-version dependency fix was applied.

## Hosted and integration status

A dedicated Vercel Hobby project and Neon Free database with managed Auth have been provisioned. The direct database connection was verified. App integration, hosted Auth and deployment have not yet been completed; local tests do not establish hosted correctness. The code still uses Supabase locally.

Finances discovery reports the plugin enabled, but no transaction-reading tool is available in this chat. No real Finances transactions were imported. No scheduled read/write cycle has run and no unattended financial automation is enabled. The supported fallback is authenticated manual reconciliation with explicit coverage, evidence and audit history.

Physical iPhone installation, hosted owner-isolation checks, production email delivery, real transaction matching and two scheduled cycles remain unverified.
