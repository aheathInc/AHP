import { prisma, type Prisma } from '@a-health/database';
import { appendAudit } from '@a-health/http';

export interface EmergencyContext {
  allergies: string[];
  chronicConditions: string[];
  bloodType: string | null;
  breakGlass: boolean;
}

/** Evaluates minimum emergency-context access. Standing consent is scoped;
 * access without a grant requires an operator's explicit, audited justification.
 * Returning an object is not confirmation that a hospital received a handover.
 */
export async function resolveEmergencyContext(
  patientProfileId: string,
  emergencyId: string,
  actorUserId: string | undefined,
  options: { transaction?: Prisma.TransactionClient; breakGlassReason?: string } = {},
): Promise<EmergencyContext | null> {
  const db = options.transaction ?? prisma;

  const grant = await db.patientConsent.findFirst({
    where: {
      patientProfileId,
      granteeType: 'emergency_responder',
      allowed: true,
      scope: { in: ['emergency_minimum','full_history'] },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });

  const breakGlass = !grant;
  if (breakGlass && (!options.breakGlassReason || options.breakGlassReason.trim().length < 10)) return null;
  const patient = await db.patientProfile.findUnique({ where: { id: patientProfileId }, select: { allergies:true, chronicConditions:true,bloodType:true } });
  if (!patient) return null;

  if (breakGlass) {
    await appendAudit({
      actorUserId: actorUserId ?? null,
      action: 'emergency.context_break_glass_access',
      entityType: 'patient_profiles',
      entityId: patientProfileId,
      reason: options.breakGlassReason,
      metadata: { emergencyRequestId: emergencyId },
    }, options.transaction);
  }

  if (!breakGlass) await appendAudit({ actorUserId: actorUserId ?? null, action:'emergency.context_consent_access', entityType:'patient_profiles', entityId:patientProfileId, metadata:{emergencyRequestId:emergencyId} }, options.transaction);

  return {
    allergies: Array.isArray(patient.allergies) ? (patient.allergies as string[]) : [],
    chronicConditions: Array.isArray(patient.chronicConditions) ? (patient.chronicConditions as string[]) : [],
    bloodType: patient.bloodType,
    breakGlass,
  };
}
