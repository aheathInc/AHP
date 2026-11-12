import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
test("scoped hospital intake worklist, patient calling and assigned consultation start", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    !process.env.AHP_INTAKE_FIXTURE,
    "Requires a local synthetic intake fixture.",
  );
  test.setTimeout(180000);
  if (
    !/^http:\/\/(localhost|127\.0\.0\.1):3000$/.test(
      process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    )
  )
    throw Error("Owned local synthetic acceptance only");
  const f = JSON.parse(readFileSync(process.env.AHP_INTAKE_FIXTURE!, "utf8"));
  async function login(
    p: Page,
    account: { email: string; password: string },
    home: string,
  ) {
    await p.goto("/login");
    await p.getByLabel("Email", { exact: true }).fill(account.email);
    await p.getByLabel("Password", { exact: true }).fill(account.password);
    const callback = p.waitForResponse(
      (r) =>
        r.url().includes("/api/auth/callback/credentials") &&
        r.request().method() === "POST",
    );
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    const response = await callback;
    const body = await response.json();
    const destination = typeof body.url === "string" ? new URL(body.url) : null;
    expect({
      status: response.status(),
      csrf: destination?.searchParams.has("csrf"),
      error: destination?.searchParams.get("error"),
    }).toEqual({ status: 200, csrf: false, error: null });
    await p.waitForURL("**/" + home);
  }
  async function filter(label: string) {
    const response = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/bff/front-desk/staff/visits" &&
        r.request().method() === "GET",
    );
    await page.getByRole("button", { name: label, exact: true }).click();
    expect((await response).status()).toBe(200);
  }
  async function open(ticket: string) {
    await page
      .getByRole("button", { name: "Open visit " + ticket, exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Selected visit details" }),
    ).toBeVisible();
  }
  await login(page, f.doctor, "doctor/queue");
  await page.goto("/doctor/front-desk");
  await expect(
    page.getByRole("heading", { name: "Hospital intake queue", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Facility", { exact: true })).toHaveValue(
    f.facilityId,
  );
  await expect(
    page.getByRole("row").filter({ hasText: f.visits.ready.name }),
  ).toBeVisible();
  await filter("Ready for clinician");
  await open(f.visits.ready.ticket);
  await page.getByRole("button", { name: "Call patient", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Called by clinician");
  await filter("Called");
  await open(f.visits.called.ticket);
  await expect(
    page.getByRole("button", { name: "Start consultation", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/Only that clinician can start/)).toBeVisible();
  await open(f.visits.ready.ticket);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Start consultation", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Consultation started");
  await filter("In consultation");
  await open(f.visits.ready.ticket);
  await expect(
    page.getByRole("link", { name: "Open consultation & chat", exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate(
    async (id) =>
      await (
        await fetch("/bff/front-desk/visits/" + id, { cache: "no-store" })
      ).json(),
    f.visits.ready.id,
  );
  expect(saved.status).toBe("in_consultation");
  expect(saved.consultation_id).toBeTruthy();
  await filter("Immediate review");
  await open(f.visits.escalated.ticket);
  await expect(
    page.getByText(
      "Clinician marked this visit for immediate review. Do not admit to the routine queue without a new clinical assessment.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Call patient", exact: true }),
  ).toHaveCount(0);
  await filter("All active");
  await page.screenshot({
    path: testInfo.outputPath("intake-desktop.png"),
    fullPage: true,
  });
  await page
    .getByLabel("Find patient or ticket", { exact: true })
    .fill(f.visits.called.ticket);
  await page.getByRole("button", { name: "Search queue", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: f.visits.called.name }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: f.visits.review.name }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Find patient or ticket", { exact: true }).fill("");
  await page.getByRole("button", { name: "Search queue", exact: true }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(f.visits.review.ticket) }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("intake-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const context = await browser.newContext();
  const admin = await context.newPage();
  await login(admin, f.admin, "admin/dashboard");
  await admin.goto("/admin/front-desk");
  await admin
    .getByLabel("Facility", { exact: true })
    .selectOption(f.facilityId);
  await admin
    .getByRole("button", {
      name: "Open visit " + f.visits.review.ticket,
      exact: true,
    })
    .click();
  await admin
    .getByLabel(
      "I have checked patient registration and the required administrative clearances.",
      { exact: true },
    )
    .check();
  await admin
    .getByRole("button", { name: "Record manual clearance", exact: true })
    .click();
  await expect(admin.getByRole("status")).toContainText(
    "Awaiting facility review",
  );
  const projection = await admin.evaluate(
    async (id) =>
      await (
        await fetch("/bff/front-desk/visits/" + id, { cache: "no-store" })
      ).json(),
    f.visits.review.id,
  );
  expect(projection.clearance.registration).toBe("manually_confirmed");
  expect(projection.purpose).toBeUndefined();
  await context.close();
});
