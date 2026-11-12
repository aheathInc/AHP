import { prisma } from "@a-health/database";
import {
  appendAudit,
  conflict,
  cursorArgs,
  forbidden,
  notFound,
  toCursorPage,
  unprocessable,
} from "@a-health/http";
import { computeFlag, isCriticalFlag } from "../engine/resultFlag.js";
import type {
  CreateOrderInput,
  FileResultInput,
} from "../types/diagnostics.types.js";
import { laboratoryScope } from "./laboratory.service.js";

export interface Caller {
  sub: string;
  role: string;
  ppid?: string;
  cpid?: string;
}
export interface Meta {
  ip?: string | null;
  requestId?: string | null;
}

function serialiseOrder(
  o: {
    id: string;
    careThreadId: string;
    consultationId: string | null;
    patientProfileId: string;
    orderedById: string;
    facilityId: string | null;
    investigationCode: string;
    investigationType: string;
    urgency: string;
    status: string;
    clinicalNotes: string | null;
    narrative: string | null;
    attachmentKey: string | null;
    isCritical: boolean;
    acknowledgedById: string | null;
    acknowledgedAt: Date | null;
    orderedAt: Date;
    resultedAt: Date | null;
    version: number;
    specimenReference?: string | null;
    specimenType?: string | null;
    collectedAt?: Date | null;
    receivedAt?: Date | null;
    receivedById?: string | null;
    reportPreparedAt?: Date | null;
    enteredById?: string | null;
    releasedById?: string | null;
    releasedByName?: string | null;
    orderedBy?: { user: { fullName: string | null } };
    values?: {
      criticalLow?: number | null;
      criticalHigh?: number | null;
      analyte: string;
      value: string;
      unit: string | null;
      referenceLow: unknown;
      referenceHigh: unknown;
      flag: string;
    }[];
    patient?: { fullName: string };
    facility?: { name: string } | null;
  },
  caller: Caller,
) {
  const final = ["resulted", "acknowledged"].includes(o.status);
  const visible = final || !["patient", "guardian"].includes(caller.role);
  return {
    id: o.id,
    report_state: final
      ? o.status === "acknowledged"
        ? "acknowledged"
        : "final"
      : o.reportPreparedAt
        ? "preliminary"
        : "pending",
    specimen_reference: o.specimenReference ?? null,
    specimen_type: o.specimenType ?? null,
    collected_at: o.collectedAt?.toISOString() ?? null,
    received_at: o.receivedAt?.toISOString() ?? null,
    received_by_id: o.receivedById ?? null,
    report_prepared_at: o.reportPreparedAt?.toISOString() ?? null,
    entered_by_id: o.enteredById ?? null,
    released_by_id: o.releasedById ?? null,
    released_by_name: o.releasedByName ?? null,
    ordering_clinician: o.orderedBy?.user.fullName ?? null,
    care_thread_id: o.careThreadId,
    consultation_id: o.consultationId,
    patient_profile_id: o.patientProfileId,
    patient_name: o.patient?.fullName,
    facility_name: o.facility?.name ?? null,
    ordered_by_id: o.orderedById,
    facility_id: o.facilityId,
    investigation_code: o.investigationCode,
    investigation_type: o.investigationType,
    urgency: o.urgency,
    status: o.status,
    ...(caller.role === "patient" || caller.role === "guardian"
      ? {}
      : { clinical_notes: o.clinicalNotes }),
    values: (visible ? (o.values ?? []) : []).map((v) => ({
      analyte: v.analyte,
      value: v.value,
      unit: v.unit,
      reference_low: v.referenceLow === null ? null : Number(v.referenceLow),
      reference_high: v.referenceHigh === null ? null : Number(v.referenceHigh),
      critical_low: v.criticalLow ?? null,
      critical_high: v.criticalHigh ?? null,
      flag:
        !Number.isFinite(Number(v.value)) ||
        [v.referenceLow, v.referenceHigh, v.criticalLow, v.criticalHigh].every(
          (bound) => bound == null,
        )
          ? "not_assessed"
          : v.flag,
    })),
    narrative: visible ? o.narrative : null,
    attachment_key: visible ? o.attachmentKey : null,
    is_critical: visible && o.isCritical,
    acknowledged_by_id: o.acknowledgedById,
    acknowledged_at: o.acknowledgedAt?.toISOString() ?? null,
    ordered_at: o.orderedAt.toISOString(),
    resulted_at: o.resultedAt?.toISOString() ?? null,
    version: o.version,
  };
}

async function assertClinician(caller: Caller) {
  if (
    !(await prisma.clinicianProfile.count({
      where: {
        id: caller.cpid,
        userId: caller.sub,
        verificationStatus: "verified",
        user: { status: "active", role: "clinician" },
      },
    }))
  )
    throw forbidden(
      "CLINICIAN_NOT_VERIFIED",
      "An active verified clinician account is required",
    );
}

async function assertVisible(
  order: { id: string; patientProfileId: string; orderedById: string },
  caller: Caller,
) {
  if (caller.role === "platform_admin") return;
  if (caller.role === "lab_technician") {
    if (
      await prisma.investigationOrder.count({
        where: { id: order.id, ...laboratoryScope(caller.sub) },
      })
    )
      return;
    throw forbidden(
      "NOT_RESOURCE_OWNER",
      "This order is not assigned to your active laboratory",
    );
  }
  if (
    caller.role === "clinician" &&
    caller.cpid &&
    order.orderedById === caller.cpid
  ) {
    await assertClinician(caller);
    return;
  }
  const patient = await prisma.patientProfile.findUnique({
    where: { id: order.patientProfileId },
  });
  const owns =
    patient &&
    (patient.userId === caller.sub || patient.guardianUserId === caller.sub);
  if (!owns)
    throw forbidden(
      "NOT_RESOURCE_OWNER",
      "This investigation order is not yours",
    );
}

/**
 * Orders an investigation. Clinician only — ordering is a clinical decision,
 * not something a patient or an unrelated party can initiate.
 */
export async function createOrder(
  caller: Caller,
  input: CreateOrderInput,
  meta: Meta,
) {
  if (caller.role !== "clinician" || !caller.cpid)
    throw forbidden(
      "ROLE_NOT_PERMITTED",
      "Clinician profile required to order an investigation",
    );

  const clinician = await prisma.clinicianProfile.findFirst({
    where: {
      id: caller.cpid,
      userId: caller.sub,
      verificationStatus: "verified",
      user: { role: "clinician", status: "active" },
    },
  });
  if (!clinician)
    throw forbidden(
      "CLINICIAN_NOT_VERIFIED",
      "An active verified ordering clinician is required",
    );
  const thread = await prisma.careThread.findUnique({
    where: { id: input.care_thread_id },
  });
  if (!thread) throw notFound("Care thread not found");
  const consultation = input.consultation_id
    ? await prisma.consultationRequest.findUnique({
        where: { id: input.consultation_id },
      })
    : null;
  if (
    input.consultation_id &&
    (!consultation ||
      consultation.careThreadId !== thread.id ||
      consultation.patientProfileId !== thread.patientProfileId ||
      consultation.status === "cancelled")
  )
    throw unprocessable(
      "The consultation must belong to this patient and care thread",
    );
  if (
    thread.primaryClinicianId !== caller.cpid &&
    !(consultation?.assignedClinicianId === caller.cpid) &&
    !(await prisma.consultationRequest.count({
      where: {
        careThreadId: thread.id,
        assignedClinicianId: caller.cpid,
        status: { not: "cancelled" },
      },
    }))
  )
    throw forbidden(
      "NOT_RESOURCE_OWNER",
      "Only a clinician involved in this case may order investigations",
    );

  if (
    input.facility_id &&
    !(await prisma.facility.count({
      where: { id: input.facility_id, isActive: true },
    }))
  ) {
    throw notFound("Active destination facility not found");
  }

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.investigationOrder.create({
      data: {
        careThreadId: input.care_thread_id,
        consultationId: input.consultation_id ?? null,
        patientProfileId: thread.patientProfileId,
        orderedById: clinician.id,
        facilityId: input.facility_id ?? null,
        investigationCode: input.investigation_code,
        investigationType: input.investigation_type as never,
        urgency: (input.urgency ?? "routine") as never,
        clinicalNotes: input.clinical_notes ?? null,
      },
    });

    await appendAudit(
      {
        actorUserId: caller.sub,
        action: "investigation.ordered",
        entityType: "investigation_orders",
        entityId: created.id,
        metadata: {
          investigationCode: input.investigation_code,
          urgency: created.urgency,
        },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return created;
  });

  return serialiseOrder(order, caller);
}

export async function getOrder(orderId: string, caller: Caller) {
  const order = await prisma.investigationOrder.findUnique({
    where: { id: orderId },
    include: {
      orderedBy: { select: { user: { select: { fullName: true } } } },
      values: true,
      patient: { select: { fullName: true } },
      facility: { select: { name: true } },
    },
  });
  if (!order) throw notFound("Investigation order not found");
  await assertVisible(order, caller);
  return serialiseOrder(order, caller);
}

export async function listOrders(
  caller: Caller,
  query: {
    care_thread_id?: string;
    status?: string;
    cursor?: string;
    limit: number;
    q?: string;
    worklist?: string;
  },
) {
  if (caller.role === "clinician") await assertClinician(caller);
  const scope =
    caller.role === "platform_admin"
      ? {}
      : caller.role === "lab_technician"
        ? laboratoryScope(caller.sub)
        : caller.role === "clinician" && caller.cpid
          ? { orderedById: caller.cpid }
          : {
              patient: {
                OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }],
              },
            };

  const rows = await prisma.investigationOrder.findMany({
    where: {
      ...scope,
      ...(query.worklist === "awaiting_sample"
        ? { status: { in: ["ordered", "scheduled"] as never } }
        : query.worklist === "in_lab"
          ? { status: "collected" as const }
          : query.worklist === "review"
            ? { status: "resulted" as const }
            : query.worklist === "critical"
              ? { status: "resulted" as const, isCritical: true }
              : query.worklist === "acknowledged"
                ? { status: "acknowledged" as const }
                : {}),
      ...(query.q
        ? {
            AND: [
              {
                OR: [
                  {
                    investigationCode: {
                      contains: query.q,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    patient: {
                      fullName: {
                        contains: query.q,
                        mode: "insensitive" as const,
                      },
                    },
                  },
                  {
                    specimenReference: {
                      contains: query.q,
                      mode: "insensitive" as const,
                    },
                  },
                  ...(/^[0-9a-f-]{36}$/i.test(query.q)
                    ? [{ id: query.q }]
                    : []),
                ],
              },
            ],
          }
        : {}),
      ...(query.care_thread_id ? { careThreadId: query.care_thread_id } : {}),
      ...(query.status ? { status: query.status as never } : {}),
    },
    include: {
      orderedBy: { select: { user: { select: { fullName: true } } } },
      patient: { select: { fullName: true } },
      facility: { select: { name: true } },
    },
    orderBy: [
      { isCritical: "desc" },
      { urgency: "desc" },
      { orderedAt: "desc" },
      { id: "desc" },
    ],
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, (row) => serialiseOrder(row, caller));
}

/**
 * Files a result. `is_critical` and each value's `flag` are computed here,
 * from the order's own reference/critical bounds — never accepted from the
 * caller. A critical result is what makes this endpoint matter: it is the
 * moment a finding either starts escalating or quietly waits for someone to
 * open the chart, and this function is what decides which.
 */
export async function fileResult(
  orderId: string,
  caller: Caller,
  input: FileResultInput,
  meta: Meta,
) {
  const order = await prisma.investigationOrder.findUnique({
    where: { id: orderId },
  });
  if (!order) throw notFound("Investigation order not found");
  if (caller.role === "lab_technician") {
    await assertVisible(order, caller);
    if (input.base_version === undefined || order.status !== "collected") {
      throw conflict(
        "STATE_TRANSITION_INVALID",
        "Confirm sample receipt and reload the order before submitting results",
      );
    }
  } else if (
    caller.role !== "platform_admin" &&
    (caller.role !== "clinician" ||
      !caller.cpid ||
      order.orderedById !== caller.cpid)
  ) {
    throw forbidden(
      "ROLE_NOT_PERMITTED",
      "Only the ordering clinician may file this result",
    );
  }
  if (caller.role === "clinician") await assertClinician(caller);
  if (order.reportPreparedAt && !input.save_as_draft)
    throw conflict(
      "STATE_TRANSITION_INVALID",
      "A prepared report already exists. Review and release it rather than overwriting results",
    );
  if (input.save_as_draft && caller.role !== "lab_technician")
    throw forbidden(
      "ROLE_NOT_PERMITTED",
      "Only assigned laboratory staff may prepare reports",
    );
  if (order.status === "resulted" || order.status === "acknowledged") {
    throw conflict(
      "STATE_TRANSITION_INVALID",
      "A result has already been filed for this order",
    );
  }
  if (order.status === "cancelled") {
    throw conflict("STATE_TRANSITION_INVALID", "This order was cancelled");
  }

  const flaggedValues = input.values.map((v) => ({
    analyte: v.analyte,
    value: v.value,
    unit: v.unit ?? null,
    referenceLow: v.reference_low ?? null,
    referenceHigh: v.reference_high ?? null,
    criticalLow: v.critical_low ?? null,
    criticalHigh: v.critical_high ?? null,
    flag: computeFlag({
      value: v.value,
      referenceLow: v.reference_low,
      referenceHigh: v.reference_high,
      criticalLow: v.critical_low,
      criticalHigh: v.critical_high,
    }),
  }));

  const isCritical = flaggedValues.some((v) => isCriticalFlag(v.flag as never));

  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.investigationOrder.updateMany({
      where: {
        id: orderId,
        version: input.base_version ?? order.version,
        status: {
          in:
            caller.role === "lab_technician"
              ? ["collected"]
              : ["ordered", "scheduled", "collected"],
        },
        ...(caller.role === "lab_technician"
          ? laboratoryScope(caller.sub)
          : {}),
      },
      data: {
        status: input.save_as_draft ? "collected" : "resulted",
        reportPreparedAt: new Date(),
        enteredById: caller.sub,
        releasedById: input.save_as_draft ? null : caller.sub,
        releasedByName: input.save_as_draft
          ? null
          : ((
              await tx.user.findUnique({
                where: { id: caller.sub },
                select: { fullName: true },
              })
            )?.fullName ?? null),
        narrative: input.narrative ?? null,
        attachmentKey: input.attachment_key ?? null,
        isCritical,
        resultedAt: input.save_as_draft ? null : new Date(),
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1)
      throw conflict(
        "STATE_TRANSITION_INVALID",
        "Order changed or access was revoked. Reload before retrying.",
      );
    if (order.reportPreparedAt) {
      const previousValues = await tx.investigationValue.findMany({
        where: { orderId },
        select: {
          analyte: true,
          value: true,
          unit: true,
          referenceLow: true,
          referenceHigh: true,
          criticalLow: true,
          criticalHigh: true,
          flag: true,
        },
      });
      await tx.investigationReportRevision.create({
        data: {
          orderId,
          version: order.version,
          correctedById: caller.sub,
          snapshot: {
            values: previousValues,
            narrative: order.narrative,
            prepared_at: order.reportPreparedAt.toISOString(),
            entered_by_id: order.enteredById,
          },
        },
      });
      await tx.investigationValue.deleteMany({ where: { orderId } });
    }
    await tx.investigationValue.createMany({
      data: flaggedValues.map((v) => ({
        orderId,
        analyte: v.analyte,
        value: v.value,
        unit: v.unit,
        referenceLow: v.referenceLow,
        referenceHigh: v.referenceHigh,
        criticalLow: v.criticalLow,
        criticalHigh: v.criticalHigh,
        flag: v.flag as never,
      })),
    });

    await appendAudit(
      {
        actorUserId: caller.sub,
        action: input.save_as_draft
          ? order.reportPreparedAt
            ? "investigation.preliminary_corrected"
            : "investigation.report_prepared"
          : isCritical
            ? "investigation.critical_result_filed"
            : "investigation.result_filed",
        entityType: "investigation_orders",
        entityId: orderId,
        metadata: { isCritical, analytes: flaggedValues.map((v) => v.analyte) },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return tx.investigationOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        orderedBy: { select: { user: { select: { fullName: true } } } },
        values: true,
        patient: { select: { fullName: true } },
        facility: { select: { name: true } },
      },
    });
  });

  return serialiseOrder(updated, caller);
}

/**
 * Closes the loop on a result. Until a clinician acknowledges, a critical
 * finding is not treated as received — silence is never treated as receipt.
 */
export async function acknowledgeResult(
  orderId: string,
  caller: Caller,
  meta: Meta,
  baseVersion?: number,
) {
  if (caller.role !== "clinician" || !caller.cpid)
    throw forbidden(
      "ROLE_NOT_PERMITTED",
      "Clinician profile required to acknowledge a result",
    );

  const order = await prisma.investigationOrder.findUnique({
    where: { id: orderId },
  });
  if (!order) throw notFound("Investigation order not found");
  if (order.orderedById !== caller.cpid)
    throw forbidden(
      "NOT_RESOURCE_OWNER",
      "Only the ordering clinician may acknowledge this result",
    );
  await assertClinician(caller);
  if (baseVersion !== undefined && baseVersion !== order.version)
    throw conflict(
      "VERSION_CONFLICT",
      "The report changed. Reload before acknowledging",
    );
  if (order.status === "acknowledged") {
    throw conflict(
      "RESULT_ALREADY_ACKNOWLEDGED",
      "This result has already been acknowledged",
    );
  }
  if (order.status !== "resulted") {
    throw conflict(
      "STATE_TRANSITION_INVALID",
      "No result has been filed for this order yet",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.investigationOrder.updateMany({
      where: { id: orderId, version: order.version, status: "resulted" },
      data: {
        status: "acknowledged",
        acknowledgedById: caller.cpid,
        acknowledgedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1)
      throw conflict(
        "RESULT_ALREADY_ACKNOWLEDGED",
        "This result changed. Reload the order.",
      );
    await appendAudit(
      {
        actorUserId: caller.sub,
        action: "investigation.acknowledged",
        entityType: "investigation_orders",
        entityId: orderId,
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return tx.investigationOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { values: true },
    });
  });

  return serialiseOrder(updated, caller);
}

export async function collectSample(
  orderId: string,
  caller: Caller,
  version: number,
  meta: Meta,
  specimen?: {
    specimen_reference?: string;
    specimen_type?: string;
    collected_at?: string;
  },
) {
  if (caller.role !== "lab_technician")
    throw forbidden("ROLE_NOT_PERMITTED", "Lab technician required");
  return prisma.$transaction(async (tx) => {
    const changed = await tx.investigationOrder.updateMany({
      where: {
        id: orderId,
        version,
        status: { in: ["ordered", "scheduled"] },
        ...laboratoryScope(caller.sub),
      },
      data: {
        status: "collected",
        receivedAt: new Date(),
        receivedById: caller.sub,
        specimenReference: specimen?.specimen_reference,
        specimenType: specimen?.specimen_type,
        collectedAt: specimen?.collected_at
          ? new Date(specimen.collected_at)
          : null,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1)
      throw conflict(
        "STATE_TRANSITION_INVALID",
        "Order is unavailable, changed, or not assigned to your laboratory",
      );
    await appendAudit(
      {
        actorUserId: caller.sub,
        action: "investigation.sample_received",
        entityType: "investigation_orders",
        entityId: orderId,
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    const order = await tx.investigationOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        orderedBy: { select: { user: { select: { fullName: true } } } },
        values: true,
        patient: { select: { fullName: true } },
        facility: { select: { name: true } },
      },
    });
    return serialiseOrder(order, caller);
  });
}

export async function releaseReport(
  orderId: string,
  caller: Caller,
  version: number,
  meta: Meta,
) {
  if (caller.role !== "lab_technician")
    throw forbidden(
      "ROLE_NOT_PERMITTED",
      "Assigned laboratory staff must review and release this report",
    );
  return prisma.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({
      where: { id: caller.sub },
      select: { fullName: true },
    });
    const changed = await tx.investigationOrder.updateMany({
      where: {
        id: orderId,
        version,
        status: "collected",
        reportPreparedAt: { not: null },
        ...laboratoryScope(caller.sub),
      },
      data: {
        status: "resulted",
        resultedAt: new Date(),
        releasedById: caller.sub,
        releasedByName: actor?.fullName ?? null,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1)
      throw conflict(
        "STATE_TRANSITION_INVALID",
        "Report changed, is not prepared or access was revoked. Reload before release",
      );
    const order = await tx.investigationOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        values: true,
        patient: { select: { fullName: true } },
        facility: { select: { name: true } },
        orderedBy: { select: { user: { select: { fullName: true } } } },
      },
    });
    await appendAudit(
      {
        actorUserId: caller.sub,
        action: order.isCritical
          ? "investigation.critical_result_filed"
          : "investigation.report_released",
        entityType: "investigation_orders",
        entityId: orderId,
        metadata: { isCritical: order.isCritical },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return serialiseOrder(order, caller);
  });
}
