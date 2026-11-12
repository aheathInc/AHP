/**
 * Compute a numeric flag using the bounds supplied for this authorized report.
 * Reference intervals and critical bounds are independent; critical wins.
 * No clinical thresholds, population intervals or qualitative interpretation
 * are inferred here. The legacy internal fallback is `normal`; the public
 * report serializer exposes non-finite/qualitative or unbounded findings as
 * `not_assessed`, so that fallback is never presented as a normal finding.
 */

export type ResultFlag = 'normal' | 'low' | 'high' | 'critical_low' | 'critical_high';

export interface FlagInput {
  value: string;
  referenceLow?: number;
  referenceHigh?: number;
  criticalLow?: number;
  criticalHigh?: number;
}

export function computeFlag(input: FlagInput): ResultFlag {
  const numeric = Number(input.value);
  if (!Number.isFinite(numeric)) return 'normal';

  if (input.criticalLow !== undefined && numeric <= input.criticalLow) return 'critical_low';
  if (input.criticalHigh !== undefined && numeric >= input.criticalHigh) return 'critical_high';
  if (input.referenceLow !== undefined && numeric < input.referenceLow) return 'low';
  if (input.referenceHigh !== undefined && numeric > input.referenceHigh) return 'high';
  return 'normal';
}

export function isCriticalFlag(flag: ResultFlag): boolean {
  return flag === 'critical_low' || flag === 'critical_high';
}
