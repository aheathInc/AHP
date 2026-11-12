import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
test("professional group publishing, durable replies, moderation and membership privacy", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    !process.env.AHP_PROFESSIONAL_NETWORK_FIXTURE,
    "Requires a local synthetic professional group fixture.",
  );
  test.setTimeout(180000);
  if (
    !/^http:\/\/(localhost|127\.0\.0\.1):3000$/.test(
      process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    )
  )
    throw Error("Owned local synthetic acceptance only");
  const f = JSON.parse(
    readFileSync(process.env.AHP_PROFESSIONAL_NETWORK_FIXTURE!, "utf8"),
  );
  async function login(
    p: Page,
    who: { email: string; password: string },
    home: string,
  ) {
    await p.goto("/login");
    await p.getByLabel("Email", { exact: true }).fill(who.email);
    await p.getByLabel("Password", { exact: true }).fill(who.password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await p.waitForURL("**/" + home);
  }
  async function join(p: Page) {
    await p.goto("/doctor/network");
    const group = p
      .locator("section")
      .filter({
        has: p.getByRole("heading", { name: f.group.name, exact: true }),
      });
    await group
      .getByRole("button", { name: "Join group", exact: true })
      .click();
    await expect(
      group.getByRole("button", { name: "Leave group", exact: true }),
    ).toBeVisible();
  }
  await login(page, f.author, "doctor/queue");
  await join(page);
  await page
    .getByRole("button", { name: "New discussion", exact: true })
    .click();
  await expect(
    page.getByLabel("Publishing group", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("Publishing group", { exact: true })
    .selectOption(f.group.id);
  await page.getByLabel("Discussion subject", { exact: true }).fill(f.title);
  await page
    .getByLabel("Clinical question / contribution", { exact: true })
    .fill(f.body);
  await page
    .getByRole("button", { name: "Review before publishing", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Publish to group", exact: true }),
  ).toBeDisabled();
  await page.getByLabel(/I have checked for patient identifiers/).check();
  const publication = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/bff/network/discussions" &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Publish to group", exact: true })
    .click();
  const published = await publication;
  expect(published.status()).toBe(201);
  const post = await published.json();
  const createPayload = published.request().postDataJSON();
  await expect(
    page.getByRole("link", { name: f.title, exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("professional-network-desktop.png"),
    fullPage: true,
  });
  const responderContext = await browser.newContext(),
    responder = await responderContext.newPage();
  await login(responder, f.responder, "doctor/queue");
  await responder.goto("/doctor/network/" + post.id);
  await expect(responder.getByText(f.body, { exact: true })).toHaveCount(0);
  await join(responder);
  await responder.goto("/doctor/network/" + post.id);
  await expect(responder.getByText(f.body, { exact: true })).toBeVisible();
  let lost = true;
  let replyPayload: Record<string, unknown> | undefined;
  await responder.route(
    "**/bff/network/discussions/*/replies",
    async (route) => {
      if (route.request().method() === "POST" && lost) {
        lost = false;
        replyPayload = route.request().postDataJSON();
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        await route.abort("failed");
      } else await route.continue();
    },
  );
  const replyText =
    "Synthetic evidence response with a deliberately lost HTTP receipt";
  await responder.getByLabel("Your reply", { exact: true }).fill(replyText);
  await responder.getByLabel(/I have checked that this reply contains/).check();
  await responder
    .getByRole("button", { name: "Post reply", exact: true })
    .click();
  await expect(
    responder.getByText(/Reply could not be confirmed/),
  ).toBeVisible();
  await expect(responder.getByLabel("Your reply", { exact: true })).toHaveValue(
    replyText,
  );
  await responder
    .getByRole("button", { name: "Post reply", exact: true })
    .click();
  await expect(responder.getByText(replyText, { exact: true })).toHaveCount(1);
  await page.goto("/doctor/network/" + post.id);
  await expect(page.getByText(replyText, { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Reply to " + f.responder.name, exact: true })
    .click();
  await page
    .getByLabel("Your reply", { exact: true })
    .fill("Synthetic nested professional response");
  await page.getByLabel(/I have checked that this reply contains/).check();
  const nestedReceipt = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/replies"));
  await page.getByRole("button", { name: "Post reply", exact: true }).click();
  expect((await nestedReceipt).status()).toBe(201);
  await expect(
    page.getByText("Synthetic nested professional response", { exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate(
    async (id) =>
      await (
        await fetch("/bff/network/discussions/" + id, { cache: "no-store" })
      ).json(),
    post.id,
  );
  expect(saved.reply_count).toBe(2);
  expect(
    saved.replies.filter((r: { body: string }) => r.body === replyText),
  ).toHaveLength(1);
  expect(
    saved.replies.find(
      (r: { body: string }) =>
        r.body === "Synthetic nested professional response",
    ).parent_reply_id,
  ).toBe(saved.replies.find((r: { body: string }) => r.body === replyText).id);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("professional-thread-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("professional-thread-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await responder
    .getByRole("button", { name: "Report concern", exact: true })
    .first()
    .click();
  await responder
    .getByLabel("Reason for reporting", { exact: true })
    .selectOption("privacy");
  await responder
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await expect(
    responder.getByText(/Report recorded for moderator review/),
  ).toBeVisible();
  const adminContext = await browser.newContext(),
    admin = await adminContext.newPage();
  await login(admin, f.moderator, "admin/dashboard");
  await admin.goto("/admin/professional-network");
  await expect(
    admin.getByRole("heading", { name: f.title, exact: true }),
  ).toBeVisible();
  await admin.getByText("Review reported content", { exact: true }).click();
  await expect(admin.getByText(f.body, { exact: true })).toBeVisible();
  await admin.evaluate(() => window.scrollTo(0, 0));
  await admin.screenshot({
    path: testInfo.outputPath("network-moderation.png"),
    fullPage: true,
  });
  admin.once("dialog", (dialog) => dialog.accept());
  await admin
    .getByRole("button", { name: "Hide contribution", exact: true })
    .click();
  await expect(admin.getByRole("status").filter({ hasText: "Contribution hidden" })).toBeVisible();
  await responder.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    responder.getByRole("heading", {
      name: "Discussion unavailable",
      exact: true,
    }),
  ).toBeVisible();
  await expect(responder.getByText(f.body, { exact: true })).toHaveCount(0);
  await expect(responder.getByText(replyText, { exact: true })).toHaveCount(0);
  await expect(responder.getByLabel("Your reply", { exact: true })).toHaveCount(
    0,
  );
  const replay = await page.evaluate(async (body) => {
    const response = await fetch("/bff/network/discussions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }, createPayload);
  expect(replay.status).toBe(201);
  expect(replay.body.moderation_status).toBe("hidden");
  expect(JSON.stringify(replay.body)).not.toContain(f.body);
  await responder.goto("/doctor/network");
  responder.once("dialog", (dialog) => dialog.accept());
  await responder
    .locator("section")
    .filter({
      has: responder.getByRole("heading", { name: f.group.name, exact: true }),
    })
    .getByRole("button", { name: "Leave group", exact: true })
    .click();
  await expect(
    responder
      .locator("section")
      .filter({
        has: responder.getByRole("heading", {
          name: f.group.name,
          exact: true,
        }),
      })
      .getByRole("button", { name: "Join group", exact: true }),
  ).toBeVisible();
  const denied = await responder.evaluate(
    async ({ id, body }) => {
      const response = await fetch(`/bff/network/discussions/${id}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { id: post.id, body: replyPayload },
  );
  expect(denied.status).toBe(403);
  expect(JSON.stringify(denied.body)).not.toContain(replyText);
  await responderContext.close();
  await adminContext.close();
});
