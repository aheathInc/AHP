import { prisma, Prisma } from '@a-health/database';
import {
  appendAudit, conflict, cursorArgs, decodeCursor, forbidden, notFound, recordChange, toCursorPage, unprocessable,
} from '@a-health/http';
import { env } from '../config/env.js';
import type { CreateAppointmentInput } from '../types/appointment.types.js';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }
export interface Meta { ip?: string | null; requestId?: string | null }

function serialiseAppointment(a: {
  id: string; slotId: string; careThreadId: string | null; patientProfileId: string;
  clinicianId: string; consultationId?: string | null; startsAt: Date; durationMin: number;
  modality: string; reason: string | null; status: string; cancelledReason: string | null;
  version: number; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: a.id,
    slot_id: a.slotId,
    care_thread_id: a.careThreadId,
    patient_profile_id: a.patientProfileId,
    clinician_id: a.clinicianId,
    consultation_id: a.consultationId ?? null,
    starts_at: a.startsAt.toISOString(),
    duration_minutes: a.durationMin,
    modality: a.modality,
    reason: a.reason,
    status: a.status,
    cancelled_reason: a.cancelledReason,
    version: a.version,
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
  };
}

/** Minimal, contract-shaped serialiser — mirrors consultation.service's own, not imported across the service boundary. */
function serialiseConsultation(c: {
  id: string; careThreadId: string; patientProfileId: string; assignedClinicianId: string | null;
  appointmentId: string | null; channel: string; modality: string; urgencyLevel: string;
  triageRuleVersion: string; status: string; slaDeadlineAt: Date; escalationCount: number;
  createdAt: Date; acceptedAt: Date | null; completedAt: Date | null; version: number; updatedAt: Date;
}) {
  return {
    id: c.id,
    care_thread_id: c.careThreadId,
    patient_profile_id: c.patientProfileId,
    assigned_clinician_id: c.assignedClinicianId,
    referred_from_consultation_id: null,
    appointment_id: c.appointmentId,
    channel: c.channel,
    modality: c.modality,
    symptom_text: null,
    structured_symptoms: [],
    voice_note_key: null,
    urgency_level: c.urgencyLevel,
    triage_rule_version: c.triageRuleVersion,
    status: c.status,
    sla_deadline_at: c.slaDeadlineAt.toISOString(),
    escalation_count: c.escalationCount,
    created_at: c.createdAt.toISOString(),
    client_created_at: null,
    accepted_at: c.acceptedAt?.toISOString() ?? null,
    completed_at: c.completedAt?.toISOString() ?? null,
    version: c.version,
    updated_at: c.updatedAt.toISOString(),
  };
}

async function resolvePatientProfileId(caller: Caller, requested: string | undefined, db: Prisma.TransactionClient = prisma): Promise<string> {
  const patientProfileId = requested ?? caller.ppid;
  if (!patientProfileId) throw forbidden('ROLE_NOT_PERMITTED', 'No patient profile for this request');
  const patient = await db.patientProfile.findUnique({ where: { id: patientProfileId } });
  if (!patient) throw notFound('Patient profile not found');
  if (caller.role === 'patient' && patient.userId !== caller.sub && patient.guardianUserId !== caller.sub) {
    throw forbidden('NOT_RESOURCE_OWNER', 'You cannot book an appointment for this patient');
  }
  return patientProfileId;
}

/**
 * Books a published slot.
 *
 * Slot contention is resolved by first write wins: the conditional update
 * (`isBooked: false` in the where clause) means a losing concurrent request
 * updates zero rows and is told the slot is gone, rather than double-booking
 * the clinician. Booking does not open a consultation — that is what start()
 * is for, kept separate so a no-show never leaves a clinical record behind.
 */
async function lockAppointment(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${id}::uuid FOR UPDATE`;
  const row = await tx.appointment.findUnique({ where: { id } });
  if (!row) throw notFound('Appointment not found');
  return row;
}
async function lockPatient(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`appointment-patient:${id}`}, 0))::text AS locked`;
}
async function ensureNoOverlap(tx: Prisma.TransactionClient, patientId: string, clinicianId: string, start: Date, duration: number, exclude = '00000000-0000-0000-0000-000000000000') {
  const end = new Date(start.getTime() + duration * 60000);
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM appointments
    WHERE (patient_profile_id = ${patientId}::uuid OR clinician_id = ${clinicianId}::uuid) AND id <> ${exclude}::uuid
      AND status IN ('booked', 'started') AND starts_at < (${end.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      AND starts_at + duration_minutes * interval '1 minute' > (${start.toISOString()}::timestamptz AT TIME ZONE 'UTC') LIMIT 1`;
  if (rows.length) throw conflict('STATE_TRANSITION_INVALID', 'The selected time overlaps an existing appointment for this patient or clinician.');
}
async function claimSlot(tx: Prisma.TransactionClient, id: string) {
  const slot = await tx.slot.findUnique({ where: { id }, include: { clinician: { include: { user: { select: { status: true } } } } } });
  if (!slot) throw notFound('Slot not found');
  if (slot.startsAt <= new Date()) throw conflict('SLOT_IN_PAST', 'This slot has already passed');
  if (slot.clinician.verificationStatus !== 'verified' || slot.clinician.user.status !== 'active') throw conflict('SLOT_UNAVAILABLE', 'This clinician is not currently eligible for bookings.');
  const claimed = await tx.slot.updateMany({ where: { id, isBooked: false, isPublished: true, startsAt: { gt: new Date() } }, data: { isBooked: true, version: { increment: 1 } } });
  if (claimed.count !== 1) throw conflict('SLOT_UNAVAILABLE', 'This time is no longer available. Choose another published slot.');
  return slot;
}
export async function createAppointment(caller: Caller, input: CreateAppointmentInput, meta: Meta) {
  const appointment = await prisma.$transaction(async tx => {
    const patientProfileId = await resolvePatientProfileId(caller, input.patient_profile_id, tx);
    await lockPatient(tx, patientProfileId);
    if (input.care_thread_id) {
      const thread = await tx.careThread.findUnique({ where: { id: input.care_thread_id } });
      if (!thread) throw notFound('Care thread not found');
      if (thread.patientProfileId !== patientProfileId) throw forbidden('NOT_RESOURCE_OWNER', 'That care thread does not belong to this patient');
    }
    const slotOwner = await tx.slot.findUnique({ where: { id: input.slot_id }, select: { clinicianId: true } });
    if (!slotOwner) throw notFound('Slot not found');
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`slot-calendar:${slotOwner.clinicianId}`}, 0))::text AS locked`;
    const slot = await claimSlot(tx, input.slot_id);
    await ensureNoOverlap(tx, patientProfileId, slot.clinicianId, slot.startsAt, slot.durationMin);
    const created = await tx.appointment.create({ data: { slotId: slot.id, careThreadId: input.care_thread_id ?? null, patientProfileId,
      clinicianId: slot.clinicianId, startsAt: slot.startsAt, durationMin: slot.durationMin, modality: slot.modality, reason: input.reason ?? null } });
    await recordChange(tx, { entity: 'appointments', entityId: created.id, op: 'create', version: created.version, patientProfileId, clinicianId: slot.clinicianId });
    await appendAudit({ actorUserId: caller.sub, action: 'appointment.booked', entityType: 'appointments', entityId: created.id,
      metadata: { slotId: slot.id, startsAt: slot.startsAt.toISOString() }, ipAddress: meta.ip, requestId: meta.requestId }, tx);
    return created;
  }, { maxWait: 10000, timeout: 15000 });
  return serialiseAppointment(appointment);
}

async function assertVisible(appointment: { patientProfileId: string; clinicianId: string }, caller: Caller, db: Prisma.TransactionClient = prisma) {
  if (caller.role === 'platform_admin') return;
  if (caller.cpid && appointment.clinicianId === caller.cpid) return;
  const patient = await db.patientProfile.findUnique({ where: { id: appointment.patientProfileId } });
  const owns = patient && (patient.userId === caller.sub || patient.guardianUserId === caller.sub);
  if (!owns) throw forbidden('NOT_RESOURCE_OWNER', 'This appointment is not yours');
}

export async function getAppointment(appointmentId: string, caller: Caller) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment) throw notFound('Appointment not found');
  await assertVisible(appointment, caller);
  return serialiseAppointment(appointment);
}

export async function listAppointments(
  caller: Caller,
  query: { status?: string; from?: string; to?: string; cursor?: string; limit: number },
) {
  const scope =
    caller.role === 'platform_admin'
      ? {}
      : caller.cpid
        ? { clinicianId: caller.cpid }
        : { patient: { OR: [{ userId: caller.sub }, { guardianUserId: caller.sub }] } };

  const rows = await prisma.appointment.findMany({
    where: {
      ...scope,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.from || query.to
        ? { startsAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    ...cursorArgs(query.cursor, query.limit),
  });
  return toCursorPage(rows, query.limit, serialiseAppointment);
}

/**
 * Opens the consultation for a booked appointment. The clinician is already
 * fixed by the booking, so this never touches the triage or matching engine
 * — it creates the ConsultationRequest directly in `matched` state.
 *
 * Callable by either party from START_WINDOW_MINUTES before the slot. If the
 * appointment carries no care_thread_id, one is opened here — and if the
 * thread it does carry was closed, it is reopened, the same rule
 * services/consultation applies when a problem resurfaces.
 */
export async function startAppointment(appointmentId: string, caller: Caller, meta: Meta) {
  const result = await prisma.$transaction(async (tx) => {
  const appointment = await lockAppointment(tx, appointmentId);
  if (!appointment) throw notFound('Appointment not found');
  await assertVisible(appointment, caller, tx);

  if (appointment.status !== 'booked') {
    throw conflict('APPOINTMENT_ALREADY_STARTED', `This appointment is already "${appointment.status}"`);
  }
  const earliestStart = new Date(appointment.startsAt.getTime() - env.START_WINDOW_MINUTES * 60_000);
  if (new Date() < earliestStart) {
    throw conflict('APPOINTMENT_NOT_YET_STARTABLE', 'It is too early to start this appointment');
  }


    let threadId = appointment.careThreadId;

    if (threadId) {
      const thread = await tx.careThread.findUniqueOrThrow({ where: { id: threadId } });
      if (thread.status === 'closed') {
        await tx.careThread.update({
          where: { id: threadId },
          data: { status: 'open', closedAt: null, outcome: null, version: { increment: 1 } },
        });
      }
    } else {
      const thread = await tx.careThread.create({
        data: {
          patientProfileId: appointment.patientProfileId,
          reasonSummary: appointment.reason ?? 'Scheduled appointment',
        },
      });
      threadId = thread.id;
    }

    const consultation = await tx.consultationRequest.create({
      data: {
        careThreadId: threadId,
        patientProfileId: appointment.patientProfileId,
        assignedClinicianId: appointment.clinicianId,
        appointmentId: appointment.id,
        channel: 'app',
        modality: appointment.modality,
        // No triage ran: the clinician and time were fixed at booking, not
        // derived from symptoms. The version is recorded as a fixed marker
        // for the same audit reason every other consultation stamps a real
        // triage version — so a reviewer never mistakes this for a triage
        // decision that happened and was simply not logged.
        urgencyLevel: 'routine',
        triageRuleVersion: 'scheduled-appointment-no-triage',
        status: 'matched',
        acceptedAt: new Date(),
        slaDeadlineAt: new Date(Date.now() + env.SLA_ROUTINE_SECONDS * 1000),
      },
    });

    await tx.appointment.update({
      where: { id: appointment.id },
      data: { status: 'started', version: { increment: 1 } },
    });

    await tx.careThread.update({
      where: { id: threadId },
      data: {
        latestConsultationId: consultation.id,
        openConsultationCount: { increment: 1 },
        version: { increment: 1 },
      },
    });

    await tx.clinicianProfile.update({
      where: { id: appointment.clinicianId },
      data: { currentLoad: { increment: 1 }, version: { increment: 1 } },
    });

    const updated = await tx.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    await recordChange(tx, { entity: 'appointments', entityId: appointment.id, op: 'update', version: updated.version, patientProfileId: appointment.patientProfileId, clinicianId: appointment.clinicianId });
    await appendAudit({ actorUserId: caller.sub, action: 'appointment.started', entityType: 'appointments', entityId: appointment.id,
      metadata: { consultationId: consultation.id }, ipAddress: meta.ip, requestId: meta.requestId }, tx);
    return consultation;
  }, { maxWait: 10000, timeout: 15000 });

  return serialiseConsultation(result);
}

/**
 * Cancelling releases the reservation. Published slots become bookable again;
 * withdrawn slots remain unavailable. Only legal while `booked` —
 * once started, a consultation may already be in progress, and "cancelling"
 * that is a clinical action (closing the consultation), not a scheduling one.
 */
export async function cancelAppointment(appointmentId: string, caller: Caller, reason: string | undefined, meta: Meta, baseVersion?: number) {
  const updated = await prisma.$transaction(async tx => {
    const appointment = await lockAppointment(tx, appointmentId);
    await assertVisible(appointment, caller, tx);
    if (baseVersion !== undefined && appointment.version !== baseVersion) throw conflict('VERSION_CONFLICT', 'This appointment changed. Refresh before cancelling.');
    if (appointment.status !== 'booked') throw conflict('STATE_TRANSITION_INVALID', `Cannot cancel an appointment in status "${appointment.status}"`);
    const row = await tx.appointment.update({ where: { id: appointment.id }, data: { status: 'cancelled', cancelledReason: reason ?? null, version: { increment: 1 } } });
    await tx.slot.update({ where: { id: appointment.slotId }, data: { isBooked: false, version: { increment: 1 } } });
    await recordChange(tx, { entity: 'appointments', entityId: row.id, op: 'update', version: row.version, patientProfileId: row.patientProfileId, clinicianId: row.clinicianId });
    await appendAudit({ actorUserId: caller.sub, action: 'appointment.cancelled', entityType: 'appointments', entityId: row.id, reason: reason ?? null, ipAddress: meta.ip, requestId: meta.requestId }, tx);
    return row;
  }, { maxWait: 10000, timeout: 15000 });
  return serialiseAppointment(updated);
}
async function assertPatientOwner(patientProfileId: string, caller: Caller, tx: Prisma.TransactionClient = prisma) {
  if (caller.role !== 'patient') throw forbidden('ROLE_NOT_PERMITTED', 'Patient or guardian account required.');
  const [patient, user] = await Promise.all([
    tx.patientProfile.findUnique({ where: { id: patientProfileId } }),
    tx.user.findUnique({ where: { id: caller.sub }, select: { role: true, status: true } }),
  ]);
  if (!user || user.role !== 'patient' || user.status !== 'active' || !patient || (patient.userId !== caller.sub && patient.guardianUserId !== caller.sub)) throw forbidden('NOT_RESOURCE_OWNER', 'This appointment is not yours to reschedule.');
}
export async function assertRescheduleOwnership(id: string, caller: Caller) {
  const appointment = await prisma.appointment.findUnique({ where: { id }, select: { patientProfileId: true } });
  if (!appointment) throw notFound('Appointment not found');
  await assertPatientOwner(appointment.patientProfileId, caller);
}
async function assertPatientReschedule(appointment: { patientProfileId: string; clinicianId: string; status: string; startsAt: Date }, caller: Caller, tx: Prisma.TransactionClient = prisma) {
  await assertPatientOwner(appointment.patientProfileId, caller, tx);
  if (appointment.status !== 'booked' || appointment.startsAt <= new Date()) throw conflict('STATE_TRANSITION_INVALID', 'Only future booked appointments can be rescheduled.');
}
export async function rescheduleAppointment(id: string, caller: Caller, input: { slot_id: string; base_version: number }, meta: Meta) {
  const result = await prisma.$transaction(async tx => {
    const appointment = await lockAppointment(tx, id);
    await assertPatientReschedule(appointment, caller, tx);
    if (appointment.version !== input.base_version) throw conflict('VERSION_CONFLICT', 'This appointment changed. Refresh its details before choosing a new time.');
    if (appointment.slotId === input.slot_id) throw conflict('STATE_TRANSITION_INVALID', 'Choose a different appointment time.');
    await lockPatient(tx, appointment.patientProfileId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`slot-calendar:${appointment.clinicianId}`}, 0))::text AS locked`;
    // Stable ordering prevents two reschedules from taking slot locks in opposite order.
    await tx.$queryRaw`SELECT id FROM slots WHERE id IN (${appointment.slotId}::uuid, ${input.slot_id}::uuid) ORDER BY id FOR UPDATE`;
    const slot = await claimSlot(tx, input.slot_id);
    await assertPatientReschedule(appointment, caller, tx);
    if (slot.clinicianId !== appointment.clinicianId || slot.modality !== appointment.modality || slot.durationMin !== appointment.durationMin) throw conflict('STATE_TRANSITION_INVALID', 'Choose a slot with the same clinician, consultation method and duration.');
    await ensureNoOverlap(tx, appointment.patientProfileId, slot.clinicianId, slot.startsAt, slot.durationMin, id);
    const updated = await tx.appointment.update({ where: { id }, data: { slotId: slot.id, startsAt: slot.startsAt, durationMin: slot.durationMin, modality: slot.modality, version: { increment: 1 } } });
    await tx.slot.update({ where: { id: appointment.slotId }, data: { isBooked: false, version: { increment: 1 } } });
    await recordChange(tx, { entity: 'appointments', entityId: id, op: 'update', version: updated.version, patientProfileId: appointment.patientProfileId, clinicianId: appointment.clinicianId });
    await appendAudit({ actorUserId: caller.sub, action: 'appointment.rescheduled', entityType: 'appointments', entityId: id,
      metadata: { previousSlotId: appointment.slotId, slotId: slot.id, previousStartsAt: appointment.startsAt.toISOString(), startsAt: slot.startsAt.toISOString(), previousVersion: appointment.version, version: updated.version }, ipAddress: meta.ip, requestId: meta.requestId }, tx);
    return updated;
  }, { maxWait: 10000, timeout: 15000 });
  return serialiseAppointment(result);
}
export async function rescheduleOptions(id: string, caller: Caller, query: { cursor?: string; limit: number }) {
  const appointment = await prisma.appointment.findUnique({ where: { id } });
  if (!appointment) throw notFound('Appointment not found');
  await assertPatientReschedule(appointment, caller);
  const now = new Date();
  const cursorId = decodeCursor(query.cursor);
  const cursor = cursorId ? await prisma.slot.findFirst({ where: { id: cursorId, clinicianId: appointment.clinicianId }, select: { id: true, startsAt: true } }) : null;
  if (cursorId && !cursor) throw unprocessable('Invalid rescheduling cursor.', 'cursor');
  const after = cursor ? Prisma.sql`AND (s.starts_at, s.id) > ((${cursor.startsAt.toISOString()}::timestamptz AT TIME ZONE 'UTC'), ${cursor.id}::uuid)` : Prisma.empty;
  const horizon = new Date(now.getTime() + 90 * 86400000);
  const rows = await prisma.$queryRaw<{ id: string; startsAt: Date; durationMin: number; modality: string }[]>`
    SELECT s.id, s.starts_at AS "startsAt", s.duration_minutes AS "durationMin", s.modality::text AS modality
    FROM slots s JOIN clinician_profiles c ON c.id = s.clinician_id JOIN users u ON u.id = c.user_id
    WHERE s.id <> ${appointment.slotId}::uuid AND s.clinician_id = ${appointment.clinicianId}::uuid
      AND s.is_booked = false AND s.is_published = true AND s.duration_minutes = ${appointment.durationMin}
      AND s.modality::text = ${appointment.modality} AND c.verification_status = 'verified' AND u.status = 'active'
      AND s.starts_at > (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      AND s.starts_at <= (${horizon.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.id <> ${id}::uuid AND a.status IN ('booked', 'started')
        AND (a.patient_profile_id = ${appointment.patientProfileId}::uuid OR a.clinician_id = s.clinician_id)
        AND a.starts_at < s.starts_at + s.duration_minutes * interval '1 minute'
        AND a.starts_at + a.duration_minutes * interval '1 minute' > s.starts_at)
      ${after} ORDER BY s.starts_at ASC, s.id ASC LIMIT ${query.limit + 1}`;
  const clinician = await prisma.clinicianProfile.findUniqueOrThrow({ where: { id: appointment.clinicianId }, select: { user: { select: { fullName: true } } } });
  return { appointment: serialiseAppointment(appointment), clinician_name: clinician.user.fullName, ...toCursorPage(rows, query.limit, slot => ({ id: slot.id, starts_at: slot.startsAt.toISOString(), duration_minutes: slot.durationMin, modality: slot.modality })), as_of: now.toISOString() };
}
