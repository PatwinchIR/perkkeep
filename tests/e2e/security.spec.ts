import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { env, user } from "../helpers";

// Server-side boundaries, exercised over HTTP against the running app with synthetic identities.
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "HTTP checks run once",
  );
});
const ORIGIN = "http://127.0.0.1:3017";
async function signIn(
  request: APIRequestContext,
  data: {
    email: string;
    subject?: string;
    emailVerified?: boolean;
    ttlSeconds?: number;
  },
) {
  const r = await request.post("/api/test-auth", {
    headers: { "x-perkkeep-test-secret": env.TEST_AUTH_SECRET },
    data,
  });
  expect(r.ok()).toBe(true);
}
const post = (
  request: APIRequestContext,
  op: string,
  input: unknown,
  origin: string | null = ORIGIN,
) =>
  request.post("/api/ledger", {
    headers: origin ? { origin, "sec-fetch-site": "same-origin" } : {},
    data: { op, input },
  });

test("refuses ledger access without a verified owner session", async ({
  playwright,
}) => {
  const anonymous = await playwright.request.newContext({ baseURL: ORIGIN });
  const r = await anonymous.get("/api/ledger");
  expect(r.status()).toBe(401);
  expect(r.headers()["cache-control"]).toBe("no-store");

  const forged = await playwright.request.newContext({
    baseURL: ORIGIN,
    extraHTTPHeaders: {
      cookie:
        "perkkeep_test_session=eyJlbWFpbCI6Im93bmVyQHBlcmtrZWVwLnRlc3QifQ.forged",
    },
  });
  expect((await forged.get("/api/ledger")).status()).toBe(401);

  const unverified = await playwright.request.newContext({ baseURL: ORIGIN });
  await signIn(unverified, {
    email: "owner@perkkeep.test",
    emailVerified: false,
  });
  const u = await unverified.get("/api/ledger");
  expect(u.status()).toBe(403);
  expect((await u.json()).error.code).toBe("email_unverified");

  const stranger = await playwright.request.newContext({ baseURL: ORIGIN });
  await signIn(stranger, { email: `stranger-${randomUUID()}@perkkeep.test` });
  const s = await stranger.get("/api/ledger");
  expect(s.status()).toBe(403);
  expect((await s.json()).error.code).toBe("not_owner");

  const expired = await playwright.request.newContext({ baseURL: ORIGIN });
  await signIn(expired, { email: "owner@perkkeep.test", ttlSeconds: -1 });
  const e = await expired.get("/api/ledger");
  expect(e.status()).toBe(401);
  expect((await e.json()).error.code).toBe("expired");
});

test("rejects cross-origin and origin-less writes, unknown operations, and other owners' records", async ({
  playwright,
}) => {
  const alice = await user("owner@perkkeep.test");
  await alice.q("select public.initialize_cards()");
  const [card] = await alice.q("select * from public.cards limit 1");
  const bob = await playwright.request.newContext({ baseURL: ORIGIN });
  await signIn(bob, { email: "owner2@perkkeep.test" });
  const input = {
    id: card.id,
    display_name: "Taken over",
    product_name: null,
    last4: null,
    status: "active",
    cardmember_anchor_date: null,
    issuer_timezone: "America/New_York",
  };
  expect(
    (await post(bob, "updateCard", input, "https://evil.example")).status(),
  ).toBe(403);
  expect((await post(bob, "updateCard", input, null)).status()).toBe(403);
  expect((await post(bob, "dropEverything", {})).status()).toBe(400);
  const r = await post(bob, "updateCard", input);
  expect(r.status()).toBe(400);
  expect(
    (
      await alice.one("select display_name from public.cards where id=$1", [
        card.id,
      ])
    ).display_name,
  ).toBe(card.display_name);
  // The snapshot for Bob contains none of Alice's records.
  const snapshot = (await (await bob.get("/api/ledger")).json()).data;
  expect(snapshot.cards.some((c: { id: string }) => c.id === card.id)).toBe(
    false,
  );
});

test("forces owner provenance on evidence entered through the app", async ({
  playwright,
}) => {
  const owner = await user("owner@perkkeep.test");
  const ctx = await playwright.request.newContext({ baseURL: ORIGIN });
  await signIn(ctx, { email: owner.email, subject: owner.subject });
  const card = await owner.one(
    "insert into public.cards(issuer,display_name,status,identity_verified_at) values('Synthetic','Synthetic',$1,now()) returning *",
    ["active"],
  );
  const benefit = await owner.one(
    `insert into public.benefits(card_id,name,cadence,nominal_amount_cents,effective_from,issuer_source_url,verified_at,enabled,eligibility_status,enrollment_status)
     values($1,'Synthetic benefit','monthly',1000,'2020-01-01','https://example.com/synthetic-test-only',now(),true,'eligible','not_required') returning *`,
    [card.id],
  );
  const today = new Date().toISOString().slice(0, 10);
  const period = await owner.one("select * from public.ensure_period($1,$2)", [
    benefit.id,
    today,
  ]);
  const r = await post(ctx, "recordEvidence", {
    benefit_period_id: period.id,
    source_type: "purchase",
    transaction_date: period.period_start,
    amount_cents: 100,
    confidence: "candidate",
    eligibility_result: "eligible",
    recorded_by: "import",
  });
  expect(r.status()).toBe(200);
  expect((await r.json()).data.recorded_by).toBe("user");
});

test("keeps the local test sign-in closed to other origins", async ({
  playwright,
}) => {
  const ctx = await playwright.request.newContext({ baseURL: ORIGIN });
  const r = await ctx.post("/api/test-auth", {
    headers: { origin: "https://evil.example" },
    data: { email: "owner@perkkeep.test" },
  });
  expect(r.status()).toBe(403);
  const wrong = await ctx.post("/api/test-auth", {
    headers: { "x-perkkeep-test-secret": "wrong" },
    data: { email: "owner@perkkeep.test" },
  });
  expect(wrong.status()).toBe(403);
});
