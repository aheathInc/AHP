import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("staff workspace prioritizes content, keeps role navigation and adapts to narrow screens", async ({
  page,
}, info) => {
  test.skip(
    !process.env.AHP_FAMILY_PACKAGE_FIXTURE,
    "Requires local synthetic staff account",
  );
  test.setTimeout(150000);
  const f = JSON.parse(
    readFileSync(process.env.AHP_FAMILY_PACKAGE_FIXTURE!, "utf8"),
  );
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(f.admin.email);
  await page.getByLabel("Password", { exact: true }).fill(f.admin.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin/dashboard");
  await page.goto("/admin/families");
  await expect(
    page.getByRole("heading", {
      name: "Family services & packages",
      exact: true,
    }),
  ).toBeVisible();
  const header = page.locator(".ahp-workspace-header");
  expect((await header.boundingBox())!.height).toBeLessThan(180);
  await expect(header.locator("img")).toHaveCount(0);
  await page
    .getByLabel("Search family name", { exact: true })
    .fill(f.family.name);
  await page
    .getByRole("button", { name: "Search families", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: f.family.name, exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: info.outputPath("staff-workspace-desktop.png"),
    fullPage: true,
  });
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", {
    name: "Find your workspace",
    exact: true,
  });
  await expect(search).toBeVisible();
  await page.getByLabel("Search available workspaces").fill("audit");
  await expect(
    search.getByRole("link", { name: /Audit ledger/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  const drawer = page.getByRole("dialog", {
    name: "Staff navigation",
    exact: true,
  });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("link", {
      name: "Family services & packages",
      exact: true,
    }),
  ).toBeVisible();
  for (const key of ["Tab", "Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    expect(
      await drawer.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("staff-workspace-mobile.png"),
    fullPage: true,
  });
  await page.getByLabel("Color theme", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() =>
      page
        .locator(".ahp-button--quiet")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    .toBe("rgb(19, 51, 44)");
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: info.outputPath("staff-workspace-dark-mobile.png"),
    fullPage: true,
  });
  await page.getByLabel("Color theme", { exact: true }).selectOption("system");
});
