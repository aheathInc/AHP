ALTER TABLE "investigation_orders"
  ADD COLUMN "specimen_reference" VARCHAR(100),
  ADD COLUMN "specimen_type" VARCHAR(100),
  ADD COLUMN "collected_at" TIMESTAMP(3),
  ADD COLUMN "received_at" TIMESTAMP(3),
  ADD COLUMN "received_by_id" UUID,
  ADD COLUMN "report_prepared_at" TIMESTAMP(3),
  ADD COLUMN "entered_by_id" UUID,
  ADD COLUMN "released_by_id" UUID,
  ADD COLUMN "released_by_name" VARCHAR(200);
ALTER TABLE "investigation_values" ADD COLUMN "critical_low" DOUBLE PRECISION, ADD COLUMN "critical_high" DOUBLE PRECISION;
