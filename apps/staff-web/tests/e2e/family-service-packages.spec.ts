import { test, expect, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
test("family care assignment, package publication, patient request and admin review", async ({
  page,
  browser,
}, info) => {
  test.skip(
    !process.env.AHP_FAMILY_PACKAGE_FIXTURE,
    "Requires local synthetic family fixture",
  );
  test.setTimeout(300000);
  if (
    !/^http:\/\/(localhost|127\.0\.0\.1):3000$/.test(
      process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    )
  )
    throw Error("Owned local stack only");
  const f = JSON.parse(
    readFileSync(process.env.AHP_FAMILY_PACKAGE_FIXTURE!, "utf8"),
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
  await login(page, f.admin, "admin/dashboard");
  await page.goto("/admin/families");
  await page
    .getByLabel("Search family name", { exact: true })
    .fill(f.family.name);
  await page
    .getByRole("button", { name: "Search families", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open " + f.family.name, exact: true })
    .click();
  await page
    .getByLabel("Find verified clinicians", { exact: true })
    .fill("AHP SYNTHETIC FAMILY");
  await page
    .getByRole("button", { name: "Search clinician roster", exact: true })
    .click();
  await expect(page.locator(`option[value="${f.gp.profileId}"]`)).toHaveCount(
    1,
  );
  await page
    .getByLabel("Family GP", { exact: true })
    .selectOption(f.gp.profileId);
  await page
    .getByLabel("OB-GYN", { exact: true })
    .selectOption(f.obgyn.profileId);
  await page
    .getByRole("button", { name: "Save care team", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Family care team updated" }),
  ).toBeVisible();
  const clinicianContext = await browser.newContext(),
    clinician = await clinicianContext.newPage();
  await login(clinician, f.gp, "doctor/queue");
  await clinician.goto("/doctor/families");
  await expect(
    clinician.getByRole("heading", { name: f.family.name, exact: true }),
  ).toBeVisible();
  await expect(
    clinician.getByRole("button", {
      name: "Subscription packages",
      exact: true,
    }),
  ).toHaveCount(0);
  await clinicianContext.close();
  await page
    .getByRole("button", { name: "Subscription packages", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Family Basic", exact: true }),
  ).toBeVisible();
  const original = await page.evaluate(async () => {
    const r = await fetch("/bff/families/plans", { cache: "no-store" });
    return (await r.json()).data.find(
      (p: { tier: string }) => p.tier === "family_basic",
    );
  });
  try {
    await page
      .getByRole("button", { name: "Edit Family Basic", exact: true })
      .click();
    await page
      .getByLabel("Package name", { exact: true })
      .fill("SYNTHETIC Basic acceptance package");
    await page
      .getByLabel("Package description", { exact: true })
      .fill(
        "Synthetic local acceptance terms only. Not an actual commercial offer.",
      );
    await page.getByLabel("Price in TZS", { exact: true }).fill("12500");
    await page
      .getByLabel("Included services (one per line, up to 12)", { exact: true })
      .fill("Synthetic coordination service");
    await page
      .getByLabel("Exclusions & conditions (one per line, up to 12)", {
        exact: true,
      })
      .fill("No medicines or hospital charges included");
    await page.getByLabel("Accept new requests", { exact: true }).check();
    await page
      .getByRole("button", { name: "Save package terms", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "SYNTHETIC Basic acceptance package",
        exact: true,
      }),
    ).toBeVisible();
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: info.outputPath("family-packages-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: info.outputPath("family-packages-web-mobile.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    try {
      const r = await execute(
        "/home/kali/.local/flutter-sdk/bin/flutter",
        [
          "test",
          "test/live_family_packages_test.dart",
          "--reporter",
          "expanded",
        ],
        {
          cwd: "/home/kali/AHP/apps/patient-mobile",
          env: {
            ...process.env,
            AHP_FAMILY_PACKAGE_FIXTURE: process.env.AHP_FAMILY_PACKAGE_FIXTURE!,
          },
          timeout: 180000,
          maxBuffer: 2e6,
        },
      );
      writeFileSync(
        "/home/kali/AHP/.local/family-mobile-live.log",
        r.stdout + r.stderr,
      );
    } catch (e) {
      const error = e as { stdout?: string; stderr?: string };
      writeFileSync(
        "/home/kali/AHP/.local/family-mobile-live.log",
        (error.stdout ?? "") + (error.stderr ?? ""),
      );
      throw Error(
        "Flutter live family acceptance failed; inspect private local test log",
      );
    }
    await page
      .getByRole("button", { name: "Enrollment requests", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: f.family.name, exact: true }),
    ).toBeVisible();
    const requestCard = page.locator("article").filter({
      has: page.getByRole("heading", { name: f.family.name, exact: true }),
    });
    await requestCard
      .getByText("Terms reviewed by the applicant", { exact: true })
      .click();
    await expect(
      requestCard.getByText("Synthetic coordination service", { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: info.outputPath("family-enrollment-review.png"),
      fullPage: true,
    });
    await requestCard
      .getByLabel("Review note (no clinical details)", { exact: true })
      .fill("Synthetic eligibility confirmed; payment handled separately.");
    page.once("dialog", (d) => d.accept());
    await requestCard
      .getByRole("button", { name: "Approve package allocation", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Package assigned and review recorded" }),
    ).toBeVisible();
    const saved = await page.evaluate(async (id) => {
      const r = await fetch("/bff/families/" + id, { cache: "no-store" });
      return r.json();
    }, f.family.id);
    expect(saved.subscription_tier).toBe("family_basic");
    expect(saved.members).toHaveLength(1);
  } finally {
    await page.evaluate(async (original) => {
      const current = await (
        await fetch("/bff/families/plans", { cache: "no-store" })
      ).json();
      const version = current.data.find(
        (p: { tier: string }) => p.tier === original.tier,
      ).version;
      const {
        tier,
        name,
        description,
        benefits,
        exclusions,
        price_minor,
        currency,
        billing_period,
        accepting_requests,
      } = original;
      const r = await fetch("/bff/families/plans/" + tier, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_version: version,
          name,
          description,
          benefits,
          exclusions,
          price_minor,
          currency,
          billing_period,
          accepting_requests,
        }),
      });
      if (!r.ok)
        throw Error("Restore of synthetic catalogue test terms failed");
    }, original);
  }
});
