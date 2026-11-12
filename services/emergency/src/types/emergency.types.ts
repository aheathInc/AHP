import { z } from 'zod';

export const coordinatesSchema = z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) }).refine(p => p.lat !== 0 || p.lng !== 0, 'A real incident location is required');
const priority = z.enum(['highest', 'other']);

export const createEmergencySchema = z.object({
  client_request_id: z.string().uuid().optional(),
  device_alert_id: z.string().uuid().optional(),
  location_source: z.enum(['gps','manual','device']).default('manual'),
  location_accuracy_m: z.number().finite().min(0).max(1000000).optional(),
  location_captured_at: z.string().datetime().optional(),
  landmark: z.string().trim().max(500).optional(),
  scale: z.enum(['individual', 'mass_casualty']),
  category: z.enum(['medical', 'trauma', 'obstetric', 'road_traffic', 'fire', 'other']).optional(),
  location: coordinatesSchema,
  patient_profile_id: z.string().uuid().optional(),
  estimated_casualties: z.number().int().min(1).optional(),
  description: z.string().max(2000).optional(),
  reporter_phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  source: z.enum(['patient_app', 'bystander', 'ussd', 'sms', 'voice', 'wearable', 'vehicle_sensor', 'facility']).optional(),
  channel: z.enum(['app', 'sms', 'ussd', 'voice', 'web']).optional(),
});

export const listEmergenciesQuery = z.object({
  scope: z.enum(['active','closed','all']).default('all'),
  status: z.enum(['reported', 'triaged', 'dispatched', 'en_route', 'arrived', 'resolved', 'cancelled']).optional(),
  facility_id: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const dispatchSchema = z.object({
  base_version: z.number().int().positive().optional(),
  priority: priority.optional(),
  break_glass_reason: z.string().trim().min(10).max(500).optional(),
  transport_unit_id: z.string().uuid(),
  destination_facility_id: z.string().uuid(),
  notes: z.string().max(1000).optional(),
});

export const setStatusSchema = z.object({
  base_version: z.number().int().positive().optional(),
  priority: priority.optional(),
  status: z.enum(['triaged', 'en_route', 'arrived', 'resolved', 'cancelled']),
  outcome: z.enum(['transported', 'treated_on_scene', 'refused_care', 'false_alarm', 'deceased']).optional(),
  notes: z.string().max(1000).optional(),
});

export const listUnitsQuery = z.object({
  status: z.enum(['available', 'dispatched', 'en_route', 'at_scene', 'transporting', 'out_of_service']).optional(),
  near_lat: z.coerce.number().finite().min(-90).max(90).optional(),
  near_lng: z.coerce.number().finite().min(-180).max(180).optional(),
});

export const updateLocationSchema = z.object({
  location: coordinatesSchema,
  heading_degrees: z.number().optional(),
  speed_kph: z.number().min(0).optional(),
});

export const setUnitStatusSchema = z.object({
  base_version: z.number().int().positive().optional(),
  status: z.enum(['available', 'dispatched', 'en_route', 'at_scene', 'transporting', 'out_of_service']),
});

export const reassessPrioritySchema=z.object({priority,base_version:z.number().int().positive(),notes:z.string().trim().min(10).max(1000)}).strict();
