import { prisma } from "@a-health/database";
import { forbidden } from "@a-health/http";

/** Operational totals only; patient identities and clinical text never leave this endpoint. */
export async function getOperationsOverview(role: string, now = new Date()) {
  if (role !== "platform_admin")
    throw forbidden(
      "ROLE_NOT_PERMITTED",
      "Platform administrator access is required.",
    );
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const openEmergency = {
    status: {
      notIn: ["resolved", "cancelled"] as ("resolved" | "cancelled")[],
    },
  };
  const [
    openEmergencies,
    unacknowledgedEmergencies,
    pendingVerifications,
    openIncidents,
    escalatedIncidents,
    facilities,
    activeDevices,
    failedPayments,
    oldestEmergency,
    oldestVerification,
    oldestIncident,
  ] = await prisma.$transaction(
    [
      prisma.emergencyRequest.count({ where: openEmergency }),
      prisma.emergencyRequest.count({
        where: { ...openEmergency, acknowledgedAt: null },
      }),
      prisma.clinicianProfile.count({
        where: { verificationStatus: "pending" },
      }),
      prisma.incidentReport.count({ where: { status: { not: "closed" } } }),
      prisma.incidentReport.count({
        where: { status: { not: "closed" }, escalatedToGovernance: true },
      }),
      prisma.facility.count(),
      prisma.device.count({ where: { status: "active" } }),
      prisma.paymentIntent.count({
        where: { status: "failed", createdAt: { gte: since, lte: now } },
      }),
      prisma.emergencyRequest.findFirst({
        where: { ...openEmergency, acknowledgedAt: null },
        orderBy: { reportedAt: "asc" },
        select: { reportedAt: true },
      }),
      prisma.clinicianProfile.findFirst({
        where: { verificationStatus: "pending" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      prisma.incidentReport.findFirst({
        where: { status: { not: "closed" }, escalatedToGovernance: true },
        orderBy: { reportedAt: "asc" },
        select: { reportedAt: true },
      }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  return {
    generated_at: now.toISOString(),
    scope: "platform" as const,
    environment:
      process.env.NODE_ENV === "production"
        ? ("production" as const)
        : ("development" as const),
    counts: {
      open_emergencies: openEmergencies,
      unacknowledged_emergencies: unacknowledgedEmergencies,
      pending_verifications: pendingVerifications,
      open_incidents: openIncidents,
      escalated_incidents: escalatedIncidents,
      facilities,
      active_devices: activeDevices,
      failed_payments_24h: failedPayments,
    },
    oldest: {
      unacknowledged_emergency_at:
        oldestEmergency?.reportedAt.toISOString() ?? null,
      pending_verification_at:
        oldestVerification?.createdAt.toISOString() ?? null,
      escalated_incident_at: oldestIncident?.reportedAt.toISOString() ?? null,
    },
  };
}
