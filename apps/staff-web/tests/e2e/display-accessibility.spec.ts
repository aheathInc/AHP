import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Display & accessibility", exact: true }),
  ).toBeEnabled();
});

test("preferences persist and the settings dialog contains keyboard focus", async ({
  page,
}) => {
  const trigger = page.getByRole("button", {
    name: "Display & accessibility",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Display & accessibility",
    exact: true,
  });
  await dialog
    .getByLabel("Animation preference", { exact: true })
    .selectOption("reduce");
  await dialog
    .getByLabel("Colour accessibility", { exact: true })
    .selectOption("red-green");
  await dialog.getByLabel("Use solid surfaces", { exact: false }).check();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await dialog.getByRole("button", { name: "Done", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close display settings" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await expect(page.locator("html")).toHaveAttribute(
    "data-vision",
    "red-green",
  );
  await expect(page.locator("html")).toHaveAttribute("data-surfaces", "solid");
});

test("live device reduced motion always wins over the default setting", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await page
    .getByRole("button", { name: "Display & accessibility", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Display & accessibility",
    exact: true,
  });
  await expect(
    dialog.getByLabel("Animation preference", { exact: true }),
  ).toHaveValue("system");
  expect(
    await dialog.evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
});

test("settings still apply when browser storage is blocked", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    }),
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Display & accessibility", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Display & accessibility",
    exact: true,
  });
  await dialog
    .getByLabel("Animation preference", { exact: true })
    .selectOption("reduce");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await expect(dialog.getByRole("status")).toContainText(
    "browser storage is unavailable",
  );
});

test("colour-friendly semantic badges retain readable contrast in both appearances", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Display & accessibility", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Display & accessibility",
    exact: true,
  });
  for (const theme of ["light", "dark"])
    for (const mode of ["red-green", "blue-yellow", "high-contrast"]) {
      await dialog
        .getByLabel("Appearance", { exact: true })
        .selectOption(theme);
      await dialog
        .getByLabel("Colour accessibility", { exact: true })
        .selectOption(mode);
      const ratios = await page.evaluate(() => {
        const luminance = (rgb: string) => {
          const values = rgb
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map((value) => {
              const n = Number(value) / 255;
              return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
            });
          return values.reduce(
            (sum, n, index) => sum + n * [0.2126, 0.7152, 0.0722][index],
            0,
          );
        };
        return ["good", "attention", "problem"].map((tone) => {
          const badge = document.createElement("span");
          badge.className = "ahp-badge ahp-badge--" + tone;
          badge.setAttribute("aria-hidden", "true");
          document.body.append(badge);
          const style = getComputedStyle(badge),
            a = luminance(style.color),
            b = luminance(style.backgroundColor);
          badge.remove();
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
      });
      for (const ratio of ratios)
        expect(ratio, `${mode} ${theme}`).toBeGreaterThanOrEqual(4.5);
      if (mode === "high-contrast")
        await expect(page.locator("html")).toHaveAttribute(
          "data-surfaces",
          "solid",
        );
    }
});

test("settings remain usable at narrow phone width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page
    .getByRole("button", { name: "Display & accessibility", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Display & accessibility",
    exact: true,
  });
  await dialog
    .getByLabel("Colour accessibility", { exact: true })
    .selectOption("blue-yellow");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
