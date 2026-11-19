import { before, after, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@a-health/database";
import {
  assertIsolatedLocalTestTarget,
  verifyLocalTestIdentity,
} from "@a-health/database/test-safety";
import { getOperationsOverview } from "../services/operations-overview.service.js";
const target = assertIsolatedLocalTestTarget();
before(() => verifyLocalTestIdentity(prisma, target));
after(() => prisma.$disconnect());
it("rejects every non-platform role before accessing operational data", async () => {
  for (const role of [
    "patient",
    "clinician",
    "dispatcher",
    "facility_admin",
    "pharmacist",
    "researcher",
  ])
    await assert.rejects(() => getOperationsOverview(role), {
      code: "ROLE_NOT_PERMITTED",
    });
});
it("counts full populations, excludes closed work and uses a bounded 24-hour payment window without identifiers", async () => {
  const now = new Date("2026-11-16T12:00:00Z");
  const old = new Date("2026-11-15T10:00:00Z");
  await prisma.incidentReport.createMany({
    data: Array.from({ length: 31 }, () => ({
      category: "clinical_care" as const,
      severity: "serious" as const,
      description: "PRIVATE patient details",
      escalatedToGovernance: true,
      reportedAt: old,
    })),
  });
  await prisma.incidentReport.create({
    data: {
      category: "other",
      severity: "low",
      description: "Closed",
      status: "closed",
      escalatedToGovernance: true,
    },
  });
  await prisma.paymentIntent.createMany({
    data: [
      { status: "failed" as const, createdAt: now },
      { status: "failed" as const, createdAt: old },
      { status: "failed" as const, createdAt: new Date("2026-11-17") },
      { status: "succeeded" as const, createdAt: now },
    ].map((p) => ({
      ...p,
      amount: 100,
      method: "cash" as const,
      purpose: "other" as const,
    })),
  });
  const result = await getOperationsOverview("platform_admin", now);
  assert.equal(result.counts.open_incidents, 31);
  assert.equal(result.counts.escalated_incidents, 31);
  assert.equal(result.oldest.escalated_incident_at, old.toISOString());
  assert.equal(result.counts.failed_payments_24h, 1);
  assert.equal(result.oldest.pending_verification_at, null);
  assert.equal(result.generated_at, now.toISOString());
  for (const secret of ["PRIVATE", "description", "patient_id", "reported_by"])
    assert.ok(!JSON.stringify(result).includes(secret));
});
