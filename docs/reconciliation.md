# Reconciliation contract and external-integration gate

## October 28 access observation

Plugin discovery reports Finances installed and enabled. The available tool inventory in this Codex chat contains no Finances account or transaction reader, including after discovery. Therefore no live Finances transactions were read, imported, or reconciled. Installed status alone is not evidence that a tool can run here.

Permission inspection for both Finances and Supabase reports **Use my default**, with the default **Allow low-risk actions**. Sensitive actions may be denied. These settings do not prove unattended write permission, and no permission setting was changed.

The official [scheduled-task documentation](https://learn.chatgpt.com/docs/automations) says tasks can use tools available to their chat and recommends testing the prompt interactively first. The interactive Finances read and working hosted ledger are still unavailable here, so no scheduled end-to-end test has run and no background financial automation was enabled. The fallback remains the app's authenticated manual reconciliation form with explicit coverage, evidence, audit history, and read-back. A local database test is not a Finances integration test, and a Codex heartbeat would not prove availability in a ChatGPT cloud task.

## What is implemented

`record_evidence(p_record jsonb)` is an authenticated, RLS-scoped, transactional append. IDs or stable source hashes make identical retries idempotent; changed content using the same key is rejected. Hash source references with SHA-256 before storing them. Do not store full card numbers, tokens, passwords, Finances internal IDs, or raw transaction feeds.

`apply_reconciliation(p_request_key uuid, p_trigger text, p_periods jsonb, p_evidence jsonb, p_summary jsonb)` inserts a sync run, applies evidence and coverage in one subtransaction, and preserves a failed run if validation fails. A failure rolls back its evidence and coverage changes. Exact repeat requests return the same run. Different inputs with the same request key fail. Start an explicit retry with a new key; unchanged evidence still deduplicates.

- `p_trigger`: `manual`, `scheduled`, or `user_edit`. This is provenance, not proof a scheduler works.
- `p_periods`: objects with `id`, `coverage_status` (`complete`, `partial`, `unavailable`) and `coverage_through` (date/null).
- `p_evidence`: records described below.
- `p_summary`: concise coverage limitations, source observation and reconciliation context; no large raw feeds.

Evidence fields include period ID, source type, hashed source reference, transaction date, optional merchant, integer cents **or** integer units, eligibility result, confidence, recorded-by classification, notes and optional `supersedes_evidence_id`.

Purchase-only evidence is a candidate. Inference cannot confirm a redemption. Explicit issuer credits/portal confirmations or the user's verification can establish confirmed usage. Link a posted credit to its matched candidate using supersession to avoid leaving both as live evidence. A split credit can replace the candidate with the first confirmed portion and append additional confirmed portions with distinct references; explicitly preserve any unfulfilled portion as a separate candidate if appropriate. Overlapping benefits require an explicit eligibility/allocation decision, not automatic double assignment.

A purchase refund does not automatically imply a benefit reversal. Record unverified refund consequences as unknown/review. A verified entitlement reversal uses a negative amount and a note. Totals clamp at zero but an excessive reversal is flagged for review. An import or inference cannot supersede a user-authored record. A correction must refer to the same owner and period and can have only one direct successor. All previous rows remain readable.

## Ownership when using the Supabase connector

Browser calls use the signed-in owner's Auth JWT. Connected SQL tools may run as a database administrator, so they do **not** automatically have that end-user context. Audit triggers intentionally reject writes without `auth.uid()`.

During an approved integration test, explicitly resolve and verify the owner's Supabase Auth UUID, set an authenticated owner context **inside a transaction**, invoke the same RPC, read it back, and commit. Do not disable RLS or remove the audit guard to make connector writes pass. An authorized connector's admin ability to choose an owner is still privileged access and must be treated accordingly.

A conceptual SQL outline (replace placeholders only with verified values in the approved project):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"VERIFIED_OWNER_UUID","role":"authenticated"}', true);
-- select public.apply_reconciliation(...verified structured inputs...);
-- select * from public.sync_runs where request_key = 'VERIFIED_REQUEST_UUID';
commit;
```

The local test suite exercises the actual Auth JWT → REST → Postgres route. The ChatGPT connector route above has **not** been tested, and this outline is not a claim of connector or Finances availability.

## Still required for Milestone 0

1. Complete the Neon/Vercel hosted integration and verify authenticated owner isolation. The local Supabase contract below remains the reference behavior; the hosted adapter is still pending.
2. In an interactive ChatGPT conversation where Finances is actually available, verify a card's identity and inspect its transactions with adequate backfill. Record exactly what coverage the tool can establish. Use labeled synthetic evidence if no actual qualifying event exists.
3. Perform an approved connector write/read-back through the ownership boundary above. Document any approvals or pauses.
4. Only then create one ChatGPT scheduled test that reads Finances, reconciles one benefit, writes Supabase and reads back. Repeat twice with idempotent inputs and record read/write availability, approval pauses and failures.
5. Choose **unattended**, **approval-dependent**, or **manual-only** from those observed results. Until that proof exists, Perkkeep remains manual-only.

No automation has been scheduled. No fallback Plaid connection, custom MCP server, Finances impersonation or additional aggregator has been created. Supabase/Vercel scheduled execution cannot magically access the user's ChatGPT Finances authorization.
