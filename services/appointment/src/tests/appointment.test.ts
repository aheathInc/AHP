import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { assertIsolatedLocalTestTarget, verifyLocalTestIdentity } from '@a-health/database/test-safety';
import type { AppError } from '@a-health/http';
import * as appointments from '../services/appointment.service.js';

const testTarget = assertIsolatedLocalTestTarget(process.env);
before(async () => { await verifyLocalTestIdentity(prisma, testTarget); });

const meta = { ip: '127.0.0.1', requestId: 'test' };
const users: string[] = [];
const clinicians: string[] = [];
const slotIds: string[] = [];
const appointmentIds: string[] = [];
const threadIds: string[] = [];

after(async () => {
  for (const id of appointmentIds) {
    await prisma.consultationRequest.deleteMany({ where: { appointmentId: id } }).catch(() => undefined);
    await prisma.appointment.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of threadIds) {
    await prisma.careThread.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of slotIds) {
    await prisma.slot.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of clinicians) {
    await prisma.clinicianProfile.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of users) {
    await prisma.patientProfile.deleteMany({ where: { userId: id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function makePatient() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, role: 'patient', status: 'active', fullName: 'Appt Test' },
  });
  users.push(user.id);
  const profile = await prisma.patientProfile.create({ data: { userId: user.id, fullName: 'Appt Test' } });
  return { user, profile };
}

async function makeClinician() {
  const user = await prisma.user.create({
    data: { phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`, email: `${randomUUID()}@test.local`, role: 'clinician', status: 'active', fullName: 'Appt Clinician' },
  });
  users.push(user.id);
  const profile = await prisma.clinicianProfile.create({
    data: { userId: user.id, licenseNumber: `TEST-${randomUUID().slice(0, 12)}`, specialty: 'general_practice', verificationStatus: 'verified' },
  });
  clinicians.push(profile.id);
  return profile;
}

async function makeSlot(clinicianId: string, minutesFromNow: number) {
  const slot = await prisma.slot.create({
    data: { clinicianId, startsAt: new Date(Date.now() + minutesFromNow * 60_000), durationMin: 30, modality: 'chat' },
  });
  slotIds.push(slot.id);
  return slot;
}

describe('booking', () => {
  it('books a future slot and marks it unavailable', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 120);

    const result = await appointments.createAppointment(
      { sub: user.id, role: 'patient', ppid: profile.id },
      { slot_id: slot.id }, meta,
    );
    appointmentIds.push(result.id);
    assert.equal(result.status, 'booked');

    const reloaded = await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
    assert.equal(reloaded.isBooked, true);
  });

  it('refuses a slot that is already booked', async () => {
    const { user: u1, profile: p1 } = await makePatient();
    const { user: u2, profile: p2 } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 180);

    const first = await appointments.createAppointment({ sub: u1.id, role: 'patient', ppid: p1.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(first.id);

    await assert.rejects(
      () => appointments.createAppointment({ sub: u2.id, role: 'patient', ppid: p2.id }, { slot_id: slot.id }, meta),
      (e: AppError) => e.code === 'SLOT_UNAVAILABLE',
    );
  });

  it('refuses a slot in the past', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, -30);

    await assert.rejects(
      () => appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta),
      (e: AppError) => e.code === 'SLOT_IN_PAST',
    );
  });
});

describe('starting', () => {
  it('refuses to start more than the window ahead of the slot', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 120);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);

    await assert.rejects(
      () => appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta),
      (e: AppError) => e.code === 'APPOINTMENT_NOT_YET_STARTABLE',
    );
  });

  it('opens a matched consultation with no triage, inside the window', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 5);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);

    const consultation = await appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta);
    threadIds.push(consultation.care_thread_id);

    assert.equal(consultation.status, 'matched');
    assert.equal(consultation.assigned_clinician_id, clinician.id);
    assert.equal(consultation.appointment_id, booked.id);

    const reloadedAppt = await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } });
    assert.equal(reloadedAppt.status, 'started');
  });

  it('refuses to start an appointment twice', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 5);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);
    const first = await appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta);
    threadIds.push(first.care_thread_id);

    await assert.rejects(
      () => appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta),
      (e: AppError) => e.code === 'APPOINTMENT_ALREADY_STARTED',
    );
  });

  it('reopens a closed care thread rather than orphaning the new consultation', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const thread = await prisma.careThread.create({ data: { patientProfileId: profile.id, status: 'closed', closedAt: new Date() } });
    threadIds.push(thread.id);
    const slot = await makeSlot(clinician.id, 5);
    const booked = await appointments.createAppointment(
      { sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id, care_thread_id: thread.id }, meta,
    );
    appointmentIds.push(booked.id);

    await appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta);

    const reloadedThread = await prisma.careThread.findUniqueOrThrow({ where: { id: thread.id } });
    assert.equal(reloadedThread.status, 'open');
  });
});

describe('cancelling', () => {
  it('releases the slot on cancel', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 120);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);

    const cancelled = await appointments.cancelAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, 'changed my mind', meta);
    assert.equal(cancelled.status, 'cancelled');

    const reloadedSlot = await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
    assert.equal(reloadedSlot.isBooked, false);
  });

  it('refuses to cancel an already-started appointment', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 5);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);
    const started = await appointments.startAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, meta);
    threadIds.push(started.care_thread_id);

    await assert.rejects(
      () => appointments.cancelAppointment(booked.id, { sub: user.id, role: 'patient', ppid: profile.id }, undefined, meta),
      (e: AppError) => e.code === 'STATE_TRANSITION_INVALID',
    );
  });
});

describe('visibility', () => {
  it('refuses a stranger', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 120);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);

    await assert.rejects(
      () => appointments.getAppointment(booked.id, { sub: randomUUID(), role: 'patient' }),
      (e: AppError) => e.code === 'NOT_RESOURCE_OWNER',
    );
  });

  it('lets the assigned clinician see it', async () => {
    const { user, profile } = await makePatient();
    const clinician = await makeClinician();
    const slot = await makeSlot(clinician.id, 120);
    const booked = await appointments.createAppointment({ sub: user.id, role: 'patient', ppid: profile.id }, { slot_id: slot.id }, meta);
    appointmentIds.push(booked.id);

    const result = await appointments.getAppointment(booked.id, { sub: randomUUID(), role: 'clinician', cpid: clinician.id });
    assert.equal(result.id, booked.id);
  });
});

describe('patient rescheduling', () => {
  async function booked(minutes = 120) {
    const { user, profile } = await makePatient(), clinician = await makeClinician();
    const old = await makeSlot(clinician.id, minutes), target = await makeSlot(clinician.id, 240);
    const caller = { sub: user.id, role: 'patient', ppid: profile.id };
    const appointment = await appointments.createAppointment(caller, { slot_id: old.id, reason: 'Synthetic appointment reason' }, meta);
    appointmentIds.push(appointment.id);
    return { caller, clinician, old, target, appointment, profile };
  }
  it('moves the same appointment, increments its version and atomically exchanges slots', async () => {
    const f = await booked();
    const result = await appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: f.target.id, base_version: f.appointment.version }, meta);
    assert.equal(result.id, f.appointment.id); assert.equal(result.reason, f.appointment.reason);
    assert.equal(result.slot_id, f.target.id); assert.equal(result.version, f.appointment.version + 1);
    assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: f.old.id } })).isBooked, false);
    assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: f.target.id } })).isBooked, true);
  });
  it('retains the original booking when the destination is unavailable', async () => {
    const f = await booked(); await prisma.slot.update({ where: { id: f.target.id }, data: { isBooked: true } });
    await assert.rejects(appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: f.target.id, base_version: f.appointment.version }, meta), (e: AppError) => e.code === 'SLOT_UNAVAILABLE');
    assert.equal((await appointments.getAppointment(f.appointment.id, f.caller)).slot_id, f.old.id);
    assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: f.old.id } })).isBooked, true);
  });
  it('rejects another patient even if a clinician-profile claim is supplied', async () => {
    const f = await booked(), other = await makePatient();
    await assert.rejects(appointments.rescheduleAppointment(f.appointment.id, { sub: other.user.id, role: 'patient', cpid: f.clinician.id }, { slot_id: f.target.id, base_version: f.appointment.version }, meta), (e: AppError) => e.code === 'NOT_RESOURCE_OWNER');
    await assert.rejects(appointments.rescheduleOptions(f.appointment.id, { sub: other.user.id, role: 'patient' }, { limit: 50 }));
  });
  it('allows the recorded guardian to reschedule an authorized dependant', async () => {
    const f = await booked(), guardian = await makePatient();
    await prisma.patientProfile.update({ where: { id: f.profile.id }, data: { guardianUserId: guardian.user.id } });
    const result = await appointments.rescheduleAppointment(f.appointment.id, { sub: guardian.user.id, role: 'patient' }, { slot_id: f.target.id, base_version: f.appointment.version }, meta);
    assert.equal(result.patient_profile_id, f.profile.id);
  });
  it('rejects stale writes and stale cancellation without releasing the current slot', async () => {
    const f = await booked();
    await appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: f.target.id, base_version: f.appointment.version }, meta);
    await assert.rejects(appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: f.old.id, base_version: f.appointment.version }, meta), (e: AppError) => e.code === 'VERSION_CONFLICT');
    await assert.rejects(appointments.cancelAppointment(f.appointment.id, f.caller, undefined, meta, f.appointment.version), (e: AppError) => e.code === 'VERSION_CONFLICT');
    assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: f.target.id } })).isBooked, true);
  });
  it('rejects a different clinician, modality or duration and rolls back each destination claim', async () => {
    const f = await booked(), other = await makeClinician(), otherSlot = await makeSlot(other.id, 240);
    for (const slot of [otherSlot, f.target]) {
      if (slot.id === f.target.id) await prisma.slot.update({ where: { id: slot.id }, data: { modality: 'video' } });
      await assert.rejects(appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: slot.id, base_version: f.appointment.version }, meta));
      assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } })).isBooked, false);
    }
    await prisma.slot.update({ where: { id: f.target.id }, data: { modality: 'chat', durationMin: 45 } });
    await assert.rejects(appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: f.target.id, base_version: f.appointment.version }, meta));
    assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: f.target.id } })).isBooked, false);
  });
  it('rejects past or cancelled sources and same-slot requests', async () => {
    const f = await booked();
    await assert.rejects(appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: f.old.id, base_version: f.appointment.version }, meta));
    await prisma.appointment.update({ where: { id: f.appointment.id }, data: { startsAt: new Date(Date.now() - 60000) } });
    await assert.rejects(appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: f.target.id, base_version: f.appointment.version }, meta));
    await appointments.cancelAppointment(f.appointment.id, f.caller, undefined, meta);
    await assert.rejects(appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: f.target.id, base_version: f.appointment.version + 1 }, meta));
  });
  it('allows exactly one of two concurrent moves at the same base version', async () => {
    const f = await booked(), second = await makeSlot(f.clinician.id, 360);
    const results = await Promise.allSettled([f.target.id, second.id].map(slot_id => appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id, base_version: f.appointment.version }, meta)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const current = await appointments.getAppointment(f.appointment.id, f.caller);
    assert.equal(current.version, 2);
    for (const slot of [f.old, f.target, second]) assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } })).isBooked, slot.id === current.slot_id);
  });
  it('serializes a move racing another patient booking the destination', async () => {
    const f = await booked(), other = await makePatient();
    const results = await Promise.allSettled([
      appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: f.target.id, base_version: f.appointment.version }, meta),
      appointments.createAppointment({ sub: other.user.id, ppid: other.profile.id, role: 'patient' }, { slot_id: f.target.id }, meta),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    if (results[1]!.status === 'fulfilled') appointmentIds.push(results[1]!.value.id);
    const current = await appointments.getAppointment(f.appointment.id, f.caller);
    assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: f.old.id } })).isBooked, current.slot_id === f.old.id);
    assert.equal(await prisma.appointment.count({ where: { slotId: f.target.id, status: { not: 'cancelled' } } }), 1);
  });
  it('serializes start versus a move to outside the start window', async () => {
    const f = await booked(5);
    const results = await Promise.allSettled([
      appointments.startAppointment(f.appointment.id, f.caller, meta),
      appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: f.target.id, base_version: f.appointment.version }, meta),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    if (results[0]!.status === 'fulfilled') threadIds.push(results[0]!.value.care_thread_id);
    const current = await appointments.getAppointment(f.appointment.id, f.caller);
    assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: f.old.id } })).isBooked, current.status === 'started');
  });
  it('serializes versioned cancellation versus rescheduling', async () => {
    const f = await booked();
    const results = await Promise.allSettled([
      appointments.cancelAppointment(f.appointment.id, f.caller, undefined, meta, f.appointment.version),
      appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: f.target.id, base_version: f.appointment.version }, meta),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const current = await appointments.getAppointment(f.appointment.id, f.caller);
    assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: f.target.id } })).isBooked, current.status === 'booked');
    assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: f.old.id } })).isBooked, false);
  });
  it('reuses a cancelled slot without deleting the old appointment', async () => {
    const f = await booked(); await appointments.cancelAppointment(f.appointment.id, f.caller, undefined, meta);
    const replacement = await appointments.createAppointment(f.caller, { slot_id: f.old.id }, meta); appointmentIds.push(replacement.id);
    assert.equal(await prisma.appointment.count({ where: { slotId: f.old.id } }), 2);
    assert.equal((await appointments.getAppointment(f.appointment.id, f.caller)).status, 'cancelled');
  });
  it('prevents a move from overlapping another appointment of the same patient', async () => {
    const f = await booked(), existing = await makeSlot(f.clinician.id, 230);
    const second = await appointments.createAppointment(f.caller, { slot_id: existing.id }, meta); appointmentIds.push(second.id);
    await assert.rejects(appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: f.target.id, base_version: f.appointment.version }, meta));
    assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: f.target.id } })).isBooked, false);
    assert.equal((await appointments.getAppointment(f.appointment.id, f.caller)).slot_id, f.old.id);
  });
  it('does not list or book withdrawn slots', async () => {
    const f = await booked(); await prisma.slot.update({ where: { id: f.target.id }, data: { isPublished: false } });
    const options = await appointments.rescheduleOptions(f.appointment.id, f.caller, { limit: 50 });
    assert.equal(options.data.length, 0);
    await assert.rejects(appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: f.target.id, base_version: f.appointment.version }, meta), (e: AppError) => e.code === 'SLOT_UNAVAILABLE');
    assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: f.old.id } })).isBooked, true);
  });
  it('preserves cancelled history through calendar withdrawal and republishing', async () => {
    const f = await booked();
    const { publishSlots, listSlots } = await import('../../../doctor/src/services/slot.service.js');
    const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await publishSlots(f.clinician.id, { from, to, slots: [] });
    assert.equal((await appointments.getAppointment(f.appointment.id, f.caller)).status, 'booked');
    assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: f.old.id } })).isBooked, true);
    await appointments.cancelAppointment(f.appointment.id, f.caller, undefined, meta);
    assert.equal((await listSlots(f.clinician.id, from, to)).data.length, 0);
    assert.equal((await appointments.getAppointment(f.appointment.id, f.caller)).status, 'cancelled');
    await publishSlots(f.clinician.id, { from, to, slots: [{ starts_at: f.old.startsAt.toISOString(), duration_minutes: 30, modality: 'chat' }] });
    const slots = await listSlots(f.clinician.id, from, to); assert.equal(slots.data[0]?.id, f.old.id);
    const next = await appointments.createAppointment(f.caller, { slot_id: f.old.id }, meta); appointmentIds.push(next.id);
    assert.equal(await prisma.appointment.count({ where: { slotId: f.old.id } }), 2);
  });
  it('prevents two concurrent moves into overlapping clinician slots even for different patients', async () => {
    const f = await booked(), other = await makePatient(), old = await makeSlot(f.clinician.id, 360), target = await makeSlot(f.clinician.id, 250);
    const caller = { sub: other.user.id, role: 'patient', ppid: other.profile.id };
    const second = await appointments.createAppointment(caller, { slot_id: old.id }, meta); appointmentIds.push(second.id);
    const results = await Promise.allSettled([
      appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: f.target.id, base_version: 1 }, meta),
      appointments.rescheduleAppointment(second.id, caller, { slot_id: target.id, base_version: 1 }, meta),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  });
  it('rolls back the time, both slot flags and version if required audit append fails', async () => {
    const f = await booked();
    await prisma.$executeRaw`CREATE FUNCTION ahp_test_reschedule_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'appointment.rescheduled' THEN RAISE EXCEPTION 'synthetic required audit failure'; END IF; RETURN NEW; END $$`;
    await prisma.$executeRaw`CREATE TRIGGER ahp_test_reschedule_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ahp_test_reschedule_audit_failure()`;
    try {
      await assert.rejects(appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: f.target.id, base_version: 1 }, meta));
      const current = await appointments.getAppointment(f.appointment.id, f.caller);
      assert.equal(current.slot_id, f.old.id); assert.equal(current.version, 1);
      assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: f.old.id } })).isBooked, true);
      assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: f.target.id } })).isBooked, false);
    } finally {
      await prisma.$executeRaw`DROP TRIGGER ahp_test_reschedule_audit_failure ON audit_logs`;
      await prisma.$executeRaw`DROP FUNCTION ahp_test_reschedule_audit_failure()`;
    }
  });

  it('checks JWT ownership, input validation and idempotent replay through the actual HTTP routes', async () => {
    const f = await booked(), other = await makePatient();
    const { createService, createTokenService } = await import('@a-health/http');
    const { env } = await import('../config/env.js');
    const { appointmentRouter } = await import('../routes/appointment.routes.js');
    const tokens = createTokenService({ secret: env.JWT_SECRET, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE, ttlSeconds: 900 });
    const token = (sub: string, ppid: string) => tokens.sign({ sub, ppid, role: 'patient', status: 'active', jti: randomUUID() });
    const server = createService({ name: 'appointment-test', port: 0, routers: [appointmentRouter], development: false }).app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/appointments/${f.appointment.id}`;
    const headers = { Authorization: `Bearer ${token(f.caller.sub, f.profile.id)}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() };
    try {
      assert.equal((await fetch(base + '/reschedule-options')).status, 401);
      assert.equal((await fetch(base + '/reschedule-options', { headers: { Authorization: `Bearer ${token(other.user.id, other.profile.id)}` } })).status, 403);
      const options = await fetch(base + '/reschedule-options', { headers }); assert.equal(options.status, 200); assert.equal(options.headers.get('Cache-Control'), 'no-store');
      const invalid = await fetch(base + '/reschedule', { method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ slot_id: f.target.id }) });
      assert.ok([400, 422].includes(invalid.status));
      const body = JSON.stringify({ slot_id: f.target.id, base_version: 1 });
      const first = await fetch(base + '/reschedule', { method: 'POST', headers, body }); assert.equal(first.status, 200);
      const replay = await fetch(base + '/reschedule', { method: 'POST', headers, body }); assert.equal(replay.status, 200);
      assert.deepEqual(await first.json(), await replay.json());
      assert.equal((await appointments.getAppointment(f.appointment.id, f.caller)).version, 2);
      assert.equal(await prisma.auditLog.count({ where: { entityId: f.appointment.id, action: 'appointment.rescheduled' } }), 1);
      await prisma.patientProfile.update({ where: { id: f.profile.id }, data: { guardianUserId: other.user.id } });
      const guardianHeaders = { ...headers, Authorization: `Bearer ${token(other.user.id, other.profile.id)}`, 'Idempotency-Key': randomUUID() };
      const guardianBody = JSON.stringify({ slot_id: f.old.id, base_version: 2 });
      assert.equal((await fetch(base + '/reschedule', { method: 'POST', headers: guardianHeaders, body: guardianBody })).status, 200);
      await prisma.patientProfile.update({ where: { id: f.profile.id }, data: { guardianUserId: null } });
      assert.equal((await fetch(base + '/reschedule', { method: 'POST', headers: guardianHeaders, body: guardianBody })).status, 403);

    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });

  it('paginates positive available options without dropping matching slots', async () => {
    const f = await booked(), later = await makeSlot(f.clinician.id, 360);
    const first = await appointments.rescheduleOptions(f.appointment.id, f.caller, { limit: 1 });
    assert.equal(first.data.length, 1); assert.equal((first.data[0] as { id: string }).id, f.target.id); assert.equal(first.meta.has_more, true);
    assert.ok(first.meta.next_cursor);
    const second = await appointments.rescheduleOptions(f.appointment.id, f.caller, { limit: 1, cursor: first.meta.next_cursor });
    assert.equal((second.data[0] as { id: string }).id, later.id); assert.equal(second.meta.has_more, false);
  });
  it('excludes a time overlapping this patient’s booking with a different clinician', async () => {
    const f = await booked(), otherDoctor = await makeClinician(), otherSlot = await makeSlot(otherDoctor.id, 230);
    const other = await appointments.createAppointment(f.caller, { slot_id: otherSlot.id }, meta); appointmentIds.push(other.id);
    assert.equal((await appointments.rescheduleOptions(f.appointment.id, f.caller, { limit: 50 })).data.length, 0);
    await assert.rejects(appointments.rescheduleAppointment(f.appointment.id, f.caller, { slot_id: f.target.id, base_version: 1 }, meta));
  });
  it('enforces one occupied appointment per slot at the database level while retaining cancelled rows', async () => {
    const f = await booked();
    const data = { slotId: f.old.id, patientProfileId: f.profile.id, clinicianId: f.clinician.id, startsAt: f.old.startsAt, durationMin: 30, modality: 'chat' as const };
    await assert.rejects(prisma.appointment.create({ data }), (e: { code?: string }) => e.code === 'P2002');
    const historical = await prisma.appointment.create({ data: { ...data, status: 'cancelled' } }); appointmentIds.push(historical.id);
  });

});
