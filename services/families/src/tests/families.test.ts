import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { prisma } from "@a-health/database";
import type { AppError } from "@a-health/http";
import * as families from "../services/family.service.js";

if (!/_dev|_test|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Refusing to run tests outside a development database");
}

const meta = { ip: "127.0.0.1", requestId: "test" };
const users: string[] = [];
const clinicians: string[] = [];
const familyIds: string[] = [];

after(async () => {
  for (const id of familyIds) {
    await prisma.familyAssignment
      .deleteMany({ where: { familyId: id } })
      .catch(() => undefined);
    await prisma.familyMember
      .deleteMany({ where: { familyId: id } })
      .catch(() => undefined);
    await prisma.family.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of clinicians) {
    await prisma.clinicianProfile
      .delete({ where: { id } })
      .catch(() => undefined);
  }
  for (const id of users) {
    await prisma.patientProfile
      .deleteMany({ where: { OR: [{ userId: id }, { guardianUserId: id }] } })
      .catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

let adminCaller: { sub: string; role: string };
before(async () => {
  const u = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      role: "platform_admin",
      status: "active",
    },
  });
  users.push(u.id);
  adminCaller = { sub: u.id, role: "platform_admin" };
});
function makeAdmin() {
  return adminCaller;
}

async function makePatient(guardian?: string) {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      role: "patient",
      status: "active",
      fullName: "Family Test",
    },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({
    data: {
      userId: user.id,
      guardianUserId: guardian,
      fullName: "Family Test",
    },
  });
  return { user, profile };
}

async function makeClinician(maxFamilyLoad = 10) {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      email: `${randomUUID()}@test.local`,
      role: "clinician",
      status: "active",
      fullName: "Family Clinician",
    },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: {
      userId: user.id,
      licenseNumber: `TEST-${randomUUID().slice(0, 12)}`,
      specialty: "general_practice",
      verificationStatus: "verified",
      maxFamilyLoad,
    },
  });
  clinicians.push(profile.id);
  return profile;
}

describe("creating and viewing", () => {
  it("creates a family with the caller as head, and getMyFamily finds it", async () => {
    const { user } = await makePatient();
    const family = await families.createFamily(
      { sub: user.id, role: "patient" },
      { name: "The Test Family" },
      meta,
    );
    familyIds.push(family.id);

    const mine = await families.getMyFamily({ sub: user.id, role: "patient" });
    assert.equal(mine.id, family.id);
    assert.equal(mine.members.length, 0);
  });

  it("refuses a caller with no family", async () => {
    const { user } = await makePatient();
    await assert.rejects(
      () => families.getMyFamily({ sub: user.id, role: "patient" }),
      (e: AppError) => e.code === "NOT_FOUND",
    );
  });
});

describe("membership", () => {
  it("lets the head add a member", async () => {
    const { user } = await makePatient();
    const family = await families.createFamily(
      { sub: user.id, role: "patient" },
      { name: "Add Member Family" },
      meta,
    );
    familyIds.push(family.id);
    const { profile: childProfile } = await makePatient(user.id);

    const member = await families.addFamilyMember(
      family.id,
      { sub: user.id, role: "patient" },
      { patient_profile_id: childProfile.id, relationship: "child" },
      meta,
    );
    assert.equal(member.relationship, "child");

    const mine = await families.getMyFamily({ sub: user.id, role: "patient" });
    assert.equal(mine.members.length, 1);
  });

  it("refuses a non-head adding a member", async () => {
    const { user } = await makePatient();
    const family = await families.createFamily(
      { sub: user.id, role: "patient" },
      { name: "No Access Family" },
      meta,
    );
    familyIds.push(family.id);
    const { profile: other } = await makePatient(user.id);

    await assert.rejects(
      () =>
        families.addFamilyMember(
          family.id,
          { sub: other.userId!, role: "patient" },
          { patient_profile_id: other.id, relationship: "spouse" },
          meta,
        ),
      (e: AppError) => e.code === "NOT_RESOURCE_OWNER",
    );
  });

  it("refuses adding the same patient twice", async () => {
    const { user } = await makePatient();
    const family = await families.createFamily(
      { sub: user.id, role: "patient" },
      { name: "Dup Family" },
      meta,
    );
    familyIds.push(family.id);
    const { profile: other } = await makePatient(user.id);
    await families.addFamilyMember(
      family.id,
      { sub: user.id, role: "patient" },
      { patient_profile_id: other.id, relationship: "spouse" },
      meta,
    );

    await assert.rejects(
      () =>
        families.addFamilyMember(
          family.id,
          { sub: user.id, role: "patient" },
          { patient_profile_id: other.id, relationship: "spouse" },
          meta,
        ),
      (e: AppError) => e.code === "DUPLICATE_RESOURCE",
    );
  });
});

describe("doctor assignment", () => {
  it("assigns a separate GP and OB/GYN", async () => {
    const { user } = await makePatient();
    const family = await families.createFamily(
      { sub: user.id, role: "patient" },
      { name: "Assigned Family" },
      meta,
    );
    familyIds.push(family.id);
    const gp = await makeClinician();
    const obgyn = await makeClinician();
    await prisma.clinicianProfile.update({
      where: { id: obgyn.id },
      data: { specialty: "obstetrics_gynaecology" },
    });

    const result = await families.assignFamilyDoctors(
      family.id,
      makeAdmin(),
      { gp_clinician_id: gp.id, obgyn_clinician_id: obgyn.id },
      meta,
    );
    assert.equal(result.gp_clinician!.id, gp.id);
    assert.equal(result.obgyn_clinician!.id, obgyn.id);
    assert.notEqual(result.gp_clinician!.id, result.obgyn_clinician!.id);

    const reloadedGp = await prisma.clinicianProfile.findUniqueOrThrow({
      where: { id: gp.id },
    });
    assert.equal(reloadedGp.familyLoad, 1);
  });

  it("refuses a non-admin assigning doctors", async () => {
    const { user } = await makePatient();
    const family = await families.createFamily(
      { sub: user.id, role: "patient" },
      { name: "Blocked Family" },
      meta,
    );
    familyIds.push(family.id);
    const gp = await makeClinician();

    await assert.rejects(
      () =>
        families.assignFamilyDoctors(
          family.id,
          { sub: user.id, role: "patient" },
          { gp_clinician_id: gp.id },
          meta,
        ),
      (e: AppError) => e.code === "ROLE_NOT_PERMITTED",
    );
  });

  it("refuses assigning a clinician at family-load capacity", async () => {
    const { user } = await makePatient();
    const family = await families.createFamily(
      { sub: user.id, role: "patient" },
      { name: "Full Panel Family" },
      meta,
    );
    familyIds.push(family.id);
    const gp = await makeClinician(1);

    const other = await makePatient();
    const otherFamily = await families.createFamily(
      { sub: other.user.id, role: "patient" },
      { name: "Other Family" },
      meta,
    );
    familyIds.push(otherFamily.id);
    await families.assignFamilyDoctors(
      otherFamily.id,
      makeAdmin(),
      { gp_clinician_id: gp.id },
      meta,
    );

    await assert.rejects(
      () =>
        families.assignFamilyDoctors(
          family.id,
          makeAdmin(),
          { gp_clinician_id: gp.id },
          meta,
        ),
      (e: AppError) => e.code === "CLINICIAN_UNAVAILABLE",
    );
  });

  it("releases the previous clinician\u2019s load on reassignment", async () => {
    const { user } = await makePatient();
    const family = await families.createFamily(
      { sub: user.id, role: "patient" },
      { name: "Reassign Family" },
      meta,
    );
    familyIds.push(family.id);
    const firstGp = await makeClinician();
    const secondGp = await makeClinician();

    await families.assignFamilyDoctors(
      family.id,
      makeAdmin(),
      { gp_clinician_id: firstGp.id },
      meta,
    );
    await families.assignFamilyDoctors(
      family.id,
      makeAdmin(),
      { gp_clinician_id: secondGp.id },
      meta,
    );

    const reloadedFirst = await prisma.clinicianProfile.findUniqueOrThrow({
      where: { id: firstGp.id },
    });
    const reloadedSecond = await prisma.clinicianProfile.findUniqueOrThrow({
      where: { id: secondGp.id },
    });
    assert.equal(reloadedFirst.familyLoad, 0);
    assert.equal(reloadedSecond.familyLoad, 1);
  });
});

async function ownedFamily(name: string) {
  const { user, profile } = await makePatient();
  const caller = { sub: user.id, role: "patient" };
  const f = await families.createFamily(caller, { name }, meta);
  familyIds.push(f.id);
  return { caller, profile, f };
}
async function publish(tier: "family_basic" | "family_plus" = "family_basic") {
  const { data } = await families.listPlans(makeAdmin());
  const p = data.find((x) => x.tier === tier)!;
  return families.updatePlan(
    tier,
    makeAdmin(),
    {
      base_version: p.version,
      name: p.name,
      description: "Synthetic approved package terms",
      benefits: ["Synthetic coordination service"],
      exclusions: ["No medicines or hospital charges included"],
      price_minor: 1250000,
      currency: "TZS",
      billing_period: "monthly",
      accepting_requests: true,
    },
    meta,
  );
}
it("blocks arbitrary adult links, paid-tier self-assignment and duplicate family creation", async () => {
  const { caller, f } = await ownedFamily("Privacy family");
  const other = await makePatient();
  await assert.rejects(
    () =>
      families.addFamilyMember(
        f.id,
        caller,
        { patient_profile_id: other.profile.id, relationship: "spouse" },
        meta,
      ),
    (e: AppError) => e.code === "NOT_RESOURCE_OWNER",
  );
  await assert.rejects(
    () => families.createFamily(caller, { name: "Second" }, meta),
    (e: AppError) => e.code === "DUPLICATE_RESOURCE",
  );
  const fresh = await makePatient();
  await assert.rejects(
    () =>
      families.createFamily(
        { sub: fresh.user.id, role: "patient" },
        { name: "Unpaid", subscription_tier: "family_plus" },
        meta,
      ),
    (e: AppError) => e.code === "ROLE_NOT_PERMITTED",
  );
});
it("limits clinician directories to assigned verified panels and checks assignment revisions", async () => {
  const a = await ownedFamily("Assigned panel A"),
    b = await ownedFamily("Assigned panel B");
  const gp = await makeClinician();
  await families.assignFamilyDoctors(
    a.f.id,
    makeAdmin(),
    { gp_clinician_id: gp.id, base_version: 1 },
    meta,
  );
  const caller = { sub: gp.userId, role: "clinician" };
  const panel = await families.listFamilies(caller, { limit: 25 });
  assert.deepEqual(
    panel.data.map((x) => x.id),
    [a.f.id],
  );
  await assert.rejects(
    () => families.getFamily(b.f.id, caller),
    (e: AppError) => e.code === "NOT_FOUND",
  );
  await assert.rejects(
    () =>
      families.assignFamilyDoctors(
        a.f.id,
        makeAdmin(),
        { gp_clinician_id: null, base_version: 1 },
        meta,
      ),
    (e: AppError) => e.code === "VERSION_CONFLICT",
  );
  await families.assignFamilyDoctors(
    a.f.id,
    makeAdmin(),
    { gp_clinician_id: null, base_version: 2 },
    meta,
  );
  assert.equal(
    (await prisma.clinicianProfile.findUniqueOrThrow({ where: { id: gp.id } }))
      .familyLoad,
    0,
  );
});
it("serializes competing family assignments at a one-family clinician capacity", async () => {
  const a = await ownedFamily("Race panel A"),
    b = await ownedFamily("Race panel B");
  const gp = await makeClinician(1);
  const result = await Promise.allSettled(
    [a, b].map((x) =>
      families.assignFamilyDoctors(
        x.f.id,
        makeAdmin(),
        { gp_clinician_id: gp.id, base_version: 1 },
        meta,
      ),
    ),
  );
  assert.equal(result.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (await prisma.clinicianProfile.findUniqueOrThrow({ where: { id: gp.id } }))
      .familyLoad,
    1,
  );
});
it("deduplicates concurrent enrollment retries and requires current package terms before approval", async () => {
  const { caller, f } = await ownedFamily("Enrollment family");
  const plan = await publish();
  const input = {
    tier: "family_basic" as const,
    plan_version: plan.version,
    client_request_id: randomUUID(),
    terms_confirmed: true as const,
  };
  const [a, b] = await Promise.all([
    families.requestPackage(f.id, caller, input, meta),
    families.requestPackage(f.id, caller, input, meta),
  ]);
  assert.equal(a.id, b.id);
  await assert.rejects(
    () =>
      families.requestPackage(
        f.id,
        caller,
        { ...input, tier: "family_plus" },
        meta,
      ),
    (e: AppError) => e.code === "IDEMPOTENCY_KEY_CONFLICT",
  );
  await publish();
  await assert.rejects(
    () =>
      families.reviewPackage(
        a.id,
        makeAdmin(),
        {
          base_version: 1,
          action: "approve",
          note: "Approved synthetic eligibility",
        },
        meta,
      ),
    (e: AppError) => e.code === "VERSION_CONFLICT",
  );
  const declined = await families.reviewPackage(
    a.id,
    makeAdmin(),
    {
      base_version: 1,
      action: "decline",
      note: "Terms changed; request again",
    },
    meta,
  );
  assert.equal(declined.status, "declined");
  assert.equal((await families.getMyFamily(caller)).subscription_tier, "none");
  const current = await publish();
  const next = await families.requestPackage(
    f.id,
    caller,
    {
      ...input,
      plan_version: current.version,
      client_request_id: randomUUID(),
    },
    meta,
  );
  const approved = await families.reviewPackage(
    next.id,
    makeAdmin(),
    {
      base_version: 1,
      action: "approve",
      note: "Eligibility confirmed; billing separate",
    },
    meta,
  );
  assert.equal(approved.status, "approved");
  assert.equal(
    (await families.getMyFamily(caller)).subscription_tier,
    "family_basic",
  );
  await assert.rejects(
    () =>
      families.reviewPackage(
        next.id,
        makeAdmin(),
        { base_version: 1, action: "approve", note: "Second approval attempt" },
        meta,
      ),
    (e: AppError) => e.code === "VERSION_CONFLICT",
  );
});
it("checks ownership, role and active account state on package and request reads", async () => {
  const a = await ownedFamily("Request privacy A"),
    b = await ownedFamily("Request privacy B");
  const plan = await publish();
  await assert.rejects(
    () =>
      families.requestPackage(
        a.f.id,
        b.caller,
        {
          tier: "family_basic",
          plan_version: plan.version,
          client_request_id: randomUUID(),
          terms_confirmed: true,
        },
        meta,
      ),
    (e: AppError) => e.code === "NOT_FOUND",
  );
  await assert.rejects(
    () =>
      families.listPackageRequests(
        b.caller,
        { status: "all", limit: 25 },
        a.f.id,
      ),
    (e: AppError) => e.code === "NOT_FOUND",
  );
  await assert.rejects(
    () => families.listPackageRequests(b.caller, { status: "all", limit: 25 }),
    (e: AppError) => e.code === "ROLE_NOT_PERMITTED",
  );
  await prisma.user.update({
    where: { id: b.caller.sub },
    data: { status: "suspended" },
  });
  await assert.rejects(
    () => families.listPlans(b.caller),
    (e: AppError) => e.code === "ROLE_NOT_PERMITTED",
  );
});
it("rolls package approval back when its mandatory audit fails", async () => {
  const { caller, f } = await ownedFamily("Audit rollback family");
  const p = await publish();
  const r = await families.requestPackage(
    f.id,
    caller,
    {
      tier: "family_basic",
      plan_version: p.version,
      client_request_id: randomUUID(),
      terms_confirmed: true,
    },
    meta,
  );
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION family_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'family.package_reviewed' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER family_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION family_test_audit_failure()`,
  );
  try {
    await assert.rejects(() =>
      families.reviewPackage(
        r.id,
        makeAdmin(),
        {
          base_version: 1,
          action: "approve",
          note: "Synthetic approval audit check",
        },
        meta,
      ),
    );
    assert.equal(
      (await families.getMyFamily(caller)).subscription_tier,
      "none",
    );
    assert.equal(
      (
        await prisma.familySubscriptionRequest.findUniqueOrThrow({
          where: { id: r.id },
        })
      ).status,
      "pending",
    );
  } finally {
    await prisma.$executeRawUnsafe(
      "DROP TRIGGER family_test_audit_failure ON audit_logs",
    );
    await prisma.$executeRawUnsafe("DROP FUNCTION family_test_audit_failure()");
  }
});
