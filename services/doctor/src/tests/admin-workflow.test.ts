import { before, after, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@a-health/database";
import {
  assertIsolatedLocalTestTarget,
  verifyLocalTestIdentity,
} from "@a-health/database/test-safety";
import {
  decideVerification,
  listClinicians,
} from "../services/clinician.service.js";
const target = assertIsolatedLocalTestTarget();
before(() => verifyLocalTestIdentity(prisma, target));
after(() => prisma.$disconnect());
it("searches review applications and permits exactly one decision for the displayed version", async () => {
  const admin = await prisma.user.create({
    data: {
      phoneNumber: "+255700000092",
      role: "platform_admin",
      status: "active",
      fullName: "Synthetic admin",
    },
  });
  const user = await prisma.user.create({
    data: {
      phoneNumber: "+255700000093",
      role: "clinician",
      status: "pending_verification",
      fullName: "Synthetic searchable physician",
    },
  });
  const profile = await prisma.clinicianProfile.create({
    data: {
      userId: user.id,
      licenseNumber: "PRIVATE-LICENSE-927",
      specialty: "general_practice",
    },
  });
  assert.equal(
    (
      await listClinicians(
        { q: "searchable", limit: 25 },
        { role: "platform_admin" },
      )
    ).data.length,
    1,
  );
  assert.equal(
    (
      await listClinicians(
        { q: "LICENSE-927", limit: 25 },
        { role: "platform_admin" },
      )
    ).data.length,
    1,
  );
  assert.equal((await listClinicians({verification_status:'pending',limit:25},{role:'patient'})).data.length,0);
  const application = (await listClinicians({q:'searchable',limit:25},{role:'platform_admin'})).data[0];
  assert.equal(application.version,1); assert.equal(application.account_status,'pending_verification'); assert.ok(application.updated_at);
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      decideVerification(profile.id, admin.id, "approve", undefined, {}, 1),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const current = await prisma.clinicianProfile.findUniqueOrThrow({
    where: { id: profile.id },
  });
  assert.equal(current.version, 2);
  assert.equal(current.verificationStatus, "verified");
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status,
    "active",
  );
  await assert.rejects(
    () =>
      decideVerification(
        profile.id,
        admin.id,
        "reject",
        "Stale decision",
        {},
        1,
      ),
    { code: "VERSION_CONFLICT" },
  );
  assert.equal(
    (await listClinicians({ q: "LICENSE-927", limit: 25 }, { role: "patient" }))
      .data.length,
    0,
  );
  assert.equal(
    await prisma.auditLog.count({
      where: { entityId: profile.id, action: "clinician.verified" },
    }),
    1,
  );
});

it('never returns administrative review metadata in the public directory',async()=>{
 const directory=await listClinicians({limit:25},{role:'patient'});
 for(const row of directory.data)for(const field of ['version','account_status','email','rejection_reason','updated_at','license_number'])assert.ok(!(field in row));
});
