import { afpeDuration, parseAfpeDiagnosisRules, resolveAfpeCategory } from '@a-health/config/afpe';
import { isDeepStrictEqual } from 'node:util';
import { validSignature } from './signature.js';
import { converse } from './conversation.js';
import { respondToCheckIn } from '../services/checkin.service.js';
import { respondSchema } from '../types/followup.types.js';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@a-health/database';
import { forbidden, notFound } from '@a-health/http';
import { env } from '../config/env.js';
import { activateSchema } from './types.js';
import { activate } from './service.js';
export const rawBodies = new WeakMap<object, Buffer>();
export const afpeWebhookRouter = Router();
const payloadSchema = z.object({ cycle_id: z.string().uuid(), configuration: activateSchema });
afpeWebhookRouter.post('/integrations/gothomis/discharge', async (req, res, next) => {
  try {
    const timestamp = req.header('X-AFPE-Timestamp') ?? '', signature = req.header('X-AFPE-Signature') ?? '', raw = rawBodies.get(req);
    if (!validSignature(env.GOTHOMIS_WEBHOOK_SECRET, timestamp, signature, raw)) throw forbidden('NOT_RESOURCE_OWNER', 'Invalid webhook authentication.');
    const input = payloadSchema.parse(req.body);
    const resolved = resolveAfpeCategory(input.configuration.diagnosis_codes, input.configuration.diagnosis_context, input.configuration.category, parseAfpeDiagnosisRules(env.AFPE_DIAGNOSIS_RULES_JSON));
    const cycle = await prisma.followUpCycle.findUnique({ where: { id: input.cycle_id }, include: { clinician: true, afpePlan: true } });
    if (!cycle) throw notFound('Mapped follow-up cycle not found');
    // Exact replay is harmless; a changed baseline cannot replace the signed setup.
    if (cycle.afpePlan && cycle.afpePlan.category === resolved.category && cycle.afpePlan.durationDays === afpeDuration(resolved.category, input.configuration.duration_days) && isDeepStrictEqual(cycle.afpePlan.diagnosisRuleIds, resolved.rule_ids) && isDeepStrictEqual(cycle.afpePlan.baseline, input.configuration.baseline) && isDeepStrictEqual([...(cycle.afpePlan.diagnosisCodes as string[])].sort(), [...input.configuration.diagnosis_codes].sort())) {
      res.setHeader('Cache-Control', 'no-store'); res.json({ id: cycle.afpePlan.id, duplicate: true }); return;
    }
    const result = await activate(cycle.id, { sub: cycle.clinician.userId, cpid: cycle.clinicianId, role: 'clinician' }, input.configuration, { ip: req.ip, requestId: res.locals.requestId, integration: 'gothomis' });
    res.setHeader('Cache-Control', 'no-store'); res.json(result);
  } catch (error) { next(error); }
});

const inboundSchema = z.object({ message_id: z.string().min(1).max(160), check_in_id: z.string().uuid(), channel: z.enum(['sms', 'whatsapp']), sender: z.string().regex(/^\+[1-9][0-9]{7,14}$/), text: z.string().trim().max(2000).default(''), language: z.enum(['en', 'sw']).default('sw'), answers: respondSchema.optional() });
afpeWebhookRouter.post('/integrations/afpe/messages', async (req, res, next) => {
  try {
    if (!validSignature(env.AFPE_MESSAGING_WEBHOOK_SECRET, req.header('X-AFPE-Timestamp') ?? '', req.header('X-AFPE-Signature') ?? '', rawBodies.get(req))) throw forbidden('NOT_RESOURCE_OWNER', 'Invalid webhook authentication.');
    const input = inboundSchema.parse(req.body);
    const checkIn = await prisma.checkIn.findUnique({ where: { id: input.check_in_id }, include: { followUpCycle: { include: { afpePlan: true, patient: true } } } });
    if (!checkIn?.followUpCycle.afpePlan) throw notFound('Check-in not found');
    const plan = checkIn.followUpCycle.afpePlan, patient = checkIn.followUpCycle.patient;
    if (!plan.fallbackUserId || !plan.fallbackConsentAt || plan.fallbackChannel !== input.channel || ![patient.userId, patient.guardianUserId].includes(plan.fallbackUserId)) throw forbidden('NOT_RESOURCE_OWNER', 'Messaging consent is required.');
    const user = await prisma.user.findUnique({ where: { id: plan.fallbackUserId } });
    if (!user || user.status !== 'active' || user.phoneNumber !== input.sender) throw forbidden('NOT_RESOURCE_OWNER', 'Sender does not match the consented patient or guardian.');
    const caller = { sub: user.id, role: 'patient' };
    const result = input.answers
      ? await respondToCheckIn(checkIn.id, caller, { ...input.answers, channel: input.channel === 'sms' ? 'sms' : 'app' }, { ip: req.ip, requestId: res.locals.requestId, externalChannel: input.channel })
      : await converse(checkIn.id, caller, { text: input.text, language: input.language }, `${input.channel}:${input.message_id}`);
    res.setHeader('Cache-Control', 'no-store'); res.json(result);
  } catch (error) { next(error); }
});
