ALTER TABLE "slots" ADD COLUMN "is_published" BOOLEAN NOT NULL DEFAULT true;

-- Retain cancelled booking history while allowing its published slot to be reused.
DROP INDEX "appointments_slot_id_key";
CREATE INDEX "appointments_slot_id_idx" ON "appointments"("slot_id");
CREATE UNIQUE INDEX "appointments_occupied_slot_key" ON "appointments"("slot_id") WHERE "status" <> 'cancelled';
