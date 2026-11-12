import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
test("real specimen receipt, preliminary review, report release and clinician acknowledgement", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    !process.env.AHP_DIAGNOSTICS_FIXTURE,
    "Requires an explicitly seeded local synthetic diagnostics fixture.",
  );
  test.setTimeout(180000);
  if (
    !/^http:\/\/(localhost|127\.0\.0\.1):3000$/.test(
      process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    )
  )
    throw Error("Local synthetic acceptance only");
  const f = JSON.parse(
    readFileSync(process.env.AHP_DIAGNOSTICS_FIXTURE!, "utf8"),
  );
  async function login(
    p: typeof page,
    account: { email: string; password: string },
    home: string,
  ) {
    await p.goto("/login");
    await p.getByLabel("Email").fill(account.email);
    await p.getByLabel("Password").fill(account.password);
    const callback=p.waitForResponse(response=>response.url().includes('/api/auth/callback/credentials')&&response.request().method()==='POST');
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    const response=await callback;const body=await response.json();
    const redirect=typeof body.url==='string'?new URL(body.url):null;
    expect({status:response.status(),csrf:redirect?.searchParams.has('csrf'),error:redirect?.searchParams.get('error')}).toEqual({status:200,csrf:false,error:null});
    await p.waitForURL("**/" + home);
  }
  await login(page, f.doctor, "doctor/queue");
  const create = await page.evaluate(async (f) => {
    const r = await fetch("/bff/investigation-orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        care_thread_id: f.threadId,
        investigation_code: f.marker,
        investigation_type: "laboratory",
        facility_id: f.facilityId,
        urgency: "urgent",
        clinical_notes: "Synthetic laboratory workflow acceptance only",
      }),
    });
    return { status: r.status, body: await r.json() };
  }, f);
  expect(create.status).toBe(201);
  const order = create.body;
  f.orderId = order.id;
  writeFileSync(process.env.AHP_DIAGNOSTICS_FIXTURE!, JSON.stringify(f), {
    mode: 0o600,
  });
  const labContext = await browser.newContext();
  const lab = await labContext.newPage();
  await login(lab, f.technician, "lab");
  await lab.goto(`/lab/${order.id}`);
  await expect(
    lab.getByRole("heading", { name: "Receive specimen", exact: true }),
  ).toBeVisible();
  await lab
    .getByLabel("Specimen / accession reference", { exact: true })
    .fill("SYN-SPECIMEN-" + Date.now());
  await lab
    .getByLabel("Specimen type", { exact: true })
    .fill("Synthetic test specimen");
  await lab
    .getByLabel("Collection date and time (if known)")
    .fill("2026-11-12T09:00");
  await lab
    .getByRole("button", { name: "Confirm specimen received", exact: true })
    .click();
  await expect(
    lab.getByRole("heading", {
      name: "Enter laboratory findings",
      exact: true,
    }),
  ).toBeVisible();
  await lab
    .getByLabel("Test / analyte", { exact: true })
    .fill("Synthetic analyte");
  await lab.getByLabel("Result", { exact: true }).fill("9");
  await lab.getByLabel("Unit (if applicable)").fill("test-unit");
  await lab.getByLabel("Reference low (optional)").fill("1");
  await lab.getByLabel("Reference high (optional)").fill("5");
  await lab.getByLabel("Critical high (optional)").fill("8");
  await lab
    .getByRole("button", { name: "Save preliminary report", exact: true })
    .click();
  await expect(
    lab.getByText("PRELIMINARY — not released", { exact: true }),
  ).toBeVisible();
  await expect(
    lab.getByRole("button", { name: "Print final report", exact: true }),
  ).toBeDisabled();
  await expect(
    lab.getByRole("button", {
      name: "Authorize and release final report",
      exact: true,
    }),
  ).toBeDisabled();
  await lab
    .getByRole("button", { name: "Correct preliminary report", exact: true })
    .click();
  await lab.getByLabel("Result", { exact: true }).fill("10");
  await lab
    .getByRole("button", { name: "Save preliminary report", exact: true })
    .click();
  await expect(
    lab.getByRole("heading", {
      name: "Review and authorize release",
      exact: true,
    }),
  ).toBeVisible();
  await lab.screenshot({
    path: testInfo.outputPath("lab-preliminary-desktop.png"),
    fullPage: true,
  });
  await lab
    .getByLabel("I have reviewed this report and authorize its release.")
    .check();
  lab.once("dialog", (dialog) => dialog.accept());
  await lab
    .getByRole("button", {
      name: "Authorize and release final report",
      exact: true,
    })
    .click();
  await expect(lab.getByText("Final report", { exact: true })).toBeVisible();
  await expect(
    lab.getByRole("button", { name: "Print final report", exact: true }),
  ).toBeEnabled();
  await page.goto(`/doctor/diagnostics/${order.id}`);
  await expect(
    page.getByText("Synthetic analyte", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("AHP SYNTHETIC LAB VERIFIER", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Critical high", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Thibitisha nimepokea matokeo", exact: true })
    .click();
  await expect(
    page.getByText("The ordering clinician has acknowledged this report.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(
    page.getByRole("button", { name: "Print final report", exact: true }),
  ).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("diagnostic-report-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/doctor/diagnostics");
  await page.getByLabel("Find an order", { exact: true }).fill(order.id);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByText(`${f.marker} · urgent`, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Awaiting specimen", exact: true })
    .click();
  await expect(
    page.getByText(
      "No orders match this worklist. Choose another filter or search term.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "All orders", exact: true }).click();
  await expect(
    page.getByText(`${f.marker} · urgent`, { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: testInfo.outputPath("diagnostic-worklist-desktop.png"),
    fullPage: true,
  });
  await labContext.close();
});
