/** Shared AFPE scheduling policy. ICD mappings are supplied and approved by the deploying clinical team. */
export type AfpeCategory = 'acute' | 'subacute' | 'chronic';
export const AFPE_CADENCE = { acute: { days: 1, duration: 14 }, subacute: { days: 7, duration: 90 }, chronic: { days: 30, duration: 365 } } as const;
export interface AfpeDiagnosisRule { id: string; code_prefix: string; context: string; category: AfpeCategory; approved_by: string; approved_at: string }
export function parseAfpeDiagnosisRules(raw: string | undefined): AfpeDiagnosisRule[] {
  const rules: unknown = JSON.parse(raw ?? '[]');
  if (!Array.isArray(rules) || rules.length > 500) throw new Error('AFPE diagnosis rules must be a bounded approved list.');
  const ids = new Set<string>();
  for (const r of rules) {
    if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id) || typeof r.code_prefix !== 'string' || !/^[A-Z][0-9]{2}(\.[A-Z0-9]{1,4})?$/.test(r.code_prefix) ||
      !['acute', 'subacute', 'chronic'].includes(r.category) || !['new', 'stable', 'uncontrolled', 'high_risk', 'postoperative', 'treatment_initiation'].includes(r.context) ||
      typeof r.approved_by !== 'string' || !r.approved_by.trim() || typeof r.approved_at !== 'string' || !Number.isFinite(Date.parse(r.approved_at))) throw new Error('Invalid or unapproved AFPE diagnosis rule.');
    ids.add(r.id);
  }
  return rules;
}
export function resolveAfpeCategory(codes: string[], context: string | undefined, requested: AfpeCategory | 'auto', rules: AfpeDiagnosisRule[]) {
  if (requested !== 'auto') return { category: requested, rule_ids: [] as string[] };
  const matches = rules.filter(r => r.context === context && codes.some(code => code === r.code_prefix || code.startsWith(r.code_prefix + '.') || (r.code_prefix.includes('.') && code.startsWith(r.code_prefix))));
  if (!matches.length) throw new Error('No approved diagnosis rule matches this ICD-10 code and clinical context. Select a clinician-reviewed category.');
  const order: AfpeCategory[] = ['acute', 'subacute', 'chronic'];
  const category = order.find(c => matches.some(r => r.category === c))!;
  return { category, rule_ids: matches.filter(r => r.category === category).map(r => r.id).sort() };
}
export function afpeDuration(category: AfpeCategory, requested?: number): number {
  const days = requested ?? AFPE_CADENCE[category].duration;
  const [min, max] = category === 'acute' ? [7, 14] : category === 'subacute' ? [30, 90] : [30, 365];
  if (!Number.isInteger(days) || days < min! || days > max!) throw new Error('Follow-up duration is outside the approved category window.');
  return days;
}
