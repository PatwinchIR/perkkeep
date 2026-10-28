// Browser → Next.js server → Neon Auth → Neon PostgreSQL → read-back.
// Runs against PLAYWRIGHT_BASE_URL (the HTTPS deployment) or a local dev server
// that uses the same remote database. It signs in with two dedicated, already
// email-verified test owners (for example plus-aliases of the owner's address,
// allowed with PERKKEEP_OWNER_PLUS_ALIASES=allow). Every record it writes is labeled
// synthetic, belongs to those test owners, and its test rule is paused afterwards.
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { localDate } from "../../src/lib/domain";
import type { Period, Snapshot } from "../../src/lib/types";

const owners = {
  a: {
    email: process.env.PERKKEEP_E2E_OWNER_EMAIL ?? "",
    password: process.env.PERKKEEP_E2E_OWNER_PASSWORD ?? "",
  },
  b: {
    email: process.env.PERKKEEP_E2E_OTHER_EMAIL ?? "",
    password: process.env.PERKKEEP_E2E_OTHER_PASSWORD ?? "",
  },
};
const haveOwners = Object.values(owners).every((o) => o.email && o.password);
const hash = (v: string) => createHash("sha256").update(v).digest("hex");

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Good things, kept in view." }),
  ).toBeVisible({ timeout: 30000 });
}
async function api<T = unknown>(
  request: APIRequestContext,
  baseURL: string,
  op: string,
  input: unknown,
): Promise<{ status: number; data?: T; error?: string }> {
  const response = await request.post("/api/ledger", {
    data: { op, input },
    headers: { origin: new URL(baseURL).origin },
  });
  return { status: response.status(), ...(await response.json()) };
}
async function snapshot(request: APIRequestContext): Promise<Snapshot> {
  const response = await request.get("/api/ledger");
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
/** A fresh, uniquely named synthetic rule on the owner's Discover it card. */
async function fixture(page: Page, baseURL: string) {
  const r = page.request;
  expect((await api(r, baseURL, "initialize_cards", {})).status).toBe(200);
  const card = (await snapshot(r)).cards.find(
    (c) => c.catalog_key === "discover-it",
  )!;
  expect(
    (
      await api(r, baseURL, "update_card", {
        id: card.id,
        display_name: card.display_name,
        product_name: card.product_name,
        last4: card.last4,
        status: "active",
        cardmember_anchor_date: card.cardmember_anchor_date,
        issuer_timezone: card.issuer_timezone,
      })
    ).status,
  ).toBe(200);
  const name = `Synthetic e2e ${randomUUID().slice(0, 8)} — not an entitlement`;
  const benefit = await api<{ id: string }>(r, baseURL, "create_benefit", {
    card_id: card.id,
    name,
    description: "Synthetic browser test only.",
    category: "Other",
    cadence: "monthly",
    nominal_amount_cents: 1000,
    nominal_units: null,
    unit_label: null,
    reset_anchor: null,
    custom_end_exclusive: null,
    effective_from: "2020-01-01",
    effective_to: null,
    enrollment_required: false,
    enrollment_status: "not_required",
    eligibility_status: "eligible",
    manual_verification_required: false,
    eligibility_rules_json: { synthetic: true },
    issuer_source_url: "https://example.com/synthetic-test-only",
    verified_at: new Date().toISOString(),
    enabled: true,
  });
  expect(benefit.status).toBe(200);
  const period = await api<Period>(r, baseURL, "ensure_period", {
    benefit_id: benefit.data!.id,
    on: localDate(),
  });
  expect(period.status).toBe(200);
  return { card, benefitId: benefit.data!.id, name, period: period.data! };
}
const candidate = (periodId: string, day: string, cents: number) => ({
  benefit_period_id: periodId,
  source_type: "purchase",
  source_reference_hash: hash(randomUUID()),
  transaction_date: day,
  amount_cents: cents,
  confidence: "candidate",
  eligibility_result: "eligible",
  recorded_by: "import",
  notes: "Synthetic imported candidate",
});

test("login screen is accessible, installable, and caches only public assets", async ({
  page,
  request,
}) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations.map((v) => v.id)).toEqual([]);
  await noOverflow(page);
  const manifest = await request.get("/manifest.webmanifest");
  expect((await manifest.json()).display).toBe("standalone");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const k of await caches.keys())
      for (const r of await (await caches.open(k)).keys())
        urls.push(new URL(r.url).pathname);
    return urls;
  });
  expect(cached).toContain("/offline.html");
  expect(
    cached.every((p) => p === "/offline.html" || p.startsWith("/icons/")),
  ).toBe(true);
});

test("denies anonymous, forged and cross-origin ledger access", async ({
  request,
  baseURL,
}) => {
  const anon = await request.get("/api/ledger");
  expect(anon.status()).toBe(401);
  expect(anon.headers()["cache-control"]).toContain("no-store");
  expect(
    (
      await request.get("/api/ledger", {
        headers: { cookie: "__Secure-neon-auth.session_token=forged" },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/ledger", {
        data: { op: "initialize_cards", input: {} },
        headers: { origin: "https://attacker.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/ledger", {
        data: { op: "initialize_cards", input: {} },
        headers: { origin: new URL(baseURL!).origin },
      })
    ).status(),
  ).toBe(401);
  expect((await request.post("/api/auth/admin/list-users")).status()).toBe(404);
  const stranger = await request.post("/api/auth/sign-up/email", {
    data: {
      email: `stranger-${randomUUID()}@example.com`,
      password: randomUUID(),
      name: "x",
    },
    headers: { origin: new URL(baseURL!).origin },
  });
  expect(stranger.status()).toBe(403);
});

test.describe("signed-in owners", () => {
  test.skip(!haveOwners, "Set the PERKKEEP_E2E_* test owner credentials.");

  test("records, corrects and rejects evidence with read-back and audit history", async ({
    page,
    baseURL,
  }) => {
    await login(page, owners.a);
    const { card, benefitId, name, period } = await fixture(page, baseURL!);
    try {
      await page.goto(`/cards/${card.id}`);
      const panel = page.locator(".period-panel").filter({ hasText: name });
      await panel
        .getByRole("button", { name: "Confirm redemption", exact: true })
        .click();
      await page.getByLabel("Amount in dollars").fill("3");
      await page
        .getByLabel("What did you verify?")
        .fill("Synthetic issuer confirmation for browser test.");
      await page
        .getByLabel("This assessment is supported by the evidence I reviewed.")
        .check();
      await page.getByRole("button", { name: "Save evidence" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.reload();
      await expect(panel.locator(".period-amounts")).toContainText("$3");
      const imported = await api<{ id: string }>(
        page.request,
        baseURL!,
        "record_evidence",
        { record: candidate(period.id, period.period_start, 400) },
      );
      expect(imported.status).toBe(200);
      await page.getByRole("button", { name: "Refresh records" }).click();
      await panel.getByRole("button", { name: /Evidence \(/ }).click();
      await panel.getByRole("button", { name: "Review candidate" }).click();
      await page
        .getByLabel("What did you verify?")
        .fill("Synthetic posted credit checked by user.");
      await page
        .getByLabel("This assessment is supported by the evidence I reviewed.")
        .check();
      await page.getByRole("button", { name: "Save correction" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(panel.locator(".period-amounts")).toContainText("$7");
      const rows = (await snapshot(page.request)).evidence.filter(
        (e) => e.benefit_period_id === period.id,
      );
      expect(rows).toHaveLength(3);
      expect(
        rows.find((e) => e.supersedes_evidence_id === imported.data!.id)
          ?.confidence,
      ).toBe("confirmed");
      await api(page.request, baseURL!, "record_evidence", {
        record: candidate(period.id, period.period_start, 100),
      });
      await page.getByRole("button", { name: "Refresh records" }).click();
      await panel.getByRole("button", { name: "Reject candidate" }).click();
      await page
        .getByLabel("Reason")
        .fill("Synthetic nonqualifying transaction.");
      await page.getByRole("button", { name: "Save rejection" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await panel.getByRole("button", { name: "Add note" }).click();
      const note = `Synthetic audit note ${randomUUID().slice(0, 8)}`;
      await page.getByLabel("Note", { exact: true }).fill(note);
      await page.getByRole("button", { name: "Save note" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.goto("/history");
      await page.getByLabel("History view").selectOption("audit");
      await expect(page.getByText(note).first()).toBeVisible();
      await noOverflow(page);
    } finally {
      await api(page.request, baseURL!, "set_benefit_enabled", {
        benefit_id: benefitId,
        enabled: false,
      });
    }
  });

  test("replays idempotently, rejects changed payloads and preserves earlier periods", async ({
    page,
    baseURL,
  }) => {
    await login(page, owners.a);
    const { benefitId, period } = await fixture(page, baseURL!);
    try {
      const record = candidate(period.id, period.period_start, 250);
      const first = await api<{ id: string }>(
        page.request,
        baseURL!,
        "record_evidence",
        { record },
      );
      const replay = await api<{ id: string }>(
        page.request,
        baseURL!,
        "record_evidence",
        { record },
      );
      expect(replay.data!.id).toBe(first.data!.id);
      const changed = await api(page.request, baseURL!, "record_evidence", {
        record: { ...record, amount_cents: 999 },
      });
      expect(changed.status).toBe(400);
      expect(changed.error).toMatch(/Idempotency key reused/);
      const request = {
        request_key: randomUUID(),
        trigger: "manual",
        periods: [
          {
            id: period.id,
            coverage_status: "partial",
            coverage_through: localDate(),
          },
        ],
        evidence: [record],
        summary: {
          source: "synthetic_engineering_fixture",
          finances_available: "not_tested",
        },
      };
      const run1 = await api<{ id: string; status: string }>(
        page.request,
        baseURL!,
        "apply_reconciliation",
        request,
      );
      const run2 = await api<{ id: string }>(
        page.request,
        baseURL!,
        "apply_reconciliation",
        request,
      );
      expect(run1.data!.status).toBe("partial");
      expect(run2.data!.id).toBe(run1.data!.id);
      const reused = await api(page.request, baseURL!, "apply_reconciliation", {
        ...request,
        summary: { source: "changed" },
      });
      expect(reused.status).toBe(400);
      const earlier = new Date();
      earlier.setDate(1);
      earlier.setMonth(earlier.getMonth() - 1);
      expect(
        (
          await api(page.request, baseURL!, "ensure_period", {
            benefit_id: benefitId,
            on: earlier.toISOString().slice(0, 10),
          })
        ).status,
      ).toBe(200);
      const snap = await snapshot(page.request);
      const mine = snap.periods.filter((p) => p.benefit_id === benefitId);
      expect(mine).toHaveLength(2);
      const current = mine.find((p) => p.id === period.id)!;
      expect(current.candidate_cents).toBe(250);
      expect(current.coverage_status).toBe("partial");
      expect(
        snap.evidence.filter((e) => e.benefit_period_id === period.id),
      ).toHaveLength(1);
    } finally {
      await api(page.request, baseURL!, "set_benefit_enabled", {
        benefit_id: benefitId,
        enabled: false,
      });
    }
  });

  test("isolates owners and revokes the session on sign-out", async ({
    browser,
    baseURL,
  }) => {
    const aContext = await browser.newContext();
    const a = await aContext.newPage();
    await login(a, owners.a);
    const { benefitId, name, period } = await fixture(a, baseURL!);
    const bContext = await browser.newContext();
    const b = await bContext.newPage();
    try {
      await login(b, owners.b);
      const theirs = await snapshot(b.request);
      expect(JSON.stringify(theirs)).not.toContain(period.id);
      expect(JSON.stringify(theirs)).not.toContain(benefitId);
      const intrusion = await api(b.request, baseURL!, "record_evidence", {
        record: candidate(period.id, period.period_start, 100),
      });
      expect(intrusion.status).toBeGreaterThanOrEqual(400);
      await b.goto("/history");
      await expect(b.getByText(name)).toHaveCount(0);
      // Sign out, then replay the old session cookie: the server must refuse it.
      const cookies = await bContext.cookies();
      await b.goto("/settings");
      await b.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(
        b.getByRole("heading", { name: "Welcome back." }),
      ).toBeVisible();
      expect((await b.request.get("/api/ledger")).status()).toBe(401);
      const replayContext = await browser.newContext();
      await replayContext.addCookies(cookies);
      expect((await replayContext.request.get("/api/ledger")).status()).toBe(
        401,
      );
      await replayContext.close();
    } finally {
      await api(a.request, baseURL!, "set_benefit_enabled", {
        benefit_id: benefitId,
        enabled: false,
      });
      await aContext.close();
      await bContext.close();
    }
  });
});
