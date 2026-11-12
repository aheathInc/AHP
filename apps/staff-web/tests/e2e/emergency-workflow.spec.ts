import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const fixture = process.env.AHP_EMERGENCY_FIXTURE;
test("real patient report to dispatcher acknowledgement, safe unit assignment and closure", async ({
  page,
}, testInfo) => {
  test.skip(
    !fixture,
    "Requires explicitly provisioned local synthetic emergency fixtures.",
  );
  test.setTimeout(180000);
  if (
    !/^http:\/\/(localhost|127\.0\.0\.1):3000$/.test(
      process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    )
  )
    throw Error("Local synthetic acceptance only");
  const f = JSON.parse(readFileSync(fixture!, "utf8"));
  expect(f.requestId).toBeTruthy();
  await page.goto("/login");
  await page.getByLabel("Email").fill(f.dispatcher.email);
  await page.getByLabel("Password").fill(f.dispatcher.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin/emergency", { timeout: 60000 });
  await expect(page.getByText(f.marker, { exact: true })).toBeVisible();
  await page.locator(`a[href="/admin/emergency/${f.requestId}"]`).click();
  await expect(
    page.getByRole("heading", { name: "Reported", exact: true }),
  ).toBeVisible();
  const initial = await page.evaluate(
    async (id) => await (await fetch("/bff/emergency-requests/" + id)).json(),
    f.requestId,
  );
  await page.screenshot({
    path: testInfo.outputPath("emergency-desktop-reported.png"),
    fullPage: true,
  });
  await expect(page.getByLabel("Available unit", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    page.getByLabel("Receiving facility", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("Assessed response priority", { exact: true })
    .selectOption("highest");
  await page.getByLabel("New status", { exact: true }).selectOption("triaged");
  await page
    .getByRole("button", {
      name: "Acknowledge and record assessment",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Triaged", exact: true }),
  ).toBeVisible();
  // An old network response must not roll the visible status backwards.
  const oldRoute = "**/bff/emergency-requests/" + f.requestId;
  await page.route(oldRoute, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(initial),
    }),
  );
  await page
    .getByRole("button", { name: "Refresh incident", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Triaged", exact: true }),
  ).toBeVisible();
  await page.unroute(oldRoute);
  await page
    .getByLabel("Available unit", { exact: true })
    .selectOption(f.unitId);
  for (
    let attempt = 0;
    attempt < 10 &&
    !(await page
      .locator(`#emergency-facility option[value="${f.facilityId}"]`)
      .count());
    attempt++
  )
    await page
      .getByRole("button", { name: "Load more receiving facilities" })
      .click();
  await page
    .getByLabel("Receiving facility", { exact: true })
    .selectOption(f.facilityId);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Review and assign unit", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Dispatched", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("emergency-mobile-dispatched.png"),
    fullPage: true,
  });
  for (const [value, label] of [
    ["en_route", "En route"],
    ["arrived", "Arrived"],
  ]) {
    await page.getByLabel("New status", { exact: true }).selectOption(value);
    await page
      .getByRole("button", { name: "Record status update", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
  }
  await page.getByLabel("New status", { exact: true }).selectOption("resolved");
  await expect(
    page.getByLabel("Confirmed outcome", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Record status update", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Confirmed outcome", { exact: true })
    .selectOption("treated_on_scene");
  await page
    .getByLabel("Operational note / handover summary", { exact: true })
    .fill(
      "TEST DATA ONLY: synthetic acceptance; no real emergency call or transport.",
    );
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Record status update", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Resolved", exact: true }),
  ).toBeVisible();
  const before = await page.evaluate(
    async (id) => await (await fetch("/bff/emergency-requests/" + id)).json(),
    f.requestId,
  );
  expect(before.response_unit.status).toBe("at_scene");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", {
      name: "Confirm crew ready and release unit",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Confirm crew ready and release unit",
      exact: true,
    }),
  ).toHaveCount(0);
  const result = await page.evaluate(
    async (id) => await (await fetch("/bff/emergency-requests/" + id)).json(),
    f.requestId,
  );
  expect(result.status).toBe("resolved");
  expect(result.response_unit.status).toBe("available");
  expect(result.timeline).toHaveLength(6);
  writeFileSync(
    testInfo.outputPath("emergency-result.json"),
    JSON.stringify({
      patientReportSeen: true,
      explicitPriority: true,
      acknowledged: true,
      staleResponseIgnored: true,
      explicitUnitAndFacility: true,
      noDefaultOutcome: true,
      unitReleasedOnlyAfterCrewConfirmation: true,
      timelineEvents: result.timeline.length,
    }),
  );
});
