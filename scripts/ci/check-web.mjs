#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const env = {
  ...process.env,
  NODE_ENV: "production",
  AHP_NEXT_DIST_DIR: process.env.AHP_NEXT_DIST_DIR || ".next-readiness",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXTAUTH_URL: "https://staff.ahp-ci.invalid",
  DATABASE_URL:
    "postgresql://unused@127.0.0.1:55439/ahealth_test?schema=public",
  JWT_SECRET: randomBytes(32).toString("hex"),
  NEXTAUTH_SECRET: randomBytes(32).toString("hex"),
  GATEWAY_SHARED_SECRET: randomBytes(32).toString("hex"),
};
// A build must not depend on authenticated live services or a real database.
for (const key of [
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
]) {
  env[`${key}_SERVICE_URL`] = "http://127.0.0.1:9";
}
const tsconfigPath = root + "apps/staff-web/tsconfig.json";
const originalTsconfig = readFileSync(tsconfigPath, "utf8");
const result = spawnSync("pnpm", ["--filter", "a-health-web", "build"], {
  cwd: root,
  env,
  stdio: "inherit",
  timeout: 20 * 60 * 1000,
});
const adjusted = JSON.parse(readFileSync(tsconfigPath, "utf8"));
adjusted.include = adjusted.include?.filter(
  (path) => path !== `${env.AHP_NEXT_DIST_DIR}/types/**/*.ts`,
);
if (JSON.stringify(adjusted) === JSON.stringify(JSON.parse(originalTsconfig)))
  writeFileSync(tsconfigPath, originalTsconfig);
if (result.error)
  console.error("Web production build did not complete:", result.error.message);
process.exit(result.status ?? 1);
