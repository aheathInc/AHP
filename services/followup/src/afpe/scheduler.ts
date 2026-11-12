import { env } from '../config/env.js';
import { prisma } from '@a-health/database';

/** Cycle locks serialize scheduling against responses and explicit cycle closure. */
export async function afpeTick(now = new Date()) {
  if (env.NODE_ENV === 'production' && !env.AFPE_CLINICAL_POLICY_APPROVED) return { created: 0 };
  const plans = await prisma.afpePlan.findMany({ where: { nextDueAt: { lte: now }, cycle: { status: 'active' }, OR: [{ category: 'chronic' }, { cycle: { endDate: { gte: now } } }] }, take: 100, orderBy: [{ nextDueAt: 'asc' }, { id: 'asc' }] });
  let created = 0;
  for (const candidate of plans) {
    created += await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM follow_up_cycles WHERE id = ${candidate.cycleId}::uuid FOR UPDATE`;
      const plan = await tx.afpePlan.findUniqueOrThrow({ where: { id: candidate.id }, include: { cycle: true } });
      if (plan.nextDueAt > now || plan.cycle.status !== 'active' || (plan.category !== 'chronic' && plan.cycle.endDate < now)) return 0;
      const pending = await tx.checkIn.findFirst({ where: { followUpCycleId: plan.cycleId, status: 'scheduled', questions: { array_contains: [{ afpe: true }] } } });
      if (pending) return 0;
      const baseline = plan.baseline as { vital_bounds: Record<string, unknown> };
      const checkIn = await tx.checkIn.create({ data: { followUpCycleId: plan.cycleId, careThreadId: plan.cycle.careThreadId, scheduledAt: now,
        questions: [{ afpe: true, key: 'afpe_structured_v1', vital_keys: Object.keys(baseline.vital_bounds) }] } });
      if (plan.fallbackChannel && plan.fallbackUserId && plan.fallbackConsentAt) await tx.afpeDelivery.create({ data: { planId: plan.id, checkInId: checkIn.id, channel: plan.fallbackChannel, recipientUserId: plan.fallbackUserId } });
      await tx.afpePlan.update({ where: { id: plan.id }, data: { nextDueAt: new Date(now.getTime() + plan.intervalDays * 86400000) } });
      if (plan.category === 'chronic' && plan.cycle.endDate.getTime() < now.getTime() + 60 * 86400000) await tx.followUpCycle.update({ where: { id: plan.cycleId }, data: { endDate: new Date(now.getTime() + 365 * 86400000) } });
      return 1;
    });
  }
  await missedCheckInTick();
  return { created };
}

let missedCursor: string | undefined;
async function missedCheckInTick() {
  const plans = await prisma.afpePlan.findMany({ where: { category: 'chronic', cycle: { status: 'active' } }, take: 100, orderBy: { id: 'asc' }, ...(missedCursor ? { cursor: { id: missedCursor }, skip: 1 } : {}) });
  missedCursor = plans.length === 100 ? plans.at(-1)!.id : undefined;
  for (const plan of plans) {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM follow_up_cycles WHERE id = ${plan.cycleId}::uuid FOR UPDATE`;
      const cycle = await tx.followUpCycle.findUniqueOrThrow({ where: { id: plan.cycleId } });
      if (cycle.status !== 'active') return;
      const recent = await tx.checkIn.findMany({ where: { followUpCycleId: plan.cycleId, createdAt: { gte: plan.createdAt }, questions: { array_contains: [{ afpe: true }] }, status: { not: 'scheduled' } }, orderBy: { scheduledAt: 'desc' }, take: 2 });
      if (recent.length === 2 && recent.every(c => c.status === 'missed')) {
        const dedupeKey = `missed:${recent[0]!.id}:${recent[1]!.id}`;
        await tx.afpeAlert.upsert({ where: { dedupeKey }, create: { planId: plan.id, dedupeKey, reason: 'two_missed_checkins' }, update: {} });
      }
    });
  }
}
