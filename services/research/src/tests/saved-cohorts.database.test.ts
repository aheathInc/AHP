import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@a-health/database";
import {
  assertIsolatedLocalTestTarget,
  verifyLocalTestIdentity,
} from "@a-health/database/test-safety";
import { ResearchPortal } from "../portal/service.js";
import { researchStore } from "../portal/prisma-store.js";
import { sha } from "../portal/policy.js";
import type { Cell, SavedCohort } from "../portal/types.js";
const target = assertIsolatedLocalTestTarget();
const now = new Date("2026-11-16T12:00:00Z");
const portal = new ResearchPortal(
  researchStore,
  {
    enabled: true,
    realDataEnabled: false,
    encryptionKey: randomBytes(32),
    linkageKey: randomBytes(32),
  },
  async () => "clean",
  () => now,
);
before(() => verifyLocalTestIdentity(prisma, target));
after(() => prisma.$disconnect());
async function fixture() {
  const user = async (
    role: "researcher" | "platform_admin" | "facility_admin",
  ) =>
    prisma.user.create({
      data: {
        phoneNumber:
          "+255" + String(Math.floor(600000000 + Math.random() * 99999999)),
        email: randomUUID() + "@test.invalid",
        fullName: "Synthetic cohort test",
        role,
        status: "active",
      },
    });
  const owner = await user("researcher"),
    other = await user("researcher"),
    admin = await user("platform_admin"),
    steward = await user("facility_admin");
  const actor = { sub: owner.id, role: "researcher" };
  await prisma.researcherApplication.create({
    data: {
      userId: owner.id,
      kind: "independent",
      displayName: "Synthetic cohort researcher",
      credentialReference: "SYNTHETIC-REFERENCE",
      status: "verified",
    },
  });
  const facility = await prisma.facility.create({
    data: { name: "Synthetic cohort facility", type: "clinic" },
  });
  const dataset = await prisma.researchCollection.create({
    data: {
      name: randomUUID(),
      description: "Synthetic release only",
      domains: ["condition"],
      syntheticOnly: true,
      createdBy: admin.id,
      status: "published",
      minimumCellSize: 10,
    },
  });
  const source = await prisma.researchSourceGrant.create({
    data: {
      datasetId: dataset.id,
      facilityId: facility.id,
      stewardId: steward.id,
      agreementReference: "PRIVATE-AGREEMENT",
      expiresAt: new Date("2027-01-01"),
      status: "approved",
      createdBy: admin.id,
    },
  });
  const cells: Cell[] = Array.from({ length: 28 }, (_, i) => ({
    age_band: i % 2 ? "30-39" : "40-49",
    sex: "female",
    region: "SYNTHETIC",
    period: "2026-Q3",
    domain: "condition",
    code_system: "ICD10",
    code: "TEST-" + i,
    label: "Synthetic concept " + i,
    participants: 10 + i,
  }));
  const release = await prisma.researchRelease.create({
    data: {
      datasetId: dataset.id,
      status: "published",
      sourceIds: [source.id],
      cells: JSON.parse(JSON.stringify(cells)),
      quality: {
        staged_events: 500,
        unmapped_events: 0,
        mapping_coverage: 1,
        withheld_cells: 2,
        transform_version: "synthetic",
      },
      minimumCellSize: 10,
      contentHash: sha(JSON.stringify(cells)),
      createdBy: admin.id,
    },
  });
  await prisma.researchCollection.update({
    where: { id: dataset.id },
    data: { latestReleaseId: release.id },
  });
  const study = await prisma.researchStudy.create({
    data: {
      ownerId: owner.id,
      title: "Synthetic repeatable analysis",
      purpose: "Test saved aggregate definitions only",
      datasetId: dataset.id,
      releaseId: release.id,
      status: "approved",
      ethicsReference: "TEST-ETHICS",
      controllerReference: "TEST-CONTROLLER",
      ethicsExpiresAt: new Date("2027-01-01"),
      expiresAt: new Date("2026-12-01"),
      allowExport: true,
    },
  });
  const save = (name = "Adult follow-up", filters = { age_band: "30-39" }) =>
    portal.run(actor, "cohort.create", {
      study_id: study.id,
      release_id: release.id,
      name,
      filters,
    }) as Promise<SavedCohort>;
  return { owner, other, admin, actor, source, release, study, dataset, save };
}
it("offers published facets and safe provenance without staging, source agreements or hidden counts", async () => {
  const f = await fixture();
  const result = (await portal.run(f.actor, "cohort.workspace", {
    id: f.study.id,
  })) as { facets: { age_band: string[] }; published_cells: number };
  assert.deepEqual(result.facets.age_band, ["30-39", "40-49"]);
  assert.equal(result.published_cells, 28);
  for (const field of [
    "PRIVATE-AGREEMENT",
    "withheld_cells",
    "staged_events",
    "ciphertext",
    "subject_hash",
  ])
    assert.ok(!JSON.stringify(result).includes(field));
});
it("persists named definitions without result cells and returns reproducible, filtered output", async () => {
  const f = await fixture();
  const saved = await f.save();
  assert.equal(saved.version, 1);
  const stored = await prisma.researchSavedCohort.findUniqueOrThrow({
    where: { id: saved.id },
  });
  assert.deepEqual(stored.filters, { age_band: "30-39" });
  assert.ok(!("cells" in stored));
  const result = (await portal.run(f.actor, "cohort.run", {
    id: saved.id,
    base_version: 1,
  })) as {
    cells: Cell[];
    release_hash: string;
    queried_at: string;
    saved_cohort: { version: number };
    filters: unknown;
  };
  assert.equal(result.cells.length, 14);
  assert.ok(result.cells.every((cell) => cell.age_band === "30-39"));
  assert.equal(result.release_hash, f.release.contentHash);
  assert.equal(result.queried_at, now.toISOString());
  assert.equal(result.saved_cohort.version, 1);
  assert.deepEqual(result.filters, saved.filters);
  const adHoc = (await portal.run(f.actor, "query", {
    study_id: f.study.id,
    filters: saved.filters,
  })) as typeof result;
  assert.deepEqual(adHoc.cells, result.cells);
  assert.equal(adHoc.release_hash, result.release_hash);
});
it("enforces researcher ownership for all cohort endpoints", async () => {
  const f = await fixture(),
    saved = await f.save();
  for (const role of ["platform_admin", "facility_admin", "patient"])
    await assert.rejects(() =>
      portal.run({ sub: f.admin.id, role }, "cohort.workspace", {
        id: f.study.id,
      }),
    );
  for (const action of ["cohort.run", "cohort.update", "cohort.archive"])
    await assert.rejects(
      () =>
        portal.run({ sub: f.other.id, role: "researcher" }, action, {
          id: saved.id,
          base_version: 1,
          ...(action === "cohort.update"
            ? { name: "Unauthorized update", filters: {} }
            : {}),
        }),
      { code: "NOT_RESOURCE_OWNER" },
    );
  await assert.rejects(
    () =>
      portal.run({ sub: f.other.id, role: "researcher" }, "cohort.workspace", {
        id: f.study.id,
      }),
    { code: "NOT_RESOURCE_OWNER" },
  );
});
it("serializes concurrent edits, rejects duplicate names and audits one committed update", async () => {
  const f = await fixture(),
    saved = await f.save();
  await assert.rejects(() => f.save("ADULT FOLLOW-UP"), {
    code: "COHORT_NAME_EXISTS",
  });
  const outcomes = await Promise.allSettled(
    [1, 2].map(() =>
      portal.run(f.actor, "cohort.update", {
        id: saved.id,
        base_version: 1,
        name: "Updated cohort",
        filters: { age_band: "40-49" },
      }),
    ),
  );
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (outcomes.find((r) => r.status === "rejected") as PromiseRejectedResult)
      .reason.code,
    "VERSION_CONFLICT",
  );
  assert.equal(
    await prisma.auditLog.count({
      where: { entityId: saved.id, action: "research.portal.cohort_updated" },
    }),
    1,
  );
  assert.equal(
    (
      await prisma.researchSavedCohort.findUniqueOrThrow({
        where: { id: saved.id },
      })
    ).version,
    2,
  );
  await assert.rejects(
    () => portal.run(f.actor, "cohort.run", { id: saved.id, base_version: 1 }),
    { code: "VERSION_CONFLICT" },
  );
});
it("rechecks project expiry, identity, source revocation and release status on every rerun", async () => {
  for (const changed of ["expiry", "identity", "source", "release"]) {
    const f = await fixture(),
      saved = await f.save();
    if (changed === "expiry")
      await prisma.researchStudy.update({
        where: { id: f.study.id },
        data: { expiresAt: new Date("2026-01-01") },
      });
    if (changed === "identity")
      await prisma.researcherApplication.update({
        where: { userId: f.owner.id },
        data: { status: "revoked" },
      });
    if (changed === "source")
      await prisma.researchSourceGrant.update({
        where: { id: f.source.id },
        data: { status: "revoked" },
      });
    if (changed === "release")
      await prisma.researchRelease.update({
        where: { id: f.release.id },
        data: { status: "revoked" },
      });
    await assert.rejects(
      () =>
        portal.run(f.actor, "cohort.run", { id: saved.id, base_version: 1 }),
      (e) => (e as { status: number }).status === 403,
    );
    await assert.rejects(
      () => portal.run(f.actor, "cohort.workspace", { id: f.study.id }),
      (e) => (e as { status: number }).status === 403,
    );
  }
});
it("pins saved definitions and displayed-result export requests to the exact approved release", async () => {
  const f = await fixture(),
    saved = await f.save();
  await assert.rejects(
    () =>
      portal.run(f.actor, "export.request", {
        study_id: f.study.id,
        format: "csv",
        filters: {},
        release_id: randomUUID(),
        release_hash: f.release.contentHash,
      }),
    { code: "RELEASE_CHANGED" },
  );
  await assert.rejects(
    () =>
      portal.run(f.actor, "export.request", {
        study_id: f.study.id,
        format: "csv",
        filters: {},
        release_id: f.release.id,
        release_hash: "0".repeat(64),
      }),
    { code: "RELEASE_CHANGED" },
  );
  const release = await prisma.researchRelease.create({
    data: {
      datasetId: f.dataset.id,
      status: "published",
      sourceIds: [f.source.id],
      cells: f.release.cells!,
      quality: f.release.quality!,
      minimumCellSize: 10,
      contentHash: "1".repeat(64),
      createdBy: f.admin.id,
    },
  });
  await prisma.researchStudy.update({
    where: { id: f.study.id },
    data: { releaseId: release.id },
  });
  await assert.rejects(
    () => portal.run(f.actor, "cohort.run", { id: saved.id, base_version: 1 }),
    { code: "RELEASE_CHANGED" },
  );
  await assert.rejects(
    () =>
      portal.run(f.actor, "cohort.update", {
        id: saved.id,
        base_version: 1,
        name: "New release cohort",
        filters: {},
      }),
    { code: "RELEASE_CHANGED" },
  );
});
it("archives without granting expired access and refuses archived or malicious definitions", async () => {
  const f = await fixture();
  await assert.rejects(
    () => f.save("Malicious filter", { patient_id: "private" } as never),
    { code: "INVALID_FIELD" },
  );
  const saved = await f.save();
  await prisma.researchStudy.update({
    where: { id: f.study.id },
    data: { expiresAt: new Date("2026-01-01") },
  });
  const archived = (await portal.run(f.actor, "cohort.archive", {
    id: saved.id,
    base_version: 1,
  })) as SavedCohort;
  assert.equal(archived.status, "archived");
  assert.equal(archived.version, 2);
  await assert.rejects(
    () => portal.run(f.actor, "cohort.run", { id: saved.id, base_version: 2 }),
    { code: "COHORT_ARCHIVED" },
  );
  const audit = await prisma.auditLog.findMany({
    where: { entityId: saved.id },
  });
  assert.ok(audit.length >= 2);
  assert.ok(
    !JSON.stringify(audit.map((row) => row.metadata)).includes(
      "Adult follow-up",
    ),
  );
});
