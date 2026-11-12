ALTER TABLE "emergency_requests"
 ADD COLUMN "client_request_id" UUID,
 ADD COLUMN "client_payload_hash" VARCHAR(64),
 ADD COLUMN "dispatch_priority" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "acknowledged_at" TIMESTAMP(3),
 ADD COLUMN "location_source" VARCHAR(20) NOT NULL DEFAULT 'manual',
 ADD COLUMN "location_accuracy_m" DOUBLE PRECISION,
 ADD COLUMN "location_captured_at" TIMESTAMP(3),
 ADD COLUMN "landmark" VARCHAR(500),
 ADD CONSTRAINT "emergency_dispatch_priority_check" CHECK ("dispatch_priority" IN (0,1,2)),
 ADD CONSTRAINT "emergency_location_accuracy_check" CHECK ("location_accuracy_m" IS NULL OR "location_accuracy_m" >= 0);
CREATE UNIQUE INDEX "emergency_requests_client_request_id_key" ON "emergency_requests"("client_request_id");
-- Refuse migration if existing active assignments collide; never discard incidents.
CREATE UNIQUE INDEX "emergency_active_transport_key" ON "emergency_requests"("transport_unit_id")
 WHERE "transport_unit_id" IS NOT NULL AND "status" IN ('dispatched','en_route','arrived');
CREATE INDEX "emergency_active_priority_idx" ON "emergency_requests"("status","dispatch_priority" DESC,"reported_at");
