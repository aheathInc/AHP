export interface OperationsOverview {
  generated_at: string;
  scope: "platform";
  environment: "production" | "development";
  counts: {
    open_emergencies: number;
    unacknowledged_emergencies: number;
    pending_verifications: number;
    open_incidents: number;
    escalated_incidents: number;
    facilities: number;
    active_devices: number;
    failed_payments_24h: number;
  };
  oldest: {
    unacknowledged_emergency_at: string | null;
    pending_verification_at: string | null;
    escalated_incident_at: string | null;
  };
}
export const adminNumber = (value: number) =>
  new Intl.NumberFormat("en-GB").format(value);
export function adminLabel(value: string) {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
export function waitingSince(iso: string | null, generatedAt: string) {
  if (!iso) return "No waiting records";
  const elapsed = Math.max(
    0,
    new Date(generatedAt).getTime() - new Date(iso).getTime(),
  );
  if (!Number.isFinite(elapsed)) return "Time not available";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Less than a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  return `${adminNumber(days)} ${days === 1 ? "day" : "days"}`;
}

/** A consistent, explicit operations timezone regardless of the server's locale. */
export function adminDateTime(iso: string | null | undefined) {
  if (!iso) return 'Not recorded';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return 'Time not available';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Dar_es_Salaam', year: 'numeric', month: 'short',
    day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  }).format(date);
}
