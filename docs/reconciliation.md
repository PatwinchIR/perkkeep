# Reconciliation contract and external-integration status

## Capability observations

**October 28, earlier Codex session.** Plugin discovery reported Finances as installed and enabled, but no Finances account or transaction reader was exposed. Installed status alone is not evidence that a tool can run.

**October 28, Claude Code cloud session.** No ChatGPT plugin or ChatGPT Finances tool is available to Claude. The session listed a third-party personal-finance connector, along with Gmail, Calendar and Vercel connectors. That finance connector is a different aggregator, not ChatGPT Finances, and the owner has not authorized it for Perkkeep, so it was not called. Gmail was used only to look for Neon verification emails sent to the owner's dedicated test aliases.

Consequently:

- No real Finances transaction has been read, imported or reconciled.
- No live Finances-to-ledger reconciliation has been verified.
- No scheduled ChatGPT cycle has run. **Classification: not testable from the available environment.** Neither Claude nor a Vercel schedule can inherit the owner's ChatGPT Finances authorization, so no substitute scheduler was created.

The supported fallback is authenticated manual reconciliation with explicit coverage, evidence and audit history, plus the reconciliation exchange described below.

## Hosted integration boundary

All writes go through `POST /api/ledger` with a valid Neon Auth session for a verified owner. There is no administrative SQL endpoint, and no browser or external tool receives database credentials. The server validates the request, then runs the same SQL functions under the owner's row-level security:

- `record_evidence(p_record jsonb)`: transactional append. An ID or stable hashed source reference makes identical retries idempotent. A reused key with changed content is rejected.
- `apply_reconciliation(p_request_key uuid, p_trigger text, p_periods jsonb, p_evidence jsonb, p_summary jsonb)`: inserts a sync run and applies evidence and coverage in one subtransaction. A failure rolls back that run's evidence and coverage but keeps the failed run record. An exact repeat returns the same run, and changed inputs under the same key are rejected.

### Reconciliation exchange (Settings → Exchange with a transaction reviewer)

1. **Copy context.** Perkkeep produces JSON with open period IDs, card and benefit names, dates, allowances, current totals and coverage. It contains no card digits, owner IDs or transactions.
2. **Review elsewhere.** Paste the context into a chat that can actually read the owner's transactions, for example an interactive ChatGPT session with Finances, and ask it for a request in the format below.
3. **Paste and apply.** The owner reviews the request, confirms the checkbox, and Perkkeep validates and applies it once, then shows the stored run and the updated balances. Pasting the same request again changes nothing.

This keeps the reviewer outside the trust boundary. The chat never holds a session or credential, and every write is owner-confirmed and validated server-side.

Request format (operation `apply_reconciliation`):

```json
{
  "request_key": "new UUID per run; reuse only to retry the identical request",
  "trigger": "manual",
  "periods": [
    {
      "id": "period UUID",
      "coverage_status": "complete | partial | unavailable",
      "coverage_through": "YYYY-MM-DD or null"
    }
  ],
  "evidence": [
    {
      "benefit_period_id": "period UUID",
      "source_type": "purchase | statement_credit | email_confirmation | issuer_portal | manual | refund | reversal",
      "source_reference_hash": "64-char lowercase SHA-256 of a stable source reference",
      "transaction_date": "YYYY-MM-DD",
      "merchant": "optional, ≤200 chars",
      "amount_cents": 1234,
      "confidence": "candidate | confirmed | unknown | rejected",
      "eligibility_result": "eligible | unknown | ineligible",
      "recorded_by": "import | inference",
      "notes": "short reason",
      "supersedes_evidence_id": "optional UUID of the candidate a credit replaces"
    }
  ],
  "summary": {
    "source": "chatgpt_finances_interactive",
    "coverage_limitations": "what could not be seen"
  }
}
```

Rules the server enforces:

- Purchases are always candidates; an inference can never confirm.
- `confirmed` requires `eligible`. A confirmed manual entry, refund or reversal needs an explanatory note.
- Imports cannot supersede user-entered evidence, and a correction must stay in the same period and owner.
- Use cents **or** units, matching the benefit.
- Coverage cannot be in the future, and `complete` needs an observation date.
- Requests are limited to 200 periods and 500 evidence records, with bounded field sizes.

Hash source references with SHA-256 before submitting them. Never include full card numbers, account or Finances internal IDs, tokens, or raw transaction feeds. A purchase refund does not imply a benefit reversal; record it as `unknown` until the issuer reverses the credit.

## Remaining steps toward transaction-assisted reconciliation

1. In an interactive ChatGPT conversation where Finances transaction tools actually appear, map each connected account to a verified card. Leave ambiguous mappings, including the unidentified Chase record, unresolved.
2. Record the transaction date range and completeness the tool can establish, run the exchange above, and confirm the read-back in Perkkeep. Record any approval prompts.
3. Only after that works, test whether a ChatGPT scheduled task can do the same without the owner present. Writing still needs an authenticated path; the exchange intentionally requires the owner's confirmation, so a fully unattended write would need a separately designed, revocable credential. Observe two cycles before classifying the result as unattended, approval-dependent or manual-only.
