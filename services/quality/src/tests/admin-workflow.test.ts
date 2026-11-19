import { before, after, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@a-health/database";
import {
  assertIsolatedLocalTestTarget,
  verifyLocalTestIdentity,
} from "@a-health/database/test-safety";
import {
  updateIncidentReport,
  listIncidentReports,
} from "../services/incident.service.js";
const target = assertIsolatedLocalTestTarget();
let admin: { sub: string; role: string };
const meta = { requestId: "admin-workflow-test" };
before(async () => {
  await verifyLocalTestIdentity(prisma, target);
  const u = await prisma.user.create({
    data: {
      phoneNumber: "+255700000091",
      role: "platform_admin",
      status: "active",
      fullName: "Synthetic admin",
    },
  });
  admin = { sub: u.id, role: u.role };
});
after(() => prisma.$disconnect());
it("enforces governance authorization, evidence, version and ordered transitions", async () => {
  const row = await prisma.incidentReport.create({
    data: {
      category: "clinical_care",
      severity: "serious",
      description: "SYNTHETIC private report",
      anonymous: true,
      escalatedToGovernance: true,
    },
  });
  for (const role of ["patient", "clinician", "facility_admin", "dispatcher"])
    await assert.rejects(
      () =>
        updateIncidentReport(
          { ...admin, role },
          row.id,
          {
            expected_version: 1,
            status: "under_investigation",
            investigation_notes: "Review report",
          },
          meta,
        ),
      { code: "ROLE_NOT_PERMITTED" },
    );
  await assert.rejects(() =>
    updateIncidentReport(
      admin,
      row.id,
      { expected_version: 1, status: "under_investigation" },
      meta,
    ),
  );
  await assert.rejects(
    () =>
      updateIncidentReport(
        admin,
        row.id,
        {
          expected_version: 1,
          status: "closed",
          action_taken: "Reviewed outcome",
        },
        meta,
      ),
    { code: "STATE_TRANSITION_INVALID" },
  );
  const concurrent = await Promise.allSettled(
    [1, 2].map(() =>
      updateIncidentReport(
        admin,
        row.id,
        {
          expected_version: 1,
          status: "under_investigation",
          investigation_notes: "PRIVATE investigation plan",
        },
        meta,
      ),
    ),
  );
  assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (concurrent.find((r) => r.status === "rejected") as PromiseRejectedResult)
      .reason.code,
    "VERSION_CONFLICT",
  );
  await assert.rejects(
    () =>
      updateIncidentReport(
        admin,
        row.id,
        {
          expected_version: 1,
          status: "action_taken",
          action_taken: "Updated protocol",
        },
        meta,
      ),
    { code: "VERSION_CONFLICT" },
  );
  await updateIncidentReport(
    admin,
    row.id,
    {
      expected_version: 2,
      status: "action_taken",
      action_taken: "Updated protocol",
    },
    meta,
  );
  const closed = await updateIncidentReport(
    admin,
    row.id,
    {
      expected_version: 3,
      status: "closed",
      action_taken: "Verified protocol and outcome",
    },
    meta,
  );
  assert.ok(closed.closed_at);
  assert.equal(closed.version, 4);
  assert.equal(closed.anonymous, true);
  assert.ok(!("reported_by_user_id" in closed));
  assert.ok(
    !(
      (await listIncidentReports(admin, { status: "open", limit: 25 }))
        .data as { id: string }[]
    ).some((r) => r.id === row.id),
  );
  const reopened = await updateIncidentReport(
    admin,
    row.id,
    {
      expected_version: 4,
      status: "under_investigation",
      investigation_notes: "New evidence requires further review",
    },
    meta,
  );
  assert.equal(reopened.closed_at, null);
  const audit = await prisma.auditLog.findMany({
    where: { entityId: row.id, action: "incident.status_changed" },
  });
  assert.equal(audit.length, 4);
  assert.ok(!JSON.stringify(audit.map((r) => r.metadata)).includes("PRIVATE"));
  assert.equal(
    (await prisma.incidentReport.findUniqueOrThrow({ where: { id: row.id } }))
      .reportedByUserId,
    null,
  );
});
