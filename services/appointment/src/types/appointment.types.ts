import { z } from 'zod';

export const createAppointmentSchema = z.object({
  slot_id: z.string().uuid(),
  care_thread_id: z.string().uuid().optional(),
  patient_profile_id: z.string().uuid().optional(),
  reason: z.string().max(1000).optional(),
});

export const listAppointmentsQuery = z.object({
  status: z.enum(['booked', 'started', 'completed', 'cancelled', 'no_show']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const cancelAppointmentSchema = z.object({
  base_version: z.number().int().positive().optional(),
  reason: z.string().max(500).optional(),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const rescheduleAppointmentSchema = z.object({ slot_id: z.string().uuid(), base_version: z.number().int().positive() }).strict();
export const rescheduleOptionsQuery = z.object({ cursor: z.string().max(200).refine(value => /^[A-Za-z0-9_-]+$/.test(value) && z.string().uuid().safeParse(Buffer.from(value, 'base64url').toString('utf8')).success, 'Invalid rescheduling cursor.').optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

export const appointmentIdSchema = z.string().uuid();
