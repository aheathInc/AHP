import { z } from 'zod';

export const rateConsultationSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export const createIncidentSchema = z.object({
  category: z.enum(['clinical_care', 'misconduct', 'medication_error', 'delayed_response', 'data_privacy', 'ai_error', 'other']),
  severity: z.enum(['low', 'moderate', 'serious', 'catastrophic']).optional(),
  description: z.string().min(1).max(4000),
  consultation_id: z.string().uuid().optional(),
  clinician_id: z.string().uuid().optional(),
  facility_id: z.string().uuid().optional(),
  anonymous: z.boolean().optional(),
});

export const listIncidentsQuery = z.object({
  status: z.enum(['open', 'reported', 'under_investigation', 'action_taken', 'closed']).optional(),
  severity: z.enum(['low', 'moderate', 'serious', 'catastrophic']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});


export const updateIncidentSchema = z.object({
  expected_version: z.number().int().min(1),
  status: z.enum(['under_investigation', 'action_taken', 'closed']),
  investigation_notes: z.string().trim().min(5).max(4000).optional(),
  action_taken: z.string().trim().min(5).max(4000).optional(),
}).strict().superRefine((value, ctx) => {
  const field = value.status === 'under_investigation' ? 'investigation_notes' : 'action_taken';
  if (!value[field]) ctx.addIssue({ code: 'custom', path: [field], message: field === 'investigation_notes' ? 'Record the investigation plan or reason for reopening.' : 'Record the action taken before advancing this incident.' });
});
