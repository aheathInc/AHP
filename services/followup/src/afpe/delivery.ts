import { randomUUID } from 'node:crypto';
import { prisma } from '@a-health/database';
import { env } from '../config/env.js';
/** Leased outbox; provider acceptance is not handset delivery. Provider must honor Idempotency-Key. */
export async function deliveryTick(now = new Date()) {
  if (!env.AFPE_MESSAGING_URL || !env.AFPE_MESSAGING_KEY) return { accepted: 0, configured: false };
  const rows = await prisma.afpeDelivery.findMany({ where: { status: 'queued', nextAttemptAt: { lte: now }, OR: [{ claimUntil: null }, { claimUntil: { lt: now } }] }, orderBy: { createdAt: 'asc' }, take: 50 });
  let accepted = 0;
  for (const row of rows) {
    const token = randomUUID();
    const claimed = await prisma.afpeDelivery.updateMany({ where: { id: row.id, status: 'queued', OR: [{ claimUntil: null }, { claimUntil: { lt: now } }] }, data: { claimToken: token, claimUntil: new Date(now.getTime() + 60000), attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    const current = await prisma.afpeDelivery.findUniqueOrThrow({ where: { id: row.id }, include: { checkIn: true, plan: { include: { cycle: { include: { patient: true } } } } } });
    const user = await prisma.user.findUnique({ where: { id: current.recipientUserId }, select: { phoneNumber: true, status: true } });
    const cycle = current.plan.cycle;
    const eligible = current.status === 'queued' && current.plan.fallbackConsentAt && current.plan.fallbackChannel === current.channel && current.plan.fallbackUserId === current.recipientUserId &&
      [cycle.patient.userId, cycle.patient.guardianUserId].includes(current.recipientUserId) && cycle.status === 'active' && current.checkIn.status === 'scheduled' &&
      now.getTime() - current.checkIn.scheduledAt.getTime() < 24 * 3600000 && user?.status === 'active' && user.phoneNumber;
    if (!eligible) { await prisma.afpeDelivery.updateMany({ where: { id: row.id, claimToken: token, status: 'queued' }, data: { status: 'suppressed', claimUntil: null, claimToken: null } }); continue; }
    try {
      const response = await fetch(env.AFPE_MESSAGING_URL, { method: 'POST', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${env.AFPE_MESSAGING_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': row.id },
        body: JSON.stringify({ channel: row.channel, to: user.phoneNumber, template: 'afpe_checkin_available', reference: row.checkInId, text: 'A-Health: Your care team has a follow-up check-in for you. Open A-Health or reply through this service.' }) });
      if (!response.ok) throw new Error('PROVIDER_NOT_ACCEPTED');
      await prisma.afpeDelivery.updateMany({ where: { id: row.id, claimToken: token, status: 'queued' }, data: { status: 'accepted', claimUntil: null, claimToken: null } }); accepted++;
    } catch {
      await prisma.afpeDelivery.updateMany({ where: { id: row.id, claimToken: token, status: 'queued' }, data: { status: current.attempts >= 5 ? 'failed' : 'queued', nextAttemptAt: new Date(now.getTime() + Math.min(3600, 30 * 2 ** current.attempts) * 1000), claimUntil: null, claimToken: null } });
    }
  }
  return { accepted, configured: true };
}
