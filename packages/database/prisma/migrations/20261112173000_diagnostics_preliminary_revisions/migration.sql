CREATE TABLE "investigation_report_revisions" (
 "id" UUID NOT NULL,
 "order_id" UUID NOT NULL,
 "version" INTEGER NOT NULL,
 "snapshot" JSONB NOT NULL,
 "corrected_by_id" UUID NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "investigation_report_revisions_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "investigation_report_revisions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "investigation_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "investigation_report_revisions_order_id_version_key" ON "investigation_report_revisions"("order_id","version");
