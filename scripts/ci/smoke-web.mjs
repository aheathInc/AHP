#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
const root = fileURLToPath(new URL("../../", import.meta.url));
const web = root + "apps/staff-web";
const require = createRequire(import.meta.url);
const next = require.resolve("next/dist/bin/next", { paths: [web] });
const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const env = {
  ...process.env,
  NODE_ENV: "production",
  AHP_NEXT_DIST_DIR: process.env.AHP_NEXT_DIST_DIR || ".next-readiness",
  NEXTAUTH_URL: "https://staff.ahp-ci.invalid",
  NEXTAUTH_SECRET: randomBytes(32).toString("hex"),
  JWT_SECRET: randomBytes(32).toString("hex"),
  GATEWAY_SHARED_SECRET: randomBytes(32).toString("hex"),
  DATABASE_URL:
    "postgresql://unused@127.0.0.1:55439/ahealth_test?schema=public",
};
for (const service of [
  "AUTH",
  "PATIENT",
  "DOCTOR",
  "APPOINTMENT",
  "CONSULTATION",
  "MESSAGING",
  "FOLLOWUP",
  "AI",
  "EMERGENCY",
  "PHARMACY",
  "PAYMENT",
  "DIAGNOSTICS",
  "QUALITY",
  "FAMILIES",
  "EDUCATION",
  "NETWORK",
  "INSURANCE",
  "RESEARCH",
  "SURVEILLANCE",
  "SYNC",
  "DEVICES",
  "PREVENTION",
  "FACILITIES",
])
  env[service + "_SERVICE_URL"] = "http://127.0.0.1:9";
mkdirSync(root + ".local/ci-evidence/web", { recursive: true });
const log = openSync(root + ".local/ci-evidence/web/server.log", "w", 0o600);
const child = spawn(
  process.execPath,
  [next, "start", "-H", "127.0.0.1", "-p", String(port)],
  { cwd: web, env, stdio: ["ignore", log, log] },
);
const base = `http://127.0.0.1:${port}`;
const request = (path, options = {}) =>
  fetch(base + path, {
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
    ...options,
  });
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null)
      throw new Error("Built web server exited; inspect the local server log.");
    try {
      const response = await request("/login");
      if (response.status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  assert(ready, "Built web server did not become ready");
  for (const path of ["/doctor/queue", "/admin/families"]) {
    const response = await request(path);
    assert(
      [302, 307].includes(response.status),
      path + " must require sign-in",
    );
    assert.equal(
      new URL(response.headers.get("location"), base).pathname,
      "/login",
    );
  }
  const unauthenticated = await request("/bff/families");
  assert.equal(
    unauthenticated.status,
    401,
    "BFF must return JSON 401 rather than redirecting API clients to HTML",
  );
  assert.equal((await unauthenticated.json()).error.code, "UNAUTHENTICATED");
  assert.match(unauthenticated.headers.get("cache-control") || "", /no-store/);
  const rejectedOrigin = await request("/bff/families", {
    method: "POST",
    headers: {
      origin: "https://untrusted.example",
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(
    rejectedOrigin.status,
    403,
    "Cross-origin writes must remain blocked",
  );
  const csrf = await request("/api/auth/csrf");
  assert.equal(csrf.status, 200);
  const cookies = csrf.headers.getSetCookie();
  const csrfCookie = cookies.find((cookie) =>
    cookie.startsWith("__Host-a-health-web.csrf-token="),
  );
  assert(csrfCookie, "Production CSRF cookie must use the __Host- prefix");
  assert.match(csrfCookie, /; Secure/i);
  assert.match(csrfCookie, /; HttpOnly/i);
  assert.match(csrfCookie, /; SameSite=Lax/i);
  console.log(
    "Production web smoke passed: sign-in boundaries, JSON API failures, origin protection and secure cookies.",
  );
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(3000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  closeSync(log);
}
