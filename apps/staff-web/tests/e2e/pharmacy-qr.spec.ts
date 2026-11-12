import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixture = process.env.AHP_QR_FIXTURE;
const png = process.env.AHP_QR_IMAGE;
test("Flutter QR camera read, live verification, stream cleanup and manual fallback", async ({
  browser,
}, testInfo) => {
  test.skip(
    !fixture || !png,
    "Requires a local synthetic pharmacy fixture and Flutter QR image.",
  );
  test.setTimeout(180000);
  if (
    !/^http:\/\/(localhost|127\.0\.0\.1):3000$/.test(
      process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    )
  )
    throw Error("Local synthetic acceptance only");
  const f = JSON.parse(readFileSync(fixture!, "utf8"));
  const image =
    "data:image/png;base64," + readFileSync(png!).toString("base64");
  const context = await browser.newContext();
  try {
    // Real QR pixels rendered by Flutter, exposed as a browser camera stream.
    await context.addInitScript(
      ({ image }) => {
        (window as any).__cameraStreams = [];
        (window as any).__cameraMode = "qr";
        navigator.mediaDevices.getUserMedia = async () => {
          if ((window as any).__cameraMode === "denied")
            throw new DOMException("denied", "NotAllowedError");
          if ((window as any).__cameraMode === "pending") {
            await new Promise<void>((resolve) => {
              (window as any).__releaseCamera = resolve;
            });
          }
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 720;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, 640, 720);
          const img = new Image();
          img.src = image;
          await img.decode();
          if ((window as any).__cameraMode === "qr")
            ctx.drawImage(img, 40, 30, 560, 660);
          const stream = canvas.captureStream(5);
          (window as any).__cameraStreams.push(stream);
          const timer = setInterval(() => {
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, 640, 720);
            if ((window as any).__cameraMode === "qr")
              ctx.drawImage(img, 40, 30, 560, 660);
          }, 150);
          stream.getTracks().forEach((t) => {
            const stop = t.stop.bind(t);
            t.stop = () => {
              clearInterval(timer);
              stop();
            };
          });
          return stream;
        };
      },
      { image },
    );
    const page = await context.newPage();
    let verifyRequests = 0;
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/bff/dispensing/verify")
        verifyRequests++;
    });
    await page.goto("http://localhost:3000/login");
    await page.getByLabel("Email").fill(f.pharmacist.email);
    await page.getByLabel("Password").fill(f.pharmacist.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/pharmacy", { timeout: 60000 });
    const scan = page.getByRole("button", { name: "Scan QR with camera" });
    await expect(scan).toBeEnabled();
    await scan.click();
    await expect(
      page.getByLabel("Secure prescription reference", { exact: true }),
    ).toHaveValue(f.reference, { timeout: 60000 });
    await expect(
      page.getByText("QR captured.", { exact: false }),
    ).toBeVisible();
    if (verifyRequests !== 0)
      throw Error("Scan unexpectedly verified/dispensed");
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__cameraStreams.every((s: MediaStream) =>
            s
              .getTracks()
              .every((t: MediaStreamTrack) => t.readyState === "ended"),
          ),
        ),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Verify reference", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Authorized prescription" }),
    ).toBeVisible();
    await expect(
      page.getByText(f.medicine + " · synthetic unit", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("pharmacy-verified-desktop.png"),
      fullPage: true,
    });
    // Closing stops a camera that has no code to read.
    await page.getByRole("button", { name: "Cancel lookup" }).click();
    await page.evaluate(() => {
      (window as any).__cameraMode = "blank";
    });
    await scan.click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__cameraStreams.some((s: MediaStream) =>
            s
              .getTracks()
              .some((t: MediaStreamTrack) => t.readyState === "live"),
          ),
        ),
      )
      .toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("pharmacy-camera-mobile.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Close camera" }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__cameraStreams.every((s: MediaStream) =>
            s
              .getTracks()
              .every((t: MediaStreamTrack) => t.readyState === "ended"),
          ),
        ),
      )
      .toBe(true);
    await page.evaluate(() => {
      (window as any).__cameraMode = "denied";
    });
    await scan.click();
    await expect(
      page
        .getByRole("region", { name: "Scan prescription QR" })
        .getByRole("alert"),
    ).toContainText("Camera access was denied");
    await page.getByRole("button", { name: "Close camera" }).click();
    await page
      .getByLabel("Secure prescription reference", { exact: true })
      .fill(f.reference);
    await expect(
      page.getByRole("button", { name: "Verify reference", exact: true }),
    ).toBeEnabled();

    // A late permission grant must not leave the camera running after close.
    await page.evaluate(() => {
      (window as any).__cameraMode = "pending";
    });
    const count = await page.evaluate(
      () => (window as any).__cameraStreams.length,
    );
    await scan.click();
    await expect
      .poll(() =>
        page.evaluate(
          () => typeof (window as any).__releaseCamera === "function",
        ),
      )
      .toBe(true);
    await page.getByRole("button", { name: "Close camera" }).click();
    await page.evaluate(() => (window as any).__releaseCamera());
    await expect
      .poll(() => page.evaluate(() => (window as any).__cameraStreams.length))
      .toBe(count + 1);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__cameraStreams.every((stream: MediaStream) =>
            stream.getTracks().every((track) => track.readyState === "ended"),
          ),
        ),
      )
      .toBe(true);

    // Hiding a tab releases an active scan as well as its decoder.
    await page.evaluate(() => {
      (window as any).__cameraMode = "blank";
    });
    await scan.click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__cameraStreams.some((stream: MediaStream) =>
            stream.getTracks().some((track) => track.readyState === "live"),
          ),
        ),
      )
      .toBe(true);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(
      page.getByRole("button", { name: "Close camera" }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__cameraStreams.every((stream: MediaStream) =>
            stream.getTracks().every((track) => track.readyState === "ended"),
          ),
        ),
      )
      .toBe(true);
  } finally {
    await context.close();
  }
});
