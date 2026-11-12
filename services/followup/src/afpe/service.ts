import { afpeDuration, parseAfpeDiagnosisRules, resolveAfpeCategory } from '@a-health/config/afpe';
import { prisma, type Prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound } from '@a-health/http';
import { z } from 'zod';
import { env } from '../config/env.js';
import { activateSchema, observationSchema } from './types.js';
import { assess, cadence, escalation, patientReport, weeklyHistory, RULE_VERSION, type Baseline, type Category } from './engine.js';
import { evaluateRedFlags } from '../engine/red-flags.js';
import type { Caller, Meta } from '../services/checkin.service.js';

const asJson = (value: unknown) => value as Prisma.InputJsonValue;
async function access(id: string, caller: Caller, db: Prisma.TransactionClient = prisma, write = false) {
  const cycle = await db.followUpCycle.findUnique({ where: { id }, include: { patient: true, afpePlan: true } });
  if (!cycle) throw notFound('Follow-up cycle not found');
  if (caller.role === 'clinician' && caller.cpid === cycle.clinicianId) {
    const verified = await db.clinicianProfile.findFirst({ where: { id: caller.cpid, userId: caller.sub, verificationStatus: 'verified', user: { status: 'active' } } });
    if (verified) return cycle;
  }
  if (!write && caller.role === 'patient' && [cycle.patient.userId, cycle.patient.guardianUserId].includes(caller.sub)) return cycle;
  throw forbidden('NOT_RESOURCE_OWNER', 'Access to this follow-up plan is not permitted.');
}
export async function activate(id: string, caller: Caller, input: z.infer<typeof activateSchema>, meta: Meta) {
  if (env.NODE_ENV === 'production' && !env.AFPE_CLINICAL_POLICY_APPROVED) throw conflict('STATE_TRANSITION_INVALID', 'AFPE clinical policy approval is required before activation.');
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM follow_up_cycles WHERE id = ${id}::uuid FOR UPDATE`;
    const cycle = await access(id, caller, tx, true);
    if (cycle.status !== 'active') throw conflict('FOLLOW_UP_CYCLE_CLOSED', 'An active cycle is required.');
    if (await tx.afpePlan.findUnique({ where: { cycleId: id } })) throw conflict('STATE_TRANSITION_INVALID', 'This baseline is immutable; create a new follow-up cycle after clinical review.');
    const sourceConsultation = await tx.consultationRequest.findUnique({ where: { id: cycle.sourceConsultationId }, include: { note: true } });
    const note = sourceConsultation?.status === 'completed' ? sourceConsultation.note : null;
    if (!note || note.signedByClinicianId !== caller.cpid) throw forbidden('NOT_RESOURCE_OWNER', 'A signed source consultation is required.');
    const codes = Array.isArray(note.diagnosisCodes) ? note.diagnosisCodes : [];
    if (input.diagnosis_codes.some(code => !codes.includes(code))) throw conflict('STATE_TRANSITION_INVALID', 'Use ICD-10 codes recorded in the signed consultation.');
    let resolved;
    try { resolved = resolveAfpeCategory(input.diagnosis_codes, input.diagnosis_context, input.category, parseAfpeDiagnosisRules(env.AFPE_DIAGNOSIS_RULES_JSON)); } catch (error) { throw conflict('STATE_TRANSITION_INVALID', error instanceof Error ? error.message : 'Invalid diagnosis policy.'); }
    const policy = cadence(resolved.category), now = new Date();
    let duration; try { duration = afpeDuration(resolved.category, input.duration_days); } catch { throw conflict('STATE_TRANSITION_INVALID', 'Duration is outside the approved clinical category window.'); }
    const plan = await tx.afpePlan.create({ data: { cycleId: id, category: resolved.category, diagnosisRuleIds: resolved.rule_ids, baseline: asJson(input.baseline), diagnosisCodes: input.diagnosis_codes,
      durationDays: duration, intervalDays: policy.days, nextDueAt: now, consentConfirmedAt: now, ruleVersion: RULE_VERSION } });
    await tx.followUpCycle.update({ where: { id }, data: { endDate: new Date(now.getTime() + duration * 86400000), version: { increment: 1 } } });
    await appendAudit({ actorUserId: meta.integration ? null : caller.sub, action: 'afpe.plan_activated', entityType: 'afpe_plans', entityId: plan.id, metadata: { cycleId: id, source: meta.integration ?? 'clinician', assignedClinicianId: caller.cpid, category: resolved.category, ruleIds: resolved.rule_ids, ruleVersion: RULE_VERSION }, ipAddress: meta.ip, requestId: meta.requestId }, tx);
    return { id: plan.id, category: plan.category, interval_days: plan.intervalDays, next_due_at: plan.nextDueAt };
  });
}
/** Called inside the same cycle-locked transaction as the patient response. */
export async function recordAssessment(tx: Prisma.TransactionClient, cycleId: string, checkInId: string, responses: Record<string, unknown>, caller: Caller, meta: Meta) {
  if (env.NODE_ENV === 'production' && !env.AFPE_CLINICAL_POLICY_APPROVED) throw conflict('STATE_TRANSITION_INVALID', 'AFPE clinical policy approval is required before scoring.');
  const plan = await tx.afpePlan.findUnique({ where: { cycleId }, include: { cycle: true } });
  if (plan && plan.cycle.status !== 'active') throw conflict('FOLLOW_UP_CYCLE_CLOSED', 'This follow-up cycle is closed.');
  if (!plan) throw conflict('STATE_TRANSITION_INVALID', 'AFPE plan is unavailable; clinical review is required.');
  const parsed = observationSchema.parse(responses.afpe);
  const observation = { ...parsed, vitals: Object.fromEntries(Object.entries(parsed.vitals).filter((entry): entry is [string, number] => entry[1] !== undefined)) };
  const previous = await tx.afpeAssessment.findMany({ where: { planId: plan.id }, orderBy: { createdAt: 'desc' }, take: 2 });
  const now = new Date(), since = previous[0]?.createdAt ?? plan.createdAt;
  const doses = await tx.adherenceLog.findMany({ where: { patientProfileId: plan.cycle.patientProfileId, supersededAt: null, reminderPlan: { status: 'active' },
    scheduledAt: { gt: since, lte: now }, prescription: { careThreadId: plan.cycle.careThreadId, status: { not: 'discontinued' } } }, take: 5001 });
  if (doses.length > 5000) throw conflict('STATE_TRANSITION_INVALID', 'Clinical review is required for this reporting window.');
  const baseline = plan.baseline as unknown as Baseline;
  const redFlags = evaluateRedFlags({ ...responses, temperature_c: observation.vitals.temperature_c ?? responses.temperature_c });
  const result = assess(baseline, observation, doses, redFlags);
  const trendRows = plan.category === 'subacute' ? await tx.afpeAssessment.findMany({ where: { planId: plan.id }, orderBy: { createdAt: 'desc' }, take: 100, select: { score: true, createdAt: true } }) : previous;
  const reason = escalation(plan.category as Category, result.score, weeklyHistory(trendRows, now), redFlags);
  const band = reason ? 'red' : result.components.biometrics !== null && result.components.biometrics < 100 && result.band === 'green' ? 'yellow' : result.band;
  const source = { check_in_id: checkInId, response_path: `/check-ins/${checkInId}`, received_at: now.toISOString() };
  const summary = [
    { section: 'S', text: `Patient-reported symptom severity: ${observation.symptom_severity}/10; baseline: ${baseline.symptom_severity}/10.`, source },
    { section: 'O', text: `${result.reported_doses}/${result.expected_doses} doses confirmed; ${doses.filter(d => d.reportedStatus === 'missed').length} explicitly skipped. Side effects: ${observation.side_effects || 'not reported'}.`, source, dose_ids: doses.map(d => d.id) },
    { section: 'A/P', text: `AFPE research score: ${result.score ?? 'incomplete'}; ${band}. ${reason ? 'Clinician review required: ' + reason : 'Continue the clinician-authored care plan.'}`, source },
  ];
  const assessment = await tx.afpeAssessment.create({ data: { planId: plan.id, checkInId, score: result.score, band,
    components: asJson(result.components), missing: result.missing, sources: asJson({ response: source, external_channel: meta.externalChannel ?? null, dose_ids: doses.map(d => d.id), baseline: plan.baseline, diagnosis_rule_ids: plan.diagnosisRuleIds, dose_reports: doses.map(d => ({ id: d.id, scheduled_at: d.scheduledAt.toISOString(), reported_at: d.reportedAt?.toISOString() ?? null, status: d.reportedStatus })) }),
    clinicalSummary: asJson(summary), patientReport: asJson(patientReport(band)), ruleVersion: RULE_VERSION } });
  if (reason || band === 'yellow') await tx.afpeAlert.create({ data: { planId: plan.id, dedupeKey: `assessment:${assessment.id}`, reason: reason ?? 'caution_score' } });
  const normal = cadence(plan.category as Category).days;
  await tx.afpePlan.update({ where: { id: plan.id }, data: { intervalDays: band === 'yellow' ? Math.max(1, Math.floor(normal / 2)) : normal,
    nextDueAt: new Date(now.getTime() + (band === 'yellow' ? Math.max(1, Math.floor(normal / 2)) : normal) * 86400000) } });
  await appendAudit({ actorUserId: caller.sub, action: 'afpe.assessment_recorded', entityType: 'afpe_assessments', entityId: assessment.id,
    metadata: { checkInId, ruleVersion: RULE_VERSION, alert: Boolean(reason) }, ipAddress: meta.ip, requestId: meta.requestId }, tx);
  return { id: assessment.id, score: result.score, band, components: result.components, missing: result.missing, patient_report: patientReport(band), urgent_care_required: Boolean(reason), rule_version: RULE_VERSION };
}
export async function report(id: string, caller: Caller) {
  const cycle = await access(id, caller);
  if (!cycle.afpePlan) return { plan: null, assessments: [], alerts: [] };
  const clinician = caller.role === 'clinician';
  const [assessments, alerts, recentDoses] = await Promise.all([
    prisma.afpeAssessment.findMany({ where: { planId: cycle.afpePlan.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    clinician ? prisma.afpeAlert.findMany({ where: { planId: cycle.afpePlan.id, acknowledgedAt: null }, orderBy: { createdAt: 'desc' }, take: 100 }) : [],
    prisma.adherenceLog.findMany({ where: { patientProfileId: cycle.patientProfileId, supersededAt: null, scheduledAt: { lte: new Date() }, prescription: { careThreadId: cycle.careThreadId, status: { not: 'discontinued' } } }, orderBy: { scheduledAt: 'desc' }, take: 100, select: { reportedStatus: true } }),
  ]);
  let streak = 0; for (const dose of recentDoses) { if (dose.reportedStatus !== 'taken') break; streak++; }
  return { messaging_available: Boolean(env.AFPE_MESSAGING_URL && env.AFPE_MESSAGING_KEY), adherence_streak: streak, plan: { id: cycle.afpePlan.id, category: cycle.afpePlan.category, duration_days: cycle.afpePlan.durationDays, baseline: cycle.afpePlan.baseline, interval_days: cycle.afpePlan.intervalDays, next_due_at: cycle.afpePlan.nextDueAt, rule_version: cycle.afpePlan.ruleVersion, fallback_channel: cycle.afpePlan.fallbackChannel ?? 'none' },
    assessments: assessments.map(a => ({ id: a.id, check_in_id: a.checkInId, score: a.score, band: a.band, components: a.components, missing: a.missing, patient_report: a.patientReport,
      created_at: a.createdAt, ...(clinician ? { clinical_summary: a.clinicalSummary, sources: a.sources } : {}) })),
    alerts: alerts.map(a => ({ id: a.id, reason: a.reason, created_at: a.createdAt })) };
}
export async function acknowledge(id: string, caller: Caller, meta: Meta) {
  return prisma.$transaction(async tx => {
    const alert = await tx.afpeAlert.findUnique({ where: { id }, include: { plan: true } });
    if (!alert) throw notFound('Alert not found');
    await access(alert.plan.cycleId, caller, tx, true);
    await tx.afpeAlert.updateMany({ where: { id, acknowledgedAt: null }, data: { acknowledgedAt: new Date(), acknowledgedBy: caller.sub } });
    await appendAudit({ actorUserId: caller.sub, action: 'afpe.alert_acknowledged', entityType: 'afpe_alerts', entityId: id, ipAddress: meta.ip, requestId: meta.requestId }, tx);
    return { id, acknowledged: true };
  });
}
export async function alertFeed(caller: Caller) {
  if (caller.role !== 'clinician' || !caller.cpid) throw forbidden('ROLE_NOT_PERMITTED', 'Clinician account required.');
  const clinician = await prisma.clinicianProfile.findFirst({ where: { id: caller.cpid, userId: caller.sub, verificationStatus: 'verified', user: { status: 'active' } } });
  if (!clinician) throw forbidden('CLINICIAN_NOT_VERIFIED', 'Verified active clinician required.');
  const rows = await prisma.afpeAlert.findMany({ where: { acknowledgedAt: null, plan: { cycle: { clinicianId: caller.cpid } } }, orderBy: { createdAt: 'desc' }, take: 100, include: { plan: { select: { cycleId: true } } } });
  return rows.map(a => ({ id: a.id, cycle_id: a.plan.cycleId, reason: a.reason, created_at: a.createdAt }));
}

export async function setFallback(id: string, caller: Caller, channel: 'none' | 'sms' | 'whatsapp', meta: Meta) {
  if (channel !== 'none' && (!env.AFPE_MESSAGING_URL || !env.AFPE_MESSAGING_KEY)) throw conflict('STATE_TRANSITION_INVALID', 'Messaging provider is not configured. In-app follow-up remains available.');
  return prisma.$transaction(async tx => {
    const cycle = await access(id, caller, tx);
    if (caller.role !== 'patient' || !cycle.afpePlan) throw forbidden('ROLE_NOT_PERMITTED', 'Patient account and an AFPE plan are required.');
    await tx.$queryRaw`SELECT id FROM follow_up_cycles WHERE id = ${id}::uuid FOR UPDATE`;
    await tx.afpePlan.update({ where: { id: cycle.afpePlan.id }, data: { fallbackChannel: channel === 'none' ? null : channel, fallbackUserId: channel === 'none' ? null : caller.sub, fallbackConsentAt: channel === 'none' ? null : new Date() } });
    await tx.afpeDelivery.updateMany({ where: { planId: cycle.afpePlan.id, status: 'queued' }, data: { status: 'suppressed' } });
    await appendAudit({ actorUserId: caller.sub, action: 'afpe.fallback_preference_changed', entityType: 'afpe_plans', entityId: cycle.afpePlan.id, metadata: { channel }, ipAddress: meta.ip, requestId: meta.requestId }, tx);
    return { fallback_channel: channel };
  });
}
