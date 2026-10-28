import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, ok, user } from "../helpers";
import { localDate } from "../../src/lib/domain";
async function login(page: Page, owner: Awaited<ReturnType<typeof user>>) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Good things, kept in view." }),
  ).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("creates the nine-card collection, verifies identity and adds a rule through the UI", async ({
  page,
}) => {
  const owner = await user();
  await login(page, owner);
  await expect(page.getByText("Let’s get your cards together.")).toBeVisible();
  await page.getByRole("button", { name: "Set up my cards" }).click();
  await expect(page.locator(".card-tile")).toHaveCount(9);
  await noOverflow(page);
  await page
    .getByRole("link")
    .filter({ hasText: "American Express" })
    .first()
    .click();
  await page.getByRole("button", { name: "Confirm card identity" }).click();
  await page
    .getByLabel("I checked this card’s identity and details with the issuer.")
    .check();
  await page.getByRole("button", { name: "Save card details" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Add benefit", exact: true }).click();
  await page
    .getByLabel("Benefit name", { exact: true })
    .fill("Synthetic browser-test benefit");
  await page
    .getByLabel("Conditions and exclusions")
    .fill("Synthetic test only; not an actual entitlement.");
  await page.getByLabel("Allowance in dollars").fill("10");
  await page
    .getByLabel("Terms effective from")
    .fill(localDate().slice(0, 8) + "01");
  await page
    .getByLabel("Official issuer source")
    .fill("https://example.com/synthetic-test-only");
  await page.getByLabel("I verified that my card is eligible").check();
  await page
    .getByLabel("I checked the source, effective dates, and conditions above.")
    .check();
  await page.getByRole("button", { name: "Save verified rule" }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic browser-test benefit" }),
  ).toBeVisible();
  await expect(
    page.getByText("Coverage unavailable", { exact: false }),
  ).toBeVisible();
  await noOverflow(page);
  const saved = ok(
    await owner.client
      .from("benefits")
      .select()
      .eq("name", "Synthetic browser-test benefit"),
  );
  expect(saved).toHaveLength(1);
});

test("records, corrects and rejects evidence with actual persistence and preserved history", async ({
  page,
}) => {
  const owner = await user(),
    { card, period } = await fixture(owner.client, "monthly", {}, localDate());
  await login(page, owner);
  await page.goto(`/cards/${card.id}`);
  await page
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
  await expect(page.locator(".period-amounts")).toContainText("$3");
  const candidate = ok(
    await owner.client.rpc("record_evidence", {
      p_record: {
        benefit_period_id: period.id,
        source_type: "purchase",
        transaction_date: period.period_start,
        amount_cents: 400,
        confidence: "candidate",
        eligibility_result: "eligible",
        recorded_by: "import",
        notes: "Synthetic imported candidate",
      },
    }),
  );
  await page.getByRole("button", { name: "Refresh records" }).click();
  await page.getByRole("button", { name: /Evidence \(/ }).click();
  await page.getByRole("button", { name: "Review candidate" }).click();
  await page
    .getByLabel("What did you verify?")
    .fill("Synthetic posted credit checked by user.");
  await page
    .getByLabel("This assessment is supported by the evidence I reviewed.")
    .check();
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".period-amounts")).toContainText("$7");
  const rows = ok(
    await owner.client
      .from("redemption_evidence")
      .select()
      .eq("benefit_period_id", period.id),
  );
  expect(rows).toHaveLength(3);
  expect(
    rows.find((e) => e.supersedes_evidence_id === candidate.id).confidence,
  ).toBe("confirmed");
  await owner.client.rpc("record_evidence", {
    p_record: {
      id: randomUUID(),
      benefit_period_id: period.id,
      source_type: "purchase",
      transaction_date: period.period_start,
      amount_cents: 100,
      confidence: "candidate",
      eligibility_result: "eligible",
      recorded_by: "import",
    },
  });
  await page.getByRole("button", { name: "Refresh records" }).click();
  await page.getByRole("button", { name: "Reject candidate" }).click();
  await page.getByLabel("Reason").fill("Synthetic nonqualifying transaction.");
  await page.getByRole("button", { name: "Save rejection" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Add note" }).click();
  await page
    .getByLabel("Note", { exact: true })
    .fill("Keep this note in the audit trail.");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/history");
  await page.getByRole("button", { name: "Evidence ledger" }).click();
  await expect(
    page.getByText("Superseded · preserved for audit.").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Change log" }).click();
  await expect(
    page.getByText("Note: (empty) → Keep this note in the audit trail."),
  ).toBeVisible();
  await noOverflow(page);
});

test("records explicit coverage, shows honest totals, and keeps old periods across refreshes", async ({
  page,
}) => {
  const owner = await user(),
    { period, benefit } = await fixture(
      owner.client,
      "monthly",
      {},
      localDate(),
    );
  await owner.client.rpc("ensure_period", {
    p_benefit_id: benefit.id,
    p_on: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15, 12)
      .toISOString()
      .slice(0, 10),
  });
  await login(page, owner);
  await expect(page.locator(".summary-value")).toHaveText("—");
  await page.goto("/settings");
  await page
    .getByRole("button", { name: "Record a manual reconciliation" })
    .click();
  await page
    .getByRole("dialog")
    .locator('input[name="period"]')
    .first()
    .check();
  await page.getByLabel("Transaction coverage").selectOption("complete");
  await page
    .getByLabel("What was checked, and what was missing?")
    .fill("Synthetic complete coverage through today.");
  await page
    .getByLabel(
      "I checked complete transaction coverage, including late credits and reversals, through this date.",
    )
    .check();
  await page.getByRole("button", { name: "Save reconciliation" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/");
  await expect(page.locator(".summary-value")).toHaveText("$10");
  await page.goto("/history");
  await expect(page.locator(".period-panel")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".period-panel")).toHaveCount(2);
  expect(
    ok(await owner.client.from("benefit_periods").select().eq("id", period.id)),
  ).toHaveLength(1);
});

test("isolates sessions on sign-out and has an installable manifest with a private offline cache", async ({
  page,
  context,
  request,
}, testInfo) => {
  const owner = await user();
  await owner.client.rpc("initialize_cards");
  await login(page, owner);
  await page.screenshot({
    path: `.local/${testInfo.project.name}-overview.png`,
    fullPage: true,
  });
  await noOverflow(page);
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).display).toBe("standalone");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls: string[] = [];
    for (const k of keys) {
      for (const r of await (await caches.open(k)).keys())
        urls.push(new URL(r.url).pathname);
    }
    return urls;
  });
  expect(cached).toContain("/offline.html");
  expect(
    cached.every((p) => p === "/offline.html" || p.startsWith("/icons/")),
  ).toBe(true);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  const other = await user();
  await login(page, other);
  await expect(page.getByText("Let’s get your cards together.")).toBeVisible();
  await expect(page.locator(".card-tile")).toHaveCount(0);
  if (testInfo.project.name.startsWith("chromium")) {
    await context.setOffline(true);
    await page.goto("/history");
    await expect(
      page.getByRole("heading", { name: "A moment to reconnect." }),
    ).toBeVisible();
  }
});

test("has accessible login, overview, and card review screens", async ({
  page,
}) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const owner = await user();
  await owner.client.rpc("initialize_cards");
  await page.goto("/");
  let audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await login(page, owner);
  audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page
    .getByRole("link")
    .filter({ hasText: "American Express" })
    .first()
    .click();
  await page.getByRole("button", { name: "Confirm card identity" }).click();
  audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
});

test("shows both Ink cards without invented digits and saves last-four edits", async ({
  page,
}) => {
  const owner = await user();
  await owner.client.rpc("initialize_cards");
  await login(page, owner);
  await expect(
    page.getByRole("link").filter({ hasText: "Ink Business Cash" }),
  ).toContainText("Last four not set");
  await expect(
    page.getByRole("link").filter({ hasText: "Ink Business Preferred" }),
  ).toContainText("Last four not set");
  await page.getByRole("link").filter({ hasText: "Ink Business Cash" }).click();
  await page.getByRole("button", { name: "Confirm card identity" }).click();
  await page.getByLabel("Last four digits (optional)").fill("0555");
  await page
    .getByLabel("I checked this card’s identity and details with the issuer.")
    .check();
  await page.getByRole("button", { name: "Save card details" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".page-heading .eyebrow")).toContainText("0555");
  expect(
    ok(
      await owner.client
        .from("cards")
        .select()
        .eq("product_name", "Chase Ink Business Cash"),
    ).map((c) => c.last4),
  ).toEqual(["0555"]);
  await noOverflow(page);
});
