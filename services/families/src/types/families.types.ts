import { z } from "zod";
export const tierSchema = z.enum(["none", "family_basic", "family_plus"]);
export const createFamilySchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    subscription_tier: z.literal("none").optional(),
  })
  .strict();
export const addMemberSchema = z
  .object({
    patient_profile_id: z.string().uuid(),
    relationship: z.enum([
      "head",
      "spouse",
      "child",
      "parent",
      "sibling",
      "dependant",
      "other",
    ]),
  })
  .strict();
export const assignDoctorsSchema = z
  .object({
    gp_clinician_id: z.string().uuid().nullable().optional(),
    obgyn_clinician_id: z.string().uuid().nullable().optional(),
    base_version: z.number().int().positive(),
  })
  .strict()
  .refine(
    (v) =>
      v.gp_clinician_id !== undefined || v.obgyn_clinician_id !== undefined,
    { message: "Specify at least one assignment slot" },
  );
export const listFamiliesSchema = z.object({
  q: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const planSchema = z
  .object({
    base_version: z.number().int().positive(),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(600),
    benefits: z.array(z.string().trim().min(1).max(200)).max(12),
    exclusions: z.array(z.string().trim().min(1).max(200)).max(12),
    price_minor: z.number().int().min(0).max(2000000000).nullable(),
    currency: z.literal("TZS"),
    billing_period: z.enum(["monthly", "annual"]),
    accepting_requests: z.boolean(),
  })
  .strict()
  .refine(
    (v) =>
      !v.accepting_requests ||
      (v.price_minor !== null && v.benefits.length > 0),
    { message: "Opening enrollment requires a published price and benefits" },
  );
export const requestPlanSchema = z
  .object({
    tier: tierSchema,
    plan_version: z.number().int().positive(),
    client_request_id: z.string().uuid(),
    terms_confirmed: z.literal(true),
  })
  .strict();
export const reviewPlanSchema = z
  .object({
    base_version: z.number().int().positive(),
    action: z.enum(["approve", "decline"]),
    note: z.string().trim().min(5).max(600),
  })
  .strict();
export const requestListSchema = z.object({
  status: z.enum(["pending", "reviewed", "all"]).default("pending"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
