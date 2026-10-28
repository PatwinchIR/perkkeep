# Hosted release runbook

## Status, October 28, 2026

The Neon port on this branch is complete in code and verified against local PostgreSQL. Production (https://perkkeep.vercel.app) currently runs a parallel implementation from branch `claude/magical-hypatia-cpmayb`, whose schema lives in `neondb`. This branch deploys into its own `perkkeep` database, so switching production does not touch that data, and Vercel can promote the earlier deployment to roll back. See the [Phase 0 report](reports/phase-0.md).

No paid upgrade or change to unrelated projects is authorized. Database connection strings, auth secrets and encryption keys stay in ignored local files or server environment variables. Never copy them into public source or into `NEXT_PUBLIC_` variables.

## Environment variables (Vercel, production)

| Name                                     | Purpose                                                         |
| ---------------------------------------- | --------------------------------------------------------------- |
| `PERKKEEP_DATABASE_URL`                  | Pooled connection as `perkkeep_app`. Never the owner role.      |
| `NEON_AUTH_BASE_URL`                     | Neon Auth URL, from the Neon Console Auth page.                 |
| `NEON_AUTH_COOKIE_SECRET`                | At least 32 characters; signs the session cache cookie.         |
| `PERKKEEP_OWNER_EMAILS`                  | Comma-separated owner emails. Empty admits nobody.              |
| `PERKKEEP_ALLOWED_ORIGINS`               | Optional extra origins, such as a custom domain.                |
| `PERKKEEP_ENCRYPTION_KEY`, `CRON_SECRET` | Reserved for Phase 1 (encrypted aggregator tokens, daily sync). |

The Neon integration's own `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are the owner role. The app does not use them at runtime, and the build guard refuses a `PERKKEEP_DATABASE_URL` that equals either one.

## Release steps

1. `npm run neon:provision -- --database perkkeep --vercel --owner-email <owner email>` on the owner's machine (reads `.local/neon.production.env` by variable name). It creates the `perkkeep` database if needed and never alters `neondb`.
2. Set `NEON_AUTH_BASE_URL` in Vercel if it is not already present. Turn on email verification in Neon Auth.
3. Deploy (merge to `main`, or run `vercel deploy --prod`).
4. Sign up with the owner email, verify it, and confirm the ledger opens. Sign out, and confirm a second browser cannot open it.
5. On a physical iPhone, use Safari, Share, Add to Home Screen, and check sign-in, navigation, evidence entry, refresh, offline reconnect and sign-out.

Never change an existing user's email-verification state to bypass sign-in. Use clearly labeled, separate test accounts for verification.

## Backups

Source control is not a database backup. Confirm the backup and restore options within the Neon Free plan before relying on the hosted database. Do not turn on paid backup options without authorization.
