import { AFPE_CADENCE } from '@a-health/config/afpe';
/** AFPE specification policy v1. Research score; requires clinical validation before clinical use. */
export const RULE_VERSION = 'afpe-srs-v1';
export type Category = 'acute' | 'subacute' | 'chronic';
export interface Baseline {
  symptom_severity: number;
  vitals: Record<string, number>;
  medication_required: boolean;
  vital_bounds: Record<string, { min: number; max: number }>;
}
export interface Observation {
  symptom_severity?: number;
  side_effects?: string;
  vitals?: Record<string, number>;
}
export interface Dose { id: string; reportedStatus: string; scheduledAt: Date; reportedAt: Date | null }
export function cadence(category: Category) {
  return AFPE_CADENCE[category];
}
export function assess(baseline: Baseline, observation: Observation, doses: Dose[], redFlags: string[]) {
  const missing: string[] = [];
  let adherence: number | null = baseline.medication_required ? null : 100;
  const reported = doses.filter(d => d.reportedStatus !== 'unreported');
  if (baseline.medication_required) {
    // Missing confirmations are unknown, never counted as skipped or taken.
    if (!doses.length || reported.length !== doses.length) missing.push('medication_adherence');
    else adherence = Math.round(100 * doses.filter(d => d.reportedStatus === 'taken').length / doses.length);
  }
  const severity = observation.symptom_severity;
  // No worsening scores 100; each point above the discharge baseline costs 10.
  const symptoms = severity === undefined ? null : Math.max(0, 100 - Math.max(0, severity - baseline.symptom_severity) * 10);
  if (symptoms === null) missing.push('symptom_severity');
  const entries = Object.entries(baseline.vital_bounds);
  const measured = entries.filter(([key]) => Number.isFinite(observation.vitals?.[key]));
  if (!entries.length || measured.length !== entries.length) missing.push('vitals');
  const biometrics = !entries.length || measured.length !== entries.length ? null : Math.round(100 * measured.filter(([key, b]) => observation.vitals![key]! >= b.min && observation.vitals![key]! <= b.max).length / entries.length);
  const raw = adherence === null || symptoms === null || biometrics === null ? null : Math.round(adherence * .4 + symptoms * .4 + biometrics * .2);
  const score = raw === null ? null : redFlags.length ? Math.min(raw, 59) : raw;
  return { score, band: redFlags.length ? 'red' : score === null ? 'incomplete' : score >= 80 ? 'green' : score >= 60 ? 'yellow' : 'red',
    components: { adherence, symptoms, biometrics }, missing, reported_doses: reported.length, expected_doses: doses.length };
}
export function escalation(category: Category, current: number | null, previous: number[], redFlags: string[]) {
  if (redFlags.length) return 'red_flag';
  if (current === null) return null;
  if (current < 60) return 'score_below_60';
  if (category === 'chronic' && current < 70) return 'chronic_score_below_70';
  if (category === 'subacute' && previous.length >= 2 && previous[1]! - previous[0]! > 10 && previous[0]! - current > 10) return 'consecutive_score_decline';
  return null;
}
export function patientReport(band: string) {
  const messages: Record<string, { en: string; sw: string }> = {
    red: { en: 'Your answers need urgent clinical review. Seek urgent medical care; do not wait for another check-in.', sw: 'Majibu yako yanahitaji mapitio ya haraka ya kliniki. Tafuta huduma ya haraka; usisubiri ujumbe mwingine.' },
    yellow: { en: 'Some answers need attention. Continue your prescribed treatment and contact your care team about symptoms or side effects.', sw: 'Baadhi ya majibu yanahitaji kuangaliwa. Endelea na matibabu uliyoandikiwa na wasiliana na timu yako kuhusu dalili au madhara.' },
    green: { en: 'Your reported measures are within this follow-up plan. Keep following your clinician’s instructions and report any new symptoms.', sw: 'Vipimo ulivyoripoti viko ndani ya mpango huu wa ufuatiliaji. Endelea kufuata maelekezo ya daktari na ripoti dalili mpya.' },
    incomplete: { en: 'There is not enough information to calculate your score. Complete the requested measures; seek care if you feel worse.', sw: 'Taarifa hazitoshi kuhesabu alama yako. Kamilisha vipimo vilivyoombwa; tafuta huduma ikiwa hali inazidi kuwa mbaya.' },
  };
  return messages[band]!;
}

/** Select two prior observations separated by at least a week, despite adaptive short-interval check-ins. */
export function weeklyHistory(rows: { score: number | null; createdAt: Date }[], now: Date): number[] {
  const values: number[] = []; let anchor = now.getTime();
  for (const row of rows) {
    if (row.score !== null && row.createdAt.getTime() <= anchor - 7 * 86400000) {
      values.push(row.score); anchor = row.createdAt.getTime(); if (values.length === 2) break;
    }
  }
  return values;
}
