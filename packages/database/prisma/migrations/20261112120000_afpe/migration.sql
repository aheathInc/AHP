-- CreateTable
CREATE TABLE "afpe_plans" (
    "id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "baseline" JSONB NOT NULL,
    "diagnosis_codes" JSONB NOT NULL,
    "diagnosis_rule_ids" JSONB NOT NULL DEFAULT '[]',
    "duration_days" INTEGER NOT NULL,
    "interval_days" INTEGER NOT NULL,
    "next_due_at" TIMESTAMP(3) NOT NULL,
    "consent_confirmed_at" TIMESTAMP(3) NOT NULL,
    "rule_version" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fallback_channel" VARCHAR(20),
    "fallback_user_id" UUID,
    "fallback_consent_at" TIMESTAMP(3),

    CONSTRAINT "afpe_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "afpe_assessments" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "check_in_id" UUID NOT NULL,
    "score" INTEGER,
    "band" VARCHAR(20) NOT NULL,
    "components" JSONB NOT NULL,
    "missing" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "clinical_summary" JSONB NOT NULL,
    "patient_report" JSONB NOT NULL,
    "rule_version" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "afpe_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "afpe_alerts" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "dedupe_key" VARCHAR(200) NOT NULL,
    "reason" VARCHAR(60) NOT NULL,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "afpe_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "afpe_interactions" (
    "external_message_id" VARCHAR(180),
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "check_in_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "patient_text" VARCHAR(2000) NOT NULL,
    "reply" JSONB NOT NULL,
    "mode" VARCHAR(30) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "afpe_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "afpe_deliveries" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "check_in_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claim_token" UUID,
    "claim_until" TIMESTAMP(3),
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider_ref" VARCHAR(180),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "afpe_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "afpe_plans_cycle_id_key" ON "afpe_plans"("cycle_id");

-- CreateIndex
CREATE INDEX "afpe_plans_next_due_at_idx" ON "afpe_plans"("next_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "afpe_assessments_check_in_id_key" ON "afpe_assessments"("check_in_id");

-- CreateIndex
CREATE INDEX "afpe_assessments_plan_id_created_at_idx" ON "afpe_assessments"("plan_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "afpe_alerts_dedupe_key_key" ON "afpe_alerts"("dedupe_key");

-- CreateIndex
CREATE INDEX "afpe_alerts_plan_id_acknowledged_at_idx" ON "afpe_alerts"("plan_id", "acknowledged_at");

-- CreateIndex
CREATE UNIQUE INDEX "afpe_interactions_external_message_id_key" ON "afpe_interactions"("external_message_id");

-- CreateIndex
CREATE INDEX "afpe_interactions_plan_id_created_at_idx" ON "afpe_interactions"("plan_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "afpe_deliveries_check_in_id_key" ON "afpe_deliveries"("check_in_id");

-- CreateIndex
CREATE INDEX "afpe_deliveries_status_next_attempt_at_idx" ON "afpe_deliveries"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "afpe_plans" ADD CONSTRAINT "afpe_plans_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "follow_up_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "afpe_assessments" ADD CONSTRAINT "afpe_assessments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "afpe_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "afpe_assessments" ADD CONSTRAINT "afpe_assessments_check_in_id_fkey" FOREIGN KEY ("check_in_id") REFERENCES "check_ins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "afpe_alerts" ADD CONSTRAINT "afpe_alerts_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "afpe_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "afpe_interactions" ADD CONSTRAINT "afpe_interactions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "afpe_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "afpe_interactions" ADD CONSTRAINT "afpe_interactions_check_in_id_fkey" FOREIGN KEY ("check_in_id") REFERENCES "check_ins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "afpe_deliveries" ADD CONSTRAINT "afpe_deliveries_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "afpe_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "afpe_deliveries" ADD CONSTRAINT "afpe_deliveries_check_in_id_fkey" FOREIGN KEY ("check_in_id") REFERENCES "check_ins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "afpe_assessments" ADD CONSTRAINT "afpe_score_range" CHECK (score IS NULL OR score BETWEEN 0 AND 100);
ALTER TABLE "afpe_assessments" ADD CONSTRAINT "afpe_band" CHECK (band IN ('green', 'yellow', 'red', 'incomplete'));
ALTER TABLE "afpe_plans" ADD CONSTRAINT "afpe_category" CHECK (category IN ('acute', 'subacute', 'chronic'));
ALTER TABLE "afpe_plans" ADD CONSTRAINT "afpe_interval" CHECK (interval_days BETWEEN 1 AND 30);
ALTER TABLE "afpe_plans" ADD CONSTRAINT "afpe_fallback" CHECK (fallback_channel IS NULL OR fallback_channel IN ('sms', 'whatsapp'));
ALTER TABLE "afpe_deliveries" ADD CONSTRAINT "afpe_delivery_status" CHECK (status IN ('queued', 'accepted', 'suppressed', 'failed'));
CREATE UNIQUE INDEX "afpe_checkin_slot" ON "check_ins" (follow_up_cycle_id, scheduled_at) WHERE questions @> '[{"afpe":true}]'::jsonb;
ALTER TABLE "afpe_plans" ADD CONSTRAINT "afpe_duration" CHECK ((category = 'acute' AND duration_days BETWEEN 7 AND 14) OR (category = 'subacute' AND duration_days BETWEEN 30 AND 90) OR (category = 'chronic' AND duration_days BETWEEN 30 AND 365));
ALTER TABLE "afpe_plans" ADD CONSTRAINT "afpe_fallback_consent" CHECK ((fallback_channel IS NULL AND fallback_user_id IS NULL AND fallback_consent_at IS NULL) OR (fallback_channel IS NOT NULL AND fallback_user_id IS NOT NULL AND fallback_consent_at IS NOT NULL));
ALTER TABLE "afpe_assessments" ADD CONSTRAINT "afpe_score_completeness" CHECK ((score IS NOT NULL OR band IN ('red', 'incomplete')) AND (band != 'incomplete' OR score IS NULL));
ALTER TABLE "afpe_alerts" ADD CONSTRAINT "afpe_acknowledgement" CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL));
