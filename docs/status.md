# Status and next steps

Last updated: 2026-10-28. Update this file at the end of every working session.

## Where things stand

- **Branch:** `claude/gallant-cray-jewnhr`, open as draft pull request PatwinchIR/perkkeep#2. Nothing is merged into `main` yet.
- **Phase 0 (Neon port):** code done. 48/48 unit, database, source and card-art tests pass, and 20/20 Chromium browser and HTTP security tests pass, all on local PostgreSQL that reproduces Neon's roles with synthetic data. **Not deployed.** Vercel preview builds of the branch succeed and show the setup screen, because no PerkKeep variables exist in Vercel yet.
- **Phase 1 (sources):** code done on synthetic data. The gate needs a real SimpleFIN sync after deployment.
- **Section 8a (card art):** done. Five products have allowlisted issuer images. Freedom Unlimited, Prime Visa and Discover it keep the placeholder until the owner uploads a photo.
- **Open issue:** on 2026-10-28, `npm test` failed once in 36 runs in the cloud container. Its output was not captured, and the next 35 runs passed, including 20 in a row with full logs. If it happens again, keep the full vitest log and find the root cause; do not dismiss it as flakiness.
- **Not run anywhere yet:** WebKit phone tests, the Plaid adapter against Plaid, issuer CSV layouts against real files, and anything against real Neon or Neon Auth.

## Next steps, in order

1. **Deploy Phase 0** (see [deployment](deployment.md)). The work is the same from any machine that can reach Neon and Vercel:
   - Get the Neon owner connection variables (`vercel env pull .local/neon.production.env --environment production`; read them by name only).
   - Run `npm run neon:provision -- --vercel --owner-email <owner email>`. It applies `db/migrations` over the unpooled owner connection, sets a strong password on `perkkeep_app`, proves the role cannot bypass RLS, and writes the production variables to Vercel.
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
- Deployment from a container needs a `VERCEL_TOKEN` in the environment's Network secrets, and only a new session sees newly added secrets.
- It is not yet known whether a container can reach Neon's Postgres port through the egress proxy. If it cannot, report the denied host to the owner; do not route around the proxy.
- Never paste or request secrets in chat. Never claim the SimpleFIN token from a container: it can be claimed only once, and the container is temporary.

## Handoff rules

- Read [brief](brief.md), [decisions](decisions.md) and this file before working.
- After each push to the PR, check the Vercel commit status. Production builds fail closed when settings are missing; preview builds fail only on unsafe settings.
- Before every commit, scan staged files for secrets and card digits. No identifier of a real account may enter the repository or its history.
