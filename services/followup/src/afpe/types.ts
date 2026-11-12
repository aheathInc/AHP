import { z } from 'zod';
export const baselineSchema = z.object({
  symptom_severity: z.number().min(0).max(10),
  medication_required: z.boolean(),
  vitals: z.partialRecord(z.enum(['temperature_c', 'systolic', 'diastolic', 'glucose_mmol_l', 'spo2']), z.number().finite()),
  vital_bounds: z.partialRecord(z.enum(['temperature_c', 'systolic', 'diastolic', 'glucose_mmol_l', 'spo2']), z.object({ min: z.number().finite(), max: z.number().finite() }).refine(b => b.min <= b.max)).refine(v => Object.keys(v).length > 0, 'At least one clinician-defined vital range is required.'),
}).refine(v => Object.keys(v.vital_bounds).every(key => Number.isFinite(v.vitals[key as keyof typeof v.vitals])), 'Record a discharge reading for each configured vital measure.');
export const activateSchema = z.object({
  category: z.enum(['auto', 'acute', 'subacute', 'chronic']),
  diagnosis_context: z.enum(['new', 'stable', 'uncontrolled', 'high_risk', 'postoperative', 'treatment_initiation']).optional(),
  baseline: baselineSchema,
  diagnosis_codes: z.array(z.string().regex(/^[A-Z][0-9]{2}(\.[A-Z0-9]{1,4})?$/)).min(1).max(20),
  consent_confirmed: z.literal(true),
  duration_days: z.number().int().min(7).max(365).optional(),
});
export const observationSchema = z.object({
  symptom_severity: z.number().min(0).max(10),
  side_effects: z.string().trim().max(1000).optional(),
  vitals: z.partialRecord(z.enum(['temperature_c', 'systolic', 'diastolic', 'glucose_mmol_l', 'spo2']), z.number().finite()).default({}),
});
