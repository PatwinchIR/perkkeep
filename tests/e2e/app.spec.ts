import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  ensurePeriod,
  env,
  fixture,
  recordEvidence,
  user as syntheticUser,
} from "../helpers";
import { localDate } from "../../src/lib/domain";
// Synthetic owners on the local test allowlist; each test gets a fresh owner identity.
const OWNER_EMAIL = "owner@perkkeep.test";
const user = () => syntheticUser(OWNER_EMAIL);
async function login(page: Page, owner: Awaited<ReturnType<typeof user>>) {
  const response = await page.request.post("/api/test-auth", {
    headers: { "x-perkkeep-test-secret": env.TEST_AUTH_SECRET },
    data: { email: owner.email, subject: owner.subject },
  });
  expect(response.ok()).toBe(true);
  await page.goto("/");
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
  const saved = await owner.q("select * from public.benefits where name=$1", [
    "Synthetic browser-test benefit",
  ]);
  expect(saved).toHaveLength(1);
});

test("records, corrects and rejects evidence with actual persistence and preserved history", async ({
  page,
}) => {
  const owner = await user(),
    { card, period } = await fixture(owner, "monthly", {}, localDate());
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
  const candidate = await recordEvidence(owner, {
    benefit_period_id: period.id,
    source_type: "purchase",
    transaction_date: period.period_start,
    amount_cents: 400,
    confidence: "candidate",
    eligibility_result: "eligible",
    recorded_by: "import",
    notes: "Synthetic imported candidate",
  });
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
  const rows = await owner.q(
    "select * from public.redemption_evidence where benefit_period_id=$1",
    [period.id],
  );
  expect(rows).toHaveLength(3);
  expect(
    rows.find((e) => e.supersedes_evidence_id === candidate.id)?.confidence,
  ).toBe("confirmed");
  await recordEvidence(owner, {
    id: randomUUID(),
    benefit_period_id: period.id,
    source_type: "purchase",
    transaction_date: period.period_start,
    amount_cents: 100,
    confidence: "candidate",
    eligibility_result: "eligible",
    recorded_by: "import",
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
    { period, benefit } = await fixture(owner, "monthly", {}, localDate());
  await ensurePeriod(
    owner,
    benefit.id,
    new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15, 12)
      .toISOString()
      .slice(0, 10),
  );
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
    await owner.q("select * from public.benefit_periods where id=$1", [
      period.id,
    ]),
  ).toHaveLength(1);
});

test("isolates sessions on sign-out and has an installable manifest with a private offline cache", async ({
  page,
  context,
  request,
}, testInfo) => {
  const owner = await user();
  await owner.q("select public.initialize_cards()");
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
  // A different person signs in through the local sign-in form and sees an empty ledger.
  await page.goto("/");
  await page.getByLabel("Email address").fill("owner2@perkkeep.test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
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
  await owner.q("select public.initialize_cards()");
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
  await owner.q("select public.initialize_cards()");
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
    (
      await owner.q("select * from public.cards where product_name=$1", [
        "Chase Ink Business Cash",
      ])
    ).map((c) => c.last4),
  ).toEqual(["0555"]);
  await noOverflow(page);
});

test("imports a synthetic statement CSV, shows its coverage, and links the account to a card", async ({
  page,
}) => {
  const owner = await user();
  await owner.q("select public.initialize_cards()");
  await login(page, owner);
  await page.goto("/settings");
  await page.getByText("Import a statement CSV", { exact: true }).click();
  await page.getByLabel("CSV file").setInputFiles({
    name: "synthetic-statement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Trans. Date,Post Date,Description,Amount,Category\n10/01/2026,10/02/2026,SYNTHETIC STORE,5.00,Shopping\n10/04/2026,10/05/2026,SYNTHETIC CAFE,3.25,Dining\n",
    ),
  });
  await page.getByLabel("Institution").fill("Discover");
  await page.getByLabel("Account name").fill("Synthetic Discover export");
  await page.getByRole("button", { name: "Import file" }).click();
  const row = page
    .locator(".account-row")
    .filter({ hasText: "Synthetic Discover export" });
  await expect(row).toContainText("covers Oct 1, 2026 – Oct 4, 2026");
  await expect(row).toContainText("2 transaction records");
  await row
    .getByLabel("Card for Synthetic Discover export")
    .selectOption({ label: "Discover it · Last four not set" });
  await row.getByRole("button", { name: "Link card" }).click();
  await expect(row).toContainText("Linked to Discover it");
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await noOverflow(page);
  const [account] = await owner.q("select mapping_status from public.accounts");
  expect(account.mapping_status).toBe("confirmed");
});

test("uploads private card art, serves it uncached to its owner only, and keeps the unidentified card plain", async ({
  page,
  playwright,
}) => {
  const { default: sharp } = await import("sharp");
  const owner = await user();
  await owner.q("select public.initialize_cards()");
  await login(page, owner);
  const [card] = await owner.q(
    "select id from public.cards where catalog_key='discover-it'",
  );
  await page.goto(`/cards/${card.id}`);
  await page
    .getByLabel("Draw my name and last four on uploaded images")
    .check();
  await page
    .getByLabel("Upload an image or a photo of your card")
    .setInputFiles({
      name: "synthetic-card.png",
      mimeType: "image/png",
      buffer: await sharp({
        create: { width: 640, height: 400, channels: 3, background: "#3c7fb0" },
      })
        .png()
        .toBuffer(),
    });
  const art = page.locator(".card-art-panel img.face-art");
  await expect(art).toBeVisible();
  const src = (await art.getAttribute("src"))!;
  const response = await page.request.get(src);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/webp");
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const stranger = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:3017",
  });
  await stranger.post("/api/test-auth", {
    headers: { "x-perkkeep-test-secret": env.TEST_AUTH_SECRET },
    data: { email: "owner2@perkkeep.test" },
  });
  expect((await stranger.get(src)).status()).toBe(404);
  expect(
    (
      await playwright.request
        .newContext({ baseURL: "http://127.0.0.1:3017" })
        .then((c) => c.get(src))
    ).status(),
  ).toBe(401);
  const [unidentified] = await owner.q(
    "select id from public.cards where catalog_key='chase-unidentified'",
  );
  await page.goto(`/cards/${unidentified.id}`);
  await expect(
    page.getByText(
      "This card keeps a plain face until its product is confirmed.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use the issuer’s image" }),
  ).toHaveCount(0);
  await page.goto(`/cards/${card.id}`);
  await page.getByRole("button", { name: "Remove image" }).click();
  await expect(page.locator(".card-art-panel img.face-art")).toHaveCount(0);
  await noOverflow(page);
});

test("shows a linked SimpleFIN connection without the token box, and hides unused starter cards", async ({
  page,
}) => {
  const owner = await user();
  await owner.q("select public.initialize_cards()");
  // Synthetic connection and account; the secret is a placeholder that is never decrypted here.
  const [connection] = await owner.q(
    "insert into public.source_connections(source,encrypted_secret,last_success_at) values('simplefin','v1.synthetic',now()) returning id",
  );
  const [card] = await owner.q(
    "update public.cards set last4='4242', status='active', identity_verified_at=now() where catalog_key='chase-sapphire-reserve' returning id",
  );
  await owner.q(
    `insert into public.accounts(source,connection_id,external_ref,institution,name,mask,kind,card_id,proposed_card_id,mapping_status,mapping_confirmed_at)
     values('simplefin',$1,$2,'Synthetic Chase','Synthetic Sapphire ...4242','4242','credit',$3,$3,'confirmed',now())`,
    [connection.id, "a".repeat(64), card.id],
  );
  await login(page, owner);
  await expect(page.locator(".card-tile")).toHaveCount(1);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "SimpleFIN" })).toBeVisible();
  await expect(page.locator(".badge", { hasText: "Linked" })).toBeVisible();
  await expect(page.getByLabel("SimpleFIN setup token")).toHaveCount(0);
  const row = page
    .locator(".account-row")
    .filter({ hasText: "Synthetic Sapphire" });
  await expect(row).toContainText("Linked to Sapphire Reserve · •••• 4242");
  await page
    .getByRole("button", { name: "Replace with a new setup token" })
    .click();
  await expect(page.getByLabel("SimpleFIN setup token")).toBeVisible();
  await page
    .getByRole("button", { name: "Keep the current connection" })
    .click();
  await expect(page.getByLabel("SimpleFIN setup token")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/settings-linked.png",
    fullPage: true,
  });
  await noOverflow(page);
});

test("adds a card by hand, removes it without losing history, and restores it from Settings", async ({
  page,
}) => {
  const owner = await user();
  await owner.q("select public.initialize_cards()");
  await login(page, owner);
  await page.goto("/cards");
  await page.getByRole("button", { name: "Add a card" }).click();
  await page.getByLabel("Product").fill("Citi Double Cash");
  await expect(page.getByLabel("Issuer")).toHaveValue("Citi");
  await page.getByLabel("Last four digits (optional)").fill("9876");
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Double Cash" }),
  ).toBeVisible();
  await expect(
    page.getByText("First, make sure this is the right card."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove this card" }).click();
  await page.getByRole("button", { name: "Remove card", exact: true }).click();
  await expect(page.getByText("This card was removed.")).toBeVisible();
  await page.goto("/cards");
  await expect(
    page.locator(".card-tile", { hasText: "Double Cash" }),
  ).toHaveCount(0);
  await page.goto("/settings");
  const removed = page.locator("section", { hasText: "Removed cards" });
  await expect(removed).toContainText("Double Cash");
  await removed.getByRole("button", { name: "Restore" }).click();
  await expect(
    page.getByText("Card restored with its full history."),
  ).toBeVisible();
  await page.goto("/cards");
  await expect(
    page.locator(".card-tile", { hasText: "Double Cash" }),
  ).toHaveCount(1);
  await noOverflow(page);
});
