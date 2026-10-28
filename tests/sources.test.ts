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
  it("never requests more than SimpleFIN's recommended 45-day window and overlaps the last success by two weeks", () => {
    const now = new Date("2026-10-28T15:00:00Z");
    expect(syncWindow(null, now)).toEqual({
      start: "2026-09-14",
      endExclusive: "2026-10-29",
    });
    // A long outage still asks for at most 45 days.
    expect(syncWindow("2026-01-01T15:00:00Z", now)).toEqual({
      start: "2026-09-14",
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
  it("reads a Copilot Money export: flips signs, names each row's account and drops transfers, pending and unplaced rows", () => {
    const s = parseStatement(COPILOT_EXPORT);
    expect(s.format.id).toBe("copilot-money");
    expect(
      s.rows.map((r) => [
        r.transactedOn,
        r.amountCents,
        r.description,
        r.account?.name,
        r.account?.mask,
      ]),
    ).toEqual([
      ["2026-10-01", -1200, "Synthetic Cafe", "Synthetic Rewards", "4343"],
      [
        "2026-10-02",
        500,
        "Synthetic Credit $300-year",
        "Synthetic Rewards",
        "4343",
      ],
      ["2026-10-20", -700, "Synthetic Grocer", "Synthetic Rewards", "4343"],
      ["2026-10-03", -300, "Synthetic Toll", "Synthetic Checking", "1111"],
      ["2026-10-06", -500, "Synthetic Bakery", "Apple\u00a0Card", null],
    ]);
    expect([s.coverageStart, s.coverageEnd]).toEqual([
      "2026-10-01",
      "2026-10-20",
    ]);
  });
});

// Synthetic Copilot Money export: header as Copilot writes it, invented accounts and digits.
const COPILOT_EXPORT = [
  "date,name,amount,status,category,parent category,excluded,tags,type,account,account mask,note,recurring",
  "2026-10-01,Synthetic Cafe,12,posted,Restaurants,Food,false,,regular,Synthetic Rewards,4343,,",
  '2026-10-02,"Synthetic Credit $300-year",-5,posted,Travel,Travel,false,,regular,Synthetic Rewards,4343,,',
  "2026-10-20,Synthetic Grocer,7,posted,Groceries,Food,false,,regular,Synthetic Rewards,4343,,",
  "2026-10-21,Synthetic Pending,3,pending,Shops,Shops,false,,regular,Synthetic Rewards,4343,,",
  "2026-10-05,Payment Thank You,-200,posted,Internal Transfer,Internal Transfer,false,,internal transfer,Synthetic Rewards,4343,,",
  "2026-10-03,Synthetic Toll,3,posted,Transportation,Transportation,false,,regular,Synthetic Checking,1111,,",
  "2026-10-04,Synthetic Orphan,4,posted,Other,Other,false,,regular,,,,",
  "2026-10-06,Synthetic Bakery,5,posted,Restaurants,Food,false,,regular,Apple\u00a0Card,,,",
  "",
].join("\n");

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
      mapping_status: "confirmed",
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

  it("links a mapping only to the owner's own card", async () => {
    const [account] = await owner.q(
      "select id, proposed_card_id from public.accounts where mapping_status='confirmed' limit 1",
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

  it("splits a Copilot Money export by account, links by digits, leaves synced days to the sync and replays as a no-op", async () => {
    const card = await insert(owner, "cards", {
      issuer: "Synthetic Issuer",
      display_name: "Synthetic Rewards Card",
      last4: "4343",
      status: "active",
      identity_verified_at: new Date().toISOString(),
    });
    // A synced account the owner linked to the card, with history from 2026-10-15.
    const synced = await insert(owner, "accounts", {
      source: "simplefin",
      external_ref: randomBytes(32).toString("hex"),
      institution: "Synthetic Issuer",
      name: "Synthetic Rewards (4343)",
      mask: "4343",
      kind: "credit",
      card_id: card.id,
      proposed_card_id: card.id,
      mapping_status: "confirmed",
      mapping_confirmed_at: new Date().toISOString(),
    });
    await owner.q("select public.record_account_sync($1,$2,$3,null)", [
      synced.id,
      "2026-10-15",
      "2026-10-27",
    ]);
    type Result = {
      replay: boolean;
      added: number;
      accounts: {
        account: string;
        card: string | null;
        status: string;
        reason: string | null;
        added: number;
        left_to_sync: number;
        coverage_start: string | null;
        coverage_end: string | null;
      }[];
    };
    const first = (await runSourceOperation(owner.id, "importCsv", {
      file_name: "synthetic-copilot.csv",
      file_text: COPILOT_EXPORT,
    })) as Result;
    expect(first.replay).toBe(false);
    expect(first.added).toBe(2);
    expect(first.accounts).toEqual([
      expect.objectContaining({
        account: "Apple\u00a0Card",
        card: null,
        status: "skipped",
        reason: "No active card matches its product.",
      }),
      expect.objectContaining({
        account: "Synthetic Checking",
        card: null,
        status: "skipped",
        reason: "No card has its last four digits.",
      }),
      expect.objectContaining({
        account: "Synthetic Rewards",
        card: "Synthetic Rewards Card",
        status: "imported",
        added: 2,
        left_to_sync: 1,
        coverage_start: "2026-10-01",
        coverage_end: "2026-10-14",
      }),
    ]);
    const [csvAccount] = await owner.q(
      "select a.*, c.earliest_synced_on, c.synced_through from public.accounts a join public.account_coverage c on c.account_id=a.id where a.source='csv' and a.card_id=$1",
      [card.id],
    );
    expect(csvAccount.mapping_status).toBe("confirmed");
    expect(csvAccount.mask).toBe("4343");
    expect([csvAccount.earliest_synced_on, csvAccount.synced_through]).toEqual([
      "2026-10-01",
      "2026-10-14",
    ]);
    const rows = await owner.q(
      "select transacted_on, amount_cents, description from public.transactions where account_id=$1 order by transacted_on",
      [csvAccount.id],
    );
    expect(
      rows.map((r) => [r.transacted_on, Number(r.amount_cents), r.description]),
    ).toEqual([
      ["2026-10-01", -1200, "Synthetic Cafe"],
      ["2026-10-02", 500, "Synthetic Credit $300-year"],
    ]);
    const again = (await runSourceOperation(owner.id, "importCsv", {
      file_name: "synthetic-copilot.csv",
      file_text: COPILOT_EXPORT,
    })) as Result;
    expect(again.replay).toBe(true);
    expect(
      again.accounts.find((a) => a.account === "Synthetic Rewards")?.status,
    ).toBe("unchanged");
    expect(
      await owner.q(
        "select 1 from public.accounts where source='csv' and card_id=$1",
        [card.id],
      ),
    ).toHaveLength(1);
  });
});

describe("card accounts become the owner's cards (synthetic owner, D41)", () => {
  it("fills starter cards, creates missing ones, skips bank accounts, hides unused starters and respects unlinking", async () => {
    const { loadSnapshot } = await import("../src/server/ledger");
    const { linkAccounts } = await import("../src/server/sources/sync");
    const owner = await user();
    await owner.q("select public.initialize_cards()");
    const account = (id: string, name: string, conn: string) => ({
      id,
      name,
      conn_id: conn,
      currency: "USD",
      balance: "0",
      "balance-date": epoch("2026-10-27"),
      transactions: [],
    });
    const batch = normalizeAccountSet({
      errlist: [],
      connections: [
        { conn_id: "C1", name: "Synthetic Chase" },
        { conn_id: "C2", name: "Synthetic Citi" },
        { conn_id: "C3", name: "Apple Card" },
      ],
      accounts: [
        account("A1", "Synthetic Sapphire Reserve (...1111)", "C1"),
        account("A2", "Synthetic Strata ...2222", "C2"),
        account("A3", "Synthetic Total Checking ...3333", "C1"),
        account("A4", "Apple Card", "C3"),
      ],
    } as never);
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
    await syncConnection(owner.id, id, "claim", {
      simplefin: { source: "simplefin", fetch: async () => batch },
      plaid: { source: "plaid", fetch: async () => batch },
    });
    const linked = await owner.q(
      `select a.name, a.mapping_status, c.catalog_key, c.last4, c.status, c.identity_verified_at is not null as verified
       from public.accounts a left join public.cards c on c.id=a.card_id order by a.name`,
    );
    expect(
      linked.map((r) => [
        r.name,
        r.mapping_status,
        r.catalog_key,
        r.last4,
        r.verified,
      ]),
    ).toEqual([
      ["Apple Card", "confirmed", "apple-card", null, true],
      [
        "Synthetic Sapphire Reserve (...1111)",
        "confirmed",
        "chase-sapphire-reserve",
        "1111",
        true,
      ],
      ["Synthetic Strata ...2222", "confirmed", "citi-strata", "2222", true],
      ["Synthetic Total Checking ...3333", "unmapped", null, null, false],
    ]);
    // The starter Sapphire Reserve was filled in, not duplicated.
    expect(
      await owner.q(
        "select id from public.cards where catalog_key='chase-sapphire-reserve'",
      ),
    ).toHaveLength(1);
    const snapshot = await withOwner(owner.id, (tx) => loadSnapshot(tx));
    expect(snapshot.cards.map((c) => c.catalog_key).sort()).toEqual([
      "apple-card",
      "chase-sapphire-reserve",
      "citi-strata",
    ]);
    const strata = await owner.one(
      "select id from public.accounts where name like '%Strata%'",
    );
    await runSourceOperation(owner.id, "rejectMapping", {
      account_id: strata.id,
    });
    await withOwner(owner.id, (tx) => linkAccounts(tx));
    expect(
      (
        await owner.one(
          "select mapping_status from public.accounts where id=$1",
          [strata.id],
        )
      ).mapping_status,
    ).toBe("rejected");
  });
});

describe("SimpleFIN account names as issuers send them (synthetic digits)", () => {
  it("reads digits in parentheses and identifies products, including Discover under Capital One", async () => {
    const { identifyAccount } = await import("../src/server/sources/sync");
    const { maskFrom } = await import("../src/server/sources/simplefin");
    const cases: [string, string, string | null, string | undefined][] = [
      [
        "Chase Bank",
        "Sapphire Reserve (1111)",
        "1111",
        "chase-sapphire-reserve",
      ],
      ["Capital One", "Discover it (2222)", "2222", "discover-it"],
      ["Chase Bank", "Amazon Prime (3333)", "3333", "chase-prime-visa"],
      ["Citibank", "Citi Strata℠ Card-4444 (4444)", "4444", "citi-strata"],
      [
        "Citibank",
        "Costco Anywhere Visa® Card by Citi-5555 (5555)",
        "5555",
        "citi-costco-anywhere",
      ],
      [
        "American Express",
        "American Express Gold Card (6666)",
        "6666",
        "amex-gold",
      ],
      ["Chase Bank", "SYNTHETIC HOLDER (7777)", "7777", undefined],
      ["Synthetic Brokerage", "Brokerage ...123 (123)", null, undefined],
    ];
    for (const [institution, name, mask, key] of cases) {
      expect(maskFrom(name)).toBe(mask);
      expect(identifyAccount({ institution, name }).product?.key).toBe(key);
    }
    expect(
      identifyAccount({
        institution: "Capital One",
        name: "Discover it (2222)",
      }).issuer?.name,
    ).toBe("Discover");
  });

  it("backfills digits, links an unknown-kind account only to a card that already has its digits, and skips bank accounts", async () => {
    const { linkAccounts } = await import("../src/server/sources/sync");
    const owner = await user();
    await owner.q("select public.initialize_cards()");
    await owner.q(
      "update public.cards set last4='7777', status='active', identity_verified_at=now() where catalog_key='chase-ink-business-cash'",
    );
    const add = (institution: string, name: string, kind: string) =>
      owner.q(
        "insert into public.accounts(source,external_ref,institution,name,kind) values('simplefin',$1,$2,$3,$4)",
        [randomBytes(32).toString("hex"), institution, name, kind],
      );
    await add("Chase Bank", "SYNTHETIC HOLDER (7777)", "unknown");
    await add("Chase Bank", "SYNTHETIC HOLDER (8888)", "unknown");
    await add("Capital One", "Discover it (2222)", "unknown");
    await add("Synthetic Bank", "Checking (9999)", "depository");
    await withOwner(owner.id, (tx) => linkAccounts(tx));
    const rows = await owner.q(
      `select a.name, a.mask, a.mapping_status, c.catalog_key from public.accounts a
       left join public.cards c on c.id=a.card_id order by a.name`,
    );
    expect(
      rows.map((r) => [r.name, r.mask, r.mapping_status, r.catalog_key]),
    ).toEqual([
      ["Checking (9999)", "9999", "unmapped", null],
      ["Discover it (2222)", "2222", "confirmed", "discover-it"],
      [
        "SYNTHETIC HOLDER (7777)",
        "7777",
        "confirmed",
        "chase-ink-business-cash",
      ],
      ["SYNTHETIC HOLDER (8888)", "8888", "unmapped", null],
    ]);
  });
});
