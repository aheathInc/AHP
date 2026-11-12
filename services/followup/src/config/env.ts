import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  AFPE_CLINICAL_POLICY_APPROVED: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  AFPE_DIAGNOSIS_RULES_JSON: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4007),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('a-health'),
  JWT_AUDIENCE: z.string().default('a-health-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  AFPE_AI_URL: z.string().url().refine(v => v.startsWith('https://'), 'AFPE inference requires HTTPS.').optional(),
  AFPE_AI_KEY: z.string().min(16).optional(),
  AFPE_MESSAGING_URL: z.string().url().refine(v => v.startsWith('https://')).optional(),
  AFPE_MESSAGING_KEY: z.string().min(16).optional(),
  AFPE_MESSAGING_WEBHOOK_SECRET: z.string().min(32).optional(),
  GOTHOMIS_WEBHOOK_SECRET: z.string().min(32).optional(),
  CARE_REMINDER_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(300).default(30),
  CARE_REMINDER_WINDOW_MINUTES: z.coerce.number().int().min(1).max(240).default(120),
  CARE_REMINDER_BATCH: z.coerce.number().int().min(1).max(200).default(100),
  SCHEDULER_INTERVAL_MINUTES: z.coerce.number().default(15),
  SCHEDULE_HORIZON_DAYS: z.coerce.number().default(2),
  MISSED_AFTER_HOURS: z.coerce.number().default(24),
  ADHERENCE_MISS_THRESHOLD: z.coerce.number().default(3),
});

export const env = envSchema.parse(process.env);
