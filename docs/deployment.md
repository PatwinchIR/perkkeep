# Hosted release runbook

## Current status — October 28, 2026

The local application works with an isolated Supabase backend. Dedicated hosted Supabase creation was blocked by the free-project limit. The chosen hosted destination is now Neon attached to Vercel. A dedicated Vercel Hobby project and Neon Free database with managed Auth have been provisioned. The application migration and hosted deployment are still pending.

No paid upgrade or alteration of unrelated projects is authorized. Database connection strings, Auth secrets and deployment configuration stay in ignored local files or server environment variables. Never copy them into public source or `NEXT_PUBLIC_` variables.

## Remaining release work

1. Adapt the existing migrations and ownership policies to Neon managed Auth, retaining append-only evidence, audit history, atomic reconciliation and idempotent retries.
2. Implement server-side database access under a restricted database role. Verify the signed-in identity before setting transaction-local owner context. The database owner connection bypasses RLS and must not serve unchecked client queries.
3. Configure production sign-in, allowed origins and owner access. Test email delivery, login, logout and session revocation.
4. Update the current Supabase-only deployment guard and backend selection. Browser code must contain no database connection string or privileged key.
5. Test a hosted preview: owner isolation, unauthorized writes, evidence read-back, replay deduplication, preserved historical periods and audit history.
6. Release the tested deployment. On a physical iPhone, use Safari → Share → Add to Home Screen and check login, navigation, evidence entry, refresh, offline reconnect and logout.

Local accounts and records are not automatically migrated. Never change an existing user's email-verification state to bypass sign-in. Use clearly labeled, separate test accounts for verification.

## Public source and operations

The public repository starts with a sanitized source snapshot. Earlier local history remains local because it contained personal card endings. Starter cards have no last-four digits; existing private ledger records are preserved. Environment files, local database state, browser traces and generated agent tooling are ignored.

Source control is not a database backup. Confirm backup and restore procedures within the chosen free plan before relying on the hosted database. Do not enable paid backup options without authorization.

No Cron jobs, Finances feed or unattended reconciliation have been configured. See [reconciliation](reconciliation.md) for the actual integration limitations and manual fallback.
