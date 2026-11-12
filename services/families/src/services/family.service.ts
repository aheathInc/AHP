import { prisma, type Prisma } from "@a-health/database";
import {
  appendAudit,
  conflict,
  forbidden,
  notFound,
  cursorArgs,
  toCursorPage,
} from "@a-health/http";
import type { z } from "zod";
import type {
  planSchema,
  requestPlanSchema,
  reviewPlanSchema,
} from "../types/families.types.js";
export interface Caller {
  sub: string;
  role: string;
  ppid?: string;
}
export interface Meta {
  ip?: string | null;
  requestId?: string | null;
}
type Tx = Prisma.TransactionClient;
async function actor(tx: Tx, c: Caller, roles: string[]) {
  const u = await tx.user.findUnique({
    where: { id: c.sub },
    select: { role: true, status: true },
  });
  if (
    !u ||
    u.status !== "active" ||
    u.role !== c.role ||
    !roles.includes(u.role)
  )
    throw forbidden(
      "ROLE_NOT_PERMITTED",
      "Current active account access is required",
    );
  return u;
}
const audit = (
  tx: Tx,
  c: Caller,
  m: Meta,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata?: Record<string, unknown>,
) =>
  appendAudit(
    {
      actorUserId: c.sub,
      action,
      entityType,
      entityId,
      metadata,
      ipAddress: m.ip,
      requestId: m.requestId,
    },
    tx,
  );
const include = {
  members: {
    include: { patient: { select: { fullName: true } } },
    orderBy: { createdAt: "asc" as const },
  },
  assignments: {
    include: {
      gp: { include: { user: { select: { fullName: true, status: true } } } },
      obgyn: {
        include: { user: { select: { fullName: true, status: true } } },
      },
    },
  },
} satisfies Prisma.FamilyInclude;
type FullFamily = Prisma.FamilyGetPayload<{ include: typeof include }>;
function summary(f: {
  id: string;
  name: string;
  subscriptionTier: string;
  version: number;
  createdAt: Date;
}) {
  return {
    id: f.id,
    name: f.name,
    subscription_tier: f.subscriptionTier,
    created_at: f.createdAt.toISOString(),
    version: f.version,
  };
}
function serialise(f: FullFamily, c: Caller) {
  const a = f.assignments[0];
  const clinician = (p: typeof a.gp | undefined) =>
    p
      ? {
          id: p.id,
          full_name: p.user.fullName,
          available:
            p.verificationStatus === "verified" && p.user.status === "active",
        }
      : null;
  return {
    ...summary(f),
    is_head: f.headUserId === c.sub,
    members: f.members.map((m) => ({
      id: m.id,
      patient_profile_id: m.patientProfileId,
      full_name: m.patient.fullName,
      relationship: m.relationship,
    })),
    gp_clinician: clinician(a?.gp),
    obgyn_clinician: clinician(a?.obgyn),
  };
}
async function scope(tx: Tx, c: Caller): Promise<Prisma.FamilyWhereInput> {
  await actor(tx, c, ["patient", "clinician", "platform_admin"]);
  if (c.role === "platform_admin") return {};
  if (c.role === "clinician") {
    const p = await tx.clinicianProfile.findUnique({
      where: { userId: c.sub },
    });
    if (!p || p.verificationStatus !== "verified")
      throw forbidden(
        "CLINICIAN_NOT_VERIFIED",
        "Verified clinician access required",
      );
    return {
      assignments: {
        some: { OR: [{ gpClinicianId: p.id }, { obgynClinicianId: p.id }] },
      },
    };
  }
  return {
    OR: [
      { headUserId: c.sub },
      {
        members: {
          some: {
            patient: { OR: [{ userId: c.sub }, { guardianUserId: c.sub }] },
          },
        },
      },
    ],
  };
}
async function familyAccess(tx: Tx, id: string, c: Caller) {
  const where = await scope(tx, c);
  const f = await tx.family.findFirst({
    where: { AND: [{ id }, where] },
    include,
  });
  if (!f) throw notFound("Family not found or access unavailable");
  return f;
}
async function lockFamily(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM families WHERE id=${id}::uuid FOR UPDATE`;
}
export async function createFamily(
  c: Caller,
  input: { name: string; subscription_tier?: string },
  m: Meta,
) {
  return prisma.$transaction(async (tx) => {
    await actor(tx, c, ["patient"]);
    if (input.subscription_tier && input.subscription_tier !== "none")
      throw forbidden(
        "ROLE_NOT_PERMITTED",
        "Request a package separately for review",
      );
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.sub}))`;
    if (await tx.family.findFirst({ where: { headUserId: c.sub } }))
      throw conflict(
        "DUPLICATE_RESOURCE",
        "A family already exists for this account",
      );
    const f = await tx.family.create({
      data: {
        name: input.name.trim(),
        headUserId: c.sub,
        subscriptionTier: "none",
      },
    });
    await audit(tx, c, m, "family.created", "families", f.id);
    return summary(f);
  });
}
export async function getMyFamily(c: Caller) {
  return prisma.$transaction(async (tx) => {
    const where = await scope(tx, c);
    const f = await tx.family.findFirst({
      where,
      include,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!f) throw notFound("You do not belong to a family");
    return serialise(f, c);
  });
}
export async function listFamilies(
  c: Caller,
  q: { q?: string; cursor?: string; limit: number },
) {
  return prisma.$transaction(async (tx) => {
    const where = await scope(tx, c);
    const rows = await tx.family.findMany({
      where: {
        AND: [
          where,
          ...(q.q
            ? [{ name: { contains: q.q, mode: "insensitive" as const } }]
            : []),
        ],
      },
      include,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...cursorArgs(q.cursor, q.limit),
    });
    const data = rows.map((f) => serialise(f, c));
    return { ...toCursorPage(rows, q.limit), data: data.slice(0, q.limit) };
  });
}
export async function getFamily(id: string, c: Caller) {
  return prisma.$transaction(async (tx) =>
    serialise(await familyAccess(tx, id, c), c),
  );
}
export async function addFamilyMember(
  id: string,
  c: Caller,
  input: { patient_profile_id: string; relationship: string },
  m: Meta,
) {
  return prisma.$transaction(async (tx) => {
    await actor(tx, c, ["patient", "platform_admin"]);
    await lockFamily(tx, id);
    const f = await tx.family.findUnique({ where: { id } });
    if (!f) throw notFound("Family not found");
    if (f.headUserId !== c.sub && c.role !== "platform_admin")
      throw forbidden(
        "NOT_RESOURCE_OWNER",
        "Only the family head may manage members",
      );
    const patient = await tx.patientProfile.findUnique({
      where: { id: input.patient_profile_id },
    });
    if (!patient) throw notFound("Patient profile not found");
    if (
      c.role !== "platform_admin" &&
      patient.userId !== c.sub &&
      patient.guardianUserId !== c.sub
    )
      throw forbidden(
        "NOT_RESOURCE_OWNER",
        "Only your own or legally guarded profiles can be linked here",
      );
    if (
      await tx.familyMember.findFirst({
        where: { familyId: id, patientProfileId: patient.id },
      })
    )
      throw conflict(
        "DUPLICATE_RESOURCE",
        "Patient already belongs to this family",
      );
    const member = await tx.familyMember.create({
      data: {
        familyId: id,
        patientProfileId: patient.id,
        relationship: input.relationship as never,
      },
    });
    await tx.family.update({
      where: { id },
      data: { version: { increment: 1 } },
    });
    await audit(tx, c, m, "family.member_added", "family_members", member.id, {
      familyId: id,
      patientProfileId: patient.id,
    });
    return {
      id: member.id,
      family_id: id,
      patient_profile_id: patient.id,
      full_name: patient.fullName,
      relationship: member.relationship,
    };
  });
}
export async function removeFamilyMember(
  id: string,
  memberId: string,
  c: Caller,
  version: number,
  m: Meta,
) {
  return prisma.$transaction(async (tx) => {
    await actor(tx, c, ["patient", "platform_admin"]);
    await lockFamily(tx, id);
    const f = await tx.family.findUnique({ where: { id } });
    if (!f) throw notFound("Family not found");
    if (f.headUserId !== c.sub && c.role !== "platform_admin")
      throw forbidden(
        "NOT_RESOURCE_OWNER",
        "Only the family head may manage members",
      );
    if (f.version !== version)
      throw conflict(
        "VERSION_CONFLICT",
        "Refresh the family before changing membership",
      );
    const member = await tx.familyMember.findFirst({
      where: { id: memberId, familyId: id },
    });
    if (!member) throw notFound("Member not found");
    await tx.familyMember.delete({ where: { id: memberId } });
    await tx.family.update({
      where: { id },
      data: { version: { increment: 1 } },
    });
    await audit(tx, c, m, "family.member_removed", "family_members", memberId, {
      familyId: id,
    });
    return { removed: true };
  });
}
export async function assignFamilyDoctors(
  id: string,
  c: Caller,
  input: {
    gp_clinician_id?: string | null;
    obgyn_clinician_id?: string | null;
    base_version?: number;
  },
  m: Meta,
) {
  return prisma.$transaction(async (tx) => {
    await actor(tx, c, ["platform_admin"]);
    await lockFamily(tx, id);
    const f = await tx.family.findUnique({ where: { id } });
    if (!f) throw notFound("Family not found");
    if (input.base_version !== undefined && f.version !== input.base_version)
      throw conflict(
        "VERSION_CONFLICT",
        "Refresh before assigning the care team",
      );
    const old = await tx.familyAssignment.findUnique({
      where: { familyId: id },
    });
    const gp =
      input.gp_clinician_id === undefined
        ? (old?.gpClinicianId ?? null)
        : input.gp_clinician_id;
    const ob =
      input.obgyn_clinician_id === undefined
        ? (old?.obgynClinicianId ?? null)
        : input.obgyn_clinician_id;
    if (gp && gp === ob)
      throw conflict(
        "CLINICIAN_ASSIGNMENT_INVALID",
        "GP and OB/GYN require separate clinician assignments",
      );
    const ids = [
      ...new Set(
        [gp, ob, old?.gpClinicianId, old?.obgynClinicianId].filter(
          (x): x is string => !!x,
        ),
      ),
    ].sort();
    for (const cid of ids)
      await tx.$queryRaw`SELECT id FROM clinician_profiles WHERE id=${cid}::uuid FOR UPDATE`;
    for (const [next, previous, label] of [
      [gp, old?.gpClinicianId, "GP"],
      [ob, old?.obgynClinicianId, "OB/GYN"],
    ] as const) {
      if (next === previous) continue;
      if (next) {
        const p = await tx.clinicianProfile.findUnique({
          where: { id: next },
          include: { user: { select: { status: true, role: true } } },
        });
        if (!p) throw notFound(`${label} clinician not found`);
        if (
          p.verificationStatus !== "verified" ||
          p.user.status !== "active" ||
          p.user.role !== "clinician"
        )
          throw forbidden(
            "CLINICIAN_NOT_VERIFIED",
            "Choose an active verified clinician",
          );
        if (
          (label === "GP" && p.specialty !== "general_practice") ||
          (label === "OB/GYN" && p.specialty !== "obstetrics_gynaecology")
        )
          throw conflict(
            "CLINICIAN_ASSIGNMENT_INVALID",
            `Choose a ${label} clinician with the required specialty`,
          );
        if (p.maxFamilyLoad > 0 && p.familyLoad >= p.maxFamilyLoad)
          throw conflict(
            "CLINICIAN_UNAVAILABLE",
            "Clinician family panel is full",
          );
        await tx.clinicianProfile.update({
          where: { id: next },
          data: { familyLoad: { increment: 1 } },
        });
      }
      if (previous)
        await tx.clinicianProfile.updateMany({
          where: { id: previous, familyLoad: { gt: 0 } },
          data: { familyLoad: { decrement: 1 } },
        });
    }
    await tx.familyAssignment.upsert({
      where: { familyId: id },
      create: { familyId: id, gpClinicianId: gp, obgynClinicianId: ob },
      update: {
        gpClinicianId: gp,
        obgynClinicianId: ob,
        assignedAt: new Date(),
        version: { increment: 1 },
      },
    });
    await tx.family.update({
      where: { id },
      data: { version: { increment: 1 } },
    });
    await audit(tx, c, m, "family.doctors_assigned", "families", id, {
      gpClinicianId: gp,
      obgynClinicianId: ob,
    });
    return serialise(
      await tx.family.findUniqueOrThrow({ where: { id }, include }),
      c,
    );
  });
}
function planDto(p: Prisma.FamilyPlanGetPayload<object>) {
  return {
    tier: p.tier,
    name: p.name,
    description: p.description,
    benefits: p.benefits,
    exclusions: p.exclusions,
    price_minor: p.priceMinor,
    currency: p.currency,
    billing_period: p.billingPeriod,
    accepting_requests: p.acceptingRequests,
    version: p.version,
    updated_at: p.updatedAt.toISOString(),
    billing_notice:
      "Package allocation is administrative. This workflow does not collect money or confirm payment.",
  };
}
export async function listPlans(c: Caller) {
  return prisma.$transaction(async (tx) => {
    await actor(tx, c, ["patient", "clinician", "platform_admin"]);
    return {
      data: (await tx.familyPlan.findMany({ orderBy: { tier: "asc" } })).map(
        planDto,
      ),
    };
  });
}
export async function updatePlan(
  tier: string,
  c: Caller,
  input: z.infer<typeof planSchema>,
  m: Meta,
) {
  return prisma.$transaction(async (tx) => {
    await actor(tx, c, ["platform_admin"]);
    const p = await tx.familyPlan.updateMany({
      where: { tier: tier as never, version: input.base_version },
      data: {
        name: input.name,
        description: input.description,
        benefits: input.benefits,
        exclusions: input.exclusions,
        priceMinor: input.price_minor,
        currency: input.currency,
        billingPeriod: input.billing_period,
        acceptingRequests: input.accepting_requests,
        version: { increment: 1 },
      },
    });
    if (!p.count)
      throw conflict(
        "VERSION_CONFLICT",
        "Package changed; refresh before saving",
      );
    await audit(tx, c, m, "family.package_updated", "family_plans", null, {
      tier,
    });
    return planDto(
      await tx.familyPlan.findUniqueOrThrow({ where: { tier: tier as never } }),
    );
  });
}
function requestDto(r: Prisma.FamilySubscriptionRequestGetPayload<object>) {
  return {
    id: r.id,
    family_id: r.familyId,
    tier: r.tier,
    plan_version: r.planVersion,
    terms: r.planSnapshot,
    status: r.status,
    version: r.version,
    created_at: r.createdAt.toISOString(),
    reviewed_at: r.reviewedAt?.toISOString() ?? null,
    review_note: r.reviewNote,
  };
}
export async function requestPackage(
  id: string,
  c: Caller,
  input: z.infer<typeof requestPlanSchema>,
  m: Meta,
) {
  return prisma.$transaction(async (tx) => {
    await actor(tx, c, ["patient"]);
    await lockFamily(tx, id);
    const f = await familyAccess(tx, id, c);
    if (f.headUserId !== c.sub)
      throw forbidden(
        "NOT_RESOURCE_OWNER",
        "Only the family head may request packages",
      );
    const existing = await tx.familySubscriptionRequest.findUnique({
      where: {
        requestedByUserId_clientRequestId: {
          requestedByUserId: c.sub,
          clientRequestId: input.client_request_id,
        },
      },
    });
    if (existing) {
      if (
        existing.familyId !== id ||
        existing.tier !== input.tier ||
        existing.planVersion !== input.plan_version
      )
        throw conflict(
          "IDEMPOTENCY_KEY_CONFLICT",
          "Retry reference belongs to another request",
        );
      return requestDto(existing);
    }
    await tx.$queryRaw`SELECT tier FROM family_plans WHERE tier::text=${input.tier} FOR SHARE`;
    const p = await tx.familyPlan.findUnique({ where: { tier: input.tier } });
    if (!p || p.version !== input.plan_version)
      throw conflict(
        "VERSION_CONFLICT",
        "Package terms changed; review them again",
      );
    if (!p.acceptingRequests)
      throw conflict(
        "STATE_TRANSITION_INVALID",
        "This package is not accepting requests",
      );
    if (f.subscriptionTier === input.tier)
      throw conflict(
        "STATE_TRANSITION_INVALID",
        "This package is already assigned",
      );
    if (
      await tx.familySubscriptionRequest.findFirst({
        where: { familyId: id, status: "pending" },
      })
    )
      throw conflict(
        "STATE_TRANSITION_INVALID",
        "A package request is already pending",
      );
    const r = await tx.familySubscriptionRequest.create({
      data: {
        familyId: id,
        tier: input.tier,
        planVersion: p.version,
        planSnapshot: planDto(p),
        familyVersion: f.version,
        requestedByUserId: c.sub,
        clientRequestId: input.client_request_id,
      },
    });
    await audit(
      tx,
      c,
      m,
      "family.package_requested",
      "family_subscription_requests",
      r.id,
      { familyId: id, tier: input.tier },
    );
    return requestDto(r);
  });
}
export async function listPackageRequests(
  c: Caller,
  q: { status: string; cursor?: string; limit: number },
  familyId?: string,
) {
  return prisma.$transaction(async (tx) => {
    if (familyId) await familyAccess(tx, familyId, c);
    else await actor(tx, c, ["platform_admin"]);
    const rows = await tx.familySubscriptionRequest.findMany({
      where: {
        ...(familyId ? { familyId } : {}),
        ...(q.status === "all"
          ? {}
          : {
              status: q.status === "reviewed" ? { not: "pending" } : "pending",
            }),
      },
      include: { family: { select: { name: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...cursorArgs(q.cursor, q.limit),
    });
    return {
      ...toCursorPage(rows, q.limit),
      data: rows
        .slice(0, q.limit)
        .map((r) => ({ ...requestDto(r), family_name: r.family.name })),
    };
  });
}
export async function reviewPackage(
  id: string,
  c: Caller,
  input: z.infer<typeof reviewPlanSchema>,
  m: Meta,
) {
  return prisma.$transaction(async (tx) => {
    await actor(tx, c, ["platform_admin"]);
    const initial = await tx.familySubscriptionRequest.findUnique({
      where: { id },
    });
    if (!initial) throw notFound("Request not found");
    await lockFamily(tx, initial.familyId);
    const r = await tx.familySubscriptionRequest.findUniqueOrThrow({
      where: { id },
    });
    if (r.status !== "pending" || r.version !== input.base_version)
      throw conflict("VERSION_CONFLICT", "Request has already changed");
    if (input.action === "approve") {
      const f = await tx.family.findUniqueOrThrow({
        where: { id: r.familyId },
      });
      await tx.$queryRaw`SELECT tier FROM family_plans WHERE tier::text=${r.tier} FOR SHARE`;
      const p = await tx.familyPlan.findUniqueOrThrow({
        where: { tier: r.tier },
      });
      if (
        p.version !== r.planVersion ||
        !p.acceptingRequests ||
        f.version !== r.familyVersion
      )
        throw conflict(
          "VERSION_CONFLICT",
          "Package or family changed; decline this request and ask for a fresh review",
        );
      await tx.family.update({
        where: { id: f.id },
        data: { subscriptionTier: r.tier, version: { increment: 1 } },
      });
    }
    const saved = await tx.familySubscriptionRequest.update({
      where: { id },
      data: {
        status: input.action === "approve" ? "approved" : "declined",
        reviewedByUserId: c.sub,
        reviewedAt: new Date(),
        reviewNote: input.note,
        version: { increment: 1 },
      },
    });
    await audit(
      tx,
      c,
      m,
      "family.package_reviewed",
      "family_subscription_requests",
      id,
      { decision: saved.status, familyId: r.familyId },
    );
    return requestDto(saved);
  });
}
export async function listFamilyClinicians(
  c: Caller,
  q: { q?: string; cursor?: string; limit: number },
) {
  return prisma.$transaction(async (tx) => {
    await actor(tx, c, ["platform_admin"]);
    const rows = await tx.clinicianProfile.findMany({
      where: {
        verificationStatus: "verified",
        specialty: { in: ["general_practice", "obstetrics_gynaecology"] },
        user: {
          status: "active",
          role: "clinician",
          ...(q.q
            ? { fullName: { contains: q.q, mode: "insensitive" as const } }
            : {}),
        },
      },
      include: { user: { select: { fullName: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...cursorArgs(q.cursor, q.limit),
    });
    return {
      ...toCursorPage(rows, q.limit),
      data: rows.slice(0, q.limit).map((p) => ({
        id: p.id,
        full_name: p.user.fullName,
        specialty: p.specialty,
        family_load: p.familyLoad,
        max_family_load: p.maxFamilyLoad,
      })),
    };
  });
}
