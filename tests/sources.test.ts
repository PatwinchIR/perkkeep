// Phase 1 source tests. Every account, transaction and token here is SYNTHETIC; SimpleFIN payloads
// follow the documented protocol shape (https://www.simplefin.org/protocol.html), not real data.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { env, insert, user } from "./helpers";
import type { SourceBatch, SyncWindow } from "../src/server/sources/types";

process.env.PERKKEEP_DATABASE_URL = env.TEST_APP_URL;
process.env.PERKKEEP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const { decimalToCents } = await import("../src/server/sources/types");
const { claimSetupToken, normalizeAccountSet, simplefinAdapter } =
  await import("../src/server/sources/simplefin");
const { parseStatement } = await import("../src/server/sources/csv");
const { encryptSecret, decryptSecret } = await import("../src/server/crypto");
const { syncConnection, secretLabel, syncWindow } =
  await import("../src/server/sources/sync");
const { runSourceOperation } = await import("../src/server/sources/operations");
const { withOwner, closePool } = await import("../src/server/db");
afterAll(() => closePool());

const epoch = (iso: string) =>
  Math.floor(Date.parse(`${iso}T16:00:00Z`) / 1000);
const v2 = (transactions: object[], extra: object = {}): never =>
  ({
    errlist: [],
    connections: [
      {
        conn_id: "CON-SYNTH",
        name: "Synthetic Chase Bank",
        org_id: "o",
        sfin_url: "https://example.com",
      },
    ],
    accounts: [
      {
        id: "ACT-SYNTH-1",
        name: "Synthetic Sapphire ...4242",
        conn_id: "CON-SYNTH",
        currency: "USD",
        balance: "-120.50",
        "balance-date": epoch("2026-10-27"),
        transactions,
        ...extra,
      },
    ],
  }) as never;

describe("SimpleFIN adapter (documented format, synthetic payloads)", () => {
  it("converts decimal strings to integer cents exactly", () => {
    expect(
      ["-12.30", "0.1", "100", ".5", "-0.005", "1234567.89"].map(
        decimalToCents,
      ),
    ).toEqual([-1230, 10, 10000, 50, -1, 123456789]);
    expect(() => decimalToCents("1e3")).toThrow();
  });
  it("normalizes v2 connections and v1 org responses, pending flags and masks", () => {
    const batch = normalizeAccountSet(
      v2([
        {
          id: "T1",
          posted: epoch("2026-10-20"),
          amount: "-25.00",
          description: "SYNTHETIC CAFE",
        },
        {
          id: "T2",
          posted: 0,
          amount: "-9.99",
          description: "SYNTHETIC PENDING",
          transacted_at: epoch("2026-10-26"),
          pending: true,
        },
      ]),
    );
    expect(batch.accounts[0]).toMatchObject({
      institution: "Synthetic Chase Bank",
      mask: "4242",
      kind: "credit",
      balanceCents: -12050,
    });
    expect(batch.transactions).toMatchObject([
      {
        externalId: "T1",
        transactedOn: "2026-10-20",
        postedOn: "2026-10-20",
        amountCents: -2500,
        pending: false,
      },
      {
        externalId: "T2",
        transactedOn: "2026-10-26",
        postedOn: null,
        amountCents: -999,
        pending: true,
      },
    ]);
    const v1 = normalizeAccountSet({
      errors: ["Synthetic connection needs attention"],
      accounts: [
        {
          id: "A",
          name: "Checking",
          org: { name: "Synthetic Bank" },
          currency: "USD",
          balance: "10",
          "balance-date": 1,
        },
      ],
    } as never);
    expect(v1.accounts[0].institution).toBe("Synthetic Bank");
    expect(v1.messages).toEqual(["Synthetic connection needs attention"]);
  });
  it("claims a setup token once over HTTPS and refuses a reused token", async () => {
    const token = Buffer.from(
      "https://bridge.example.com/simplefin/claim/SYNTHETIC",
    ).toString("base64");
    const ok = await claimSetupToken(token, (async (
      url: URL,
      init: RequestInit,
    ) => {
      expect(String(url)).toBe(
        "https://bridge.example.com/simplefin/claim/SYNTHETIC",
      );
      expect(init.method).toBe("POST");
      return new Response("https://user:pass@bridge.example.com/simplefin");
    }) as never);
    expect(ok).toBe("https://user:pass@bridge.example.com/simplefin");
    await expect(
      claimSetupToken(
        token,
        (async () => new Response("", { status: 403 })) as never,
      ),
    ).rejects.toThrow(/already claimed/);
    await expect(
      claimSetupToken(
        Buffer.from("http://insecure.example.com").toString("base64"),
      ),
    ).rejects.toThrow(/HTTPS/);
  });
  it("requests /accounts with basic auth taken out of the URL, a date window and pending items", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const adapter = simplefinAdapter((async (url: URL, init: RequestInit) => {
      seen = {
        url: String(url),
        auth: new Headers(init.headers).get("authorization"),
      };
      return Response.json(v2([]));
    }) as never);
    await adapter.fetch(
      "https://synth%40user:p%3Ass@bridge.example.com/simplefin",
      { start: "2026-10-01", endExclusive: "2026-10-29" },
    );
    expect(seen!.url).toBe(
      `https://bridge.example.com/simplefin/accounts?start-date=${Date.parse("2026-10-01T00:00:00Z") / 1000}&end-date=${Date.parse("2026-10-29T00:00:00Z") / 1000}&pending=1&version=2`,
    );
    expect(seen!.auth).toBe(
      `Basic ${Buffer.from("synth@user:p:ss").toString("base64")}`,
    );
  });
  it("encrypts secrets bound to their connection", () => {
    const sealed = encryptSecret(
      "https://user:pass@example.com",
      "source_connection:a",
    );
    expect(sealed).not.toContain("pass");
    expect(decryptSecret(sealed, "source_connection:a")).toBe(
      "https://user:pass@example.com",
    );
    expect(() => decryptSecret(sealed, "source_connection:b")).toThrow();
  });
  it("never requests more than SimpleFIN's 90-day window and overlaps the last success by two weeks", () => {
    const now = new Date("2026-10-28T15:00:00Z");
    expect(syncWindow(null, now)).toEqual({
      start: "2026-07-31",
      endExclusive: "2026-10-29",
    });
    // A long outage still asks for at most 90 days.
    expect(syncWindow("2026-01-01T15:00:00Z", now)).toEqual({
      start: "2026-07-31",
      endExclusive: "2026-10-29",
    });
    expect(syncWindow("2026-10-27T15:00:00Z", now)).toEqual({
      start: "2026-10-13",
      endExclusive: "2026-10-29",
    });
  });
});

describe("CSV statements (synthetic files)", () => {
  it("parses quoted fields and normalizes signs per format", () => {
    const chase = parseStatement(
      'Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n10/02/2026,10/03/2026,"SYNTHETIC, DINER",Food,Sale,-12.34,\n10/05/2026,10/05/2026,SYNTHETIC CREDIT,,Adjustment,10.00,\n',
    );
    expect(chase.format.id).toBe("chase-card");
    expect(
      chase.rows.map((r) => [r.transactedOn, r.amountCents, r.description]),
    ).toEqual([
      ["2026-10-02", -1234, "SYNTHETIC, DINER"],
      ["2026-10-05", 1000, "SYNTHETIC CREDIT"],
    ]);
    expect([chase.coverageStart, chase.coverageEnd]).toEqual([
      "2026-10-02",
      "2026-10-05",
    ]);
    const discover = parseStatement(
      "Trans. Date,Post Date,Description,Amount,Category\n10/01/2026,10/02/2026,SYNTHETIC STORE,5.00,Shopping\n",
    );
    expect(discover.rows[0].amountCents).toBe(-500);
  });
  it("asks the owner to choose when two layouts share the same columns", () => {
    const text = "Date,Description,Amount\n10/01/2026,SYNTHETIC,4.00\n";
    expect(() => parseStatement(text)).toThrow(/Choose the file's format/);
    expect(parseStatement(text, "amex").rows[0].amountCents).toBe(-400);
    expect(parseStatement(text, "generic-signed").rows[0].amountCents).toBe(
      400,
    );
    expect(() => parseStatement("Foo,Bar\n1,2\n")).toThrow(/not supported/);
  });
});

describe("sync and import ledger behavior (synthetic owner, restricted role)", () => {
  let owner: Awaited<ReturnType<typeof user>>;
  let batch: SourceBatch;
  const fake = (next: () => SourceBatch | Error) => ({
    simplefin: {
      source: "simplefin" as const,
      async fetch(secret: string, window: SyncWindow) {
        expect(secret).toBe("https://user:pass@bridge.example.com/simplefin");
        expect(window.endExclusive > window.start).toBe(true);
        const b = next();
        if (b instanceof Error) throw b;
        return b;
      },
    },
    plaid: {
      source: "plaid" as const,
      fetch: async () => {
        throw new Error("unused");
      },
    },
  });
  const connect = async () => {
    const id = randomUUID();
    await withOwner(owner.id, (tx) =>
      tx.query(
        "insert into public.source_connections(id,source,encrypted_secret) values($1,'simplefin',$2)",
        [
          id,
          encryptSecret(
            "https://user:pass@bridge.example.com/simplefin",
            secretLabel(id),
          ),
        ],
      ),
    );
    return id;
  };
  beforeAll(async () => {
    owner = await user();
    await insert(owner, "cards", {
      issuer: "Chase",
      display_name: "Synthetic Sapphire",
      last4: "4242",
    });
    batch = normalizeAccountSet(
      v2([
        {
          id: "T1",
          posted: epoch("2026-10-20"),
          amount: "-25.00",
          description: "SYNTHETIC CAFE",
        },
        {
          id: "T2",
          posted: 0,
          amount: "-9.99",
          description: "SYNTHETIC PENDING",
          transacted_at: epoch("2026-10-26"),
          pending: true,
        },
      ]),
    );
  });

  it("stores accounts and transactions once, revises pending→posted, and records vanished pending charges as removals", async () => {
    const connection = await connect();
    const first = await syncConnection(
      owner.id,
      connection,
      "manual",
      fake(() => batch),
      new Date("2026-10-28T15:00:00Z"),
    );
    expect(first).toMatchObject({
      status: "success",
      accounts: 1,
      added: 2,
      revised: 0,
    });
    const again = await syncConnection(
      owner.id,
      connection,
      "manual",
      fake(() => batch),
      new Date("2026-10-28T16:00:00Z"),
    );
    expect(again).toMatchObject({ added: 0, revised: 0 });
    const posted = normalizeAccountSet(
      v2([
        {
          id: "T1",
          posted: epoch("2026-10-20"),
          amount: "-25.00",
          description: "SYNTHETIC CAFE",
        },
        {
          id: "T3",
          posted: epoch("2026-10-27"),
          amount: "-9.99",
          description: "SYNTHETIC PENDING POSTED",
        },
      ]),
    );
    const third = await syncConnection(
      owner.id,
      connection,
      "manual",
      fake(() => posted),
      new Date("2026-10-28T17:00:00Z"),
    );
    expect(third).toMatchObject({ added: 1, revised: 1 });
    const rows = await owner.q(
      "select observation, pending, amount_cents, supersedes_transaction_id from public.transactions order by recorded_at, observation",
    );
    expect(rows.map((r) => r.observation).sort()).toEqual([
      "observed",
      "observed",
      "observed",
      "removed",
    ]);
    const removed = rows.find((r) => r.observation === "removed")!;
    expect([
      removed.pending,
      Number(removed.amount_cents),
      !!removed.supersedes_transaction_id,
    ]).toEqual([true, -999, true]);
    await expect(
      owner.q("update public.transactions set amount_cents=0"),
    ).rejects.toThrow();
    await expect(owner.q("delete from public.transactions")).rejects.toThrow();
    const [account] = await owner.q(
      "select a.*, c.* from public.accounts a join public.account_coverage c on c.account_id=a.id",
    );
    expect(account).toMatchObject({
      mapping_status: "proposed",
      mask: "4242",
      synced_through: "2026-10-27",
      last_error: null,
    });
    expect(account.external_ref).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(account)).not.toContain("ACT-SYNTH-1");
    expect(
      await (await user()).q("select * from public.transactions"),
    ).toHaveLength(0);
  });

  it("keeps coverage unchanged and marks the connection stale when a sync fails", async () => {
    const connection = await connect();
    await syncConnection(
      owner.id,
      connection,
      "manual",
      fake(() => batch),
      new Date("2026-10-28T15:00:00Z"),
    );
    const before = await owner.one(
      "select c.* from public.account_coverage c join public.accounts a on a.id=c.account_id where a.connection_id=$1",
      [connection],
    );
    const failed = await syncConnection(
      owner.id,
      connection,
      "scheduled",
      fake(() => new Error("SimpleFIN returned status 500.")),
    );
    expect(failed.status).toBe("failed");
    const after = await owner.one(
      "select c.* from public.account_coverage c join public.accounts a on a.id=c.account_id where a.connection_id=$1",
      [connection],
    );
    expect([
      after.synced_through,
      after.last_success_at,
      after.last_error,
    ]).toEqual([
      before.synced_through,
      before.last_success_at,
      "SimpleFIN returned status 500.",
    ]);
    expect(
      (
        await owner.one(
          "select status from public.source_connections where id=$1",
          [connection],
        )
      ).status,
    ).toBe("error");
  });

  it("refuses a second manual sync within 30 minutes to protect SimpleFIN's daily quota", async () => {
    const connection = await connect();
    let calls = 0;
    const adapters = fake(() => {
      calls++;
      return batch;
    });
    await runSourceOperation(
      owner.id,
      "syncConnection",
      { connection_id: connection },
      adapters,
    );
    await expect(
      runSourceOperation(
        owner.id,
        "syncConnection",
        { connection_id: connection },
        adapters,
      ),
    ).rejects.toThrow(/about 24 requests a day/);
    expect(calls).toBe(1);
  });

  it("confirms a proposed mapping only for the owner's own card", async () => {
    const [account] = await owner.q(
      "select id, proposed_card_id from public.accounts where mapping_status='proposed' limit 1",
    );
    const stranger = await user();
    const foreign = await insert(stranger, "cards", {
      issuer: "Chase",
      display_name: "Not yours",
    });
    await expect(
      runSourceOperation(owner.id, "confirmMapping", {
        account_id: account.id,
        card_id: foreign.id,
      }),
    ).rejects.toThrow();
    const confirmed = (await runSourceOperation(owner.id, "confirmMapping", {
      account_id: account.id,
      card_id: account.proposed_card_id,
    })) as { mapping_status: string };
    expect(confirmed.mapping_status).toBe("confirmed");
  });

  it("imports a CSV once, replays it as a no-op, and rejects the same file with different settings", async () => {
    const file =
      "Date,Description,Amount\n10/01/2026,SYNTHETIC GROCER,-4.00\n10/01/2026,SYNTHETIC GROCER,-4.00\n10/03/2026,SYNTHETIC REFUND,2.00\n";
    const first = (await runSourceOperation(owner.id, "importCsv", {
      file_name: "synthetic.csv",
      file_text: file,
      format: "generic-signed",
      new_account: {
        institution: "Synthetic Issuer",
        name: "Synthetic card export",
        mask: null,
      },
    })) as {
      added: number;
      import: {
        account_id: string;
        coverage_start: string;
        coverage_end: string;
      };
    };
    expect(first.added).toBe(3);
    expect([first.import.coverage_start, first.import.coverage_end]).toEqual([
      "2026-10-01",
      "2026-10-03",
    ]);
    const replay = (await runSourceOperation(owner.id, "importCsv", {
      file_name: "synthetic.csv",
      file_text: file,
      format: "generic-signed",
      account_id: first.import.account_id,
    })) as { replay: boolean };
    expect(replay.replay).toBe(true);
    await expect(
      runSourceOperation(owner.id, "importCsv", {
        file_name: "synthetic.csv",
        file_text: file,
        format: "amex",
        account_id: first.import.account_id,
      }),
    ).rejects.toThrow(/different settings/);
    expect(
      await owner.q("select * from public.transactions where account_id=$1", [
        first.import.account_id,
      ]),
    ).toHaveLength(3);
  });
});
