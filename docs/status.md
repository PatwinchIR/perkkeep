# Status and next steps

Last updated: 2026-10-28. Update this file at the end of every working session.

## Where things stand

- **Branch:** `claude/gallant-cray-jewnhr`, open as draft pull request PatwinchIR/perkkeep#2. Nothing is merged into `main` yet.
- **Phase 0 (Neon port):** deployed; anonymous and synthetic-account checks passed over HTTPS (see the Phase 0 report). The owner's own sign-in is the last check. 48/48 unit, database, source and card-art tests pass, and 20/20 Chromium browser and HTTP security tests pass, all on local PostgreSQL that reproduces Neon's roles with synthetic data. Preview builds of the branch still show the setup screen, because PerkKeep's variables exist only in Vercel production (D16).
- **Production:** https://perkkeep.vercel.app runs this branch (deployed 2026-10-28 with `vercel deploy --prod`) on the `perkkeep` database. The earlier parallel deployment's data stays in `neondb`. `main` still holds the old published commit, so merge this branch before anything is pushed to `main`; a push to `main` would redeploy the old code.
- **Phase 1 (sources):** code done on synthetic data. The owner connected SimpleFIN in production on 2026-10-28. Synced card accounts now become linked cards automatically (D41). On 2026-10-28, 9 of the owner's 24 SimpleFIN accounts linked to cards; the rest are bank and investment accounts, plus one Chase business card the owner has not identified. 456 transactions are stored. No benefits exist yet, so nothing can match; the gate still needs statement credits seen for at least one issuer.
- **Section 8a (card art):** done. Five products have allowlisted issuer images. Freedom Unlimited, Prime Visa and Discover it keep the placeholder until the owner uploads a photo.
- **Hosted attempt (2026-10-28, second session):** the local suite passed in a fresh container, and the Vercel CLI works with a `VERCEL_TOKEN` environment variable. The container cannot reach Neon's Postgres port: a direct connection timed out, and the egress proxy accepted a tunnel to port 5432 but did not relay the Postgres protocol. So `neon:provision`, the production deployment and the synthetic end-to-end check were not run. Vercel production already holds `NEON_AUTH_BASE_URL` and `PERKKEEP_OWNER_EMAILS` (matching the owner's sign-in email). Details: [Phase 0 report](reports/phase-0.md).
- **Open issue, deferred by the owner on 2026-10-28:** `npm test` fails intermittently in the cloud container. It reproduced once in 17 completed runs in the second session. The failing test was `tests/database.test.ts` > "rejects conflicting idempotency payloads, purchase confirmations and inference overrides" (1 failed, 47 passed). The owner asked to skip the investigation for now, so the root cause is still unknown. Do not dismiss it as flakiness when it is picked up again.
- **Phase 2 (in progress):** rule files in `data/benefits` (Gold and Sapphire Reserve read on the issuers' pages on 2026-10-28; six products not yet researched), and a deterministic matcher that runs after each sync, import or link. Credit patterns are unverified until real statements confirm them (D36). Next: verify patterns on the first real sync, research the other six products, then the MCP endpoint with OAuth.
- **Not run anywhere yet:** WebKit phone tests, the Plaid adapter against Plaid, issuer CSV layouts against real files, and anything against real Neon or Neon Auth.

## Next steps, in order

1. **Deploy Phase 0** (see [deployment](deployment.md)). Provisioning needs a machine that can reach Neon's Postgres port, which rules out the cloud container; the deployment and the HTTPS checks can run anywhere:
   - Get the Neon owner connection variables (`vercel env pull .local/neon.production.env --environment production`; read them by name only).
   - Run `npm run neon:provision -- --database perkkeep --vercel --owner-email <owner email>`. It applies `db/migrations` over the unpooled owner connection, sets a strong password on `perkkeep_app`, proves the role cannot bypass RLS, and writes the production variables to Vercel.
   - Make sure `NEON_AUTH_BASE_URL` exists in Vercel, and that Neon Auth requires email verification (Neon Console, Auth).
   - Deploy production (merge to `main` after review, or `vercel deploy --prod`). Verify with a synthetic, clearly labeled account: sign-up, email verification, sign-in, owner isolation, sign-out, session expiry, and the offline page. Then write the hosted results into `docs/reports/phase-0.md`.
2. **Phase 1 gate.** The owner pastes the SimpleFIN token into Settings, confirms account links, and runs one sync. Check that statement credits appear for at least one issuer, then record the result in `docs/reports/phase-1.md`.
3. **Phase 2:** benefit rule data files (`data/benefits/`), deterministic matchers, review queue, expiration alerts, the MCP endpoint with OAuth (requirements in [brief](brief.md) section 8), and AI proposals verified with Claude.

## Working in a Claude Code cloud container

The container starts empty: no `.local/`, no database and no credentials.

```sh
npm ci
bash scripts/cloud-postgres.sh   # PostgreSQL 16 as the postgres user, port 54329, then local:postgres
npm test
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --project=chromium-desktop --project=chromium-phone
npm run typecheck && npm run lint && npm run build && npm run check:client
```

- Preinstalled Chromium may be a different revision from the one Playwright expects; `PLAYWRIGHT_CHROMIUM_PATH` handles that.
- WebKit is not installed in the container, and the container's rules say not to run `playwright install`.
- Deployment from a container needs `VERCEL_TOKEN` as an environment variable. Install the Vercel CLI with a pinned version (`npm i -g vercel@64.0.2`) and pass `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` (kept out of this public file) instead of running `vercel link`.
- A container cannot reach Neon's Postgres port (checked 2026-10-28): the egress proxy does not relay the Postgres protocol. Use `npm run neon:https` and `npm run neon:reconcile` instead, which go over port 443 (D42); they need `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` set the first time, to pull credentials. `neon:provision` still needs the owner's Mac.
- Never paste or request secrets in chat. Never claim the SimpleFIN token from a container: it can be claimed only once, and the container is temporary.

## Handoff rules

- Read [brief](brief.md), [decisions](decisions.md) and this file before working.
- After each push to the PR, check the Vercel commit status. Production builds fail closed when settings are missing; preview builds fail only on unsafe settings.
- Before every commit, scan staged files for secrets and card digits. No identifier of a real account may enter the repository or its history.
