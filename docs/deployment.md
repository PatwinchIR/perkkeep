# Hosted release runbook

## Current state — October 28, 2026

- **Production URL:** https://perkkeep.vercel.app (Vercel project `perkkeep`, team `dee-dongs-projects`, Hobby plan).
- **Database:** Neon project `lucky-meadow-02568421` (Free plan, US East), attached to the Vercel production environment through the Neon integration.
- **Auth:** Neon Auth on the same project.
- **Git:** the Vercel project is linked to `PatwinchIR/perkkeep`, with `main` as the production branch. Pushes to `main` deploy production; other branches build previews.
- No paid upgrade, custom domain, Cron job or scheduled task was created.

## Environment

The Neon integration provides `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL` and related `PG*`/`POSTGRES_*` variables for **production only**. Perkkeep adds:

- `PERKKEEP_OWNER_EMAILS`: the owner's address. Production builds fail without it.
- `PERKKEEP_OWNER_PLUS_ALIASES=allow`: lets `owner+tag@` aliases sign up as separate, isolated test owners. Remove it to allow only exact addresses.
- `NEON_AUTH_COOKIE_SECRET` (optional): signs the short-lived session-data cookie. If unset, a key is derived from `DATABASE_URL` with HKDF.

Preview deployments have no database variables. They build, but the ledger API answers 503 "not configured". Attach a Neon preview branch before relying on previews.

## Neon Auth configuration

Neon Auth reads its project configuration from `neon_auth.project_config`. On October 28, two values were changed directly in that table at the owner's request; the earlier values were backed up locally:

- `trusted_origins` changed from `[]` to `["https://perkkeep.vercel.app"]`. Without it, sign-up failed with `INVALID_ORIGIN`/`INVALID_CALLBACK_URL`. `allow_localhost` was already `true`.
- `email_and_password.requireEmailVerification`, `sendVerificationEmailOnSignUp` and `sendVerificationEmailOnSignIn` changed from `false` to `true`. The verification method remains `otp` (a code sent by email).

These settings are normally managed in the Neon Console (Auth → Configuration). A console change may overwrite them. Re-check both values after any console edit or a domain change. The shared Neon email provider sends the verification codes.

## Deploy

Deployments run `node scripts/vercel-build.mjs`. In production it applies pending migrations with the unpooled connection, then runs `next build`. Applied migrations are checksummed; an edited, previously applied file stops the build.

```sh
vercel deploy --prod   # or merge to main
```

## Release checks

Run the commands in the README's Verify section. Then, on a physical iPhone, use Safari → Share → Add to Home Screen and check login, navigation, evidence entry, refresh, offline reconnect and logout. That device check has not been performed.

## Operations

- Source control is not a backup. Neon Free includes limited point-in-time history; confirm restore options in the Neon Console before relying on it, and do not enable paid options without approval.
- Local Supabase records from the earlier development stack were not migrated. They remain wherever that local stack stored them, and this repository no longer runs it.
- Never print or commit `DATABASE_URL`, `PGPASSWORD`, Auth secrets or `.env*` files. `.vercelignore` keeps environment files out of CLI uploads.
