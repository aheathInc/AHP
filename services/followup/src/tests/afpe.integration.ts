import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { assertIsolatedLocalTestTarget, verifyLocalTestIdentity } from '@a-health/database/test-safety';
import { activate, report, alertFeed, acknowledge, setFallback } from '../afpe/service.js';
import { afpeTick } from '../afpe/scheduler.js';
import { deliveryTick } from '../afpe/delivery.js';
import { respondToCheckIn, closeCycle } from '../services/checkin.service.js';
import { env } from '../config/env.js';
const target = assertIsolatedLocalTestTarget();
before(async () => { await verifyLocalTestIdentity(prisma, target); assert.equal(await prisma.afpePlan.count(), 0, 'AFPE database suite requires a fresh disposable target.'); });
after(async () => { await prisma.$disconnect(); });
const meta = { ip: '127.0.0.1', requestId: 'synthetic-afpe-integration' };
async function fixture(category: 'acute' | 'subacute' | 'chronic' = 'acute') {
  const patientUser = await prisma.user.create({ data: { role: 'patient', status: 'active', phoneNumber: '+2557' + randomInt(10000000, 99999999), fullName: 'Synthetic AFPE Patient' } });
  const patient = await prisma.patientProfile.create({ data: { userId: patientUser.id, fullName: 'Synthetic AFPE Patient' } });
  const doctorUser = await prisma.user.create({ data: { role: 'clinician', status: 'active', phoneNumber: '+2557' + randomInt(10000000, 99999999), fullName: 'Synthetic AFPE Clinician' } });
  const doctor = await prisma.clinicianProfile.create({ data: { userId: doctorUser.id, verificationStatus: 'verified', licenseNumber: 'SYN-' + randomUUID(), specialty: 'general_practice' } });
  const thread = await prisma.careThread.create({ data: { patientProfileId: patient.id } });
  const consultation = await prisma.consultationRequest.create({ data: { careThreadId: thread.id, patientProfileId: patient.id, assignedClinicianId: doctor.id, status: 'completed', channel: 'app', urgencyLevel: 'routine', triageRuleVersion: 'synthetic', slaDeadlineAt: new Date() } });
  await prisma.consultationNote.create({ data: { consultationId: consultation.id, careThreadId: thread.id, diagnosisText: 'Synthetic diagnosis', diagnosisCodes: ['I10'], adviceText: 'Synthetic existing clinician plan', signedByClinicianId: doctor.id, signedAt: new Date() } });
  const cycle = await prisma.followUpCycle.create({ data: { careThreadId: thread.id, patientProfileId: patient.id, sourceConsultationId: consultation.id, clinicianId: doctor.id, frequency: 'daily', startDate: new Date(), endDate: new Date(Date.now() + 14 * 86400000) } });
  const clinician = { sub: doctorUser.id, cpid: doctor.id, role: 'clinician' };
  const caller = { sub: patientUser.id, role: 'patient' };
  const input = { category, baseline: { symptom_severity: 0, medication_required: false, vitals: { temperature_c: 37 }, vital_bounds: { temperature_c: { min: 36, max: 38 } } }, diagnosis_codes: ['I10'], consent_confirmed: true as const };
  return { cycle, clinician, caller, input };
}
async function ready(category: 'acute' | 'subacute' | 'chronic' = 'acute') {
  const f = await fixture(category); await activate(f.cycle.id, f.clinician, f.input, meta);
  await afpeTick();
  const checkIn = await prisma.checkIn.findFirstOrThrow({ where: { followUpCycleId: f.cycle.id } });
  return { ...f, checkIn };
}
const answers = (severity = 0, temperature = 37) => ({ responses: { afpe: { symptom_severity: severity, vitals: { temperature_c: temperature } } } });
test('plan activation enforces ownership, signed diagnosis codes and immutable baseline', async () => {
  const f = await fixture();
  await assert.rejects(activate(f.cycle.id, f.caller, f.input, meta));
  await assert.rejects(activate(f.cycle.id, f.clinician, { ...f.input, diagnosis_codes: ['E11'] }, meta));
  await activate(f.cycle.id, f.clinician, f.input, meta);
  await assert.rejects(activate(f.cycle.id, f.clinician, f.input, meta));
  assert.equal(await prisma.afpePlan.count({ where: { cycleId: f.cycle.id } }), 1);
  await assert.rejects(report(f.cycle.id, { sub: randomUUID(), role: 'patient' }));
});
test('concurrent schedulers create one AFPE check-in per due plan', async () => {
  const f = await fixture(); await activate(f.cycle.id, f.clinician, f.input, meta);
  await Promise.all([afpeTick(), afpeTick()]);
  assert.equal(await prisma.checkIn.count({ where: { followUpCycleId: f.cycle.id } }), 1);
});
test('a confirmed response atomically stores score and source-linked clinical summary', async () => {
  const f = await ready(); const result = await respondToCheckIn(f.checkIn.id, f.caller, answers(), meta);
  assert.equal(result.afpe?.score, 100); assert.equal(result.afpe?.band, 'green');
  const rows = await prisma.afpeAssessment.findMany({ where: { checkInId: f.checkIn.id } });
  assert.equal(rows.length, 1); assert.equal((rows[0]!.clinicalSummary as { source: { check_in_id: string } }[])[0]!.source.check_in_id, f.checkIn.id);
  const patient = await report(f.cycle.id, f.caller);
  assert.equal('clinical_summary' in patient.assessments[0]!, false);
  assert.equal('sources' in patient.assessments[0]!, false);
});
test('concurrent replies cannot duplicate an assessment or escalation', async () => {
  const f = await ready(); const results = await Promise.allSettled([respondToCheckIn(f.checkIn.id, f.caller, answers(0, 40), meta), respondToCheckIn(f.checkIn.id, f.caller, answers(0, 40), meta)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(await prisma.afpeAssessment.count({ where: { checkInId: f.checkIn.id } }), 1);
  const plan = await prisma.afpePlan.findUniqueOrThrow({ where: { cycleId: f.cycle.id } });
  assert.equal(await prisma.afpeAlert.count({ where: { planId: plan.id } }), 1);
});
test('red flags are delivered to the assigned clinician alert feed and require scoped acknowledgement', async () => {
  const f = await ready(); await respondToCheckIn(f.checkIn.id, f.caller, answers(0, 40), meta);
  const alerts = await alertFeed(f.clinician); assert.equal(alerts.length, 1);
  await assert.rejects(acknowledge(alerts[0]!.id, f.caller, meta));
  await acknowledge(alerts[0]!.id, f.clinician, meta);
  assert.equal((await alertFeed(f.clinician)).length, 0);
});
test('caution shortens the next subacute interval without prescribing', async () => {
  const f = await ready('subacute'); const result = await respondToCheckIn(f.checkIn.id, f.caller, answers(8), meta);
  assert.equal(result.afpe?.band, 'yellow');
  assert.equal((await prisma.afpePlan.findUniqueOrThrow({ where: { cycleId: f.cycle.id } })).intervalDays, 3);
});
test('incomplete observations stay unscored and closed cycles reject new AFPE assessments', async () => {
  const f = await ready(); const result = await respondToCheckIn(f.checkIn.id, f.caller, { responses: { afpe: { symptom_severity: 2 } } }, meta);
  assert.equal(result.afpe?.score, null); assert.equal(result.afpe?.band, 'incomplete');
  const second = await ready(); await closeCycle(second.cycle.id, second.clinician, 'recovered', 'Synthetic explicit clinical outcome', meta);
  await assert.rejects(respondToCheckIn(second.checkIn.id, second.caller, answers(), meta));
});
test('two missed chronic check-ins raise an alert before the next monthly due date', async () => {
  const f = await fixture('chronic'); await activate(f.cycle.id, f.clinician, f.input, meta);
  await prisma.afpePlan.update({ where: { cycleId: f.cycle.id }, data: { nextDueAt: new Date(Date.now() + 30 * 86400000) } });
  for (const days of [60, 30]) await prisma.checkIn.create({ data: { followUpCycleId: f.cycle.id, careThreadId: f.cycle.careThreadId, status: 'missed', scheduledAt: new Date(Date.now() - days * 86400000), questions: [{ afpe: true }] } });
  await afpeTick();
  assert.equal((await alertFeed(f.clinician))[0]?.reason, 'two_missed_checkins');
});
test('fallback requires configured delivery, explicit patient consent and leased at-most-one submission per attempt', async () => {
  const f = await fixture(); await activate(f.cycle.id, f.clinician, f.input, meta);
  await assert.rejects(setFallback(f.cycle.id, f.clinician, 'none', meta));
  const priorUrl = env.AFPE_MESSAGING_URL, priorKey = env.AFPE_MESSAGING_KEY, priorFetch = globalThis.fetch;
  env.AFPE_MESSAGING_URL = 'https://synthetic-provider.test/messages'; env.AFPE_MESSAGING_KEY = 'synthetic-key-for-test-only';
  let requests = 0;
  globalThis.fetch = async (_url, init) => { requests++; const payload = JSON.parse(init!.body as string); assert.equal(payload.template, 'afpe_checkin_available'); assert.equal('diagnosis' in payload, false); return new Response('{}', { status: 200 }); };
  try {
    await setFallback(f.cycle.id, f.caller, 'whatsapp', meta); await afpeTick();
    await Promise.all([deliveryTick(), deliveryTick()]); assert.equal(requests, 1);
    const row = await prisma.afpeDelivery.findFirstOrThrow({ where: { plan: { cycleId: f.cycle.id } } }); assert.equal(row.status, 'accepted');
  } finally { env.AFPE_MESSAGING_URL = priorUrl; env.AFPE_MESSAGING_KEY = priorKey; globalThis.fetch = priorFetch; }
});

test('the mobile due query returns only owned active due check-ins, including late unanswered replies', async () => {
  const { listMyCheckIns } = await import('../services/checkin.service.js');
  const f = await ready();
  await prisma.checkIn.create({ data: { followUpCycleId: f.cycle.id, careThreadId: f.cycle.careThreadId, status: 'scheduled', scheduledAt: new Date(Date.now() + 86400000) } });
  const result = await listMyCheckIns(f.caller, { status: 'due', limit: 50 });
  assert.equal(result.data.length, 1); const first = result.data[0]; assert.ok(first && typeof first === 'object' && 'id' in first); assert.equal(first.id, f.checkIn.id);
  const other = await listMyCheckIns({ role: 'patient', sub: randomUUID() }, { status: 'due', limit: 50 });
  assert.equal(other.data.length, 0);
});
