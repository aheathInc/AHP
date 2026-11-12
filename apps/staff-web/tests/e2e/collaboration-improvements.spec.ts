import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
test("real named-clinician collaboration, uncertain message retry and consent-safe access closure", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    !process.env.AHP_COLLABORATION_FIXTURE,
    "Requires an explicitly seeded local synthetic collaboration fixture.",
  );
  test.setTimeout(180000);
  if (
    !/^http:\/\/(localhost|127\.0\.0\.1):3000$/.test(
      process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    )
  )
    throw Error("Owned local synthetic acceptance only");
  const f = JSON.parse(
    readFileSync(process.env.AHP_COLLABORATION_FIXTURE!, "utf8"),
  );
  async function login(p: Page, account: { email: string; password: string }) {
    await p.goto("/login");
    await p.getByLabel("Email", { exact: true }).fill(account.email);
    await p.getByLabel("Password", { exact: true }).fill(account.password);
    const callback = p.waitForResponse(
      (r) =>
        r.url().includes("/api/auth/callback/credentials") &&
        r.request().method() === "POST",
    );
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    expect((await callback).status()).toBe(200);
    await p.waitForURL("**/doctor/queue");
  }
  await login(page, f.requester);
  await page.goto("/doctor/clinical-collaboration");
  await page
    .getByLabel("Case to discuss", { exact: true })
    .selectOption(f.consultationId);
  await expect(
    page.getByLabel("Patient-authorized clinician", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Patient-authorized clinician", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("Patient-authorized clinician", { exact: true })
    .selectOption(f.invitee.id);
  await page
    .getByLabel("Clinical question / requested input", { exact: true })
    .fill(f.question);
  await page
    .getByLabel("Maximum access duration", { exact: true })
    .selectOption("24");
  const createdResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/bff/network/collaborations" &&
      r.request().method() === "POST",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Review and send request", exact: true })
    .click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const requested = await created.json();
  await expect(page.getByRole("status")).toContainText("Request sent.");
  await expect(page.getByText(f.question, { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("collaboration-worklist-desktop.png"),
    fullPage: true,
  });
  const context = await browser.newContext();
  const invited = await context.newPage();
  await login(invited, f.invitee);
  await invited.goto("/doctor/clinical-collaboration");
  await expect(invited.getByText(f.question, { exact: true })).toBeVisible();
  invited.once("dialog", (dialog) => dialog.accept());
  await invited
    .getByRole("button", { name: "Accept collaboration", exact: true })
    .click();
  await expect(invited.getByRole("status")).toContainText(
    "Collaboration accepted",
  );
  await page
    .getByRole("button", { name: "Active discussions", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Open case discussion", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Shared case context", exact: true }),
  ).toBeVisible();
  const message = "Synthetic message with an intentionally lost HTTP response";
  let lost = true;
  let firstKey = "";
  let lastBody: Record<string, unknown> | undefined;
  await page.route(
    "**/bff/network/collaborations/*/messages",
    async (route) => {
      if (route.request().method() === "POST" && lost) {
        lost = false;
        firstKey = route.request().headers()["idempotency-key"];
        lastBody = route.request().postDataJSON();
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page
    .getByLabel("Reply to the collaborating clinician", { exact: true })
    .fill(message);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText(/Message could not be confirmed/)).toBeVisible();
  await expect(
    page.getByLabel("Reply to the collaborating clinician", { exact: true }),
  ).toHaveValue(message);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Message saved");
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);
  const stored = await page.evaluate(
    async (id) =>
      await (
        await fetch(`/bff/network/collaborations/${id}/messages?limit=100`, {
          cache: "no-store",
        })
      ).json(),
    requested.id,
  );
  expect(
    stored.data.filter((row: { body: string }) => row.body === message),
  ).toHaveLength(1);
  await invited
    .getByRole("button", { name: "Active discussions", exact: true })
    .click();
  await invited
    .getByRole("link", { name: "Open case discussion", exact: true })
    .click();
  await expect(invited.getByText(message, { exact: true })).toBeVisible();
  await invited
    .getByLabel("Reply to the collaborating clinician", { exact: true })
    .fill("Synthetic collaborator response");
  await invited
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(invited.getByRole("status")).toContainText("Message saved");
  await page
    .getByRole("button", { name: "Refresh discussion", exact: true })
    .click();
  await expect(
    page.getByText("Synthetic collaborator response", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("collaboration-discussion-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("collaboration-discussion-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  invited.once("dialog", (dialog) => dialog.accept());
  await invited
    .getByRole("button", { name: "End collaboration access", exact: true })
    .click();
  await expect(invited.getByRole("status")).toContainText(
    "Collaboration access has ended",
  );
  await page
    .getByRole("button", { name: "Refresh discussion", exact: true })
    .click();
  await expect(page.getByText("Access ended", { exact: true })).toBeVisible();
  await expect(page.getByText(message, { exact: true })).toHaveCount(0);
  await expect(page.getByText(f.question, { exact: true })).toHaveCount(0);
  await expect(
    page.getByLabel("Reply to the collaborating clinician", { exact: true }),
  ).toHaveCount(0);
  const replay = await page.evaluate(
    async ({ id, key, body }) => {
      const response = await fetch(
        `/bff/network/collaborations/${id}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify(body),
        },
      );
      return { status: response.status, body: await response.json() };
    },
    { id: requested.id, key: firstKey, body: lastBody },
  );
  expect(replay.status).toBe(403);
  expect(replay.body.body).toBeUndefined();
  await context.close();
});

test("hides prior clinical content when discussion access verification fails", async ({
  page,
  browser,
}) => {
  test.skip(
    !process.env.AHP_COLLABORATION_FIXTURE,
    "Requires a local synthetic collaboration fixture.",
  );
  if (
    !/^http:\/\/(localhost|127\.0\.0\.1):3000$/.test(
      process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    )
  )
    throw Error("Owned local synthetic acceptance only");
  const f = JSON.parse(
    readFileSync(process.env.AHP_COLLABORATION_FIXTURE!, "utf8"),
  );
  async function login(p: Page, account: { email: string; password: string }) {
    await p.goto("/login");
    await p.getByLabel("Email", { exact: true }).fill(account.email);
    await p.getByLabel("Password", { exact: true }).fill(account.password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await p.waitForURL("**/doctor/queue");
  }
  await login(page, f.requester);
  const requested = await page.evaluate(async (f) => {
    const response = await fetch("/bff/network/collaborations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        consultation_id: f.consultationId,
        invited_clinician_id: f.invitee.id,
        question: "Synthetic access verification question",
      }),
    });
    return { status: response.status, body: await response.json() };
  }, f);
  expect(requested.status).toBe(201);
  const context = await browser.newContext(),
    invitee = await context.newPage();
  await login(invitee, f.invitee);
  const accepted = await invitee.evaluate(async (row) => {
    const response = await fetch(
      `/bff/network/collaborations/${row.id}/accept`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ base_version: row.version }),
      },
    );
    return response.status;
  }, requested.body);
  expect(accepted).toBe(200);
  await page.goto("/doctor/clinical-collaboration/" + requested.body.id);
  await expect(
    page.getByRole("heading", { name: "Shared case context", exact: true }),
  ).toBeVisible();
  await page.route("**/bff/network/collaborations/*/case", (route) =>
    route.fulfill({
      status: 403,
      json: {
        error: {
          code: "NOT_RESOURCE_OWNER",
          message: "Synthetic access verification denied",
        },
      },
    }),
  );
  await page
    .getByRole("button", { name: "Refresh discussion", exact: true })
    .click();
  await expect(
    page.getByText("Synthetic access verification denied", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Shared case context", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Synthetic access verification question", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Reply to the collaborating clinician", { exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/bff/network/collaborations/*/case");
  await page
    .getByRole("button", { name: "Refresh discussion", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Shared case context", exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "End collaboration access", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Collaboration access has ended",
  );
  await context.close();
});
