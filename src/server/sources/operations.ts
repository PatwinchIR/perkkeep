import "server-only";
import { z } from "zod";
import { withOwner } from "../db";
import { encryptSecret, reference, sha256 } from "../crypto";
import { InputError } from "../ledger";
import { runMatchers, runMatchersSafely } from "../matchers";
import { claimSetupToken, setupTokenClaimUrl } from "./simplefin";
import { parseStatement } from "./csv";
import {
  defaultAdapters,
  linkAccounts,
  secretLabel,
  SyncCooldownError,
  syncConnection,
  type Adapters,
} from "./sync";

export const sourceOperations = {
  connectSimplefin: z.object({
    setup_token: z.string().min(20).max(2000),
    label: z.string().max(100).default(""),
  }),
  syncConnection: z.object({ connection_id: z.uuid() }),
  importCsv: z.object({
    file_name: z.string().max(200),
    file_text: z.string().min(1).max(2_000_000),
    format: z.string().max(60).optional(),
    account_id: z.uuid().optional(),
    new_account: z
      .object({
        institution: z.string().min(1).max(200),
        name: z.string().min(1).max(200),
        mask: z
          .string()
          .regex(/^[0-9]{4}$/)
          .nullable(),
      })
      .optional(),
  }),
  confirmMapping: z.object({ account_id: z.uuid(), card_id: z.uuid() }),
  runMatchers: z.object({}),
  rejectMapping: z.object({ account_id: z.uuid() }),
} as const;
export type SourceOperation = keyof typeof sourceOperations;
export type SourceOperationInput<O extends SourceOperation> = z.infer<
  (typeof sourceOperations)[O]
>;

export async function runSourceOperation(
  ownerId: string,
  op: SourceOperation,
  raw: unknown,
  adapters: Adapters = defaultAdapters(),
): Promise<unknown> {
  const parsed = sourceOperations[op].safeParse(raw);
  if (!parsed.success)
    throw new InputError(
      `Invalid ${op} request: ${parsed.error.issues[0]?.message}`,
    );
  switch (op) {
    case "connectSimplefin": {
      const i = parsed.data as SourceOperationInput<"connectSimplefin">;
      setupTokenClaimUrl(i.setup_token);
      // Prove the secret can be stored before spending the one-time token.
      const id = crypto.randomUUID();
      encryptSecret("probe", secretLabel(id));
      await withOwner(ownerId, (tx) => tx.query("select 1"));
      const accessUrl = await claimSetupToken(i.setup_token);
      try {
        await withOwner(ownerId, (tx) =>
          tx.query(
            "insert into public.source_connections(id,source,label,encrypted_secret) values($1,'simplefin',$2,$3)",
            [id, i.label, encryptSecret(accessUrl, secretLabel(id))],
          ),
        );
      } catch {
        throw new InputError(
          "SimpleFIN accepted the token, but PerkKeep could not save the connection. Revoke this connection in SimpleFIN Bridge and create a new token.",
        );
      }
      return {
        connection_id: id,
        sync: await syncConnection(ownerId, id, "claim", adapters),
      };
    }
    case "syncConnection": {
      const i = parsed.data as SourceOperationInput<"syncConnection">;
      try {
        return await syncConnection(
          ownerId,
          i.connection_id,
          "manual",
          adapters,
        );
      } catch (e) {
        if (e instanceof SyncCooldownError) throw new InputError(e.message);
        throw e;
      }
    }
    case "importCsv": {
      const i = parsed.data as SourceOperationInput<"importCsv">;
      let statement;
      try {
        statement = parseStatement(i.file_text, i.format);
      } catch (e) {
        throw new InputError(
          e instanceof Error ? e.message : "Unreadable CSV.",
        );
      }
      const fileHash = sha256(i.file_text);
      return withOwner(ownerId, async (tx) => {
        let accountId = i.account_id;
        if (!accountId) {
          if (!i.new_account)
            throw new InputError("Choose an account for this file.");
          const created = await tx.query(
            `insert into public.accounts(source,external_ref,institution,name,mask,kind)
             values('csv',$1,$2,$3,$4,'credit') returning id`,
            [
              reference("account:csv", crypto.randomUUID()),
              i.new_account.institution,
              i.new_account.name,
              i.new_account.mask,
            ],
          );
          accountId = created.rows[0].id as string;
        }
        const account = await tx.query(
          "select id, source from public.accounts where id=$1",
          [accountId],
        );
        if (account.rows[0]?.source !== "csv")
          throw new InputError("CSV files import into CSV accounts only.");
        // Identical rows within one file are distinct purchases, so each occurrence gets its own reference.
        const seen = new Map<string, number>();
        const rows = statement.rows.map((r) => {
          const key = JSON.stringify([
            r.transactedOn,
            r.postedOn,
            r.amountCents,
            r.description,
          ]);
          const n = (seen.get(key) ?? 0) + 1;
          seen.set(key, n);
          return {
            dedup_ref: reference(`transaction:csv:${accountId}`, `${key}#${n}`),
            transacted_on: r.transactedOn,
            posted_on: r.postedOn,
            amount_cents: r.amountCents,
            description: r.description,
            pending: false,
          };
        });
        const digest = sha256(
          JSON.stringify({ accountId, format: statement.format.id, rows }),
        );
        const existing = await tx.query(
          "select * from public.imports where file_sha256=$1",
          [fileHash],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].content_digest !== digest)
            throw new InputError(
              "This file was already imported with different settings. Nothing was changed.",
            );
          return { import: existing.rows[0], replay: true };
        }
        const created = await tx.query(
          `insert into public.imports(account_id,format,file_name,file_sha256,content_digest,row_count,coverage_start,coverage_end)
           values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
          [
            accountId,
            statement.format.id,
            i.file_name,
            fileHash,
            digest,
            rows.length,
            statement.coverageStart,
            statement.coverageEnd,
          ],
        );
        const result = await tx.query(
          "select * from public.ingest_transactions($1,'csv',$2,$3)",
          [accountId, JSON.stringify(rows), created.rows[0].id],
        );
        if (statement.coverageStart && statement.coverageEnd)
          await tx.query("select public.record_account_sync($1,$2,$3,null)", [
            accountId,
            statement.coverageStart,
            statement.coverageEnd,
          ]);
        const matched = await runMatchersSafely(tx, "manual");
        return {
          matched,
          import: created.rows[0],
          added: result.rows[0].added,
          unchanged: result.rows[0].unchanged,
          format: {
            id: statement.format.id,
            label: statement.format.label,
            verified: statement.format.verified,
          },
          replay: false,
        };
      });
    }
    case "runMatchers":
      // Links any synced accounts first, without another request to the source.
      return withOwner(ownerId, async (tx) => {
        await linkAccounts(tx);
        return runMatchers(tx, "manual");
      });
    case "confirmMapping": {
      const i = parsed.data as SourceOperationInput<"confirmMapping">;
      return withOwner(ownerId, async (tx) => {
        const { rows } = await tx.query(
          `update public.accounts set card_id=$2, proposed_card_id=$2, mapping_status='confirmed', mapping_confirmed_at=now()
           where id=$1 returning *`,
          [i.account_id, i.card_id],
        );
        if (!rows[0]) throw new InputError("Account not found.");
        await runMatchersSafely(tx, "manual");
        return rows[0];
      });
    }
    case "rejectMapping": {
      const i = parsed.data as SourceOperationInput<"rejectMapping">;
      return withOwner(ownerId, async (tx) => {
        const { rows } = await tx.query(
          `update public.accounts set card_id=null, mapping_status='rejected', mapping_confirmed_at=null where id=$1 returning *`,
          [i.account_id],
        );
        if (!rows[0]) throw new InputError("Account not found.");
        return rows[0];
      });
    }
  }
}
