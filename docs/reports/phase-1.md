# Phase 1 report: sources, mapping, coverage (with section 8a card art)

Date: 2026-10-28. Branch: `claude/gallant-cray-jewnhr`.

**Status:** the code is complete and verified with synthetic data. The Phase 1 gate (owner has linked real accounts; one full sync cycle shows statement credits for at least one issuer) is **not met**. Phase 0 is not deployed yet, and the SimpleFIN token has not been claimed (D14).

## 1. Deployed URL and commit

- Deployed URL: none (see the Phase 0 report).
- Commit: the head of `claude/gallant-cray-jewnhr`.

## 2. Tests run and results

All data is **synthetic**. SimpleFIN payloads follow the documented protocol shape, not real responses.

| Check                                                                               | Result                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit, database, source and card-art tests (`npm test`)                              | 47/47 passed                                                                                                                                                                                       |
| Browser tests, desktop and 375px Chromium                                           | 20/20 passed. New flows: CSV import with coverage and card linking (with an accessibility audit of Settings), and card art upload with private serving, cross-owner 404 and an unauthenticated 401 |
| Type check, lint, production build, client-secret scan                              | Passed                                                                                                                                                                                             |
| Live fetch of the five allowlisted issuer images through the app (local dev server) | 5/5 stored and rendered; screenshot reviewed for band placement                                                                                                                                    |
| WebKit phone tests                                                                  | Not run (not installed in the agent container)                                                                                                                                                     |

Source tests cover:

- exact decimal-to-cents conversion;
- SimpleFIN v1 and v2 shapes, the one-time claim (including a refused reused token and refused HTTP), and basic auth taken out of the access URL;
- encryption bound to each connection;
- the sync window;
- repeated syncs with no duplicates, pending-to-posted revision, and inferred removal of a vanished pending charge;
- append-only enforcement (update and delete denied);
- coverage left unchanged when a sync fails;
- mapping confirmation limited to the owner's own cards;
- CSV replay as a no-op, and rejection of the same file with different settings.

## 3. Security boundaries verified, and how

- **Aggregator secrets.** AES-256-GCM, with the connection id as associated data. A test confirms that ciphertext moved to another connection fails to decrypt. Snapshots never select `encrypted_secret`, and the client-secret scan checks built browser assets for every server secret present in the build environment, including `PERKKEEP_ENCRYPTION_KEY` and `CRON_SECRET`. The SimpleFIN access URL exists only as ciphertext in the database.
- **Source identifiers.** Only keyed digests are stored. A test asserts the synthetic account id does not appear anywhere in the stored account row.
- **Append-only evidence.** Transactions, imports, balance snapshots and holdings have no `UPDATE` or `DELETE` grants for `perkkeep_app`. Tests confirm both are refused.
- **Isolation.** Every new table has forced row-level security. Tests show a second owner sees no transactions and cannot link an account to a card it does not own. Card art returns 404 to another owner and 401 without a session.
- **Cron.** The route requires `Authorization: Bearer <CRON_SECRET>` (compared in constant time), and the build guard requires a secret of at least 32 characters.
- **Card art.** Issuer images are fetched only from allowlisted HTTPS hosts and URLs, with redirects refused. Uploads are limited to 8 MB, decoded by `sharp`, and re-encoded. Responses are `private, no-store`, and the service worker does not intercept them.

## 4. What works with real data

Nothing yet. Issuer card images (public product art) were fetched from the issuers' sites during the visual check. No financial data was read.

## 5. Owner inputs still missing

1. **Finish Phase 0** (Phase 0 report, section 5). That step also sets `PERKKEEP_ENCRYPTION_KEY` and `CRON_SECRET`.
2. **SimpleFIN:** after deployment, open Settings, paste the setup token from your Mac into "Connect SimpleFIN", and press the button once. PerkKeep claims it, stores it encrypted, and runs the first sync.
3. **Confirm account links:** Settings, Connected accounts. Confirm or reject each suggestion, including the account behind the unidentified Chase record.
4. **Card images:** on each card's page, press "Use the issuer's image" (Gold, Sapphire Reserve, Freedom Flex, Ink Cash, Ink Business Preferred). For Freedom Unlimited, Prime Visa and Discover it, upload a photo of the card.
5. **Optional:** a Copilot Money CSV export sample (enables that layout); Plaid Sandbox client id and secret in Vercel as `PLAID_CLIENT_ID` and `PLAID_SECRET` (enables testing the backup adapter).

## 6. Decisions made without asking

D18 to D31 in [decisions.md](../decisions.md).

## 7. Known gaps and fallbacks

| Gap                                                                                    | Fallback                                                                                                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| SimpleFIN's request quota and history depth are not verified                           | Sync once a day plus manual "Sync now". Coverage shows the requested window and the last successful refresh. |
| Chase and Amex reliability through SimpleFIN is unknown                                | Failures mark the account stale and keep earlier coverage. CSV statements fill gaps.                         |
| Plaid adapter not run against Plaid                                                    | Marked untested. SimpleFIN and CSV are the supported sources.                                                |
| Issuer CSV layouts not checked against real files                                      | They are labeled unverified in the UI. The generic signed layout is exact.                                   |
| Duplicate transactions between a CSV account and a SimpleFIN account for the same card | Resolved by the Phase 2 matchers. Until then, transactions never change balances.                            |
| No clean issuer image for Freedom Unlimited, Prime Visa or Discover it                 | Placeholder face, or an owner upload.                                                                        |
| Issuer image URLs can change without notice                                            | The fetch fails with a clear message, and the stored image stays until replaced.                             |
