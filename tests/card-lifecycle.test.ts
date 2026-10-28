import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { appPool, fixture, recordEvidence, user } from "./helpers";
import {
  loadSnapshot,
  runOperation,
  type Operation,
} from "../src/server/ledger";

// Synthetic owners in the local perkkeep_test database, through the same named operations
// the server runs for the browser.
let alice: Awaited<ReturnType<typeof user>>,
  bob: Awaited<ReturnType<typeof user>>;
beforeAll(async () => {
  alice = await user();
  bob = await user();
});
afterAll(() => appPool.end());

async function as<T>(
  owner: { id: string },
  work: (tx: import("pg").PoolClient) => Promise<T>,
) {
  const client = await appPool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.owner_id',$1,true)", [owner.id]);
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
const op = (owner: { id: string }, name: Operation, input: unknown) =>
  as(owner, (tx) => runOperation(tx as never, name, input));
const snapshot = (owner: { id: string }) =>
  as(owner, (tx) => loadSnapshot(tx as never));

describe("owner-managed cards", () => {
  it("adds a card by hand as unverified, rejects a duplicate ending, and keeps it visible", async () => {
    const card = (await op(alice, "addCard", {
      issuer: "Synthetic Issuer",
      display_name: "Synthetic added card",
      product_name: "Synthetic Product",
      last4: "4321",
    })) as Record<string, unknown>;
    expect(card).toMatchObject({
      status: "unknown",
      identity_verified_at: null,
      catalog_key: null,
      archived_at: null,
    });
    await expect(
      op(alice, "addCard", {
        issuer: "Synthetic Issuer",
        display_name: "Duplicate",
        product_name: null,
        last4: "4321",
      }),
    ).rejects.toThrow(/already have/);
    await expect(
      op(alice, "addCard", {
        issuer: "",
        display_name: "x",
        product_name: null,
        last4: null,
      }),
    ).rejects.toThrow(/Invalid addCard/);
    expect((await snapshot(alice)).cards.map((c) => c.id)).toContain(card.id);
    expect((await snapshot(bob)).cards.map((c) => c.id)).not.toContain(card.id);
  });

  it("removes a card by archiving it: history stays, new periods stop, restore is owner-only", async () => {
    const { card, benefit, period } = await fixture(alice);
    await recordEvidence(alice, {
      benefit_period_id: period.id,
      source_type: "purchase",
      source_reference_hash: createHash("sha256")
        .update(randomUUID())
        .digest("hex"),
      transaction_date: "2026-10-10",
      amount_cents: 500,
      confidence: "candidate",
      eligibility_result: "eligible",
      recorded_by: "import",
    });
    await expect(op(bob, "archiveCard", { id: card.id })).rejects.toThrow(
      /not found/,
    );
    await op(alice, "archiveCard", { id: card.id });
    await expect(op(alice, "archiveCard", { id: card.id })).rejects.toThrow(
      /not found/,
    );
    let snap = await snapshot(alice);
    expect(snap.cards.find((c) => c.id === card.id)?.archived_at).toBeTruthy();
    expect(snap.periods.find((p) => p.id === period.id)?.candidate_cents).toBe(
      500,
    );
    expect(
      snap.evidence.filter((e) => e.benefit_period_id === period.id),
    ).toHaveLength(1);
    expect(snap.periodErrors).toEqual([]);
    await expect(
      op(alice, "ensurePeriod", { benefit_id: benefit.id, on: "2026-11-02" }),
    ).rejects.toThrow(/removed/);
    await expect(op(bob, "restoreCard", { id: card.id })).rejects.toThrow(
      /not found/,
    );
    await op(alice, "restoreCard", { id: card.id });
    await op(alice, "ensurePeriod", {
      benefit_id: benefit.id,
      on: "2026-11-02",
    });
    snap = await snapshot(alice);
    expect(snap.cards.find((c) => c.id === card.id)?.archived_at).toBeNull();
    expect(
      snap.audit.filter((a) => a.entity_id === card.id && a.action === "UPDATE")
        .length,
    ).toBeGreaterThanOrEqual(2);
  });
});
