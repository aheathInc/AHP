/**
 * Deterministic AFPE safety override for structured patient check-ins.
 * These rules only raise an urgent flag; they never diagnose or change care.
 */
const RED_FLAG_FIELDS = [
  'chest_pain',
  'severe_bleeding',
  'difficulty_breathing',
] as const;

export function evaluateRedFlags(responses: Record<string, unknown>): string[] {
  const flags: string[] = [];

  for (const field of RED_FLAG_FIELDS) {
    if (responses[field] === true) flags.push(`red_flag:${field}`);
  }

  const afpe = responses.afpe && typeof responses.afpe === 'object' ? responses.afpe as { vitals?: { temperature_c?: unknown }; side_effects?: unknown } : undefined;
  const temperature = afpe?.vitals?.temperature_c ?? responses.temperature_c;
  if (typeof temperature === 'number' && Number.isFinite(temperature) && temperature > 39) {
    flags.push('red_flag:temperature_over_39_c');
  }

  // Conservative text matching intentionally prioritizes review over a missed alert.
  // Negated or historical mentions can still flag; this is screening, not diagnosis.
  const text = Object.values({ ...responses, afpe_side_effects: afpe?.side_effects }).filter((v): v is string => typeof v === 'string').join(' ').toLowerCase();
  const phrases = {
    chest_pain: ['chest pain', 'maumivu ya kifua'],
    severe_bleeding: ['severe bleeding', 'heavy bleeding', 'bleeding heavily', 'kutokwa damu nyingi', 'damu nyingi'],
    difficulty_breathing: ['difficulty breathing', 'cannot breathe', "can't breathe", 'shortness of breath', 'shida ya kupumua', 'kupumua kwa shida'],
  };
  for (const [key, terms] of Object.entries(phrases)) {
    if (terms.some(term => text.includes(term)) && !flags.includes(`red_flag:${key}`)) flags.push(`red_flag:${key}`);
  }
  return flags;
}

export function hasRedFlag(reasons: unknown): boolean {
  return Array.isArray(reasons) && reasons.some(
    (reason) => typeof reason === 'string' && reason.startsWith('red_flag:'),
  );
}

export function requiresUrgentReview(reasons: unknown): boolean {
  return hasRedFlag(reasons) || (Array.isArray(reasons) && reasons.includes('afpe:red'));
}
