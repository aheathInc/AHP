import { z } from "zod";

export const createOrderSchema = z.object({
  care_thread_id: z.string().uuid(),
  consultation_id: z.string().uuid().optional(),
  investigation_code: z.string().trim().min(1).max(40),
  investigation_type: z.enum([
    "laboratory",
    "imaging",
    "pathology",
    "point_of_care",
  ]),
  clinical_notes: z.string().max(2000).optional(),
  urgency: z.enum(["routine", "urgent", "emergency"]).optional(),
  facility_id: z.string().uuid().optional(),
});

export const resultValueSchema = z
  .object({
    analyte: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(200),
    unit: z.string().max(40).optional(),
    reference_low: z.number().optional(),
    reference_high: z.number().optional(),
    /** Retained with the report so its numeric flag remains traceable. */
    critical_low: z.number().optional(),
    critical_high: z.number().optional(),
  })
  .refine(
    (v) =>
      v.reference_low === undefined ||
      v.reference_high === undefined ||
      v.reference_low <= v.reference_high,
    {
      message: "Reference low must not exceed reference high",
      path: ["reference_low"],
    },
  )
  .refine(
    (v) =>
      v.critical_low === undefined ||
      v.critical_high === undefined ||
      v.critical_low <= v.critical_high,
    {
      message: "Critical low must not exceed critical high",
      path: ["critical_low"],
    },
  );

export const fileResultSchema = z.object({
  save_as_draft: z.boolean().optional(),
  base_version: z.number().int().positive().optional(),
  values: z.array(resultValueSchema).min(1).max(100),
  narrative: z.string().max(4000).optional(),
  attachment_key: z.string().max(500).optional(),
});

export const listOrdersQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    worklist: z
      .enum([
        "all",
        "awaiting_sample",
        "in_lab",
        "review",
        "critical",
        "acknowledged",
      ])
      .optional(),
    care_thread_id: z.string().uuid().optional(),
    status: z
      .enum([
        "ordered",
        "scheduled",
        "collected",
        "resulted",
        "acknowledged",
        "cancelled",
      ])
      .optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine(
    (value) => !value.status || !value.worklist || value.worklist === "all",
    {
      message: "Choose either status or worklist filtering",
      path: ["worklist"],
    },
  );

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type FileResultInput = z.infer<typeof fileResultSchema>;

export const collectSchema = z.object({
  base_version: z.number().int().positive(),
  specimen_reference: z.string().trim().min(1).max(100).optional(),
  specimen_type: z.string().trim().min(1).max(100).optional(),
  collected_at: z.iso
    .datetime({ offset: true })
    .refine(
      (v) => Date.parse(v) <= Date.now() + 5 * 60_000,
      "Collection time cannot be in the future",
    )
    .optional(),
});
export const releaseSchema = z.object({
  base_version: z.number().int().positive(),
  confirm_review: z.literal(true),
});
export const acknowledgeSchema = z.object({
  base_version: z.number().int().positive().optional(),
});
export const membershipQuery = z.object({ facility_id: z.string().uuid() });
export const membershipSchema = membershipQuery.extend({
  email: z.string().trim().toLowerCase().email(),
  is_active: z.boolean(),
});
